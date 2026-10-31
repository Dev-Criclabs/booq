import type { PlatformDb } from '@booq/db';

// Admin writes of the console (PLAT-04 launch checks, P6 config, the legal notice; migrations 0046 and 0048).
// Each one calls the database function that owns the rule and writes P6 itself, so this module only
// validates the shape, maps the function's refusals to codes, and requires a fresh second factor.
// There is no "run check" operation: a recorded check is set by an admin, the others come from facts.

export interface AdminActor {
  staffId: string;
  stepUpFresh: boolean;
}

type Refusal = { ok: false; code: string } & Record<string, unknown>;
export type RecordCheckResult = { ok: true } | Refusal;
export type SetConfigResult = { ok: true } | Refusal;
export interface LaunchItem {
  item: string;
  result: string;
  owed_by: 'booq' | 'owner';
  /** True for a check an admin records by hand; the others are worked out from the club's data. */
  recorded: boolean;
}
export type LaunchResult = { ok: true; clubName: string; clubStatus: string; items: LaunchItem[] } | { ok: false; code: 'not_found' };
export type ListConfigResult = { ok: true; config: Array<{ key: string; value: unknown }> } | { ok: false; code: 'not_found' };
export interface LegalTexts { [kind: string]: { [language: string]: { title: string; body: string } } }
export type LegalOverview = {
  ok: true;
  releases: Array<{ version: string; publishedAt: string; publishedBy: string | null }>;
  /** The newest release with its texts, or null when nothing is published yet. */
  current: { version: string; texts: LegalTexts } | null;
};
export type LegalOverviewResult = LegalOverview | { ok: false; code: 'not_found' };
export type PublishLegalResult = { ok: true; version: string } | Refusal;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

interface Staff {
  id: string;
  display_name: string;
  role: string;
  active: boolean;
}

export function createAdminService(deps: { db: PlatformDb }) {
  const { db } = deps;

  async function loadAdmin(actor: AdminActor): Promise<Staff | Refusal> {
    if (!UUID.test(actor.staffId)) return { ok: false, code: 'not_found' };
    const row = await db.withPlatformTx({ staffId: null }, async (tx) => (await tx.query<Staff>('select id, display_name, role, active from platform.staff_by_id($1)', [actor.staffId])).rows[0] ?? null);
    if (!row || !row.active) return { ok: false, code: 'not_found' };
    // The functions below check the role themselves; this answer only keeps a specialist from learning more.
    if (row.role !== 'platform_admin') return { ok: false, code: 'forbidden' };
    if (!actor.stepUpFresh) return { ok: false, code: 'step_up_required' };
    return row;
  }

  /** A raised refusal of the form `prefix:code[:a[:b]]`, or null for anything else (which is a real failure). */
  function parts(e: unknown, prefix: string): string[] | null {
    const err = e as { code?: string; message?: string };
    if (err.code !== 'P0001' && err.code !== '42501') return null;
    const m = new RegExp(`^${prefix}:(.+)$`).exec(err.message ?? '');
    return m ? m[1]!.split(':') : null;
  }

  async function recordLaunchCheck(actor: AdminActor, clubId: string, checkKey: unknown, body: unknown): Promise<RecordCheckResult> {
    const admin = await loadAdmin(actor);
    if ('ok' in admin) return admin;
    if (!UUID.test(clubId)) return { ok: false, code: 'not_found' };
    if (typeof checkKey !== 'string' || checkKey === '' || !isObject(body) || typeof body['result'] !== 'string' || Object.keys(body).length !== 1) return { ok: false, code: 'invalid' };
    try {
      await db.withPlatformTx({ staffId: admin.id, staffLabel: admin.display_name, clubId }, (tx) =>
        tx.query('select platform.record_launch_check($1, $2, $3)', [clubId, checkKey, body['result']]),
      );
      return { ok: true };
    } catch (e) {
      const p = parts(e, 'launch_check');
      const map: Record<string, string> = { not_found: 'not_found', forbidden: 'forbidden', not_testing: 'not_testing', not_recorded: 'not_recorded', invalid_result: 'invalid' };
      if (p && map[p[0]!]) return { ok: false, code: map[p[0]!]! };
      throw e;
    }
  }

  async function setConfig(actor: AdminActor, key: string, body: unknown): Promise<SetConfigResult> {
    const admin = await loadAdmin(actor);
    if ('ok' in admin) return admin;
    if (!isObject(body) || !('value' in body) || Object.keys(body).length !== 1 || body['value'] === null || body['value'] === undefined) return { ok: false, code: 'invalid' };
    try {
      await db.withPlatformTx({ staffId: admin.id, staffLabel: admin.display_name }, (tx) =>
        tx.query('select platform.set_config_value($1, $2::jsonb)', [key, JSON.stringify(body['value'])]),
      );
      return { ok: true };
    } catch (e) {
      const p = parts(e, 'config');
      if (p?.[0] === 'forbidden') return { ok: false, code: 'forbidden' };
      if (p?.[0] === 'invalid_value') return { ok: false, code: 'invalid' };
      throw e;
    }
  }

  async function publishLegalRelease(actor: AdminActor, body: unknown): Promise<PublishLegalResult> {
    const admin = await loadAdmin(actor);
    if ('ok' in admin) return admin;
    if (!isObject(body) || !isObject(body['texts']) || Object.keys(body).length !== 1) return { ok: false, code: 'invalid' };
    try {
      const r = await db.withPlatformTx({ staffId: admin.id, staffLabel: admin.display_name }, (tx) =>
        tx.query<{ v: string }>('select platform.publish_legal_release($1::jsonb) as v', [JSON.stringify(body['texts'])]),
      );
      return { ok: true, version: r.rows[0]!.v };
    } catch (e) {
      const p = parts(e, 'legal');
      if (p?.[0] === 'not_allowed') return { ok: false, code: 'forbidden' };
      if (p?.[0] === 'invalid_texts') return { ok: false, code: 'invalid', reason: 'invalid_texts' };
      // Which text is missing, or which {field} is unknown, goes back as plain values for the client to word.
      if (p?.[0] === 'missing_text') return { ok: false, code: 'invalid', reason: 'missing_text', kind: p[1] ?? '', language: p[2] ?? '' };
      if (p?.[0] === 'unknown_field') return { ok: false, code: 'invalid', reason: 'unknown_field', field: p[1] ?? '' };
      throw e;
    }
  }

  /** P4: the checks this club must pass to go live, with each result and which ones are recorded by hand. Any visible staff member may read it. */
  async function launchOverview(staffId: string, clubId: string): Promise<LaunchResult> {
    if (!UUID.test(staffId) || !UUID.test(clubId)) return { ok: false, code: 'not_found' };
    const staff = await db.withPlatformTx({ staffId: null }, async (tx) => (await tx.query<Staff>('select id, display_name, role, active from platform.staff_by_id($1)', [staffId])).rows[0] ?? null);
    if (!staff || !staff.active) return { ok: false, code: 'not_found' };
    return db.withPlatformTx({ staffId: staff.id, staffLabel: staff.display_name, clubId }, async (tx) => {
      const club = (await tx.query<{ status: string; name_en: string }>('select status, name_en from public.club where id = $1', [clubId])).rows[0];
      if (!club) return { ok: false as const, code: 'not_found' as const };
      const progress = (await tx.query<{ p: { launch?: Array<{ item: string; result: string; owed_by: 'booq' | 'owner' }> } | null }>('select platform.club_progress($1) as p', [clubId])).rows[0]?.p;
      const kinds = new Map((await tx.query<{ check_key: string; kind: string }>('select check_key, kind from app.launch_producers')).rows.map((r) => [r.check_key, r.kind]));
      return { ok: true as const, clubName: club.name_en, clubStatus: club.status, items: (progress?.launch ?? []).map((i) => ({ ...i, recorded: kinds.get(i.item) === 'recorded' })) };
    });
  }

  /** P6 config: every platform value that is set. Any active staff member may read them (they hold no secrets); only an admin changes one. */
  async function listConfig(staffId: string): Promise<ListConfigResult> {
    if (!UUID.test(staffId)) return { ok: false, code: 'not_found' };
    const staff = await db.withPlatformTx({ staffId: null }, async (tx) => (await tx.query<Staff>('select id, display_name, role, active from platform.staff_by_id($1)', [staffId])).rows[0] ?? null);
    if (!staff || !staff.active) return { ok: false, code: 'not_found' };
    const rows = await db.withPlatformTx({ staffId: staff.id, staffLabel: staff.display_name }, async (tx) => (await tx.query<{ key: string; value: unknown }>('select key, value from platform.config order by key')).rows);
    return { ok: true, config: rows };
  }

  /** The notice: every release published and the texts of the newest, so a new one can start from it. Any staff member reads them. */
  async function legalOverview(staffId: string): Promise<LegalOverviewResult> {
    if (!UUID.test(staffId)) return { ok: false, code: 'not_found' };
    const staff = await db.withPlatformTx({ staffId: null }, async (tx) => (await tx.query<Staff>('select id, display_name, role, active from platform.staff_by_id($1)', [staffId])).rows[0] ?? null);
    if (!staff || !staff.active) return { ok: false, code: 'not_found' };
    return db.withPlatformTx({ staffId: staff.id, staffLabel: staff.display_name }, async (tx) => {
      const releases = (await tx.query<{ seq: number; version: string; published_at: Date; name: string | null }>(
        `select r.seq, r.version, r.published_at, s.display_name as name from platform.legal_release r left join platform.platform_staff s on s.id = r.published_by order by r.seq desc`,
      )).rows;
      const newest = releases[0];
      let current: LegalOverview['current'] = null;
      if (newest) {
        const texts: LegalTexts = {};
        for (const t of (await tx.query<{ kind: string; language: string; title: string; body: string }>('select kind, language, title, body from platform.legal_text where seq = $1', [newest.seq])).rows) {
          (texts[t.kind] ??= {})[t.language] = { title: t.title, body: t.body };
        }
        current = { version: newest.version, texts };
      }
      return { ok: true as const, releases: releases.map((r) => ({ version: r.version, publishedAt: r.published_at.toISOString(), publishedBy: r.name })), current };
    });
  }

  return { recordLaunchCheck, setConfig, publishLegalRelease, launchOverview, listConfig, legalOverview };
}
