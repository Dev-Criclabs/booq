import type { Tx } from '../../../db/src/tx';
import { CheckoutError } from './errors';
import { pricePackage, type PackageQuote } from './package';
import { entitlement, type PlacedOrder } from './pay';
import { buyerOf, codeFor, openClub, priceGroupsOf, usedBirthdayKinds, type QuoteSources } from './quote';

// F05 package-only Pay: the server side of C10P (H-C10P-Package-checkout, H-C11P-Pay-package; F06 R3-AC1, AC4,
// PKG-02-AC6 to AC8; F05 PAY-04-AC1 to AC4; D74). A package bought on its own is priced by pricePackage from the
// club's product row, then placed as an order with one package line and no booking: no hold, so the QR lives the
// club's package_qr_minutes (start_payment, 0416). The package itself is created when the payment lands
// (apply_payment's grant_package port), or at once when nothing is left to pay (complete_zero_money_order, 0416).
// The client sends the product and the code only; any amount in the body is ignored (CC-2).

export interface PackageQuoteRequest {
  productId: string;
  code: string | null;
}

export interface PackagePayRequest {
  choice: PackageQuoteRequest;
  quoteHash: string;
}

export type PreparedPackagePay = { kind: 'ready'; quote: PackageQuote } | { kind: 'price_changed'; quote: PackageQuote };

/** The locale key that labels a package line on C10P, C11P and the receipt (pending, locales/pending/f05.json). */
export const PACKAGE_LINE_TEXT_KEY = 'P-new.package_line';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;

export function parsePackageQuoteRequest(body: unknown): PackageQuoteRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const id = b['productId'];
  if (typeof id !== 'string' || !UUID.test(id)) throw new CheckoutError('bad_input');
  const code = b['code'] ?? null;
  if (code !== null && typeof code !== 'string') throw new CheckoutError('bad_input');
  const trimmed = code === null ? '' : code.trim().toUpperCase();
  return { productId: id.toLowerCase(), code: trimmed === '' ? null : trimmed };
}

export function parsePackagePayRequest(body: unknown): PackagePayRequest {
  const hash = ((body ?? {}) as Record<string, unknown>)['quoteHash'];
  if (typeof hash !== 'string' || !HASH.test(hash.toLowerCase())) throw new CheckoutError('bad_input');
  return { choice: parsePackageQuoteRequest(body), quoteHash: hash.toLowerCase() };
}

interface ProductRow {
  id: string;
  name_th: string;
  name_en: string;
  price_satang: number | null;
  active: boolean;
  price_group_id: string | null;
}

async function productOf(tx: Tx, productId: string): Promise<ProductRow> {
  const p = (await tx.query<ProductRow>(
    `select id, name_th, name_en, price_satang, active, price_group_id from public.package_product where club_id = app.club_id() and id = $1`,
    [productId],
  )).rows[0];
  if (!p) throw new CheckoutError('package_not_for_sale');
  return p;
}

/** Price one package for `customerId` from this moment's product row and settings. Throws CheckoutError. */
export async function packageQuoteFor(tx: Tx, customerId: string, req: PackageQuoteRequest, sources: QuoteSources, opts: { forCustomer?: boolean } = {}): Promise<PackageQuote> {
  const club = await openClub(tx);
  const person = await buyerOf(tx, customerId, opts.forCustomer === true);
  const product = await productOf(tx, req.productId);
  const terms = await sources.clubTerms(tx);
  const result = pricePackage({
    onDate: club.today,
    dob: person.dob,
    priceGroups: await priceGroupsOf(tx),
    product: { id: product.id, priceSatang: product.price_satang, active: product.active, priceGroupId: product.price_group_id },
    walletBalanceSatang: await sources.walletBalance(tx, customerId),
    code: await codeFor(tx, req.code, customerId, sources),
    birthday: { setting: terms.birthdayDiscount, usedKinds: await usedBirthdayKinds(tx, customerId, Number(club.today.slice(0, 4))) },
  });
  if (!result.ok) {
    if (result.code === 'code_below_minimum') throw new CheckoutError(result.code, { amount: result.minSpendSatang });
    throw new CheckoutError(result.code);
  }
  return result.quote;
}

/** Gate and reprice inside the Pay transaction; a hash other than the one shown creates nothing (R4-AC9). */
export async function preparePackagePay(tx: Tx, customerId: string, req: PackagePayRequest, sources: QuoteSources, opts: { forCustomer?: boolean } = {}): Promise<PreparedPackagePay> {
  const quote = await packageQuoteFor(tx, customerId, req.choice, sources, opts);
  return quote.quoteHash === req.quoteHash ? { kind: 'ready', quote } : { kind: 'price_changed', quote };
}

/** The customer's open package order for this product whose payment is still running (a second tap, D47). */
export async function findLivePackageOrder(tx: Tx, productId: string, customerId: string): Promise<PlacedOrder | null> {
  const r = (await tx.query<{ id: string }>(
    `select o.id from public.orders o
      where o.club_id = app.club_id() and o.customer_id = $1 and o.status = 'open'
        and not exists (select 1 from public.booking b where b.club_id = o.club_id and b.order_id = o.id)
        and exists (select 1 from public.order_line l where l.club_id = o.club_id and l.order_id = o.id and l.package_product_id = $2)
        and exists (select 1 from public.payment p where p.club_id = o.club_id and p.order_id = o.id and p.method = 'beam' and p.status = 'pending'
                     and (p.qr_expires_at is null or p.qr_expires_at > app.now()))
      order by o.created_at desc limit 1`,
    [customerId, productId],
  )).rows[0];
  return r ? { orderId: r.id, bookingIds: [], holdExpiresAt: null, reused: true, confirmed: false, receiptId: null } : null;
}

/** Write the priced order and its package line, take the code, birthday and wallet; confirm it when nothing is due. */
export async function placePackageOrder(tx: Tx, customerId: string, quote: PackageQuote, sources: QuoteSources): Promise<PlacedOrder> {
  const line = quote.lines[0]!;
  const product = await productOf(tx, line.packageProductId);
  const group = (await tx.query<{ id: string; name_th: string; name_en: string }>(
    `select id, name_th, name_en from public.price_group where club_id = app.club_id() and id = $1`,
    [quote.priceGroupId],
  )).rows[0];
  const orderId = (await tx.query<{ id: string }>('select app.create_priced_order($1, $2::jsonb) as id', [
    customerId,
    JSON.stringify({
      price_group_snapshot: group ?? null,
      subtotal_satang: quote.subtotalSatang,
      discount_satang: quote.discountSatang,
      total_satang: quote.totalSatang,
      credit_value_satang: 0,
      wallet_satang: quote.walletSatang,
      money_satang: quote.moneySatang,
      promo_code_id: quote.promoCodeId,
      birthday_entitlement: quote.birthdayEntitlement !== null,
      quote_hash: quote.quoteHash,
    }),
  ])).rows[0]!.id;
  // Lock order (FA 3.4): the customer (in create_priced_order), the wallet and packages, then the promo row.
  await tx.query('select app.lock_wallet_and_packages($1)', [customerId]);
  if (quote.promoCodeId !== null) await entitlement(tx, 'select app.count_promo_use($1, $2)', [quote.promoCodeId, orderId]);
  if (quote.birthdayEntitlement !== null) await entitlement(tx, 'select app.use_birthday_entitlement($1, $2)', [quote.birthdayEntitlement, orderId]);
  await tx.query('select app.add_order_lines($1, $2::jsonb)', [
    orderId,
    JSON.stringify([{
      position: line.position,
      kind: 'package',
      booking_id: null,
      add_on_id: null,
      package_product_id: line.packageProductId,
      description_key: PACKAGE_LINE_TEXT_KEY,
      name_th: product.name_th,
      name_en: product.name_en,
      unit_price_satang: line.unitPriceSatang,
      discount_satang: line.discountSatang,
      net_satang: line.netSatang,
      credit_package_id: null,
      credit_units: 0,
      credit_value_satang: 0,
      wallet_satang: line.walletSatang,
      money_satang: line.moneySatang,
      scope: { birthday_discount_satang: line.birthdayDiscountSatang, code_discount_satang: line.codeDiscountSatang },
    }]),
  ]);
  if (!(await sources.reserveCreditAndWallet(tx, orderId))) throw new CheckoutError('credit_unavailable');
  if (quote.moneySatang === 0) {
    const done = await tx.query<{ receipt: string }>('select app.complete_zero_money_order($1) as receipt', [orderId]);
    return { orderId, bookingIds: [], holdExpiresAt: null, reused: false, confirmed: true, receiptId: done.rows[0]!.receipt };
  }
  return { orderId, bookingIds: [], holdExpiresAt: null, reused: false, confirmed: false, receiptId: null };
}
