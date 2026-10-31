import { call, newKey, type Outcome } from './api';

// A02c Sell a package (F11-T14; ADMIN-04; board G-A02c-Sell-package), apart from the screen. Reads the club's products (GET /packages) and sells one to a
// named customer two ways: by PromptPay QR (POST /staff/orders/package/quote then /pay, which shows the QR; the customer pays as a player) or for cash with a
// reason (POST /staff/customers/:id/package-sale, an Idempotency-Key header, the reason code and a note when the reason is "other"). The wallet is used by
// the server up to the price (the quote shows it); credits go to the player's account after payment. Nothing here sets a price or a date.

type Fetch = typeof fetch;

export interface Product {
  productId: string; nameTh: string; nameEn: string; creditType: 'court_hour' | 'solo_class' | 'group_session'; credits: number; validityMonths: number;
  priceGroupId: string | null; coachTierId: string | null; priceSatang: number; pricePerCreditSatang: number; savingSatang: number | null;
}
export const loadProducts = async (slug: string, f: Fetch): Promise<Outcome<Product[]>> => {
  const r = await call<Product[] | { products: Product[] } | null>(slug, '/packages', f);
  if (r.kind !== 'ok') return r;
  const list = Array.isArray(r.body) ? r.body : r.body?.products;
  return { kind: 'ok', body: list ?? [] };
};

export const TYPE_ORDER = ['court_hour', 'solo_class', 'group_session'] as const;
export const TYPE_KEY: Record<(typeof TYPE_ORDER)[number], string> = { court_hour: 'A-0431', solo_class: 'A-0227', group_session: 'A-0159' };
export function byType(products: readonly Product[]): Array<{ type: (typeof TYPE_ORDER)[number]; items: Product[] }> {
  return TYPE_ORDER.map((type) => ({ type, items: products.filter((p) => p.creditType === type) })).filter((g) => g.items.length > 0);
}

export interface PackageQuote {
  priceGroupId: string; lines: Array<{ netSatang: number }>; subtotalSatang: number; discountSatang: number; totalSatang: number; walletSatang: number; moneySatang: number; quoteHash: string;
}
export const quotePackage = (slug: string, customerId: string, productId: string, f: Fetch) =>
  call<PackageQuote>(slug, '/staff/orders/package/quote', f, { method: 'POST', body: { customerId, productId } });

export interface QrPayment { id: string; amountSatang: number; qrImageBase64: string; qrExpiresAt: string }
export type PayAnswer = { orderId: string; confirmed: true; payment: null } | { orderId: string; confirmed: false; payment: QrPayment } | { priceChanged: true; quote: PackageQuote };
export const payPackageByQr = (slug: string, customerId: string, productId: string, quoteHash: string, key: string, f: Fetch): Promise<Outcome<PayAnswer>> =>
  call<PayAnswer>(slug, '/staff/orders/package/pay', f, { method: 'POST', body: { customerId, productId, quoteHash }, key });

export const REASONS = ['no_banking_app', 'qr_failed_at_counter', 'other'] as const;
export type Reason = (typeof REASONS)[number];
export const REASON_KEY: Record<Reason, string> = { no_banking_app: 'A-new.sell_reason_no_app', qr_failed_at_counter: 'A-new.sell_reason_qr_failed', other: 'A-new.sell_reason_other' };

export type CashDraft = { reason: Reason | ''; note: string };
export type CashBody = { ok: true; body: { productId: string; reasonCode: Reason; note?: string } } | { ok: false; key: string };
/** The cash sale needs a reason; "other" needs a written note (PAY-06-AC2). */
export function cashBody(productId: string, d: CashDraft): CashBody {
  if (d.reason === '') return { ok: false, key: 'A-new.sell_err_reason' };
  const note = d.note.trim();
  if (d.reason === 'other' && note === '') return { ok: false, key: 'A-new.sell_err_note' };
  return { ok: true, body: { productId, reasonCode: d.reason, ...(note ? { note } : {}) } };
}
export interface CashResult { orderId: string; paymentId: string | null; cashSatang: number; walletSatang: number }
export const sellForCash = (slug: string, customerId: string, body: { productId: string; reasonCode: Reason; note?: string }, key: string, f: Fetch) =>
  call<CashResult>(slug, `/staff/customers/${encodeURIComponent(customerId)}/package-sale`, f, { method: 'POST', body, key });

/** The order's status, polled while the QR is on screen. */
export const orderStatus = async (slug: string, orderId: string, f: Fetch): Promise<string | null> => {
  const r = await call<{ status: string }>(slug, `/orders/${encodeURIComponent(orderId)}`, f);
  return r.kind === 'ok' ? r.body.status : null;
};

export const SELL_ERROR_KEY: Record<string, string> = {
  selection_invalid: 'A-new.sell_err_not_for_customer', price_not_set: 'A-new.sell_err_price', club_paused: 'A-new.sell_err_paused', customer_not_found: 'A-new.sell_err_customer',
  reason_required: 'A-new.sell_err_note', payment_unavailable: 'A-new.sell_err_qr', not_found: 'A-new.sell_err_customer', bad_input: 'A-new.sell_err_general',
};
export function sellErrorKey(o: Outcome<unknown>): string {
  if (o.kind === 'forbidden') return 'A-new.sell_err_forbidden';
  if (o.kind === 'not_found') return 'A-new.sell_err_customer';
  if (o.kind === 'refused') return SELL_ERROR_KEY[o.code] ?? 'A-new.sell_err_general';
  return 'A-new.sell_err_general';
}
export { newKey };
export const sellPath = (slug: string, customerId: string): string => `/c/${slug}/admin/customers/${customerId}/sell-package`;
