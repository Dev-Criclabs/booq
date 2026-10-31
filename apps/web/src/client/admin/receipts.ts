import { call, type Outcome } from './api';
import { addDays } from './calendar';

// A14 Receipts and daily close (F11-T21; ADMIN-15; board H-A14-Receipts), apart from the screen. Owner and accountant: GET /staff/receipts?q=&from=&to=&limit=&offset=
// (newest first), the PDF (GET /staff/receipts/:id/pdf?lang=), Void (owner, with a written reason: POST /staff/receipts/:id/void), and the daily close of a finished Bangkok
// day (GET /staff/daily-close?day= previews or reads it, POST /staff/daily-close {day} runs it, GET .../csv exports it). Numbers are never reused; a void keeps its number.
// Amounts are integer satang.

type Fetch = typeof fetch;

export interface ReceiptRow { id: string; number: string; kind: string; status: string; issued_at: string; customer_name: string | null; total_satang: number; is_test: boolean }
export interface ReceiptQuery { q: string; from: string; to: string; offset?: number }
export const PAGE = 50;
export function listPath(q: ReceiptQuery): string {
  const p = new URLSearchParams({ from: q.from, to: q.to, limit: String(PAGE), offset: String(q.offset ?? 0) });
  if (q.q.trim()) p.set('q', q.q.trim());
  return `/staff/receipts?${p.toString()}`;
}
export type Checked = { ok: true } | { ok: false; key: string };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export function checkRange(q: Pick<ReceiptQuery, 'from' | 'to'>): Checked {
  if (!DAY.test(q.from) || !DAY.test(q.to)) return { ok: false, key: 'A-new.rcpt_err_day' };
  return q.to < q.from ? { ok: false, key: 'A-new.rcpt_err_range' } : { ok: true };
}
/** The first view: the last 31 days up to the server's today. */
export const defaultRange = (today: string): { from: string; to: string } => ({ from: addDays(today, -30), to: today });
export const loadReceipts = (slug: string, q: ReceiptQuery, f: Fetch) => call<ReceiptRow[] | null>(slug, listPath(q), f);
export const pdfHref = (slug: string, id: string, lang: 'th' | 'en'): string => `/api/c/${encodeURIComponent(slug)}/staff/receipts/${encodeURIComponent(id)}/pdf?lang=${lang}`;

export function voidBody(reason: string): { ok: true; body: { reason: string } } | { ok: false; key: string } {
  const r = reason.trim();
  return r === '' ? { ok: false, key: 'A-new.rcpt_err_reason' } : { ok: true, body: { reason: r } };
}
export const voidReceipt = (slug: string, id: string, reason: string, f: Fetch) => call<{ ok: true }>(slug, `/staff/receipts/${encodeURIComponent(id)}/void`, f, { method: 'POST', body: { reason } });

export const KIND_KEY: Record<string, string> = { sale: 'A-new.prof_receipt_sale', wallet_credit: 'A-new.prof_receipt_wallet' };

// ---- daily close ------------------------------------------------------------------------------------------------------------------------------------
export interface CloseTotals {
  methods: { beam: number; cash: number }; money_total_satang: number; credit_used: { count: number; value_satang: number }; wallet_used_satang: number; wallet_returned_satang: number;
  voided_payments: Array<{ number: string; method: string; amount_satang: number }>; voids_made: Array<{ number: string; total_satang: number; reason: string }>;
  wallet_credited: Array<{ reason: string; amount_satang: number; receipt_number: string | null }>; receipts: Array<{ number: string; kind: string; status: string; customer_name: string | null; total_satang: number }>;
}
export interface Close { closed: boolean; day: string; runAt: string | null; isTest?: boolean; totals: CloseTotals }
export const loadClose = (slug: string, day: string, f: Fetch) => call<Close>(slug, `/staff/daily-close?day=${day}`, f);
export const runClose = (slug: string, day: string, f: Fetch) => call<{ id: string; day: string }>(slug, '/staff/daily-close', f, { method: 'POST', body: { day } });
export const closeCsvHref = (slug: string, day: string): string => `/api/c/${encodeURIComponent(slug)}/staff/daily-close/csv?day=${day}`;

export const RECEIPT_ERROR_KEY: Record<string, string> = {
  forbidden: 'A-new.rcpt_err_forbidden', not_found: 'A-new.rcpt_err_gone', already_void: 'A-new.rcpt_err_void', reason_required: 'A-new.rcpt_err_reason', day_not_over: 'A-new.rcpt_err_not_over',
  already_closed: 'A-new.rcpt_err_closed', invalid_day: 'A-new.rcpt_err_day', bad_input: 'A-new.rcpt_err_day', not_configured: 'A-new.rcpt_err_pdf',
};
export function receiptErrorKey(o: Outcome<unknown>): string {
  if (o.kind === 'forbidden') return 'A-new.rcpt_err_forbidden';
  if (o.kind === 'not_found') return 'A-new.rcpt_err_gone';
  if (o.kind === 'refused') return RECEIPT_ERROR_KEY[o.code] ?? 'A-new.rcpt_err_general';
  return 'A-new.rcpt_err_general';
}
