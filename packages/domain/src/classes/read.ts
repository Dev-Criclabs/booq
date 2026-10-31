import type { Tx } from '../../../db/src/tx';
import { bangkokDate } from '../../../time/src/index';
import { ClassError } from './errors';

// F08-T12: what a guest or a player sees of classes and their own waitlist (CLASS-01-AC5 to AC8; CLASS-02-AC1, AC3, AC8, AC14;
// WAIT-01). Reads go through the public view and the player's own rows; the audience rule is the database's own
// (app.class_visible, so the API refuses what the screen hides, CC-2). A class not visible to the caller is not found.
// Counts only: no player, no entry of anyone else, never a date of birth.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 31;

export interface ClassCard {
  sessionId: string;
  startAt: string;
  endAt: string;
  nameTh: string;
  nameEn: string;
  level: string | null;
  audience: 'adult' | 'student';
  coachName: string;
  courtName: string;
  minPlayers: number;
  maxPlayers: number;
  spotsLeft: number;
  full: boolean;
  waitlist: boolean;
  /** The drop in price in satang; null when the owner set none (credit or wallet only, D157). */
  dropInPriceSatang: number | null;
}

export interface ClassDetail extends ClassCard {
  /** The caller's own waitlist entry for this class, if any. */
  myEntry: { entryId: string; status: string; position: number } | null;
}

interface CardRow {
  session_id: string;
  start_at: Date;
  end_at: Date;
  name_th: string;
  name_en: string;
  level: string | null;
  audience: 'adult' | 'student';
  coach_name: string | null;
  court_name: string;
  min_players: number;
  max_players: number;
  spots_left: number;
  full: boolean;
  waitlist: boolean;
  drop_in_price_satang: number | null;
}

const card = (r: CardRow): ClassCard => ({
  sessionId: r.session_id,
  startAt: r.start_at.toISOString(),
  endAt: r.end_at.toISOString(),
  nameTh: r.name_th,
  nameEn: r.name_en,
  level: r.level,
  audience: r.audience,
  coachName: r.coach_name ?? '',
  courtName: r.court_name,
  minPlayers: r.min_players,
  maxPlayers: r.max_players,
  spotsLeft: r.spots_left,
  full: r.full,
  waitlist: r.waitlist,
  dropInPriceSatang: r.drop_in_price_satang,
});

const uuid = (v: unknown): string => {
  if (typeof v !== 'string' || !UUID.test(v)) throw new ClassError('not_found');
  return v.toLowerCase();
};

/** The week (or any range up to 31 days) of classes the caller may see. Default: today and the next 6 days. */
export async function listClasses(tx: Tx, viewer: { userId: string | null }, query: { from?: unknown; to?: unknown; level?: unknown }, now: Date): Promise<ClassCard[]> {
  const today = bangkokDate(now);
  const from = query.from === undefined ? today : query.from;
  if (typeof from !== 'string' || !DAY.test(from)) throw new ClassError('bad_input');
  const to = query.to === undefined ? addDays(from, 6) : query.to;
  if (typeof to !== 'string' || !DAY.test(to) || to < from || daysBetween(from, to) >= MAX_DAYS) throw new ClassError('bad_input');
  if (query.level !== undefined && (typeof query.level !== 'string' || query.level.length === 0 || query.level.length > 100)) throw new ClassError('bad_input');
  const r = await tx.query<CardRow>(
    `select c.* from public.public_class_state c
      where (c.start_at at time zone 'Asia/Bangkok')::date between $1::date and $2::date
        and ($3::text is null or c.level = $3)
        and app.class_visible(c.session_id, $4)
      order by c.start_at, c.session_id`,
    [from, to, query.level ?? null, viewer.userId],
  );
  return r.rows.map(card);
}

export async function getClass(tx: Tx, viewer: { userId: string | null }, id: unknown): Promise<ClassDetail> {
  const sid = uuid(id);
  const r = await tx.query<CardRow>(`select c.* from public.public_class_state c where c.session_id = $1 and app.class_visible(c.session_id, $2)`, [sid, viewer.userId]);
  const row = r.rows[0];
  if (!row) throw new ClassError('not_found');
  let myEntry: ClassDetail['myEntry'] = null;
  if (viewer.userId) {
    const e = await tx.query<{ entry_id: string; status: string; position: number }>(`select entry_id, status, position from public.waitlist_position where class_session_id = $1`, [sid]);
    if (e.rows[0]) myEntry = { entryId: e.rows[0].entry_id, status: e.rows[0].status, position: e.rows[0].position };
  }
  return { ...card(row), myEntry };
}

export interface WaitlistItem {
  entryId: string;
  kind: 'class_session' | 'court_slot';
  sessionId: string | null;
  resourceId: string | null;
  courtName: string | null;
  className: { th: string; en: string } | null;
  startAt: string | null;
  status: 'waiting' | 'offered';
  /** The caller's own place in line. */
  position: number;
  /** While an offer is open: when it ends. */
  offerExpiresAt: string | null;
}

interface ItemRow {
  entry_id: string;
  subject_kind: 'class_session' | 'court_slot';
  class_session_id: string | null;
  resource_id: string | null;
  slot_start_at: Date | null;
  status: 'waiting' | 'offered';
  position: number;
  offer_expires_at: Date | null;
  name_th: string | null;
  name_en: string | null;
  class_start: Date | null;
  class_court: string | null;
  slot_court: string | null;
}

const ITEM_SQL = `select w.entry_id, w.subject_kind, w.class_session_id, w.resource_id, w.slot_start_at, w.status, w.position, w.offer_expires_at,
       c.name_th, c.name_en, c.start_at as class_start, c.court_name as class_court, r.name as slot_court
  from public.waitlist_position w
  left join public.public_class_state c on c.session_id = w.class_session_id
  left join public.resource r on r.club_id = app.club_id() and r.id = w.resource_id`;

const item = (r: ItemRow): WaitlistItem => ({
  entryId: r.entry_id,
  kind: r.subject_kind,
  sessionId: r.class_session_id,
  resourceId: r.resource_id,
  courtName: r.class_court ?? r.slot_court,
  className: r.name_th !== null && r.name_en !== null ? { th: r.name_th, en: r.name_en } : null,
  startAt: (r.class_start ?? r.slot_start_at)?.toISOString() ?? null,
  status: r.status,
  position: r.position,
  offerExpiresAt: r.offer_expires_at?.toISOString() ?? null,
});

/** C13: the caller's own live entries with their own place in line. */
export async function myWaitlist(tx: Tx): Promise<WaitlistItem[]> {
  const r = await tx.query<ItemRow>(`${ITEM_SQL} order by coalesce(c.start_at, w.slot_start_at), w.entry_id`);
  return r.rows.map(item);
}

export interface OfferDetail extends WaitlistItem {
  /** The held booking and its order, once an offer is open: what Pay is called on (F04-T22c). */
  offer: { orderId: string; bookingId: string; holdExpiresAt: string } | null;
}

/** C16: one of the caller's own entries; not found when it is not theirs or is over. */
export async function myWaitlistEntry(tx: Tx, id: unknown): Promise<OfferDetail> {
  const eid = uuid(id);
  const r = await tx.query<ItemRow>(`${ITEM_SQL} where w.entry_id = $1`, [eid]);
  const row = r.rows[0];
  if (!row) throw new ClassError('not_found');
  let offer: OfferDetail['offer'] = null;
  if (row.status === 'offered') {
    const o = await tx.query<{ order_id: string; id: string; hold_expires_at: Date }>(
      `select b.order_id, b.id, b.hold_expires_at from public.waitlist_entry w
         join public.booking b on b.club_id = w.club_id and b.id = w.offer_booking_id
        where w.id = $1 and w.customer_id = app.user_id() and w.status = 'offered' and w.offer_expires_at > app.now()
          and b.status = 'awaiting_payment' and b.hold_expires_at > app.now()`,
      [eid],
    );
    if (o.rows[0]) offer = { orderId: o.rows[0].order_id, bookingId: o.rows[0].id, holdExpiresAt: o.rows[0].hold_expires_at.toISOString() };
  }
  return { ...item(row), offer };
}

/**
 * The claim (CLASS-02-AC3, AC7; design 4.11): the entry must be the caller's, offered, and unexpired, or the spot is gone. The
 * answer names the offer's held booking and order, which F04's Pay takes as the claim instead of making a second reservation;
 * this call takes no seat and writes nothing.
 */
export async function claimOffer(tx: Tx, id: unknown): Promise<NonNullable<OfferDetail['offer']>> {
  const eid = uuid(id);
  // The caller's own row, whatever its status (a player reads their own entries): an entry that is not theirs is not found; one
  // whose offer has ended is the spot gone.
  const own = await tx.query<{ status: string }>(`select status from public.waitlist_entry where id = $1 and customer_id = app.user_id()`, [eid]);
  if (!own.rows[0]) throw new ClassError('not_found');
  if (own.rows[0].status !== 'offered') throw new ClassError('spot_gone');
  const detail = await myWaitlistEntry(tx, eid);
  if (!detail.offer) throw new ClassError('spot_gone');
  return detail.offer;
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
