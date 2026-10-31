import type { Tx } from '../../../db/src/tx';

// F05 design 6 / C11: the state of one payment for the payment screen. The player's own payment (row policy payment_own_read) or the club's
// for staff. The QR image is returned only while the payment waits: once it is final the database clears it. Codes and plain values only;
// the page picks the text. The screen polls this until the state is final (assumption A-1).

export type PaymentState = 'waiting' | 'checking' | 'confirmed' | 'wallet' | 'failed' | 'expired';

export interface PaymentStatus {
  paymentId: string;
  orderId: string;
  state: PaymentState;
  amountSatang: number;
  /** The QR as a base64 image, only while the payment waits. */
  qrImageBase64: string | null;
  qrExpiresAt: string | null;
  /** When the held hours are given up if unpaid; null once final. */
  holdExpiresAt: string | null;
  /** The first booking of the order, for the lines of the screen. */
  booking: { courtName: string | null; startAt: string; endAt: string } | null;
  /** The receipt of the paid order (its number), once confirmed. */
  receiptNumber: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PaymentNotFound extends Error {
  constructor() {
    super('payment_not_found');
  }
}

export function stateOf(status: string, outcome: string | null): PaymentState {
  if (status === 'succeeded') return outcome !== null && outcome.startsWith('wallet_') ? 'wallet' : 'confirmed';
  if (status === 'failed') return 'failed';
  if (status === 'expired' || status === 'cancelled') return 'expired';
  return outcome === 'mismatch' ? 'checking' : 'waiting';
}

export async function paymentStatus(tx: Tx, id: unknown): Promise<PaymentStatus> {
  if (typeof id !== 'string' || !UUID.test(id)) throw new PaymentNotFound();
  const p = (await tx.query<{
    id: string; order_id: string; status: string; outcome: string | null; amount_satang: number; qr_image: string | null; qr_expires_at: Date | null;
  }>(`select id, order_id, status, outcome, amount_satang, qr_image, qr_expires_at from public.payment where id = $1`, [id.toLowerCase()])).rows[0];
  if (!p) throw new PaymentNotFound();
  const state = stateOf(p.status, p.outcome);
  const hold = (await tx.query<{ h: Date | null }>(
    `select min(hold_expires_at) as h from public.booking where order_id = $1 and status = 'awaiting_payment' and hold_expires_at > app.now()`, [p.order_id])).rows[0]?.h ?? null;
  const b = (await tx.query<{ name: string | null; start_at: Date; end_at: Date }>(
    `select r.name, b.start_at, b.end_at from public.booking b left join public.resource r on r.club_id = b.club_id and r.id = b.resource_id
      where b.order_id = $1 order by b.start_at, b.id limit 1`, [p.order_id])).rows[0];
  const receipt = state === 'confirmed' ? (await tx.query<{ number: string }>(`select number from public.receipt where order_id = $1 and status = 'issued' order by issued_at limit 1`, [p.order_id])).rows[0] : undefined;
  return {
    paymentId: p.id, orderId: p.order_id, state, amountSatang: p.amount_satang,
    qrImageBase64: state === 'waiting' ? p.qr_image : null,
    qrExpiresAt: state === 'waiting' && p.qr_expires_at ? p.qr_expires_at.toISOString() : null,
    holdExpiresAt: state === 'waiting' || state === 'checking' ? (hold ? hold.toISOString() : null) : null,
    booking: b ? { courtName: b.name, startAt: b.start_at.toISOString(), endAt: b.end_at.toISOString() } : null,
    receiptNumber: receipt?.number ?? null,
  };
}
