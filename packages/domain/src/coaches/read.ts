import type { Tx } from '../../../db/src/tx';
import { CoachError } from './errors';

// F07-T11: what a guest or a player sees of coaches (COACH-01, R1-AC1 to AC8, COACH-02-AC1, AC4, CC-3). Reads go through the public card
// view and the public times function, so a coach who is not active and published is not found here as on the screen (CC-2). The card
// holds the public profile only: never leave, notes, pay, consent or who recorded it. The price is for the caller's price group
// (app.coach_prices); null means not set, shown with no price and no pick action (COACH-02-AC4).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_HOURS = 24;
const MAX_DAYS = 31;

export interface CoachCard {
  coachId: string;
  displayName: string | null;
  tier: { id: string; nameTh: string; nameEn: string } | null;
  bioTh: string | null;
  bioEn: string | null;
  certificationsTh: string | null;
  certificationsEn: string | null;
  specialtiesTh: string[];
  specialtiesEn: string[];
  agesLevelsTh: string | null;
  agesLevelsEn: string | null;
  languages: string[];
  photoPath: string | null;
  /** The price in satang for the caller's price group; null when not set. */
  priceSatang: number | null;
}

export interface CoachTime {
  startAt: string;
  state: 'open' | 'no_court_open';
  courtName: string | null;
}

interface CardRow {
  id: string;
  display_name: string | null;
  tier_id: string | null;
  tier_name_th: string | null;
  tier_name_en: string | null;
  bio_th: string | null;
  bio_en: string | null;
  certifications_th: string | null;
  certifications_en: string | null;
  specialties_th: string[] | null;
  specialties_en: string[] | null;
  ages_levels_th: string | null;
  ages_levels_en: string | null;
  languages: string[] | null;
  photo_path: string | null;
  price_satang: number | null;
}

const CARD_SQL = `select c.*, p.price_satang
                    from public.public_coach_card c
                    left join app.coach_prices() p on p.coach_id = c.id`;

const card = (r: CardRow): CoachCard => ({
  coachId: r.id,
  displayName: r.display_name,
  tier: r.tier_id ? { id: r.tier_id, nameTh: r.tier_name_th ?? '', nameEn: r.tier_name_en ?? '' } : null,
  bioTh: r.bio_th,
  bioEn: r.bio_en,
  certificationsTh: r.certifications_th,
  certificationsEn: r.certifications_en,
  specialtiesTh: r.specialties_th ?? [],
  specialtiesEn: r.specialties_en ?? [],
  agesLevelsTh: r.ages_levels_th,
  agesLevelsEn: r.ages_levels_en,
  languages: r.languages ?? [],
  photoPath: r.photo_path,
  priceSatang: r.price_satang,
});

/** A Paused club shows Classes as paused (R1-AC8): the lists answer club_paused. */
async function refuseIfPaused(tx: Tx): Promise<void> {
  const r = await tx.query<{ status: string }>(`select status from public.public_club_config`);
  if (r.rows[0]?.status === 'paused') throw new CoachError('club_paused');
}

export function coachIdOf(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new CoachError('not_found');
  return value.toLowerCase();
}

/** The hours of a selection: ISO instants on the hour (BK-wide rule), one to MAX_HOURS, comma separated or an array. */
export function startsOf(value: unknown): string[] {
  const parts = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : null;
  if (!parts || parts.length === 0 || parts.length > MAX_HOURS) throw new CoachError('bad_input');
  const out: string[] = [];
  for (const p of parts) {
    if (typeof p !== 'string') throw new CoachError('bad_input');
    const d = new Date(p.trim());
    if (Number.isNaN(d.getTime()) || d.getTime() % 3_600_000 !== 0) throw new CoachError('bad_input');
    out.push(d.toISOString());
  }
  return out;
}

/** GET /coaches: every active published coach with the caller's price (C5). */
export async function listCoaches(tx: Tx): Promise<CoachCard[]> {
  await refuseIfPaused(tx);
  const r = await tx.query<CardRow>(`${CARD_SQL} order by c.display_name nulls last, c.id`);
  return r.rows.map(card);
}

/** GET /coaches/:id: one coach profile (C6); a coach who is not published is not found. */
export async function getCoach(tx: Tx, id: unknown): Promise<CoachCard> {
  const coachId = coachIdOf(id);
  await refuseIfPaused(tx);
  const r = await tx.query<CardRow>(`${CARD_SQL} where c.id = $1`, [coachId]);
  if (!r.rows[0]) throw new CoachError('not_found');
  return card(r.rows[0]);
}

/** GET /coaches/:id/times?from=&to=: the hours a coach can take, with the court it would get (C6, R1-AC2, AC3). */
export async function coachTimes(tx: Tx, id: unknown, from: unknown, to: unknown): Promise<CoachTime[]> {
  const coachId = coachIdOf(id);
  if (typeof from !== 'string' || typeof to !== 'string' || !DAY.test(from) || !DAY.test(to) || from > to) throw new CoachError('bad_input');
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 >= MAX_DAYS) throw new CoachError('bad_input');
  await refuseIfPaused(tx);
  const exists = await tx.query(`select 1 from public.public_coach_card where id = $1`, [coachId]);
  if (!exists.rows[0]) throw new CoachError('not_found');
  const r = await tx.query<{ start_at: Date; state: 'open' | 'no_court_open'; court_name: string | null }>(
    `select * from public.public_coach_times($1, $2::date, $3::date) order by start_at`, [coachId, from, to]);
  return r.rows.map((t) => ({ startAt: t.start_at.toISOString(), state: t.state, courtName: t.court_name }));
}

/** GET /coaches/offerable?starts=&resourceId=: the coaches free for every hour of the selection, who can be booked (COACH-01-AC7). */
export async function offerableCoaches(tx: Tx, starts: unknown, resourceId: unknown): Promise<CoachCard[]> {
  const hours = startsOf(starts);
  let resource: string | null = null;
  if (resourceId !== undefined && resourceId !== '') {
    if (typeof resourceId !== 'string' || !UUID.test(resourceId)) throw new CoachError('bad_input');
    resource = resourceId.toLowerCase();
  }
  await refuseIfPaused(tx);
  const r = await tx.query<CardRow>(
    `${CARD_SQL} where c.id in (select app.coaches_offerable($1, $2::timestamptz[])) order by c.display_name nulls last, c.id`,
    [resource, hours]);
  return r.rows.map(card);
}

/**
 * GET /staff/bookings/:id/coaches: the desk's coach picker for a confirmed court booking with no coach yet. The coaches free for the
 * booking's hour (the check POST /bookings/:id/coach runs), each with the price for the BOOKING'S CUSTOMER's price group, not the
 * staff member's own (a walk in with no customer gets the standard price). The desk then calls POST /bookings/:id/coach.
 */
export async function staffOfferableCoaches(tx: Tx, bookingId: unknown): Promise<CoachCard[]> {
  const id = coachIdOf(bookingId);
  const b = await tx.query<{ customer_id: string | null }>(
    `select customer_id from public.booking
      where club_id = app.club_id() and id = $1 and type = 'court' and status = 'confirmed' and coach_id is null`, [id]);
  const row = b.rows[0];
  if (!row) throw new CoachError('not_found');
  await refuseIfPaused(tx);
  const r = await tx.query<CardRow>(
    `select c.*, p.price_satang
       from public.public_coach_card c
       left join app.coach_prices_for($2::uuid) p on p.coach_id = c.id
      where c.id in (select app.coaches_for_booking($1)) order by c.display_name nulls last, c.id`,
    [id, row.customer_id]);
  return r.rows.map(card);
}

/** POST /bookings/:id/coach: adds a coach to the caller's confirmed court booking, held with its own order (COACH-03-AC3, D111, D120). */
export async function addCoach(tx: Tx, bookingId: unknown, body: { coachId?: unknown; orderId?: unknown }): Promise<{ ok: true }> {
  const booking = coachIdOf(bookingId);
  if (typeof body.coachId !== 'string' || !UUID.test(body.coachId) || typeof body.orderId !== 'string' || !UUID.test(body.orderId)) {
    throw new CoachError('bad_input');
  }
  await tx.query(`select app.add_coach_to_booking($1, $2, $3)`, [booking, body.coachId.toLowerCase(), body.orderId.toLowerCase()]);
  return { ok: true };
}
