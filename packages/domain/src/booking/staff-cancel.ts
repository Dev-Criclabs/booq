import type { Tx } from '../../../db/src/tx';
import { BookingError } from './errors';
import { readBooking } from './player';

// F09-T13: the staff side of A2 (CANCEL-01-AC20, CANCEL-04; F09 design 4.1, 4.2, 4.5, 5). Front desk and owner only (the
// route's permission; the database checks the role again). The rule lives in the database: app.cancel_outcome for the
// preview, app.cancel_booking, app.mark_no_show, app.mark_late_cancel and app.reverse_mark, each with a written reason
// (a missing or blank one is refused there as reason_required). Inputs are parsed here; refusals come back from the
// database as 'cancel:<code>', 'mark:<code>' or 'reverse:<code>' and the route maps them. Answers hold codes, ids and numbers.

interface Reader {
  userId: string | null;
  roles: readonly string[];
}

const reasonOf = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || v.length > 500) throw new BookingError('bad_input');
  return v;
};

/** Both outcomes A2 can offer: the staff cancel (the window applies) and the club cancel (full value, AC20). */
export async function previewStaffCancel(tx: Tx, reader: Reader, id: unknown) {
  const row = await readBooking(tx, reader, id, true);
  const r = await tx.query<{ staff: Record<string, unknown>; club: Record<string, unknown> }>(
    'select app.cancel_outcome($1, true, false) as staff, app.cancel_outcome($1, true, true) as club',
    [row.id],
  );
  return { bookingId: row.id, staffCancel: r.rows[0]!.staff, clubCancel: r.rows[0]!.club };
}

export async function staffCancel(tx: Tx, reader: Reader, id: unknown, input: { clubCancel?: unknown; reason?: unknown }) {
  if (input.clubCancel !== undefined && typeof input.clubCancel !== 'boolean') throw new BookingError('bad_input');
  const reason = reasonOf(input.reason);
  const row = await readBooking(tx, reader, id, true);
  const r = await tx.query<{ r: { kind: string; outcome: string; version: number; returned: unknown; repeated: boolean } }>(
    'select app.cancel_booking($1, true, $2, $3, null) as r',
    [row.id, input.clubCancel === true, reason],
  );
  const x = r.rows[0]!.r;
  return { bookingId: row.id, kind: x.kind, outcome: x.outcome, version: x.version, returned: x.returned, repeated: x.repeated };
}

const MARK_FN = { no_show: 'app.mark_no_show', late_cancel: 'app.mark_late_cancel' } as const;

export async function markBooking(tx: Tx, reader: Reader, id: unknown, input: { kind?: unknown; reason?: unknown }) {
  const kind = input.kind;
  if (kind !== 'no_show' && kind !== 'late_cancel') throw new BookingError('bad_input');
  const reason = reasonOf(input.reason);
  const row = await readBooking(tx, reader, id, true);
  const r = await tx.query<{ r: Record<string, unknown> }>(`select ${MARK_FN[kind]}($1, $2) as r`, [row.id, reason]);
  return { bookingId: row.id, ...r.rows[0]!.r };
}

export async function reverseBookingMark(tx: Tx, reader: Reader, id: unknown, input: { reason?: unknown }) {
  const reason = reasonOf(input.reason);
  const row = await readBooking(tx, reader, id, true);
  const r = await tx.query<{ r: Record<string, unknown> }>('select app.reverse_mark($1, $2) as r', [row.id, reason]);
  return { bookingId: row.id, ...r.rows[0]!.r };
}
