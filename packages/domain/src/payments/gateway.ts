// The payment gateway as the app sees it (F05-T03; FA 6.3; design 5.1, 5.7, 5.8). It creates a QR charge and
// reads one back; there is no method that returns money (PAY-01-AC10, PAY-05): every return of value is a
// wallet or package credit. Amounts are integer satang. The Beam adapter is in packages/beam.

export type KeySet = 'test' | 'live';
export type ChargeStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';

export interface CreateCharge {
  amountSatang: number;
  /** When the QR stops working, UTC ISO 8601: the hold end less the margin (qrExpiryTime). */
  expiryTime: string;
  /** Our payment id; the only reference sent to the gateway, no player data (D76). */
  referenceId: string;
  idempotencyKey: string;
  returnUrl?: string;
}

export interface CreatedCharge {
  chargeId: string;
  status: ChargeStatus;
  amountSatang: number;
  qrImageBase64: string;
  qrExpiresAt: string;
}

export interface ChargeLookup {
  chargeId: string;
  status: ChargeStatus;
  amountSatang: number;
  currency: string;
  referenceId: string;
}

export interface PaymentGateway {
  createCharge(req: CreateCharge): Promise<CreatedCharge>;
  getCharge(chargeId: string): Promise<ChargeLookup>;
}

/** Everything a gateway may do. A test holds the adapters to it. */
export const GATEWAY_METHODS = ['createCharge', 'getCharge'] as const satisfies readonly (keyof PaymentGateway)[];

/** The key set of a club by its status (PAY-01-AC4, D32): Testing the test set, Live and Paused the live set. */
export function keySetFor(clubStatus: string): KeySet | null {
  if (clubStatus === 'testing') return 'test';
  if (clubStatus === 'live' || clubStatus === 'paused') return 'live';
  return null;
}

export type QrExpiry = { ok: true; expiryTime: string } | { ok: false; code: 'payment_unavailable'; reason: 'margin_unset' | 'no_time_left' };

/** The QR ends `marginSeconds` before the hold (D18, D80), so it never outlives the hold. The margin is the
 *  platform setting qr_expiry_margin_seconds; unset means payment is unavailable, never a default. */
export function qrExpiryTime(holdEndsAt: string, marginSeconds: number | null, now: Date): QrExpiry {
  if (marginSeconds === null || !Number.isInteger(marginSeconds) || marginSeconds < 0) return { ok: false, code: 'payment_unavailable', reason: 'margin_unset' };
  const at = new Date(new Date(holdEndsAt).getTime() - marginSeconds * 1000);
  if (Number.isNaN(at.getTime()) || at.getTime() <= now.getTime()) return { ok: false, code: 'payment_unavailable', reason: 'no_time_left' };
  return { ok: true, expiryTime: at.toISOString() };
}
