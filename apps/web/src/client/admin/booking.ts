import { call, newKey, type Outcome } from './api';
import { bangkokParts } from './time';

// A02 Booking create and A02b Booking detail (F11-T14; ADMIN-04; boards H-A02-Booking-create, G-A02b-Booking-detail), apart from the screens. The desk names a
// customer (one who has signed in: pricing needs the profile, D168), picks the court and hours, and the server quotes (POST /staff/orders/quote) and then places
// the order (POST /staff/orders/pay) with the hash of the quote the desk saw. A price that changed in between returns the new quote and nothing is placed. The player
// pays by PromptPay QR shown here, or nothing is left to pay and the booking is confirmed. Walk-ins without a sign-in, cash for a court booking, cancel and no-show are
// not here: no route takes them yet.

type Fetch = typeof fetch;

export interface CustomerHit { customerId: string; name: string | null; phone: string | null; claimState: 'unclaimed' | null; signedIn: boolean }
export const searchCustomers = async (slug: string, q: string, f: Fetch): Promise<Outcome<CustomerHit[]>> => {
  const r = await call<{ customers: CustomerHit[] }>(slug, `/staff/customers?q=${encodeURIComponent(q.trim())}`, f);
  return r.kind === 'ok' ? { kind: 'ok', body: r.body.customers ?? [] } : r;
};
/** A customer who has not signed in cannot be priced (their date of birth is not known to the club), so they are listed but not chosen. */
export const canBook = (c: Pick<CustomerHit, 'claimState'>): boolean => c.claimState !== 'unclaimed';

export interface AddOn { id: string; nameTh: string; nameEn: string; priceSatang: number | null; active: boolean }
export const loadAddOns = async (slug: string, f: Fetch): Promise<AddOn[]> => {
  const r = await call<AddOn[]>(slug, '/staff/setup/add-ons', f);
  return r.kind === 'ok' ? r.body.filter((a) => a.active && a.priceSatang !== null) : [];
};

// ---- hours ------------------------------------------------------------------------------------------------------------------------------------------
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
/** The start from the address (the calendar's click), kept only if it is an instant on the hour. */
export function startFrom(raw: string | null): string | null {
  if (!raw || !INSTANT.test(raw)) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0 ? null : d.toISOString();
}
/** n consecutive hours from a start, as instants. */
export const hoursFrom = (start: string, n: number): string[] => Array.from({ length: n }, (_, i) => new Date(Date.parse(start) + i * 3_600_000).toISOString());
export const hourText = (iso: string): string => bangkokParts(iso)?.time ?? '';
export const dayText = (iso: string): string => bangkokParts(iso)?.day ?? '';

// ---- quote and pay ----------------------------------------------------------------------------------------------------------------------------------
export interface Choice { customerId: string; courtId: string; hours: string[]; addOnIds: string[]; code: string }
export const bodyOf = (c: Choice): Record<string, unknown> => ({ customerId: c.customerId, courtId: c.courtId, hours: c.hours, addOnIds: c.addOnIds, ...(c.code.trim() ? { code: c.code.trim() } : {}) });

export interface QuoteLine { position: number; kind: 'court_hour' | 'coach' | 'add_on'; hourIndex: number; startsAt: string; addOnId: string | null; unitPriceSatang: number; discountSatang: number; netSatang: number }
export interface Quote {
  lines: QuoteLine[]; subtotalSatang: number; discountSatang: number; totalSatang: number; creditValueSatang: number; walletSatang: number; moneySatang: number; quoteHash: string; codeNotApplied: boolean;
  cancelWindowHours: number | null;
}
export const quoteBooking = (slug: string, c: Choice, f: Fetch) => call<Quote>(slug, '/staff/orders/quote', f, { method: 'POST', body: bodyOf(c) });

export interface Qr { id: string; amountSatang: number; qrImageBase64: string; qrExpiresAt: string }
export type PayAnswer = { priceChanged: true; quote: Quote } | { orderId: string; holdExpiresAt: string | null; payment: Qr | null; confirmed: boolean };
export const payBooking = (slug: string, c: Choice, quoteHash: string, key: string, f: Fetch): Promise<Outcome<PayAnswer>> =>
  call<PayAnswer>(slug, '/staff/orders/pay', f, { method: 'POST', body: { ...bodyOf(c), quoteHash }, key });
export { newKey };

export const orderState = async (slug: string, orderId: string, f: Fetch): Promise<string | null> => {
  const r = await call<{ status: string }>(slug, `/orders/${encodeURIComponent(orderId)}`, f);
  return r.kind === 'ok' ? r.body.status : null;
};

// ---- detail -----------------------------------------------------------------------------------------------------------------------------------------
export interface BookingView { id: string; orderId: string; type: string; status: string; court: { id: string; name: string }; start: string; end: string; holdExpiresAt: string | null; holdEnded: boolean }
export interface HistoryRow { at: string; kind: 'audit' | 'cancel'; action: string; actor: string | null; source: string | null; reason: string | null; detail: { old?: unknown; new?: unknown } | null; piiFields: string[] }
export interface OrderView { status: string; subtotalSatang: number | null; discountSatang: number | null; totalSatang: number | null; creditValueSatang: number | null; walletSatang: number | null; moneySatang: number | null }
export const loadOrder = async (slug: string, orderId: string, f: Fetch): Promise<OrderView | null> => {
  const r = await call<OrderView>(slug, `/orders/${encodeURIComponent(orderId)}`, f);
  return r.kind === 'ok' ? r.body : null;
};
export const loadBooking = (slug: string, id: string, f: Fetch) => call<BookingView>(slug, `/bookings/${encodeURIComponent(id)}`, f);
export const loadHistory = async (slug: string, id: string, f: Fetch): Promise<Outcome<HistoryRow[]>> => {
  const r = await call<HistoryRow[] | null>(slug, `/staff/bookings/${encodeURIComponent(id)}/history`, f);
  return r.kind === 'ok' ? { kind: 'ok', body: r.body ?? [] } : r;
};
export const releaseHold = (slug: string, id: string, f: Fetch) => call<{ orderId: string; status: 'released' }>(slug, `/staff/bookings/${encodeURIComponent(id)}/release`, f, { method: 'POST', body: {} });

export const STATUS_KEY: Record<string, string> = {
  confirmed: 'A-new.book_status_confirmed', awaiting_payment: 'A-0015', cancelled: 'A-new.book_status_cancelled', released: 'A-new.book_status_released', completed: 'A-new.book_status_completed', no_show: 'A-new.book_status_no_show',
};

// ---- refusals ---------------------------------------------------------------------------------------------------------------------------------------
export const BOOK_ERROR_KEY: Record<string, string> = {
  club_paused: 'A-new.book_err_paused', club_not_available: 'A-new.book_err_club', resource_inactive: 'A-new.book_err_court', selection_invalid: 'A-new.book_err_selection', price_not_set: 'A-new.book_err_price',
  coach_price_not_set: 'A-new.book_err_price', add_on_not_for_sale: 'A-new.book_err_addon', student_item_not_allowed: 'A-new.book_err_selection', code_not_valid: 'A-new.book_err_code', code_expired: 'A-new.book_err_code',
  code_wrong_audience: 'A-new.book_err_code', code_out_of_scope: 'A-new.book_err_code', code_below_minimum: 'A-new.book_err_code', code_first_booking_only: 'A-new.book_err_code', code_used_up: 'A-new.book_err_code',
  code_not_for_solo_class: 'A-new.book_err_code', one_code_per_order: 'A-new.book_err_code', credit_unavailable: 'A-new.book_err_credit', payment_unavailable: 'A-new.book_err_qr', slot_unavailable: 'A-new.book_err_taken',
  limit_reached: 'A-new.book_err_limit', too_many_attempts: 'A-new.book_err_attempts', customer_not_found: 'A-new.book_err_customer', not_releasable: 'A-new.book_err_release', forbidden: 'A-new.book_err_forbidden',
  not_found: 'A-new.book_err_gone', bad_input: 'A-new.book_err_selection',
};
export function bookErrorKey(o: Outcome<unknown>): { key: string; vars: Record<string, string | number> } {
  if (o.kind === 'forbidden') return { key: 'A-new.book_err_forbidden', vars: {} };
  if (o.kind === 'not_found') return { key: 'A-new.book_err_gone', vars: {} };
  if (o.kind === 'refused') {
    const vars: Record<string, string | number> = {};
    for (const k of ['hours', 'seconds']) if (typeof o.params?.[k] === 'number') vars[k] = o.params[k] as number;
    return { key: BOOK_ERROR_KEY[o.code] ?? 'A-new.book_err_general', vars };
  }
  return { key: 'A-new.book_err_general', vars: {} };
}
export const bookingPath = (slug: string, id: string): string => `/c/${slug}/admin/bookings/${encodeURIComponent(id)}`;
export const newBookingPath = (slug: string): string => `/c/${slug}/admin/bookings/new`;
