import type { Tx } from '../../../db/src/tx';
import { AdminError } from './errors';

// F11-T03: the staff calendar (ADMIN-03). One read; the range check is the service's and the database's. Names only.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 7;

export interface CalendarCell {
  resourceId: string;
  resourceName: string;
  startAt: string;
  endAt: string;
  kind: string;
  state: 'confirmed' | 'held';
  holdExpiresAt: string | null;
  bookingId: string | null;
  bookingStatus: string | null;
  bookingSource: string | null;
  customerId: string | null;
  customerName: string | null;
  coachId: string | null;
  coachName: string | null;
  classSessionId: string | null;
  classNameTh: string | null;
  classNameEn: string | null;
  closureId: string | null;
}

interface Row {
  resource_id: string; resource_name: string; start_at: Date; end_at: Date; kind: string; state: 'confirmed' | 'held'; hold_expires_at: Date | null;
  booking_id: string | null; booking_status: string | null; booking_source: string | null; customer_id: string | null; customer_name: string | null;
  coach_id: string | null; coach_name: string | null; class_session_id: string | null; class_name_th: string | null; class_name_en: string | null; closure_id: string | null;
}

export async function staffCalendar(tx: Tx, from: unknown, to: unknown): Promise<CalendarCell[]> {
  if (typeof from !== 'string' || typeof to !== 'string' || !DAY.test(from) || !DAY.test(to) || to < from) throw new AdminError('bad_input');
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 >= MAX_DAYS) throw new AdminError('bad_input');
  const r = await tx.query<Row>(`select * from public.staff_calendar($1::date, $2::date)`, [from, to]);
  return r.rows.map((x) => ({
    resourceId: x.resource_id, resourceName: x.resource_name, startAt: x.start_at.toISOString(), endAt: x.end_at.toISOString(), kind: x.kind, state: x.state,
    holdExpiresAt: x.hold_expires_at ? x.hold_expires_at.toISOString() : null, bookingId: x.booking_id, bookingStatus: x.booking_status,
    bookingSource: x.booking_source, customerId: x.customer_id, customerName: x.customer_name, coachId: x.coach_id, coachName: x.coach_name,
    classSessionId: x.class_session_id, classNameTh: x.class_name_th, classNameEn: x.class_name_en, closureId: x.closure_id,
  }));
}
