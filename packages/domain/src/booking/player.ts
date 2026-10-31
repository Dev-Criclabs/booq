import type { Tx } from '../../../db/src/tx';
import { BookingError } from './errors';
import { toBangkokIso } from './time';

// F03-T21: one booking for C11 and C12, and the player leaving C11 (BOOK-03-AC14, ROLE-01-AC4; design
// 4.5, 5.2, 8). A player reaches only their own booking; owner and front desk reach the club's. Anything
// else (another player's, another club's, an accountant here, D35) is not found, so nothing is revealed.
// The release itself is app.release_hold(order, 'player'), which re-checks the owner under its lock.

export interface BookingView {
  id: string;
  orderId: string;
  type: string;
  status: string;
  court: { id: string; name: string };
  start: string;
  end: string;
  /** Null once confirmed or released. */
  holdExpiresAt: string | null;
  /** The hold's end time has passed (Time ran out), whether or not the release job has run. */
  holdEnded: boolean;
  /** Only in the staff read: who the booking is for. Null for a walk in with no customer record. */
  customer?: { id: string; name: string } | null;
}

interface Reader {
  userId: string | null;
  roles: readonly string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF = new Set(['owner', 'front_desk']);

export const isBookingStaff = (r: Reader) => r.roles.some((x) => STAFF.has(x));

interface Row {
  id: string;
  order_id: string;
  type: string;
  status: string;
  customer_id: string | null;
  resource_id: string;
  court_name: string;
  start_at: Date;
  end_at: Date;
  hold_expires_at: Date | null;
  hold_ended: boolean;
}

/** The booking as the caller may see it, or not_found. `staff` widens the reach to the club's bookings. */
export async function readBooking(tx: Tx, reader: Reader, id: unknown, staff: boolean): Promise<Row> {
  if (typeof id !== 'string' || !UUID.test(id)) throw new BookingError('not_found');
  const r = await tx.query<Row>(
    `select b.id, b.order_id, b.type, b.status, b.customer_id, b.resource_id, r.name as court_name, b.start_at, b.end_at,
            b.hold_expires_at, coalesce(b.hold_expires_at <= app.now(), false) as hold_ended
       from public.booking b
       join public.resource r on r.club_id = b.club_id and r.id = b.resource_id
      where b.club_id = app.club_id() and b.id = $1`,
    [id],
  );
  const row = r.rows[0];
  if (!row) throw new BookingError('not_found');
  const own = reader.userId !== null && row.customer_id === reader.userId;
  if (!own && !staff) throw new BookingError('not_found');
  return row;
}

export function viewOf(row: Row): BookingView {
  return {
    id: row.id,
    orderId: row.order_id,
    type: row.type,
    status: row.status,
    court: { id: row.resource_id, name: row.court_name },
    start: toBangkokIso(row.start_at),
    end: toBangkokIso(row.end_at),
    holdExpiresAt: row.hold_expires_at ? toBangkokIso(row.hold_expires_at) : null,
    holdEnded: row.hold_ended,
  };
}

export async function getBooking(tx: Tx, reader: Reader, id: unknown): Promise<BookingView> {
  const staff = isBookingStaff(reader);
  const row = await readBooking(tx, reader, id, staff);
  const view = viewOf(row);
  if (!staff) return view;
  if (row.customer_id === null) return { ...view, customer: null };
  const c = await tx.query<{ name: string | null }>(
    `select coalesce(nullif(btrim(full_name), ''), nullif(btrim(display_name), '')) as name from public.app_user where club_id = app.club_id() and id = $1`,
    [row.customer_id],
  );
  return { ...view, customer: { id: row.customer_id, name: c.rows[0]?.name ?? '' } };
}

/** The player leaves C11: the whole order's hold ends now with reason `player` (A-6). Own holds only. */
export async function releaseOwnHold(tx: Tx, reader: Reader, id: unknown): Promise<{ orderId: string; status: 'released' }> {
  const row = await readBooking(tx, reader, id, false);
  if (row.status !== 'awaiting_payment') throw new BookingError('not_releasable');
  const r = await tx.query<{ released: boolean }>(`select app.release_hold($1, 'player') as released`, [row.order_id]);
  if (r.rows[0]?.released !== true) throw new BookingError('not_releasable');   // confirmed or released meanwhile
  return { orderId: row.order_id, status: 'released' };
}
