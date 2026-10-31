import type { ClubContext, Db, Tx } from '../../../db/src/tx';
import { readSecret } from '../../../secrets/src/index';
import { qrExpiryTime, type KeySet, type PaymentGateway } from './gateway';

// F05-T04b: startPayment, after the Pay transaction has committed the order and its hold (design 5.1;
// PAY-02-AC1 to AC3, PAY-01-AC1, AC7; D47, D72, D75, D80). Three short steps, the Beam call outside any
// transaction:
//   1. app.start_payment(order): the pending payment for exactly the money due, or the one that exists (a second
//      tap, D47; after a failed charge a new one in the same hold, D72). A payment with a charge is returned as is.
//   2. the club's active key set (app.payment_charge_context, the key through the secret reader) and the QR expiry,
//      the hold end less the platform margin; then POST the charge with the payment id as the idempotency key.
//   3. app.record_charge stores the charge id, QR and expiry.
// When the keys are missing or Beam refuses them: release the hold (payment_unavailable, so the restore handlers
// run and no "Booking released" message goes out), flag the owner and raise the P1 alert. When Beam cannot be
// reached, or the margin is unset: release and raise the P1 alert only. The player gets payment_unavailable.
// The P1 alert is a failed check in platform.club_health (F05-T04c), written in the release's transaction.

export type PaymentAlertKind = 'beam_unreachable' | 'beam_keys_missing' | 'beam_key_check_failed' | 'qr_margin_unset' | 'package_qr_unset';

// Each alert is also a failed check in platform.club_health for the console health tile (F05-T04c, 0699).
// A club's own unset package QR time is the owner's setting, not a Beam fault: an alert, no health row.
const HEALTH: Partial<Record<PaymentAlertKind, [check: 'beam_keys' | 'beam_charge', reason: string]>> = {
  beam_keys_missing: ['beam_keys', 'keys_missing'],
  beam_key_check_failed: ['beam_keys', 'key_refused'],
  beam_unreachable: ['beam_charge', 'unreachable'],
  qr_margin_unset: ['beam_charge', 'margin_unset'],
};

/** Platform alerts (P1): a kind and the club only; never a key, an amount or a person. */
export interface PaymentAlerts {
  p1(kind: PaymentAlertKind, clubId: string): void;
}

export interface StartPaymentDeps {
  db: Db;
  /** The secret reader's private key (F01-T09). */
  privateKey: string;
  gateway(creds: { set: KeySet; merchantId: string; apiKey: string }): PaymentGateway;
  alerts: PaymentAlerts;
  now(): Date;
}

export type StartedPayment =
  | { ok: true; paymentId: string; amountSatang: number; qrImageBase64: string; qrExpiresAt: string }
  | { ok: false; code: 'payment_unavailable' };

interface ChargeContext {
  merchant_id: string | null;
  environment: KeySet;
  amount_satang: number;
  hold_expires_at: string | null;
  qr_expiry_margin_seconds: number | null;
  has_bookings: boolean;
  package_qr_minutes: number | null;
}

interface Stored {
  gateway_charge_id: string | null;
  qr_image: string | null;
  qr_expires_at: Date | null;
  amount_satang: number;
}

const unavailable = { ok: false, code: 'payment_unavailable' } as const;

async function storedPayment(tx: Tx, paymentId: string): Promise<Stored> {
  return (await tx.query<Stored>(
    `select gateway_charge_id, qr_image, qr_expires_at, amount_satang from public.payment where club_id = app.club_id() and id = $1`,
    [paymentId],
  )).rows[0]!;
}

function asStarted(paymentId: string, p: Stored): StartedPayment {
  return { ok: true, paymentId, amountSatang: p.amount_satang, qrImageBase64: p.qr_image!, qrExpiresAt: new Date(p.qr_expires_at!).toISOString() };
}

export async function startPayment(deps: StartPaymentDeps, ctx: ClubContext, orderId: string): Promise<StartedPayment> {
  type Prepared = { kind: 'stored'; result: StartedPayment } | { kind: 'charge'; paymentId: string; set: KeySet; merchantId: string; apiKey: string; amount: number; expiryTime: string } | { kind: 'refuse'; alert: PaymentAlertKind; flag: boolean };
  const prepared = await deps.db.withClubTx<Prepared>(ctx, async (tx) => {
    const paymentId = (await tx.query<{ id: string }>('select app.start_payment($1) as id', [orderId])).rows[0]!.id;
    const stored = await storedPayment(tx, paymentId);
    if (stored.gateway_charge_id !== null && stored.qr_image !== null) return { kind: 'stored', result: asStarted(paymentId, stored) };
    const c = (await tx.query<{ c: ChargeContext }>('select app.payment_charge_context($1) as c', [paymentId])).rows[0]!.c;
    const apiKey = c.merchant_id === null ? null : await readSecret(tx, deps.privateKey, ctx.clubId, c.environment === 'live' ? 'beam_api_key_live' : 'beam_api_key_test');
    if (c.merchant_id === null || apiKey === null) return { kind: 'refuse', alert: 'beam_keys_missing', flag: true };
    let expiryTime: string;
    if (!c.has_bookings) {
      // A package bought alone: no hold, the QR lives the club's package_qr_minutes (D74); unset is no payment.
      if (c.package_qr_minutes === null) return { kind: 'refuse', alert: 'package_qr_unset', flag: false };
      expiryTime = new Date(deps.now().getTime() + c.package_qr_minutes * 60_000).toISOString();
    } else {
      const expiry = c.hold_expires_at === null ? null : qrExpiryTime(c.hold_expires_at, c.qr_expiry_margin_seconds, deps.now());
      if (expiry === null || !expiry.ok) return { kind: 'refuse', alert: 'qr_margin_unset', flag: false };
      expiryTime = expiry.expiryTime;
    }
    return { kind: 'charge', paymentId, set: c.environment, merchantId: c.merchant_id, apiKey, amount: c.amount_satang, expiryTime };
  });
  if (prepared.kind === 'stored') return prepared.result;
  if (prepared.kind === 'refuse') return refuse(deps, ctx, orderId, prepared.alert, prepared.flag);

  let created;
  try {
    created = await deps.gateway({ set: prepared.set, merchantId: prepared.merchantId, apiKey: prepared.apiKey }).createCharge({
      amountSatang: prepared.amount,
      expiryTime: prepared.expiryTime,
      referenceId: prepared.paymentId,
      idempotencyKey: prepared.paymentId,
    });
  } catch (e) {
    const unauthorized = (e as { kind?: string }).kind === 'unauthorized';
    return refuse(deps, ctx, orderId, unauthorized ? 'beam_key_check_failed' : 'beam_unreachable', unauthorized);
  }
  return deps.db.withClubTx(ctx, async (tx) => {
    try {
      await tx.query('savepoint record_charge');
      await tx.query('select app.record_charge($1, $2, $3, $4)', [prepared.paymentId, created.chargeId, created.qrImageBase64, created.qrExpiresAt]);
      // Beam took the keys and made the charge: both checks are ok again.
      await tx.query(`select app.report_payment_health('beam_keys', null), app.report_payment_health('beam_charge', null)`);
    } catch (e) {
      // A parallel tap recorded the same charge first (same idempotency key, G8): keep what is stored.
      if (!/already recorded/.test((e as Error).message ?? '')) throw e;
      await tx.query('rollback to savepoint record_charge');
    }
    return asStarted(prepared.paymentId, await storedPayment(tx, prepared.paymentId));
  });
}

async function refuse(deps: StartPaymentDeps, ctx: ClubContext, orderId: string, alert: PaymentAlertKind, flag: boolean): Promise<StartedPayment> {
  await deps.db.withClubTx(ctx, async (tx) => {
    // An order with bookings releases its hold; a package bought alone has none, so it is ended instead (0416).
    const released = (await tx.query<{ r: boolean }>(`select app.release_hold($1, 'payment_unavailable') as r`, [orderId])).rows[0]?.r === true;
    if (!released) await tx.query(`select app.end_package_order($1, 'payment_unavailable')`, [orderId]);
    if (flag) await tx.query('select app.flag_key_check_failed()');
    const health = HEALTH[alert];
    if (health) await tx.query('select app.report_payment_health($1, $2)', health);
  });
  deps.alerts.p1(alert, ctx.clubId);
  return unavailable;
}
