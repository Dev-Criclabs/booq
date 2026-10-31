import type { Tx } from '../../../db/src/tx';
import { AdminError } from './errors';

// F11-T07: the credit and wallet panels of A6 (ADMIN-07; F06 PKG-01, PKG-03-AC5, D88, D118). Reads go through the tables and views staff may
// read; every change calls the F06 function, which writes a ledger row and checks the role and the written reason. Value never changes as a
// single editable number; an adjust is a ledger movement with who and why. A refusal of the function is mapped to a typed code.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTE_MAX = 500;
const bad = (): never => {
  throw new AdminError('bad_input');
};
const id = (v: unknown): string => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : bad());
const found = (v: unknown): string => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : (() => { throw new AdminError('not_found'); })());

/** The F06 refusals (SQLSTATE P0001, 'kind:code') mapped to the admin codes. */
export function mapValueError(e: unknown): AdminError | null {
  const m = (e as { code?: string; message?: string }).code === 'P0001' ? (e as { message: string }).message : '';
  switch (m) {
    case 'wallet:note_required': case 'credit:note_required': case 'package:reason_required': return new AdminError('reason_required');
    case 'wallet:below_zero': case 'credit:below_zero': return new AdminError('below_zero');
    case 'wallet:amount': case 'credit:amount': case 'package:expiry_not_later_day': return new AdminError('bad_input');
    case 'credit:package_not_found': case 'package:not_found': return new AdminError('not_found');
    case 'customer_not_claimed': return new AdminError('customer_not_claimed');
    default: return null;
  }
}

export interface CustomerPackage {
  packageId: string;
  nameTh: string;
  nameEn: string;
  creditType: string;
  creditsTotal: number;
  creditsLeft: number;
  status: 'active' | 'used_up' | 'expired';
  purchasedAt: string;
  expiresAt: string;
}
export interface LedgerRow {
  at: string;
  change: number;
  reason: string;
  note: string | null;
  packageId?: string;
}
export interface CustomerValue {
  packages: CustomerPackage[];
  wallet: { balanceSatang: number; ledger: LedgerRow[] };
  creditLedger: LedgerRow[];
}

/** GET /staff/customers/:id/credits: packages with credits left, the wallet balance and the latest ledger rows of each (D57). */
export async function customerValue(tx: Tx, customer: unknown): Promise<CustomerValue> {
  const c = found(customer);
  const exists = await tx.query(`select 1 from public.app_user where id = $1 and anonymised_at is null`, [c]);
  if (!exists.rows[0]) throw new AdminError('not_found');
  const pk = await tx.query(
    `select cp.id, p.name_th, p.name_en, p.credit_type, cp.credits_total, s.credits_left, s.status, cp.purchased_at, cp.expires_at
       from public.customer_package cp join public.package_status s on s.package_id = cp.id join public.package_product p on p.club_id = cp.club_id and p.id = cp.product_id
      where cp.customer_id = $1 order by cp.expires_at desc, cp.id`, [c]);
  const bal = await tx.query<{ b: string }>(`select coalesce((select balance_satang from public.wallet_balance where customer_id = $1), 0) as b`, [c]);
  const wl = await tx.query(`select change_satang, reason, note, created_at from public.wallet_ledger where customer_id = $1 order by created_at desc, id desc limit 50`, [c]);
  const cl = await tx.query(
    `select l.change, l.reason, l.note, l.created_at, l.package_id from public.credit_ledger l join public.customer_package cp on cp.club_id = l.club_id and cp.id = l.package_id
      where cp.customer_id = $1 order by l.created_at desc, l.id desc limit 50`, [c]);
  return {
    packages: pk.rows.map((r) => ({
      packageId: r.id, nameTh: r.name_th, nameEn: r.name_en, creditType: r.credit_type, creditsTotal: r.credits_total, creditsLeft: r.credits_left, status: r.status,
      purchasedAt: new Date(r.purchased_at).toISOString(), expiresAt: new Date(r.expires_at).toISOString(),
    })),
    wallet: {
      balanceSatang: Number(bal.rows[0]!.b),
      ledger: wl.rows.map((r) => ({ at: new Date(r.created_at).toISOString(), change: Number(r.change_satang), reason: r.reason, note: r.note })),
    },
    creditLedger: cl.rows.map((r) => ({ at: new Date(r.created_at).toISOString(), change: r.change, reason: r.reason, note: r.note, packageId: r.package_id })),
  };
}

function noteOf(v: unknown): string {
  if (typeof v !== 'string') throw new AdminError('reason_required');
  const t = v.trim();
  if (t === '') throw new AdminError('reason_required');
  if (t.length > NOTE_MAX) return bad();
  return t;
}

/** POST /staff/customers/:id/credit-adjust {packageId, delta, note}: the change is one ledger row with the staff member and the note. */
export async function creditAdjust(tx: Tx, customer: unknown, body: { packageId?: unknown; delta?: unknown; note?: unknown }): Promise<{ ledgerId: string }> {
  const c = found(customer);
  const pkg = id(body.packageId);
  if (!Number.isInteger(body.delta) || body.delta === 0) return bad();
  const note = noteOf(body.note);
  const own = await tx.query(`select 1 from public.customer_package where id = $1 and customer_id = $2`, [pkg, c]);
  if (!own.rows[0]) throw new AdminError('not_found');
  const r = await tx.query<{ id: string }>(`select app.credit_adjust($1, $2, $3) as id`, [pkg, body.delta, note]);
  return { ledgerId: r.rows[0]!.id };
}

/** POST /staff/customers/:id/wallet-adjust {deltaSatang, note} */
export async function walletAdjust(tx: Tx, customer: unknown, body: { deltaSatang?: unknown; note?: unknown }): Promise<{ ledgerId: string }> {
  const c = found(customer);
  if (!Number.isInteger(body.deltaSatang) || body.deltaSatang === 0) return bad();
  const note = noteOf(body.note);
  const r = await tx.query<{ id: string }>(`select app.wallet_adjust($1, $2, $3) as id`, [c, body.deltaSatang, note]);
  return { ledgerId: r.rows[0]!.id };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** POST /staff/packages/:id/extend {newExpiresOn, reason} (owner, D88, D118): a later day, ending at the end of that Bangkok day (D20). */
export async function extendPackage(tx: Tx, pkg: unknown, body: { newExpiresOn?: unknown; reason?: unknown }): Promise<{ extensionId: string }> {
  const p = found(pkg);
  if (typeof body.newExpiresOn !== 'string' || !DAY.test(body.newExpiresOn)) return bad();
  const reason = noteOf(body.reason);
  const r = await tx.query<{ id: string }>(`select app.extend_package($1, (($2::date + 1)::timestamp at time zone 'Asia/Bangkok') - interval '1 millisecond', $3) as id`, [p, body.newExpiresOn, reason]);
  return { extensionId: r.rows[0]!.id };
}
