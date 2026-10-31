import type { Tx } from '../../../db/src/tx';
import { CoachError } from './errors';
import { coachIdOf } from './read';

// F07-T12: the owner's and the coach's side of coaches (COACH-02, R2, R4, CC-2, CC-3). Each function calls the definer function of
// migrations 0805 to 0807, which checks the caller's role again; a route that lets a role through only passes what the database
// would. Nothing here writes a price, a pay amount or a text: values come from the caller and a null is "not set", never replaced
// by a default.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const REASONS = ['leave', 'closed_time', 'inactive', 'other'] as const;
const PROFILE_KEYS = [
  'bio_th', 'bio_en', 'certifications_th', 'certifications_en', 'specialties_th', 'specialties_en', 'ages_levels_th', 'ages_levels_en',
  'languages', 'photo_path', 'tier_id',
] as const;

export interface CoachViewer {
  userId: string;
  roles: readonly string[];
}
const isOwner = (v: CoachViewer) => v.roles.includes('owner');

const bad = (): never => {
  throw new CoachError('bad_input');
};
const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : bad());
const uuid = (v: unknown): string => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : bad());
const intOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number.isInteger(v) ? (v as number) : bad());

/** The coach a /coach/... route is about: the caller's own, or (owner only) the one named. Another coach's rows are forbidden. */
export function ownCoach(v: CoachViewer, named: unknown): string {
  if (named === undefined || named === '') return v.userId;
  const id = uuid(named);
  if (id !== v.userId && !isOwner(v)) throw new CoachError('forbidden');
  return id;
}

export interface StaffCoachRow {
  coachId: string;
  displayName: string | null;
  tierId: string | null;
  active: boolean;
  published: boolean;
}

/** GET /staff/coaches: every coach of the club, for the list in A7 and the staff picker. */
export async function listStaffCoaches(tx: Tx): Promise<StaffCoachRow[]> {
  const r = await tx.query<{ id: string; display_name: string | null; tier_id: string | null; active: boolean; published: boolean }>(
    `select c.id, n.display_name, c.tier_id, c.active, c.published
       from public.coach c left join public.app_user_names n on n.id = c.id
      order by n.display_name nulls last, c.id`);
  return r.rows.map((x) => ({ coachId: x.id, displayName: x.display_name, tierId: x.tier_id, active: x.active, published: x.published }));
}

export interface StaffCoach extends StaffCoachRow {
  profile: Record<string, unknown>;
  consentAt: string | null;
  overrides: { priceGroupId: string; priceSatang: number }[];
}

/** GET /staff/coaches/:id: the profile, tier, state, consent and price overrides (owner). */
export async function getStaffCoach(tx: Tx, id: unknown): Promise<StaffCoach> {
  const coachId = coachIdOf(id);
  const r = await tx.query(
    `select c.*, n.display_name from public.coach c left join public.app_user_names n on n.id = c.id where c.id = $1`, [coachId]);
  const c = r.rows[0];
  if (!c) throw new CoachError('not_found');
  const o = await tx.query<{ price_group_id: string; price_satang: number }>(
    `select price_group_id, price_satang from public.coach_price_override where coach_id = $1 order by price_group_id`, [coachId]);
  return {
    coachId: c.id, displayName: c.display_name, tierId: c.tier_id, active: c.active, published: c.published,
    profile: {
      bioTh: c.bio_th, bioEn: c.bio_en, certificationsTh: c.certifications_th, certificationsEn: c.certifications_en,
      specialtiesTh: c.specialties_th ?? [], specialtiesEn: c.specialties_en ?? [], agesLevelsTh: c.ages_levels_th, agesLevelsEn: c.ages_levels_en,
      languages: c.languages ?? [], photoPath: c.photo_path,
    },
    consentAt: c.profile_consent_at ? new Date(c.profile_consent_at).toISOString() : null,
    overrides: o.rows.map((x) => ({ priceGroupId: x.price_group_id, priceSatang: x.price_satang })),
  };
}

/**
 * PUT /staff/coaches/:id: profile fields, tier, consent, publish, active and price overrides, whichever are sent, in one transaction.
 * Consent first, so a profile can be published in the same save; an override with a null price removes it. A person who is not yet a
 * coach becomes one (save_coach).
 */
export async function putStaffCoach(tx: Tx, id: unknown, body: unknown): Promise<StaffCoach> {
  const coachId = coachIdOf(id);
  const b = obj(body);
  const profile: Record<string, unknown> = {};
  const p = b['profile'] === undefined ? {} : obj(b['profile']);
  for (const k of Object.keys(p)) if (!(PROFILE_KEYS as readonly string[]).includes(k)) bad();
  Object.assign(profile, p);
  if (b['tierId'] !== undefined) profile['tier_id'] = b['tierId'] === null ? null : uuid(b['tierId']);
  await tx.query(`select app.save_coach($1, $2::jsonb)`, [coachId, JSON.stringify(profile)]);
  for (const key of ['consent', 'published', 'active'] as const) if (b[key] !== undefined && typeof b[key] !== 'boolean') bad();
  if (typeof b['consent'] === 'boolean') await tx.query(`select app.record_coach_consent($1, $2)`, [coachId, b['consent']]);
  if (typeof b['published'] === 'boolean') await tx.query(`select app.publish_coach_profile($1, $2)`, [coachId, b['published']]);
  if (typeof b['active'] === 'boolean') await tx.query(`select app.set_coach_active($1, $2)`, [coachId, b['active']]);
  if (b['overrides'] !== undefined) {
    if (!Array.isArray(b['overrides'])) bad();
    for (const raw of b['overrides'] as unknown[]) {
      const o = obj(raw);
      await tx.query(`select app.set_coach_price_override($1, $2, $3)`, [coachId, uuid(o['priceGroupId']), intOrNull(o['priceSatang'])]);
    }
  }
  return getStaffCoach(tx, coachId);
}

export interface CoachPay {
  monthlyBaseSatang: number | null;
  soloPayKind: 'fixed' | 'percent' | null;
  soloPayValue: number | null;
  groupPayKind: 'fixed' | 'percent' | null;
  groupPayValue: number | null;
}

/** GET /staff/coaches/:id/pay: every value null when the owner has not set it (A-11). */
export async function getPay(tx: Tx, id: unknown): Promise<CoachPay> {
  const coachId = coachIdOf(id);
  const exists = await tx.query(`select 1 from public.coach where id = $1`, [coachId]);
  if (!exists.rows[0]) throw new CoachError('not_found');
  const r = await tx.query(`select * from public.coach_pay where coach_id = $1`, [coachId]);
  const x = r.rows[0];
  return {
    monthlyBaseSatang: x?.monthly_base_satang ?? null,
    soloPayKind: x?.solo_pay_kind ?? null, soloPayValue: x?.solo_pay_value ?? null,
    groupPayKind: x?.group_pay_kind ?? null, groupPayValue: x?.group_pay_value ?? null,
  };
}

/** PUT /staff/coaches/:id/pay: the whole set; a field sent as null (or left out) is not set. The table's checks refuse a bad pair or a value out of range. */
export async function putPay(tx: Tx, id: unknown, body: unknown): Promise<CoachPay> {
  const coachId = coachIdOf(id);
  const b = obj(body);
  const kind = (v: unknown) => (v === null || v === undefined ? null : v === 'fixed' || v === 'percent' ? v : bad());
  const exists = await tx.query(`select 1 from public.coach where id = $1`, [coachId]);
  if (!exists.rows[0]) throw new CoachError('not_found');
  await tx.query(
    `insert into public.coach_pay (club_id, coach_id, monthly_base_satang, solo_pay_kind, solo_pay_value, group_pay_kind, group_pay_value)
     values (app.club_id(), $1, $2, $3, $4, $5, $6)
     on conflict (club_id, coach_id) do update set monthly_base_satang = excluded.monthly_base_satang, solo_pay_kind = excluded.solo_pay_kind,
       solo_pay_value = excluded.solo_pay_value, group_pay_kind = excluded.group_pay_kind, group_pay_value = excluded.group_pay_value`,
    [coachId, intOrNull(b['monthlyBaseSatang']), kind(b['soloPayKind']), intOrNull(b['soloPayValue']), kind(b['groupPayKind']), intOrNull(b['groupPayValue'])]);
  return getPay(tx, coachId);
}

export interface AvailabilityRule {
  kind: 'weekly' | 'open' | 'closed';
  weekday: number | null;
  onDate: string | null;
  startTime: string;
  endTime: string;
}

/** GET /coach/availability: a coach reads their own rules (the owner any coach, named in `coachId`). */
export async function getAvailability(tx: Tx, v: CoachViewer, named: unknown): Promise<AvailabilityRule[]> {
  const coachId = ownCoach(v, named);
  const r = await tx.query<{ kind: AvailabilityRule['kind']; weekday: number | null; on_date: string | null; start_time: string; end_time: string }>(
    `select kind, weekday, to_char(on_date, 'YYYY-MM-DD') as on_date, to_char(start_time, 'HH24:MI') as start_time, to_char(end_time, 'HH24:MI') as end_time
       from public.coach_availability_rule where coach_id = $1 order by kind, weekday, on_date, start_time`, [coachId]);
  return r.rows.map((x) => ({ kind: x.kind, weekday: x.weekday, onDate: x.on_date, startTime: x.start_time, endTime: x.end_time }));
}

/** PUT /coach/availability: replaces all the coach's rules. Saving never deletes a booking (COACH-01-AC8, R2-AC4). */
export async function putAvailability(tx: Tx, v: CoachViewer, named: unknown, body: unknown): Promise<AvailabilityRule[]> {
  const coachId = ownCoach(v, named);
  const rules = obj(body)['rules'];
  if (!Array.isArray(rules)) bad();
  const out = (rules as unknown[]).map((raw) => {
    const r = obj(raw);
    if (typeof r['startTime'] !== 'string' || !TIME.test(r['startTime']) || typeof r['endTime'] !== 'string' || !TIME.test(r['endTime'])) bad();
    if (r['onDate'] !== undefined && r['onDate'] !== null && !(typeof r['onDate'] === 'string' && DAY.test(r['onDate']))) bad();
    return { kind: r['kind'], weekday: intOrNull(r['weekday']), on_date: r['onDate'] ?? null, start_time: r['startTime'], end_time: r['endTime'] };
  });
  await tx.query(`select app.set_availability($1, $2::jsonb)`, [coachId, JSON.stringify(out)]);
  return getAvailability(tx, v, coachId);
}

export interface LeaveRow {
  leaveId: string;
  coachId: string;
  startDate: string;
  endDate: string;
  fromHour: number | null;
  toHour: number | null;
  status: 'pending' | 'approved' | 'declined';
  type: string | null;
  note: string | null;
}

const LEAVE_SQL = `select id, coach_id, to_char(start_date, 'YYYY-MM-DD') as start_date, to_char(end_date, 'YYYY-MM-DD') as end_date,
                          from_hour, to_hour, status, type, note from public.coach_leave`;
const leave = (x: Record<string, unknown>): LeaveRow => ({
  leaveId: x['id'] as string, coachId: x['coach_id'] as string, startDate: x['start_date'] as string, endDate: x['end_date'] as string,
  fromHour: (x['from_hour'] as number | null) ?? null, toHour: (x['to_hour'] as number | null) ?? null,
  status: x['status'] as LeaveRow['status'], type: (x['type'] as string | null) ?? null, note: (x['note'] as string | null) ?? null,
});

/** GET /coach/leave: the coach's own requests with their status (the owner any coach). */
export async function listOwnLeave(tx: Tx, v: CoachViewer, named: unknown): Promise<LeaveRow[]> {
  const coachId = ownCoach(v, named);
  const r = await tx.query(`${LEAVE_SQL} where coach_id = $1 order by start_date desc, id`, [coachId]);
  return r.rows.map(leave);
}

/** POST /coach/leave: a pending request on whole days or whole hours of one day (R2-AC2; no type list is built, D156). */
export async function requestLeave(tx: Tx, v: CoachViewer, named: unknown, body: unknown): Promise<{ leaveId: string }> {
  const coachId = ownCoach(v, named);
  const b = obj(body);
  if (typeof b['startDate'] !== 'string' || !DAY.test(b['startDate']) || typeof b['endDate'] !== 'string' || !DAY.test(b['endDate'])) bad();
  for (const k of ['type', 'note'] as const) if (b[k] !== undefined && b[k] !== null && typeof b[k] !== 'string') bad();
  const r = await tx.query<{ id: string }>(`select app.request_leave($1, $2::date, $3::date, $4::smallint, $5::smallint, $6, $7) as id`,
    [coachId, b['startDate'], b['endDate'], intOrNull(b['fromHour']), intOrNull(b['toHour']), b['type'] ?? null, b['note'] ?? null]);
  return { leaveId: r.rows[0]!.id };
}

/** GET /staff/leave?status=: every request of the club with its type and note (owner only). */
export async function listAllLeave(tx: Tx, status: unknown): Promise<LeaveRow[]> {
  if (status !== undefined && status !== 'pending' && status !== 'approved' && status !== 'declined') bad();
  const r = await tx.query(`${LEAVE_SQL} where ($1::text is null or status = $1) order by start_date, id`, [status ?? null]);
  return r.rows.map(leave);
}

/** POST /staff/leave/:id/decision: approve or decline once (owner); the booking stays and shows in the flags (R6). */
export async function decideLeave(tx: Tx, id: unknown, body: unknown): Promise<{ ok: true }> {
  const leaveId = uuid(id);
  const approve = obj(body)['approve'];
  if (typeof approve !== 'boolean') bad();
  await tx.query(`select app.decide_leave($1, $2)`, [leaveId, approve]);
  return { ok: true };
}

export interface FlaggedSession {
  bookingId: string;
  coachId: string;
  resourceId: string;
  startAt: string;
  endAt: string;
  reason: string;
}

/** GET /staff/flagged-sessions: confirmed solo classes ahead whose coach can no longer take them (R6; owner). */
export async function flaggedSessions(tx: Tx): Promise<FlaggedSession[]> {
  const r = await tx.query<{ booking_id: string; coach_id: string; resource_id: string; start_at: Date; end_at: Date; reason: string }>(
    `select * from public.coach_flagged_session order by start_at, booking_id`);
  return r.rows.map((x) => ({ bookingId: x.booking_id, coachId: x.coach_id, resourceId: x.resource_id, startAt: x.start_at.toISOString(), endAt: x.end_at.toISOString(), reason: x.reason }));
}

/** GET /staff/bookings/:id/substitutes: the coaches who can take that session, the current one left out (R4-AC6; owner). */
export async function substitutes(tx: Tx, id: unknown): Promise<StaffCoachRow[]> {
  const bookingId = uuid(id);
  const r = await tx.query<{ id: string; display_name: string | null; tier_id: string | null; active: boolean; published: boolean }>(
    `select c.id, n.display_name, c.tier_id, c.active, c.published
       from public.coach c left join public.app_user_names n on n.id = c.id
      where c.id in (select app.substitutes_for_booking($1))
      order by n.display_name nulls last, c.id`, [bookingId]);
  return r.rows.map((x) => ({ coachId: x.id, displayName: x.display_name, tierId: x.tier_id, active: x.active, published: x.published }));
}

/** POST /staff/bookings/:id/substitute: all or nothing; the customer is told the new coach's name only (owner). */
export async function substitute(tx: Tx, id: unknown, body: unknown): Promise<{ substitutionId: string }> {
  const bookingId = uuid(id);
  const b = obj(body);
  const reason = b['reason'];
  if (typeof reason !== 'string' || !(REASONS as readonly string[]).includes(reason)) bad();
  const r = await tx.query<{ id: string }>(`select app.substitute_coach($1, $2, $3) as id`, [bookingId, uuid(b['coachId']), reason]);
  return { substitutionId: r.rows[0]!.id };
}
