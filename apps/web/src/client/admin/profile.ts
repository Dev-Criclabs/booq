import { call, type Outcome } from './api';
import type { Lang } from '../i18n';

// A6 Customer profile (F11-T15; ADMIN-07; board H-A06-Customer-profile), apart from the screen. The reads are GET /staff/customers/:id and
// its /bookings, /orders, /notes and /credits; the changes are tags, notes, the wallet and credit adjustments and the package extension. Value
// moves only as ledger rows with a written reason (F06); this file never computes a balance, it parses what was typed and sends it.

type Fetch = typeof fetch;

export interface Profile {
  customerId: string;
  displayName: string | null;
  fullName: string | null;
  phone: string | null;
  language: string | null;
  level: string | null;
  dateOfBirth: string | null;
  claimState: 'unclaimed' | null;
  signedIn: boolean;
  active: boolean;
  tags: string[];
  createdAt: string;
}
export interface BookingRow {
  bookingId: string;
  orderId: string;
  type: string;
  courtName: string | null;
  coachName: string | null;
  classNameTh: string | null;
  classNameEn: string | null;
  startAt: string;
  endAt: string;
  status: string;
  source: string;
  cancelKind: string | null;
  cancelOutcome: string | null;
}
export interface OrderRow {
  orderId: string;
  status: string;
  source: string;
  kind: string;
  totalSatang: number;
  moneySatang: number;
  creditValueSatang: number;
  walletSatang: number;
  createdAt: string;
  receipts: string[];
  /** The ids of those receipts, in the same order (for the PDF link). */
  receiptIds?: string[];
}
export interface Note {
  noteId: string;
  note: string;
  by: string | null;
  at: string;
}
export interface PackageRow {
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
export interface Value {
  packages: PackageRow[];
  wallet: { balanceSatang: number; ledger: LedgerRow[] };
  creditLedger: LedgerRow[];
}

const enc = encodeURIComponent;
export const loadProfile = (slug: string, id: string, f: Fetch): Promise<Outcome<Profile>> => call<Profile>(slug, `/staff/customers/${enc(id)}`, f);
export const loadBookings = (slug: string, id: string, f: Fetch) => call<BookingRow[]>(slug, `/staff/customers/${enc(id)}/bookings`, f);
export const loadOrders = (slug: string, id: string, f: Fetch) => call<OrderRow[]>(slug, `/staff/customers/${enc(id)}/orders`, f);
export interface CustomerReceipt { receiptId: string; number: string; kind: string; status: string; issuedAt: string; totalSatang: number; isTest: boolean }
export const loadReceipts = (slug: string, id: string, f: Fetch) => call<CustomerReceipt[]>(slug, `/staff/customers/${enc(id)}/receipts`, f);
/** The receipt PDF in the language shown (GET /staff/receipts/:id/pdf?lang=th|en). */
export const receiptPdfHref = (slug: string, receiptId: string, lang: 'th' | 'en'): string => `/api/c/${enc(slug)}/staff/receipts/${enc(receiptId)}/pdf?lang=${lang}`;
export const RECEIPT_KIND_KEY: Record<string, string> = { sale: 'A-new.prof_receipt_sale', wallet_credit: 'A-new.prof_receipt_wallet' };
export const RECEIPT_STATUS_KEY: Record<string, string> = { issued: 'A-new.prof_receipt_issued', void: 'A-0307' };
export const loadNotes = (slug: string, id: string, f: Fetch) => call<Note[]>(slug, `/staff/customers/${enc(id)}/notes`, f);
export const loadValue = (slug: string, id: string, f: Fetch) => call<Value>(slug, `/staff/customers/${enc(id)}/credits`, f);

export const addTag = (slug: string, id: string, tag: string, f: Fetch) => call<{ ok: true }>(slug, `/staff/customers/${enc(id)}/tags`, f, { method: 'POST', body: { tag: tag.trim() } });
export const removeTag = (slug: string, id: string, tag: string, f: Fetch) => call<{ ok: true }>(slug, `/staff/customers/${enc(id)}/tags/${enc(tag)}`, f, { method: 'DELETE' });
export const addNote = (slug: string, id: string, note: string, f: Fetch) => call<{ noteId: string }>(slug, `/staff/customers/${enc(id)}/notes`, f, { method: 'POST', body: { note: note.trim() } });
export const adjustWallet = (slug: string, id: string, deltaSatang: number, note: string, f: Fetch) => call<{ ledgerId: string }>(slug, `/staff/customers/${enc(id)}/wallet-adjust`, f, { method: 'POST', body: { deltaSatang, note: note.trim() } });
export const adjustCredit = (slug: string, id: string, packageId: string, delta: number, note: string, f: Fetch) => call<{ ledgerId: string }>(slug, `/staff/customers/${enc(id)}/credit-adjust`, f, { method: 'POST', body: { packageId, delta, note: note.trim() } });
export const extendPackage = (slug: string, packageId: string, newExpiresOn: string, reason: string, f: Fetch) => call<{ extensionId: string }>(slug, `/staff/packages/${enc(packageId)}/extend`, f, { method: 'POST', body: { newExpiresOn, reason: reason.trim() } });

/** "+200", "-50.5", "200": baht to integer satang without floating point. Null when it is not a non zero amount of at most two decimals. */
export function parseBaht(text: string): number | null {
  const m = /^([+-]?)(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const satang = Number(m[2]) * 100 + (m[3] ? Number(m[3].padEnd(2, '0')) : 0);
  return satang === 0 ? null : m[1] === '-' ? -satang : satang;
}
/** "+2", "-1": a whole number of credits, not zero. */
export function parseCredits(text: string): number | null {
  const m = /^([+-]?)(\d{1,6})$/.exec(text.trim());
  if (!m || Number(m[2]) === 0) return null;
  return m[1] === '-' ? -Number(m[2]) : Number(m[2]);
}
/** A day typed or picked (YYYY-MM-DD) that is a real calendar day. */
export function parseDay(text: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? text.trim() : null;
}

/** The text key of each refusal the adjust and extend routes give; anything else is the general failure. */
export const ACTION_ERROR_KEY: Record<string, string> = {
  reason_required: 'A-new.prof_err_reason', below_zero: 'A-new.prof_err_below_zero', bad_input: 'A-new.prof_err_input', customer_not_claimed: 'A-new.prof_err_unclaimed',
  not_found: 'A-new.prof_err_not_found',
};
export function actionErrorKey(o: Outcome<unknown>): string {
  if (o.kind === 'forbidden') return 'A-new.prof_err_forbidden';
  if (o.kind === 'refused') return ACTION_ERROR_KEY[o.code] ?? 'A-new.prof_err_general';
  if (o.kind === 'not_found') return 'A-new.prof_err_not_found';
  return 'A-new.prof_err_general';
}

export const LEVEL_KEY: Record<string, string> = { new: 'P-0409', beginner: 'P-0154', intermediate: 'P-0155', advanced: 'P-0156' };
export const BOOKING_TYPE_KEY: Record<string, string> = { court: 'A-0306', solo_class: 'A-0016', class_seat: 'A-0017' };
export const BOOKING_STATUS_KEY: Record<string, string> = {
  confirmed: 'A-0404', awaiting_payment: 'A-0015', cancelled: 'A-new.prof_status_cancelled', late_cancelled: 'A-new.prof_status_late_cancelled', no_show: 'A-new.prof_status_no_show', released: 'A-new.prof_status_released',
};
export const ORDER_KIND_KEY: Record<string, string> = { sale: 'A-new.prof_order_sale', wallet_credit: 'A-new.prof_order_wallet' };

/** Visits: confirmed bookings whose hour is over, with the day of the first one. */
export function visits(bookings: readonly BookingRow[], now: Date): { count: number; since: string | null } {
  const played = bookings.filter((b) => b.status === 'confirmed' && new Date(b.endAt).getTime() <= now.getTime());
  const first = played.map((b) => b.startAt).sort()[0] ?? null;
  return { count: played.length, since: first };
}
/** The newest bookings first, as the server sent them. */
export const recent = (bookings: readonly BookingRow[], n = 5): BookingRow[] => bookings.slice(0, n);

/** The name of what a booking is for: the class, the coach, or the court. */
export function bookingWhat(b: BookingRow, lang: Lang): { kind: 'class' | 'court'; text: string } {
  const cls = lang === 'th' ? b.classNameTh : b.classNameEn;
  if (cls) return { kind: 'class', text: cls };
  return { kind: 'court', text: b.courtName ?? '' };
}
/** The package with credits left that expires first is the one the tile shows. */
export function nextPackage(packages: readonly PackageRow[]): PackageRow | null {
  const live = packages.filter((p) => p.status === 'active' && p.creditsLeft > 0).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  return live[0] ?? null;
}
export const packageName = (p: Pick<PackageRow, 'nameTh' | 'nameEn'>, lang: Lang): string => (lang === 'th' ? p.nameTh : p.nameEn);
