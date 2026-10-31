import type { Tx } from '../../../db/src/tx';
import { bangkokDate } from '../../../time/src/index';
import { ClassError } from './errors';

// F08-T13: what the owner, front desk and a coach do with templates, sessions, rosters and the waitlist of the club (CLASS-01-AC1,
// AC3, AC9 to AC13; CC-2; design 5.2, 8). The rules are the database's (check_template, edit_session, cancel_session, resolve_session,
// class_roster); this layer validates the body, maps the camelCase fields, and answers typed codes. A club id is never read from input.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):00$/;
const MAX_DAYS = 62;
const AUDIENCE = new Set(['adult', 'student']);
const CANCEL_REASONS = new Set(['below_minimum', 'owner', 'coach']);
const STATUSES = new Set(['scheduled', 'needs_attention', 'cancelled']);

const uuid = (v: unknown): string => {
  if (typeof v !== 'string' || !UUID.test(v)) throw new ClassError('not_found');
  return v.toLowerCase();
};
function bad(): never {
  throw new ClassError('bad_input');
}
const record = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : bad());
const text = (v: unknown, max: number): string => (typeof v === 'string' && v.trim() !== '' && v.length <= max ? v : bad());
const int = (v: unknown, min: number, max: number): number => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : bad());

// ---- templates ---------------------------------------------------------------------------------------------------------------

export interface TemplateFields {
  name_th: string;
  name_en: string;
  audience: 'adult' | 'student';
  level: string | null;
  coach_id: string;
  resource_id: string;
  weekday: number;
  start_time: string;
  min_players: number;
  max_players: number;
  drop_in_price_satang: number | null;
}

const TEMPLATE_KEYS = ['nameTh', 'nameEn', 'audience', 'level', 'coachId', 'resourceId', 'weekday', 'startTime', 'durationMinutes', 'minPlayers', 'maxPlayers', 'dropInPriceSatang'] as const;

/** A template body: every field for a new template, any of them for a change. Only 60 minutes is accepted (CLASS-01-AC1). */
export function parseTemplateBody(body: unknown, partial: boolean): Partial<TemplateFields> {
  const b = record(body);
  for (const k of Object.keys(b)) if (!(TEMPLATE_KEYS as readonly string[]).includes(k)) bad();
  if (b['durationMinutes'] !== undefined && b['durationMinutes'] !== 60) bad();
  const out: Partial<TemplateFields> = {};
  if (b['nameTh'] !== undefined) out.name_th = text(b['nameTh'], 200);
  if (b['nameEn'] !== undefined) out.name_en = text(b['nameEn'], 200);
  if (b['audience'] !== undefined) out.audience = (AUDIENCE.has(b['audience'] as string) ? b['audience'] : bad()) as 'adult' | 'student';
  if (b['level'] !== undefined) out.level = b['level'] === null ? null : text(b['level'], 100);
  if (b['coachId'] !== undefined) out.coach_id = typeof b['coachId'] === 'string' && UUID.test(b['coachId']) ? b['coachId'].toLowerCase() : bad();
  if (b['resourceId'] !== undefined) out.resource_id = typeof b['resourceId'] === 'string' && UUID.test(b['resourceId']) ? b['resourceId'].toLowerCase() : bad();
  if (b['weekday'] !== undefined) out.weekday = int(b['weekday'], 0, 6);
  if (b['startTime'] !== undefined) out.start_time = typeof b['startTime'] === 'string' && TIME.test(b['startTime']) ? b['startTime'] : bad();
  if (b['minPlayers'] !== undefined) out.min_players = int(b['minPlayers'], 1, 200);
  if (b['maxPlayers'] !== undefined) out.max_players = int(b['maxPlayers'], 1, 200);
  if (b['dropInPriceSatang'] !== undefined) out.drop_in_price_satang = b['dropInPriceSatang'] === null ? null : int(b['dropInPriceSatang'], 0, 100_000_000);
  if (!partial) {
    for (const k of ['name_th', 'name_en', 'audience', 'coach_id', 'resource_id', 'weekday', 'start_time', 'min_players', 'max_players'] as const) if (out[k] === undefined) bad();
    out.level ??= null;
    out.drop_in_price_satang ??= null;
  } else if (Object.keys(out).length === 0) {
    bad();
  }
  if (out.min_players !== undefined && out.max_players !== undefined && out.min_players > out.max_players) bad();
  return out;
}

export interface TemplateRow {
  id: string;
  nameTh: string;
  nameEn: string;
  audience: string;
  level: string | null;
  coachId: string;
  resourceId: string;
  weekday: number;
  startTime: string;
  durationMinutes: number;
  minPlayers: number;
  maxPlayers: number;
  dropInPriceSatang: number | null;
  active: boolean;
  endedOn: string | null;
}

const TEMPLATE_SQL = `select id, name_th, name_en, audience, level, coach_id, resource_id, weekday, to_char(start_time, 'HH24:MI') as start_time, duration_minutes,
       min_players, max_players, drop_in_price_satang, active, ended_on::text as ended_on from public.class_template`;
interface TemplateDb {
  id: string; name_th: string; name_en: string; audience: string; level: string | null; coach_id: string; resource_id: string; weekday: number; start_time: string;
  duration_minutes: number; min_players: number; max_players: number; drop_in_price_satang: number | null; active: boolean; ended_on: string | null;
}
const templateOut = (r: TemplateDb): TemplateRow => ({
  id: r.id, nameTh: r.name_th, nameEn: r.name_en, audience: r.audience, level: r.level, coachId: r.coach_id, resourceId: r.resource_id, weekday: r.weekday,
  startTime: r.start_time, durationMinutes: r.duration_minutes, minPlayers: r.min_players, maxPlayers: r.max_players, dropInPriceSatang: r.drop_in_price_satang,
  active: r.active, endedOn: r.ended_on,
});

export async function listTemplates(tx: Tx): Promise<TemplateRow[]> {
  const r = await tx.query<TemplateDb>(`${TEMPLATE_SQL} order by weekday, start_time, id`);
  return r.rows.map(templateOut);
}

interface Check {
  clashes: Array<{ date: string; reason: string }>;
  attention: Array<{ date: string; reason: string }>;
}

/** The dry run (CLASS-01-AC3): a clash with a booking, a hold, a closure or another session refuses the save with the dates and reasons. */
async function checkOrRefuse(tx: Tx, f: TemplateFields, templateId: string | null): Promise<Check> {
  const r = await tx.query<{ r: Check }>(`select app.check_template($1, $2, $3::smallint, $4::time, $5) as r`, [f.coach_id, f.resource_id, f.weekday, f.start_time, templateId]);
  const check = r.rows[0]!.r;
  if (check.clashes.length > 0) {
    throw new ClassError('template_clash', {
      dates: [...new Set(check.clashes.map((c) => c.date))].join(','),
      reasons: [...new Set(check.clashes.map((c) => c.reason))].join(','),
    });
  }
  return check;
}

export async function createTemplate(tx: Tx, userId: string, body: unknown): Promise<{ id: string; made: number; needsAttention: number }> {
  const f = parseTemplateBody(body, false) as TemplateFields;
  await checkOrRefuse(tx, f, null);
  let id: string;
  try {
    id = (
      await tx.query<{ id: string }>(
        `insert into public.class_template (club_id, name_th, name_en, audience, level, coach_id, resource_id, weekday, start_time, min_players, max_players, drop_in_price_satang, created_by)
         values (app.club_id(), $1,$2,$3,$4,$5,$6,$7,$8::time,$9,$10,$11,$12) returning id`,
        [f.name_th, f.name_en, f.audience, f.level, f.coach_id, f.resource_id, f.weekday, f.start_time, f.min_players, f.max_players, f.drop_in_price_satang, userId],
      )
    ).rows[0]!.id;
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === '23503' || err.code === '23514') throw new ClassError('bad_input');   // a coach or court of another club, or a CHECK
    throw e;
  }
  const g = (await tx.query<{ r: { made: number; needs_attention: number } }>(`select app.generate_sessions_window() as r`)).rows[0]!.r;
  return { id, made: g.made, needsAttention: g.needs_attention };
}

export async function updateTemplate(tx: Tx, id: unknown, body: unknown): Promise<{ rewritten: number; cancelled: number; generated: number }> {
  const tid = uuid(id);
  const changes = parseTemplateBody(body, true);
  const cur = (await tx.query<TemplateDb>(`${TEMPLATE_SQL} where id = $1 and active`, [tid])).rows[0];
  if (!cur) throw new ClassError('not_found');
  const merged: TemplateFields = {
    name_th: changes.name_th ?? cur.name_th, name_en: changes.name_en ?? cur.name_en, audience: (changes.audience ?? cur.audience) as 'adult' | 'student',
    level: changes.level !== undefined ? changes.level : cur.level, coach_id: changes.coach_id ?? cur.coach_id, resource_id: changes.resource_id ?? cur.resource_id,
    weekday: changes.weekday ?? cur.weekday, start_time: changes.start_time ?? cur.start_time,
    min_players: changes.min_players ?? cur.min_players, max_players: changes.max_players ?? cur.max_players,
    drop_in_price_satang: changes.drop_in_price_satang !== undefined ? changes.drop_in_price_satang : cur.drop_in_price_satang,
  };
  if (merged.min_players > merged.max_players) throw new ClassError('bad_input');
  await checkOrRefuse(tx, merged, tid);
  try {
    await tx.query(
      `update public.class_template set name_th=$2, name_en=$3, audience=$4, level=$5, coach_id=$6, resource_id=$7, weekday=$8, start_time=$9::time, min_players=$10, max_players=$11, drop_in_price_satang=$12 where id = $1`,
      [tid, merged.name_th, merged.name_en, merged.audience, merged.level, merged.coach_id, merged.resource_id, merged.weekday, merged.start_time, merged.min_players, merged.max_players, merged.drop_in_price_satang],
    );
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === '23503' || err.code === '23514') throw new ClassError('bad_input');
    throw e;
  }
  return (await tx.query<{ r: { rewritten: number; cancelled: number; generated: number } }>(`select app.apply_template_edit($1) as r`, [tid])).rows[0]!.r;
}

/** Ends a template today: no more sessions are made from it. Its future sessions are cancelled one by one by the route. */
export async function endTemplate(tx: Tx, id: unknown, now: Date): Promise<string[]> {
  const tid = uuid(id);
  const r = await tx.query(`update public.class_template set active = false, ended_on = $2::date where id = $1 and active`, [tid, bangkokDate(now)]);
  if (r.rowCount === 0) throw new ClassError('not_found');
  const s = await tx.query<{ id: string }>(`select id from public.class_session where template_id = $1 and status in ('scheduled', 'needs_attention') and start_at > app.now() order by start_at`, [tid]);
  return s.rows.map((x) => x.id);
}

// ---- sessions ----------------------------------------------------------------------------------------------------------------

export interface SessionRow {
  id: string;
  templateId: string;
  startAt: string;
  endAt: string;
  nameTh: string;
  nameEn: string;
  audience: string;
  level: string | null;
  coachId: string;
  resourceId: string;
  minPlayers: number;
  maxPlayers: number;
  dropInPriceSatang: number | null;
  status: string;
  attentionReason: string | null;
  cancelReason: string | null;
  edited: boolean;
  taken: number;
  waiting: number;
}

/** A8: the sessions of a date range (up to 62 days) with seats taken, the waiting count, status and the needs attention reason. */
export async function listSessions(tx: Tx, q: { from?: unknown; to?: unknown; status?: unknown }, now: Date): Promise<SessionRow[]> {
  const from = q.from === undefined ? bangkokDate(now) : q.from;
  if (typeof from !== 'string' || !DAY.test(from)) throw new ClassError('bad_input');
  const to = q.to === undefined ? bangkokDate(new Date(Date.parse(`${from}T00:00:00Z`) + 30 * 86_400_000)) : q.to;
  if (typeof to !== 'string' || !DAY.test(to) || to < from || (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 >= MAX_DAYS) throw new ClassError('bad_input');
  if (q.status !== undefined && (typeof q.status !== 'string' || !STATUSES.has(q.status))) throw new ClassError('bad_input');
  const r = await tx.query<Record<string, unknown>>(
    `select s.id, s.template_id, s.start_at, s.end_at, s.name_th, s.name_en, s.audience, s.level, s.coach_id, s.resource_id, s.min_players, s.max_players,
            s.drop_in_price_satang, s.status, s.attention_reason, s.cancel_reason, s.edited,
            (select count(*)::int from public.booking b where b.club_id = s.club_id and b.class_session_id = s.id
               and (b.status = 'confirmed' or (b.status = 'awaiting_payment' and b.hold_expires_at > app.now()))) as taken,
            (select count(*)::int from public.waitlist_entry w where w.club_id = s.club_id and w.class_session_id = s.id and w.status in ('waiting', 'offered')) as waiting
       from public.class_session s
      where (s.start_at at time zone 'Asia/Bangkok')::date between $1::date and $2::date and ($3::text is null or s.status = $3)
      order by s.start_at, s.id`,
    [from, to, q.status ?? null],
  );
  return r.rows.map((x) => ({
    id: x['id'] as string, templateId: x['template_id'] as string, startAt: (x['start_at'] as Date).toISOString(), endAt: (x['end_at'] as Date).toISOString(),
    nameTh: x['name_th'] as string, nameEn: x['name_en'] as string, audience: x['audience'] as string, level: x['level'] as string | null,
    coachId: x['coach_id'] as string, resourceId: x['resource_id'] as string, minPlayers: x['min_players'] as number, maxPlayers: x['max_players'] as number,
    dropInPriceSatang: x['drop_in_price_satang'] as number | null, status: x['status'] as string, attentionReason: x['attention_reason'] as string | null,
    cancelReason: x['cancel_reason'] as string | null, edited: x['edited'] as boolean, taken: x['taken'] as number, waiting: x['waiting'] as number,
  }));
}

const SESSION_KEYS: Record<string, string> = {
  nameTh: 'name_th', nameEn: 'name_en', level: 'level', coachId: 'coach_id', resourceId: 'resource_id', startAt: 'start_at',
  minPlayers: 'min_players', maxPlayers: 'max_players', dropInPriceSatang: 'drop_in_price_satang',
};

/** The owner's edit of one session (CLASS-01-AC10): the keys are mapped to the function's own and checked there. */
export async function editSession(tx: Tx, id: unknown, body: unknown): Promise<void> {
  const sid = uuid(id);
  const b = record(body);
  const changes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) {
    const key = SESSION_KEYS[k];
    if (!key) bad();
    if (k === 'startAt') {
      if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) bad();
      changes[key] = new Date(v as string).toISOString();
    } else if (k === 'nameTh' || k === 'nameEn') changes[key] = text(v, 200);
    else if (k === 'level') changes[key] = v === null ? null : text(v, 100);
    else if (k === 'coachId' || k === 'resourceId') changes[key] = typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : bad();
    else if (k === 'minPlayers' || k === 'maxPlayers') changes[key] = int(v, 1, 200);
    else changes[key] = v === null ? null : int(v, 0, 100_000_000);
  }
  if (Object.keys(changes).length === 0) bad();
  try {
    await tx.query(`select app.edit_session($1, $2::jsonb)`, [sid, JSON.stringify(changes)]);
  } catch (e) {
    if ((e as { message?: string }).message?.includes('invalid changes')) throw new ClassError('bad_input');
    throw e;
  }
}

export async function cancelSession(tx: Tx, id: unknown, body: unknown, options: { template?: boolean } = {}): Promise<{ seats: number; entries: number }> {
  const sid = uuid(id);
  const reason = options.template ? 'template' : record(body ?? {})['reason'];
  if (typeof reason !== 'string' || !(options.template || CANCEL_REASONS.has(reason))) bad();
  const r = await tx.query<{ r: { seats: number; entries: number } }>(`select app.cancel_session($1, $2) as r`, [sid, reason]);
  return { seats: r.rows[0]!.r.seats, entries: r.rows[0]!.r.entries };
}

export async function resolveSession(tx: Tx, id: unknown): Promise<{ resolved: boolean; reason: string | null }> {
  return (await tx.query<{ r: { resolved: boolean; reason: string | null } }>(`select app.resolve_session($1) as r`, [uuid(id)])).rows[0]!.r;
}

// ---- rosters and the waitlist ------------------------------------------------------------------------------------------------

export interface RosterRow {
  bookingId: string;
  customerId: string;
  displayName: string | null;
  status: string;
  holdExpiresAt: string | null;
}

/** The seat holders of a session with their names, never a date of birth or contact. The view limits a coach to the sessions they teach. */
export async function roster(tx: Tx, id: unknown): Promise<RosterRow[]> {
  const sid = uuid(id);
  const exists = await tx.query(`select 1 from public.class_session where id = $1`, [sid]);
  if (exists.rowCount === 0) throw new ClassError('not_found');
  const r = await tx.query<{ booking_id: string; customer_id: string; display_name: string | null; status: string; hold_expires_at: Date | null }>(
    `select booking_id, customer_id, display_name, status, hold_expires_at from public.class_roster where session_id = $1 order by status desc, display_name, booking_id`,
    [sid],
  );
  return r.rows.map((x) => ({ bookingId: x.booking_id, customerId: x.customer_id, displayName: x.display_name, status: x.status, holdExpiresAt: x.hold_expires_at?.toISOString() ?? null }));
}

export interface WaitlistRow {
  entryId: string;
  customerId: string;
  displayName: string | null;
  kind: string;
  sessionId: string | null;
  resourceId: string | null;
  slotStartAt: string | null;
  position: number;
  status: string;
  offerExpiresAt: string | null;
}

/** A9: the club's live entries, for one class when sessionId is given, with names for staff (design 8). */
export async function staffWaitlist(tx: Tx, q: { sessionId?: unknown }): Promise<WaitlistRow[]> {
  const sid = q.sessionId === undefined ? null : uuid(q.sessionId);
  const r = await tx.query<Record<string, unknown>>(
    `select w.id, w.customer_id, u.display_name, w.subject_kind, w.class_session_id, w.resource_id, w.slot_start_at, w.status, w.offer_expires_at,
            (select count(*)::int + 1 from public.waitlist_entry o where o.club_id = w.club_id and o.status in ('waiting', 'offered') and o.seq < w.seq
               and ((w.class_session_id is not null and o.class_session_id = w.class_session_id) or (w.class_session_id is null and o.resource_id = w.resource_id and o.slot_start_at = w.slot_start_at))) as position
       from public.waitlist_entry w join public.app_user u on u.club_id = w.club_id and u.id = w.customer_id
      where w.status in ('waiting', 'offered') and ($1::uuid is null or w.class_session_id = $1)
      order by w.class_session_id, w.resource_id, w.slot_start_at, w.seq`,
    [sid],
  );
  return r.rows.map((x) => ({
    entryId: x['id'] as string, customerId: x['customer_id'] as string, displayName: x['display_name'] as string | null, kind: x['subject_kind'] as string,
    sessionId: x['class_session_id'] as string | null, resourceId: x['resource_id'] as string | null, slotStartAt: (x['slot_start_at'] as Date | null)?.toISOString() ?? null,
    position: x['position'] as number, status: x['status'] as string, offerExpiresAt: (x['offer_expires_at'] as Date | null)?.toISOString() ?? null,
  }));
}
