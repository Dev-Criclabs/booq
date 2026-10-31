// C10 Checkout (F04-T17, T18; R4-AC5, R6-AC3, R8-AC1 to AC4). The choice arrives in the address (?court&courtId&date&from&to, see
// checkoutPath in schedule.ts); this module turns it into the hours the server prices, calls the quote and Pay routes, and sorts the answers
// into the few states the screen shows. It never computes a price, a discount or a total: every amount is the server's, in satang, and
// the player pays what Pay says (R5-AC6). The choice is only a choice until Pay places the hold (BOOK-03, CC-4).

export type Fetched<T> = { ok: true; value: T } | { ok: false; status: number; code: string; params?: Record<string, string | number | boolean> };

export interface Choice {
  courtName: string;
  courtId: string;
  date: string;
  from: string;
  to: string;
  /** The hour starts the server prices: `YYYY-MM-DDTHH:00:00+07:00`, one per hour, in order. */
  hours: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HOUR = /^(\d{2}):00$/;
const MAX_HOURS = 12;

/** The choice in the address, or null when it is not a whole run of hours on one court (a made up address must not get a quote). */
export function parseChoice(search: string): Choice | null {
  const q = new URLSearchParams(search);
  const courtName = q.get('court');
  const courtId = q.get('courtId');
  const date = q.get('date');
  const from = HOUR.exec(q.get('from') ?? '');
  const to = HOUR.exec(q.get('to') ?? '');
  if (!courtName || courtName.length > 100 || !courtId || !UUID.test(courtId) || !date || !DAY.test(date) || !from || !to) return null;
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return null;
  const a = Number(from[1]);
  const b = Number(to[1]);
  if (a > 23 || b < 1 || b > 24 || b <= a || b - a > MAX_HOURS) return null;
  const hours = Array.from({ length: b - a }, (_, i) => `${date}T${String(a + i).padStart(2, '0')}:00:00+07:00`);
  return { courtName, courtId: courtId.toLowerCase(), date, from: q.get('from')!, to: q.get('to')!, hours };
}

export interface QuoteLineView {
  position: number;
  kind: 'court_hour' | 'coach' | 'add_on' | 'package';
  hourIndex: number;
  startsAt: string;
  coachId: string | null;
  addOnId: string | null;
  unitPriceSatang: number;
  discountSatang: number;
  birthdayDiscountSatang: number;
  codeDiscountSatang: number;
  netSatang: number;
  creditUnits: number;
  creditValueSatang: number;
  walletSatang: number;
  moneySatang: number;
}
export interface QuoteView {
  lines: QuoteLineView[];
  subtotalSatang: number;
  discountSatang: number;
  totalSatang: number;
  creditValueSatang: number;
  walletSatang: number;
  moneySatang: number;
  codeNotApplied: boolean;
  quoteHash: string;
  /** The court bundle the player may buy with this booking (F04 R6; present once the server offers it). */
  bundleOffer?: { productId: string; price: number; hoursUsedNow: number } | null;
}

export interface Wanted {
  coachId: string | null;
  addOnIds: string[];
  code: string | null;
}

/** The body of the quote and Pay routes. Choices only: no amount, no price, no court name (CC-2). */
export function requestBody(choice: Choice, want: Wanted): Record<string, unknown> {
  return {
    courtId: choice.courtId,
    hours: choice.hours,
    coachId: want.coachId,
    coachSource: 'checkout',
    addOnIds: want.addOnIds,
    code: want.code && want.code.trim() !== '' ? want.code.trim() : null,
  };
}

async function call<T>(f: typeof fetch, url: string, init: RequestInit): Promise<Fetched<T>> {
  try {
    const res = await f(url, { credentials: 'same-origin', cache: 'no-store', ...init });
    const body = (await res.json().catch(() => ({}))) as T & { code?: unknown; params?: unknown };
    if (res.ok) return { ok: true, value: body };
    return {
      ok: false,
      status: res.status,
      code: typeof body.code === 'string' ? body.code : 'offline',
      ...(body.params && typeof body.params === 'object' ? { params: body.params as Record<string, string | number | boolean> } : {}),
    };
  } catch {
    return { ok: false, status: 0, code: 'offline' };
  }
}

const api = (slug: string) => `/api/c/${encodeURIComponent(slug)}`;
const JSON_HEADERS = { 'content-type': 'application/json' };

export const loadQuote = (slug: string, choice: Choice, want: Wanted, f: typeof fetch) =>
  call<QuoteView>(f, `${api(slug)}/checkout/quote`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(requestBody(choice, want)) });

export interface PayConfirmed { orderId: string; holdExpiresAt: null; payment: null; confirmed: true }
export interface PayStarted {
  orderId: string;
  holdExpiresAt: string | null;
  payment: { id: string; amountSatang: number; qrImageBase64: string; qrExpiresAt: string };
  confirmed: false;
}
export type PayAnswer = { kind: 'confirmed'; orderId: string } | { kind: 'started'; started: PayStarted } | { kind: 'price_changed'; quote: QuoteView };

/** Pay with the hash of the quote the player saw. The key makes a second tap the same Pay (D47). */
export async function pay(slug: string, choice: Choice, want: Wanted, quoteHash: string, key: string, f: typeof fetch): Promise<Fetched<PayAnswer>> {
  const r = await call<PayConfirmed | PayStarted | { priceChanged: true; quote: QuoteView }>(f, `${api(slug)}/checkout/pay`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, 'idempotency-key': key },
    body: JSON.stringify({ ...requestBody(choice, want), quoteHash }),
  });
  if (!r.ok) return r;
  const v = r.value as Record<string, unknown>;
  if (v['priceChanged'] === true) return { ok: true, value: { kind: 'price_changed', quote: v['quote'] as QuoteView } };
  if (v['confirmed'] === true) return { ok: true, value: { kind: 'confirmed', orderId: v['orderId'] as string } };
  return { ok: true, value: { kind: 'started', started: v as unknown as PayStarted } };
}

/** What the screen shows for a refused quote or Pay: the locale key of the text, and whether the player may try again here. */
export interface Refusal {
  key: string;
  /** The player goes back and picks again (the slot or the choice is gone) rather than retrying. */
  pickAgain: boolean;
  /** A value the text names ({amount}, {hours}). */
  vars: Record<string, string | number>;
}

const REFUSALS: Record<string, { key: string; pickAgain: boolean }> = {
  club_paused: { key: 'P-0442', pickAgain: false },
  club_not_available: { key: 'P-0442', pickAgain: false },
  slot_unavailable: { key: 'P-new.slot_unavailable_court', pickAgain: true },
  selection_invalid: { key: 'P-new.checkout_bad_input', pickAgain: true },
  bad_input: { key: 'P-new.checkout_bad_input', pickAgain: true },
  resource_inactive: { key: 'P-new.slot_unavailable_court', pickAgain: true },
  coach_unavailable: { key: 'P-new.slot_unavailable_coach', pickAgain: false },
  coach_price_not_set: { key: 'P-new.coach_price_not_set', pickAgain: false },
  coach_at_checkout_disabled: { key: 'P-new.coach_at_checkout_disabled', pickAgain: false },
  price_not_set: { key: 'P-new.price_not_set', pickAgain: true },
  add_on_not_for_sale: { key: 'P-new.add_on_not_for_sale', pickAgain: false },
  birthday_not_available: { key: 'P-new.birthday_not_available', pickAgain: false },
  credit_unavailable: { key: 'P-new.credit_unavailable', pickAgain: false },
  payment_unavailable: { key: 'P-new.payment_unavailable', pickAgain: false },
  limit_reached: { key: 'P-new.limit_reached', pickAgain: true },
  too_many_attempts: { key: 'P-new.too_many_attempts', pickAgain: false },
  student_item_not_allowed: { key: 'P-new.checkout_bad_input', pickAgain: true },
  rest_rule: { key: 'P-new.rest_rule', pickAgain: false },
};

const CODE_REFUSALS = new Set([
  'code_not_valid', 'code_expired', 'code_wrong_audience', 'code_out_of_scope', 'code_below_minimum', 'code_first_booking_only', 'code_used_up',
  'code_not_for_solo_class', 'one_code_per_order',
]);

/** A refused promo or referral code stays on the code field; it never blocks the booking (R4-AC5). */
export const isCodeRefusal = (code: string) => CODE_REFUSALS.has(code);
export const codeRefusalKey = (code: string) => `P-new.${code}`;

export function refusalFor(code: string, params?: Record<string, string | number | boolean>): Refusal | null {
  const r = REFUSALS[code];
  if (!r) return null;
  const vars: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params ?? {})) if (typeof v === 'string' || typeof v === 'number') vars[k] = v;
  return { ...r, vars };
}

/** satang to a baht amount for the text variables ({price}, {amount}, {total}): whole baht have no decimals, others two. */
export function baht(satang: number): string {
  const sign = satang < 0 ? '-' : '';
  const abs = Math.abs(satang);
  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}฿${grouped}${frac === 0 ? '' : `.${String(frac).padStart(2, '0')}`}`;
}

/** The lines the bill shows, grouped as the board does: the court hours, then coaching, then the add-ons as one row that expands (R3-AC3). */
export function billRows(lines: QuoteLineView[]): { courtHours: QuoteLineView[]; coaching: QuoteLineView[]; addOns: QuoteLineView[] } {
  return {
    courtHours: lines.filter((l) => l.kind === 'court_hour'),
    coaching: lines.filter((l) => l.kind === 'coach'),
    addOns: lines.filter((l) => l.kind === 'add_on'),
  };
}

/** A fresh Idempotency-Key for one Pay tap sequence of one quote. */
export function newKey(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `pay-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** C11 is the payment page (F05); Pay hands the running order to it by id. */
export const payPath = (slug: string, orderId: string) => `/c/${slug}/pay/${encodeURIComponent(orderId)}`;

/** `{dateYear}`: Sat 9 Jan 2027, with the international year in both languages (CC-5). */
export function dateYear(day: string, short: string): string {
  return `${short} ${day.slice(0, 4)}`;
}

/** HH:mm in Asia/Bangkok of an instant the server sent (UTC ISO). */
export function bangkokTime(iso: string): string {
  const d = new Date(Date.parse(iso) + 7 * 3_600_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
