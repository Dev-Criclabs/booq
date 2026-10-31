import type { Tx } from '../../../db/src/tx';
import { PackageError } from './errors';

// F06-T15: what the player app reads of packages, credits and the wallet (C9, C14; PKG-01-AC10, PKG-02-AC7 to AC9).
// Products come from public.public_package_product (D103: named columns, active and priced only), so a guest sees what
// C9 shows and nothing else. A person's own packages, balance and movements come from the F06 views and ledgers, whose
// policies (0513) show a player only their own rows. Amounts are integer satang; a ledger reason is a code the client
// turns into its locale key (one per reason, F06-T21); no staff note or staff name is returned to the player.

export interface PublicProduct {
  productId: string;
  nameTh: string;
  nameEn: string;
  creditType: 'court_hour' | 'solo_class' | 'group_session';
  credits: number;
  validityMonths: number;
  priceGroupId: string | null;
  coachTierId: string | null;
  priceSatang: number;
  pricePerCreditSatang: number;
  /** credits x the matching single price - the price (D173); null when that price is unset or varies, or there is no saving. */
  savingSatang: number | null;
  /** The product's price group names (the owner's text), or null for a product open to every group. */
  priceGroupNameTh: string | null;
  priceGroupNameEn: string | null;
}

export interface OwnPackage {
  packageId: string;
  nameTh: string | null;
  nameEn: string | null;
  creditType: string;
  creditsLeft: number;
  expiresAt: string;
  status: 'active' | 'used_up' | 'expired';
}

export interface OwnCredits {
  packages: OwnPackage[];
  walletSatang: number;
}

export interface LedgerEntry {
  id: string;
  at: string;
  reason: string;
  /** Credits for kind credit, satang for kind wallet. */
  change: number;
  packageId: string | null;
  bookingId: string | null;
  orderId: string | null;
}

export interface LedgerPage {
  entries: LedgerEntry[];
  /** Pass back as `cursor` for the next, older page; null when there is none. */
  nextCursor: string | null;
}

const PAGE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listPublicProducts(tx: Tx): Promise<PublicProduct[]> {
  const { rows } = await tx.query<Record<string, unknown>>(
    `select id, name_th, name_en, credit_type, credits, validity_months, price_group_id, coach_tier_id, price_satang, price_per_credit_satang, saving_satang, price_group_name_th, price_group_name_en
       from public.public_package_product order by credit_type, credits, price_satang, id`,
  );
  return rows.map((r) => ({
    productId: r['id'] as string,
    nameTh: r['name_th'] as string,
    nameEn: r['name_en'] as string,
    creditType: r['credit_type'] as PublicProduct['creditType'],
    credits: Number(r['credits']),
    validityMonths: Number(r['validity_months']),
    priceGroupId: (r['price_group_id'] as string | null) ?? null,
    coachTierId: (r['coach_tier_id'] as string | null) ?? null,
    priceSatang: Number(r['price_satang']),
    pricePerCreditSatang: Number(r['price_per_credit_satang']),
    savingSatang: r['saving_satang'] === null ? null : Number(r['saving_satang']),
    priceGroupNameTh: (r['price_group_name_th'] as string | null) ?? null,
    priceGroupNameEn: (r['price_group_name_en'] as string | null) ?? null,
  }));
}

/** The caller's packages (active first, then by expiry) and wallet balance. */
export async function ownCredits(tx: Tx, userId: string): Promise<OwnCredits> {
  const packages = await tx.query<Record<string, unknown>>(
    `select s.package_id, s.credits_left, s.expires_at, s.status, cp.product_snapshot
       from public.package_status s join public.customer_package cp on cp.club_id = s.club_id and cp.id = s.package_id
      where s.customer_id = $1
      order by (s.status = 'active') desc, s.expires_at, s.package_id`,
    [userId],
  );
  const wallet = await tx.query<{ balance_satang: string }>(`select balance_satang from public.wallet_balance where customer_id = $1`, [userId]);
  return {
    packages: packages.rows.map((r) => {
      const snap = (r['product_snapshot'] ?? {}) as Record<string, unknown>;
      return {
        packageId: r['package_id'] as string,
        nameTh: (snap['name_th'] as string | undefined) ?? null,
        nameEn: (snap['name_en'] as string | undefined) ?? null,
        creditType: (snap['credit_type'] as string | undefined) ?? '',
        creditsLeft: Number(r['credits_left']),
        expiresAt: new Date(r['expires_at'] as string).toISOString(),
        status: r['status'] as OwnPackage['status'],
      };
    }),
    walletSatang: Number(wallet.rows[0]?.balance_satang ?? 0),
  };
}

function decodeCursor(cursor: unknown): { at: string; id: string } | null {
  if (cursor === undefined || cursor === null || cursor === '') return null;
  if (typeof cursor !== 'string') throw new PackageError('bad_input');
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!at || !id || !UUID.test(id) || Number.isNaN(Date.parse(at))) throw new PackageError('bad_input');
  return { at, id };
}
const encodeCursor = (at: string, id: string) => Buffer.from(`${at}|${id}`, 'utf8').toString('base64url');

/** The caller's movements of one kind, newest first, a page at a time (PKG-01-AC10). */
export async function ownLedger(tx: Tx, userId: string, kind: unknown, cursor: unknown): Promise<LedgerPage> {
  if (kind !== 'credit' && kind !== 'wallet') throw new PackageError('bad_input');
  const after = decodeCursor(cursor);
  const sql = kind === 'credit'
    ? `select l.id, l.created_at, l.reason, l.change::bigint as change, l.package_id, l.booking_id, null::uuid as order_id
         from public.credit_ledger l join public.customer_package p on p.club_id = l.club_id and p.id = l.package_id
        where p.customer_id = $1`
    : `select l.id, l.created_at, l.reason, l.change_satang as change, null::uuid as package_id, l.booking_id, l.order_id
         from public.wallet_ledger l where l.customer_id = $1`;
  const args: unknown[] = [userId];
  // The cursor carries the exact instant (microseconds) as Postgres prints it, so no row is skipped or repeated at a page edge.
  let page = `select x.*, to_char(x.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at_exact from (${sql}) x`;
  if (after) {
    args.push(after.at, after.id);
    page += ` where (x.created_at, x.id) < ($2::timestamptz, $3::uuid)`;
  }
  page += ` order by x.created_at desc, x.id desc limit ${PAGE + 1}`;
  const { rows } = await tx.query<Record<string, unknown>>(page, args);
  const more = rows.length > PAGE;
  const entries = rows.slice(0, PAGE).map((r) => ({
    id: r['id'] as string,
    at: new Date(r['created_at'] as string).toISOString(),
    reason: r['reason'] as string,
    change: Number(r['change']),
    packageId: (r['package_id'] as string | null) ?? null,
    bookingId: (r['booking_id'] as string | null) ?? null,
    orderId: (r['order_id'] as string | null) ?? null,
  }));
  const last = rows[PAGE - 1];
  return {
    entries,
    nextCursor: more && last ? encodeCursor(last['at_exact'] as string, last['id'] as string) : null,
  };
}
