import type { Tx } from '../../../db/src/tx';

// F05 §5.6 (PAY-06-AC1 to AC5; D174, D181): the front desk takes cash for an open order: a court booking order inside
// its hold, a package order, or both. The reason code is no_banking_app, qr_failed_at_counter or other with a note
// (the table CHECK and app.take_cash enforce it too). app.take_cash (0408) cancels a pending Beam charge first, writes
// the cash payment, grants packages, confirms the booking through confirm_booking, issues the receipt and audits the
// reason; all in the caller's transaction. A Paused club takes no new payment at the desk either (D181). Value taken
// in cash never goes back as cash: a later cancel returns it to the wallet (PAY-06-AC7, F09).
//   * An order that adds a coach (0806) is refused here: take_cash does not confirm a coach add, so the coach would be
//     released while the order is paid. It is paid by QR until take_cash learns it.

export type CashErrorCode =
  | 'bad_input'
  | 'cash_reason_required'
  | 'cash_note_required'
  | 'club_paused'
  | 'order_not_found'
  | 'nothing_to_pay'
  | 'hold_ended'
  | 'credit_unavailable'
  | 'coach_add_not_supported';

/** The locale key each refusal shows on A2 (pending, locales/pending/f05.json; A-0058 reused). */
export const CASH_TEXT_KEYS: Record<CashErrorCode, string> = {
  bad_input: 'A-new.cash_bad_input',
  cash_reason_required: 'A-0058',
  cash_note_required: 'A-new.cash_note_required',
  club_paused: 'A-new.cash_club_paused',
  order_not_found: 'A-new.cash_order_not_found',
  nothing_to_pay: 'A-new.cash_nothing_to_pay',
  hold_ended: 'A-new.cash_hold_ended',
  credit_unavailable: 'A-new.cash_credit_unavailable',
  coach_add_not_supported: 'A-new.cash_coach_add_not_supported',
};

export class CashError extends Error {
  constructor(readonly code: CashErrorCode) {
    super(code);
  }
}

export interface CashRequest {
  reasonCode: 'no_banking_app' | 'qr_failed_at_counter' | 'other';
  note: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS = ['no_banking_app', 'qr_failed_at_counter', 'other'] as const;
const MAX_NOTE = 500;

export function parseCashRequest(body: unknown): CashRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const reason = b['reasonCode'];
  if (reason === undefined || reason === null || reason === '') throw new CashError('cash_reason_required');
  if (typeof reason !== 'string' || !(REASONS as readonly string[]).includes(reason)) throw new CashError('bad_input');
  const note = b['note'] ?? null;
  if (note !== null && (typeof note !== 'string' || note.length > MAX_NOTE)) throw new CashError('bad_input');
  const trimmed = note === null ? '' : note.trim();
  if (reason === 'other' && trimmed === '') throw new CashError('cash_note_required');
  return { reasonCode: reason as CashRequest['reasonCode'], note: trimmed === '' ? null : trimmed };
}

// take_cash's refusals (P0001), by message.
const REFUSALS: Array<[RegExp, CashErrorCode]> = [
  [/^payment: no open order/, 'order_not_found'],
  [/^payment: nothing to pay in cash/, 'nothing_to_pay'],
  [/^payment: the hold is not running/, 'hold_ended'],
  [/^payment: the booking cannot be confirmed/, 'hold_ended'],
  [/^payment: the credits cannot be reserved/, 'credit_unavailable'],
  [/^payment: unknown cash reason code/, 'bad_input'],
  [/^payment: a note is required/, 'cash_note_required'],
];

/** Take cash for `orderId` in the caller's club transaction (front desk or owner). */
export async function takeCash(tx: Tx, orderId: unknown, req: CashRequest): Promise<{ orderId: string; paymentId: string; orderStatus: 'paid' }> {
  if (typeof orderId !== 'string' || !UUID.test(orderId)) throw new CashError('order_not_found');
  const club = (await tx.query<{ status: string }>('select status from public.club where id = app.club_id()')).rows[0];
  if (club?.status === 'paused') throw new CashError('club_paused');
  const add = (await tx.query<{ n: number }>(
    'select count(*)::int as n from public.booking_coach_add where club_id = app.club_id() and order_id = $1',
    [orderId],
  )).rows[0];
  if ((add?.n ?? 0) > 0) throw new CashError('coach_add_not_supported');
  try {
    await tx.query('savepoint take_cash');
    const r = (await tx.query<{ r: { payment_id: string; order_status: 'paid' } }>('select app.take_cash($1, $2, $3) as r', [orderId, req.reasonCode, req.note])).rows[0]!.r;
    await tx.query('release savepoint take_cash');
    return { orderId: orderId.toLowerCase(), paymentId: r.payment_id, orderStatus: r.order_status };
  } catch (e) {
    await tx.query('rollback to savepoint take_cash');
    const m = (e as { message?: string }).message ?? '';
    const hit = REFUSALS.find(([re]) => re.test(m));
    if (hit) throw new CashError(hit[1]);
    throw e;
  }
}
