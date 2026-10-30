import type { PlatformDb, PlatformTx } from '@booq/db';
import { LINE_USER_ID } from '../line-id';
import type { Connections, ConnectionPlan, TestOutcome } from '../connections/connections';

// The support view (F01-T19; PLAT-02-AC2 to AC7, AC9; design 5.2): GET and PUT
// /clubs/{id}/support/setup and the session behind them. Transport-neutral: the routes call these
// functions with the staff id the platform auth (T17) authenticated.
//
// The database decides who may see and change what (migration 0008): a club the staff member
// cannot see is simply absent, so "unassigned" and "does not exist" give the same not_found.
// This module adds the projection, the validation, the session and the logging.

export type SupportMode = 'edit' | 'look';

export interface SupportSetup {
  mode: SupportMode;
  club: Record<string, unknown>;
  hours: Array<Record<string, unknown>>;
  locations: Array<Record<string, unknown>>;
  resources: Array<Record<string, unknown>>;
  settings: Array<{ key: string; value: unknown }>;
  features: Array<{ feature_key: string; enabled: boolean }>;
}

export type GetSetupResult = { ok: true; setup: SupportSetup } | { ok: false; code: 'not_found' };
export type PutSetupResult =
  | { ok: true; changed: string[]; pendingOwnerContact?: string; connectionTest?: TestOutcome }
  | { ok: false; code: 'not_found' | 'look_only' | 'invalid' | 'section_unavailable' | 'step_up_required' };
export type TestConnectionResult = ({ ok: true } & TestOutcome) | { ok: false; code: 'not_found' | 'invalid' | 'section_unavailable' };

// The club columns the support view shows: setup and the owner contact (decision D2). Not the
// support window columns and nothing about people.
const CLUB_COLUMNS = [
  'id', 'slug', 'name_th', 'name_en', 'legal_name', 'tax_id', 'tax_branch', 'registered_address', 'status',
  'payment_option', 'template_id', 'receipt_prefix', 'default_language', 'owner_name', 'owner_phone', 'owner_line',
  'owner_email', 'plan_trial_ends_at', 'billing_starts_at', 'created_at',
] as const;

const BASICS = ['slug', 'name_th', 'name_en', 'legal_name', 'tax_id', 'tax_branch', 'registered_address', 'payment_option',
  'receipt_prefix', 'default_language', 'owner_name', 'owner_phone', 'owner_line', 'owner_email'] as const;
const PLAN = ['plan_trial_ends_at', 'billing_starts_at'] as const;
const SECTIONS = ['basics', 'plan', 'resources-hours', 'line', 'payments', 'features', 'template'] as const;
// The connection sections write secrets and run tests, so they need the connection service and a fresh second factor (SR-16).
const CONNECTION_SECTIONS = new Set(['line', 'payments']);

class Invalid extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function pick(body: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!isObject(body)) throw new Invalid();
  const keys = Object.keys(body);
  if (keys.length === 0 || keys.some((k) => !allowed.includes(k))) throw new Invalid();
  for (const k of keys) {
    const v = body[k];
    if (typeof v !== 'string' && v !== null) throw new Invalid();
  }
  return body;
}

async function setColumns(tx: PlatformTx, clubId: string, values: Record<string, unknown>): Promise<string[]> {
  const cols = Object.keys(values);
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const r = await tx.query(`update public.club set ${sets} where id = $1`, [clubId, ...cols.map((c) => values[c])]);
  if (r.rowCount !== 1) throw new Invalid();
  return cols;
}

interface Applied {
  changed: string[];
  detail: Record<string, unknown>;
  /** Set when an owner contact change waits for a second admin (design 7.1). */
  pendingOwnerContact?: string;
  connectionTest?: TestOutcome;
}

const OWNER_COLUMNS = ['owner_name', 'owner_phone', 'owner_line', 'owner_email'];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

async function applySection(tx: PlatformTx, clubId: string, section: string, body: unknown, connection?: { connections: Connections; plan: ConnectionPlan }): Promise<Applied> {
  switch (section) {
    case 'line':
    case 'payments': {
      if (!connection) throw new Invalid();
      const a = await connection.connections.apply(tx, clubId, connection.plan);
      return { changed: a.changed, detail: a.detail, ...(a.connectionTest ? { connectionTest: a.connectionTest } : {}) };
    }
    case 'basics': {
      const values = pick(body, BASICS);
      if (typeof values['owner_line'] === 'string' && !LINE_USER_ID.test(values['owner_line'])) throw new Invalid();
      // The owner contact is not a plain column write: after an owner invite exists a second admin
      // must approve it (platform.change_owner_contact decides, review T18 R5).
      const owner = Object.fromEntries(Object.entries(values).filter(([k]) => OWNER_COLUMNS.includes(k)));
      const other = Object.fromEntries(Object.entries(values).filter(([k]) => !OWNER_COLUMNS.includes(k)));
      const changed = Object.keys(other).length ? await setColumns(tx, clubId, other) : [];
      let pendingOwnerContact: string | undefined;
      let applied = other;
      if (Object.keys(owner).length) {
        const r = await tx.query<{ r: { applied: boolean; request_id?: string } }>('select platform.change_owner_contact($1, $2::jsonb) as r', [clubId, JSON.stringify(owner)]);
        if (r.rows[0]?.r.applied) {
          changed.push(...Object.keys(owner));
          applied = { ...other, ...owner };
        } else {
          pendingOwnerContact = r.rows[0]?.r.request_id;
        }
      }
      return { changed, detail: { section, changed: applied }, ...(pendingOwnerContact ? { pendingOwnerContact } : {}) };
    }
    case 'plan': {
      const values = pick(body, PLAN);
      return { changed: await setColumns(tx, clubId, values), detail: { section, changed: values } };
    }
    case 'template': {
      // Starting from a template copies it into the club (PLAT-05-AC7, AC12); it is not a column write.
      const values = pick(body, ['template_id']);
      const r = await tx.query<{ r: { template: string; copied: Record<string, number>; pending: string[] } }>('select app.apply_template($1) as r', [values['template_id']]);
      return { changed: ['template_id'], detail: { section, template: r.rows[0]?.r.template, copied: r.rows[0]?.r.copied, pending: r.rows[0]?.r.pending } };
    }
    case 'features': {
      if (!isObject(body) || !isObject(body['features']) || Object.keys(body).length !== 1) throw new Invalid();
      const features = body['features'];
      const names = Object.keys(features);
      if (names.length === 0 || names.some((n) => n === '' || typeof features[n] !== 'boolean')) throw new Invalid();
      for (const n of names) {
        await tx.query(
          `insert into public.club_feature (club_id, feature_key, enabled) values ($1, $2, $3)
           on conflict (club_id, feature_key) do update set enabled = excluded.enabled`,
          [clubId, n, features[n]],
        );
      }
      // Feature names are values, not keys, so the log's key check never sees them.
      return { changed: names, detail: { section, changed: { features: names.map((name) => ({ name, enabled: features[name] })) } } };
    }
    case 'resources-hours': {
      if (!isObject(body)) throw new Invalid();
      const keys = Object.keys(body);
      if (keys.length === 0 || keys.some((k) => k !== 'hours' && k !== 'resources')) throw new Invalid();
      const changed: string[] = [];
      const detail: Record<string, unknown> = { section };
      if ('hours' in body) {
        const hours = body['hours'];
        if (!Array.isArray(hours) || hours.length === 0) throw new Invalid();
        for (const h of hours) {
          if (!isObject(h) || Object.keys(h).length !== 3) throw new Invalid();
          const { weekday, open, close } = h;
          if (!Number.isInteger(weekday) || (weekday as number) < 1 || (weekday as number) > 7) throw new Invalid();
          if (typeof open !== 'string' || !HHMM.test(open) || typeof close !== 'string' || !(HHMM.test(close) || close === '24:00')) throw new Invalid();
          await tx.query(
            `insert into public.opening_hours (club_id, weekday, open, close) values ($1, $2, $3, $4)
             on conflict (club_id, weekday) do update set open = excluded.open, close = excluded.close`,
            [clubId, weekday, open, close],
          );
        }
        changed.push('hours');
        detail['hours'] = hours;
      }
      if ('resources' in body) {
        const resources = body['resources'];
        if (!Array.isArray(resources) || resources.length === 0) throw new Invalid();
        const fields = ['name', 'sport', 'type', 'lights', 'max_players', 'active'];
        for (const r of resources) {
          if (!isObject(r)) throw new Invalid();
          const given = Object.keys(r);
          if (given.some((k) => k !== 'id' && k !== 'location_id' && !fields.includes(k))) throw new Invalid();
          const cols = given.filter((k) => fields.includes(k));
          if (typeof r['id'] === 'string') {
            if (cols.length === 0 || 'location_id' in r) throw new Invalid();
            const sets = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
            const u = await tx.query(`update public.resource set ${sets} where club_id = $1 and id = $2`, [clubId, r['id'], ...cols.map((c) => r[c])]);
            if (u.rowCount !== 1) throw new Invalid();
          } else {
            if (typeof r['location_id'] !== 'string' || typeof r['name'] !== 'string' || typeof r['sport'] !== 'string') throw new Invalid();
            const all = ['location_id', ...cols];
            await tx.query(
              `insert into public.resource (club_id, ${all.join(', ')}) values ($1, ${all.map((_, i) => `$${i + 2}`).join(', ')})`,
              [clubId, ...all.map((c) => r[c])],
            );
          }
        }
        changed.push('resources');
        // Names of the changed fields only: a column such as max_players is a count, but the log
        // refuses keys that name players, so values are listed instead.
        detail['resources'] = { count: resources.length };
      }
      return { changed, detail };
    }
    default:
      throw new Invalid();
  }
}

interface StaffRow {
  id: string;
  display_name: string;
  role: string;
  active: boolean;
}

export function createSupportService(deps: { db: PlatformDb; connections?: Connections }) {
  const { db } = deps;

  async function loadStaff(staffId: string): Promise<StaffRow | null> {
    const row = await db.withPlatformTx({ staffId: null }, async (tx) => (await tx.query<StaffRow>('select id, display_name, role, active from platform.staff_by_id($1)', [staffId])).rows[0] ?? null);
    return row && row.active ? row : null;
  }

  const p6 = (tx: PlatformTx, action: string, club: string | null, detail: Record<string, unknown>, session: string | null = null, reason: string | null = null) =>
    tx.query('select platform.write_audit($1, $2, $3, $4, $5::jsonb, $6, $7)', [action, club, club ? 'club' : null, club, JSON.stringify(detail), reason, session]);

  const clubNote = (tx: PlatformTx, action: string, record: string, detail: Record<string, unknown>) =>
    tx.query(`select audit.note($1, $2, $3, $4::jsonb, null)`, [action, 'club', record, JSON.stringify(detail)]);

  /** Makes sure the staff member has one open session of the wanted mode on this club. */
  async function ensureSession(tx: PlatformTx, staffId: string, clubId: string, mode: SupportMode): Promise<string> {
    const open = await tx.query<{ id: string; mode: SupportMode }>(
      'select id, mode from platform.support_session where staff_id = $1 and club_id = $2 and closed_at is null',
      [staffId, clubId],
    );
    for (const s of open.rows) {
      if (s.mode === mode) return s.id;
      await tx.query('update platform.support_session set closed_at = app.now() where id = $1', [s.id]);
      await tx.query(`select set_config('app.support_session_id', $1, true)`, [s.id]);
      await p6(tx, 'support.session_closed', clubId, { mode: s.mode, reason: 'mode_changed' }, s.id);
      await clubNote(tx, 'support.session_closed', clubId, { mode: s.mode });
    }
    const made = await tx.query<{ id: string }>('insert into platform.support_session (staff_id, club_id, mode) values ($1, $2, $3) returning id', [staffId, clubId, mode]);
    const id = made.rows[0]?.id as string;
    await tx.query(`select set_config('app.support_session_id', $1, true)`, [id]);
    await p6(tx, 'support.session_opened', clubId, { mode }, id);
    await clubNote(tx, 'support.session_opened', id, { mode });
    return id;
  }

  async function seeClub(tx: PlatformTx, clubId: string): Promise<Record<string, unknown> | null> {
    const r = await tx.query(`select ${CLUB_COLUMNS.join(', ')} from public.club where id = $1`, [clubId]);
    return r.rows[0] ?? null;
  }

  async function refused(staff: StaffRow, clubId: string, what: string): Promise<{ ok: false; code: 'not_found' }> {
    // The club may not exist, so it is not a foreign key: the id goes in the detail as text.
    await db.withPlatformTx({ staffId: staff.id, staffLabel: staff.display_name }, (tx) => p6(tx, 'support.access_refused', null, { what, club_ref: clubId }));
    return { ok: false, code: 'not_found' };
  }

  const validId = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

  async function getSetup(staffId: string, clubId: string): Promise<GetSetupResult> {
    const staff = validId(staffId) ? await loadStaff(staffId) : null;
    if (!staff) return { ok: false, code: 'not_found' };
    if (!validId(clubId)) return refused(staff, clubId, 'read');
    const result = await db.withPlatformTx({ staffId: staff.id, clubId, staffLabel: staff.display_name }, async (tx): Promise<SupportSetup | null> => {
      const club = await seeClub(tx, clubId);
      if (!club) return null;
      const editable = (await tx.query<{ ok: boolean }>('select platform.club_editable($1) as ok', [clubId])).rows[0]?.ok === true;
      const mode: SupportMode = editable ? 'edit' : 'look';
      await ensureSession(tx, staff.id, clubId, mode);
      const q = async (sql: string) => (await tx.query(sql, [clubId])).rows;
      return {
        mode,
        club,
        hours: await q('select weekday, open::text as open, close::text as close from public.opening_hours where club_id = $1 order by weekday'),
        locations: await q('select id, name from public.location where club_id = $1 order by name'),
        resources: await q('select id, location_id, name, sport, type, lights, max_players, active from public.resource where club_id = $1 order by name'),
        settings: (await q('select key, value from public.club_setting where club_id = $1 order by key')) as SupportSetup['settings'],
        features: (await q('select feature_key, enabled from public.club_feature where club_id = $1 order by feature_key')) as SupportSetup['features'],
      };
    });
    return result ? { ok: true, setup: result } : refused(staff, clubId, 'read');
  }

  async function putSetup(staffId: string, clubId: string, section: string, body: unknown, opts: { stepUpFresh?: boolean } = {}): Promise<PutSetupResult> {
    const staff = validId(staffId) ? await loadStaff(staffId) : null;
    if (!staff) return { ok: false, code: 'not_found' };
    if (!validId(clubId)) return refused(staff, clubId, 'write');
    if (!(SECTIONS as readonly string[]).includes(section)) return { ok: false, code: 'invalid' };

    // Connection sections: secrets and a network test. A fresh second factor is required (SR-16); the
    // caller must be able to see and edit the club before anything is sent to LINE or Beam.
    let connection: { connections: Connections; plan: ConnectionPlan } | undefined;
    if (CONNECTION_SECTIONS.has(section)) {
      if (!deps.connections) return { ok: false, code: 'section_unavailable' };
      if (opts.stepUpFresh !== true) return { ok: false, code: 'step_up_required' };
      const gate = await db.withPlatformTx({ staffId: staff.id, clubId, staffLabel: staff.display_name }, async (tx) => {
        if (!(await seeClub(tx, clubId))) return 'not_found' as const;
        return (await tx.query<{ ok: boolean }>('select platform.club_editable($1) as ok', [clubId])).rows[0]?.ok === true ? ('ok' as const) : ('look_only' as const);
      });
      if (gate === 'not_found') return refused(staff, clubId, 'write');
      if (gate === 'ok') {
        const prepared = await deps.connections.prepare(section as 'line' | 'payments', body);
        if (!prepared.ok) return { ok: false, code: 'invalid' };
        connection = { connections: deps.connections, plan: prepared.plan };
      }
    }

    type Outcome = { kind: 'not_found' } | { kind: 'look_only' } | { kind: 'done'; changed: string[]; pending?: string; test?: TestOutcome };
    try {
      const outcome = await db.withPlatformTx({ staffId: staff.id, clubId, staffLabel: staff.display_name }, async (tx): Promise<Outcome> => {
        if (!(await seeClub(tx, clubId))) return { kind: 'not_found' };
        const editable = (await tx.query<{ ok: boolean }>('select platform.club_editable($1) as ok', [clubId])).rows[0]?.ok === true;
        if (!editable) {
          const sid = await ensureSession(tx, staff.id, clubId, 'look');
          await p6(tx, 'support.edit_refused', clubId, { section, why: 'look_only' }, sid);
          await clubNote(tx, 'support.edit_refused', clubId, { section });
          return { kind: 'look_only' };
        }
        const sid = await ensureSession(tx, staff.id, clubId, 'edit');
        const applied = await applySection(tx, clubId, section, body, connection);
        await p6(tx, 'support.setup_changed', clubId, applied.detail, sid);
        await clubNote(tx, 'support.setup_changed', clubId, { section, fields: applied.changed });
        return {
          kind: 'done',
          changed: applied.changed,
          ...(applied.pendingOwnerContact ? { pending: applied.pendingOwnerContact } : {}),
          ...(applied.connectionTest ? { test: applied.connectionTest } : {}),
        };
      });
      if (outcome.kind === 'not_found') return refused(staff, clubId, 'write');
      if (outcome.kind === 'look_only') return { ok: false, code: 'look_only' };
      return {
        ok: true,
        changed: outcome.changed,
        ...(outcome.pending ? { pendingOwnerContact: outcome.pending } : {}),
        ...(outcome.test ? { connectionTest: outcome.test } : {}),
      };
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      // Invalid input, or a value the database refuses (check, unique, foreign key, bad text).
      if (e instanceof Invalid || /^(22|23)/.test(code) || /^template:/.test((e as Error).message ?? '')) return { ok: false, code: 'invalid' };
      throw e;
    }
  }

  /** "Test connection" (design 5.2): the probe on the values given, nothing written; the result is logged in P6. */
  async function testConnection(staffId: string, clubId: string, kind: 'line' | 'beam', body: unknown): Promise<TestConnectionResult> {
    const staff = validId(staffId) ? await loadStaff(staffId) : null;
    if (!staff) return { ok: false, code: 'not_found' };
    if (!deps.connections) return { ok: false, code: 'section_unavailable' };
    if (!validId(clubId)) return refused(staff, clubId, 'test');
    const visible = await db.withPlatformTx({ staffId: staff.id, clubId, staffLabel: staff.display_name }, async (tx) => (await seeClub(tx, clubId)) !== null);
    if (!visible) return refused(staff, clubId, 'test');
    const r = await deps.connections.test(kind, body);
    if (!r.ok) return r;
    await db.withPlatformTx({ staffId: staff.id, clubId, staffLabel: staff.display_name }, (tx) =>
      p6(tx, 'club.connection_tested', clubId, { connection: kind, result: r.result, ...(r.result === 'fail' ? { code: r.code } : {}) }),
    );
    return r;
  }

  async function closeSession(staffId: string, clubId: string): Promise<{ ok: true } | { ok: false; code: 'not_found' }> {
    const staff = validId(staffId) && validId(clubId) ? await loadStaff(staffId) : null;
    if (!staff) return { ok: false, code: 'not_found' };
    return db.withPlatformTx({ staffId: staff.id, clubId, staffLabel: staff.display_name }, async (tx) => {
      const open = await tx.query<{ id: string; mode: SupportMode }>(
        'update platform.support_session set closed_at = app.now() where staff_id = $1 and club_id = $2 and closed_at is null returning id, mode',
        [staff.id, clubId],
      );
      for (const s of open.rows) {
        await tx.query(`select set_config('app.support_session_id', $1, true)`, [s.id]);
        await p6(tx, 'support.session_closed', clubId, { mode: s.mode }, s.id);
        await clubNote(tx, 'support.session_closed', s.id, { mode: s.mode });
      }
      return { ok: true as const };
    });
  }

  return { getSetup, putSetup, closeSession, testConnection };
}
