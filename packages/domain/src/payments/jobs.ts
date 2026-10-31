import { createHash } from 'node:crypto';
import type { Tx } from '../../../db/src/tx';
import { readSecret } from '../../../secrets/src/index';
import type { KeySet, PaymentGateway } from './gateway';
import type { PaymentAlerts } from './start';

// F05-T09: the payment jobs, one club at a time inside the worker's club transaction (F05 design 5.2, 5.10; FA 5.4;
// PAY-02-AC15, PAY-04-AC1 to AC7; D73, D74). The worker tasks in apps/worker call these per club.
//   beam_reconcile: when a callback never arrives (D73). For each pending Beam payment older than the platform age setting,
//     look the charge up and act on what Beam holds, exactly as the webhook does: confirm only when the status is succeeded
//     and the amount, the currency and the reference all match; a wrong amount is flagged, never confirmed; a failed charge
//     fails the payment and keeps the hold; still pending changes nothing. What it acted on is recorded as a payment_event of
//     type `reconcile` (the audit "confirmed by lookup"). No money is ever sent back to Beam.
//   package_order_expiry: a package order whose QR time ended unpaid is cancelled, its payment expired, no ledger row, no
//     receipt (PAY-04-AC2); a payment after that goes to the wallet through apply_payment (D74).
//   qr_image clean-up: a final payment keeps no QR image.

export interface ReconcileDeps {
  privateKey: string;
  gateway(creds: { set: KeySet; merchantId: string; apiKey: string }): PaymentGateway;
  alerts: PaymentAlerts;
}

export interface ReconcileResult {
  checked: number;
  acted: number;
  /** Payments that could not be looked up this time (keys or Beam); the next run tries again. */
  skipped: number;
  /** Payments whose action was refused and rolled back; the next run tries again. */
  failed: number;
}

interface Candidate {
  payment_id: string;
  gateway_charge_id: string;
  environment: KeySet;
  amount_satang: number;
}

export async function reconcileClub(tx: Tx, clubId: string, deps: ReconcileDeps): Promise<ReconcileResult> {
  const result: ReconcileResult = { checked: 0, acted: 0, skipped: 0, failed: 0 };
  const rows = (await tx.query<Candidate>('select * from app.beam_reconcile_candidates()')).rows;
  const creds = new Map<KeySet, { merchantId: string; apiKey: string } | null>();
  for (const c of rows) {
    result.checked += 1;
    if (!creds.has(c.environment)) {
      const merchantId = (await tx.query<{ m: string | null }>('select app.beam_merchant($1) as m', [c.environment])).rows[0]?.m ?? null;
      const apiKey = merchantId === null ? null : await readSecret(tx, deps.privateKey, clubId, c.environment === 'live' ? 'beam_api_key_live' : 'beam_api_key_test', 'worker');
      creds.set(c.environment, merchantId !== null && apiKey !== null ? { merchantId, apiKey } : null);
      if (merchantId === null || apiKey === null) {
        deps.alerts.p1('beam_keys_missing', clubId);
        await tx.query(`select app.report_payment_health('beam_keys', 'keys_missing')`);
      }
    }
    const cr = creds.get(c.environment);
    if (!cr) {
      result.skipped += 1;
      continue;
    }
    let looked;
    try {
      looked = await deps.gateway({ set: c.environment, ...cr }).getCharge(c.gateway_charge_id);
    } catch (e) {
      const refused = (e as { kind?: string }).kind === 'unauthorized';
      deps.alerts.p1(refused ? 'beam_key_check_failed' : 'beam_unreachable', clubId);
      await tx.query('select app.report_payment_health($1, $2)', refused ? ['beam_keys', 'key_refused'] : ['beam_charge', 'unreachable']);
      result.skipped += 1;
      continue;
    }
    if (looked.status === 'PENDING') continue;
    const seen = { status: looked.status, amount_satang: looked.amountSatang, reference: looked.referenceId };
    // One savepoint per payment: a refusal for one payment leaves the others and the club's run alone.
    await tx.query('savepoint reconcile_one');
    try {
      let outcome: string;
      if (looked.status === 'FAILED') {
        await tx.query('select app.fail_payment($1, $2)', [c.payment_id, 'beam_failed']);
        outcome = 'failed';
      } else if (looked.currency !== 'THB' || looked.referenceId !== c.payment_id || looked.amountSatang !== c.amount_satang) {
        if (looked.referenceId === c.payment_id && looked.currency === 'THB' && looked.amountSatang > 0) {
          await tx.query('select app.flag_wrong_amount($1, $2)', [c.payment_id, looked.amountSatang]);
        }
        outcome = 'mismatch';
      } else {
        outcome = (await tx.query<{ r: { outcome: string } }>('select app.apply_payment($1, $2) as r', [c.payment_id, looked.amountSatang])).rows[0]!.r.outcome;
      }
      const hash = createHash('sha256').update(JSON.stringify({ chargeId: c.gateway_charge_id, ...seen })).digest('hex');
      await tx.query('select app.record_payment_event($1, $2, $3, true, $4, $5, $6::jsonb)', [c.gateway_charge_id, 'reconcile', hash, outcome, c.payment_id, JSON.stringify(seen)]);
      await tx.query('release savepoint reconcile_one');
      result.acted += 1;
    } catch {
      await tx.query('rollback to savepoint reconcile_one');
      result.failed += 1;
    }
  }
  return result;
}

/** Package orders whose QR time ended unpaid: cancelled with their payment expired (PAY-04-AC2). Returns how many. */
export async function expirePackageOrdersClub(tx: Tx): Promise<number> {
  let n = 0;
  for (const { id } of (await tx.query<{ id: string }>('select c as id from app.package_order_expiry_candidates() c')).rows) {
    if ((await tx.query<{ r: boolean }>('select app.expire_package_order($1) as r', [id])).rows[0]?.r) n += 1;
  }
  return n;
}

/** Final payments lose their QR image. Returns how many were cleared. */
export async function clearFinalQrImagesClub(tx: Tx): Promise<number> {
  return Number((await tx.query<{ n: number }>('select app.clear_final_qr_images() as n')).rows[0]?.n ?? 0);
}
