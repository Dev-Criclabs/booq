import type { Tx } from '../../../db/src/tx';
import { BookingError } from './errors';
import { isBookingStaff, readBooking, viewOf, type BookingView } from './player';

// F03-T22 (move and release): the staff side of design 5.3 (BOOK-04-AC7; decisions D43, D60). Owner and
// front desk only. The move is app.move_booking, so the exclusion constraints re-check the new court and
// hour, the coach rules run when a coach is held, and a conflict changes nothing; its typed refusals
// (BK001) pass through to the route. Abandoning an awaiting booking is app.release_hold(order, 'staff').
// In a Paused club only the owner may still manage existing bookings (D60); front desk is refused.

interface Staff {
  userId: string | null;
  roles: readonly string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

async function assertMayManage(tx: Tx, staff: Staff): Promise<void> {
  if (!isBookingStaff(staff)) throw new BookingError('forbidden');
  const r = await tx.query<{ status: string }>('select status from public.club where id = app.club_id()');
  if (r.rows[0]?.status === 'paused' && !staff.roles.includes('owner')) throw new BookingError('club_paused');
}

function parseMove(input: unknown): { courtId: string; start: Date } {
  const i = (input ?? {}) as Record<string, unknown>;
  const { courtId, start } = i;
  if (typeof courtId !== 'string' || !UUID.test(courtId) || typeof start !== 'string' || !INSTANT.test(start)) throw new BookingError('bad_input');
  const at = new Date(start);
  if (Number.isNaN(at.getTime())) throw new BookingError('bad_input');
  return { courtId, start: at };
}

export async function moveStaffBooking(tx: Tx, staff: Staff, id: unknown, input: unknown): Promise<BookingView> {
  const move = parseMove(input);
  await assertMayManage(tx, staff);
  const row = await readBooking(tx, staff, id, true);
  await tx.query('select app.move_booking($1, $2, $3)', [row.id, move.courtId, move.start]);
  return viewOf(await readBooking(tx, staff, row.id, true));
}

/** Staff abandon a booking that is awaiting payment: the whole order's hold ends with reason `staff`. */
export async function releaseStaffHold(tx: Tx, staff: Staff, id: unknown): Promise<{ orderId: string; status: 'released' }> {
  await assertMayManage(tx, staff);
  const row = await readBooking(tx, staff, id, true);
  if (row.status !== 'awaiting_payment') throw new BookingError('not_releasable');
  const r = await tx.query<{ released: boolean }>(`select app.release_hold($1, 'staff') as released`, [row.order_id]);
  if (r.rows[0]?.released !== true) throw new BookingError('not_releasable');
  return { orderId: row.order_id, status: 'released' };
}
