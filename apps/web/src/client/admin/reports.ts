import { call, type Outcome } from './api';
import { satangToBaht, bahtToSatang } from './pricing';
import { addDays } from './calendar';

// A13 Reports and A13b Coach payouts (F11-T21; ADMIN-14; boards H-A13-Reports, G-A13b-Coach-payouts), apart from the screens. Owner and accountant read
// GET /staff/reports/:name?from=&to= (value-owed takes asOf=), each report's CSV (audited), and GET /staff/coach-pay?month=YYYY-MM; the owner adds an adjustment
// (a written reason, D115) and marks a month's pay as paid (refused while the amount is unset). Amounts are integer satang; no row carries a phone number or a birth date (D35).
// Nothing here computes money: the figures are the reports' own. Test data is left out by the reports.

type Fetch = typeof fetch;

export type Rows = Array<Record<string, number | string | null>>;
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));

// ---- the month -----------------------------------------------------------------------------------------------------------------------------------
/** `YYYY-MM` of a Bangkok day. */
export const monthOfDay = (day: string): string => day.slice(0, 7);
export function monthRange(month: string): { from: string; to: string } {
  const first = `${month}-01`;
  const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1));
  return { from: first, to: addDays(next.toISOString().slice(0, 10), -1) };
}
export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// ---- reports ------------------------------------------------------------------------------------------------------------------------------------
export const REPORT_NAMES = ['cash-by-type', 'revenue-earned', 'value-owed', 'occupancy', 'online-vs-staff', 'no-show-rate', 'new-vs-returning', 'partner', 'package-sales'] as const;
export type ReportName = (typeof REPORT_NAMES)[number];
export interface Overview { [k: string]: Rows }
export interface OverviewLoad { data: Partial<Overview>; failed: ReportName[]; forbidden: boolean }
/** All the reports of the month and the owed-as-of the last day, side by side; a report that fails is named and the others still show. */
export async function loadOverview(slug: string, month: string, f: Fetch): Promise<OverviewLoad> {
  const { from, to } = monthRange(month);
  const results = await Promise.all(REPORT_NAMES.map(async (name) => {
    const q = name === 'value-owed' ? `asOf=${to}` : `from=${from}&to=${to}`;
    return [name, await call<Rows | null>(slug, `/staff/reports/${name}?${q}`, f)] as const;
  }));
  const data: Partial<Overview> = {};
  const failed: ReportName[] = [];
  let forbidden = false;
  for (const [name, r] of results) {
    if (r.kind === 'ok') data[name] = r.body ?? [];
    else {
      failed.push(name);
      if (r.kind === 'forbidden') forbidden = true;
    }
  }
  return { data, failed, forbidden };
}
export const csvHref = (slug: string, name: ReportName, month: string): string => {
  const { from, to } = monthRange(month);
  return `/api/c/${encodeURIComponent(slug)}/staff/reports/${name}/csv?${name === 'value-owed' ? `asOf=${to}` : `from=${from}&to=${to}`}`;
};

export interface Tiles {
  cashReceivedSatang: number | null; revenueEarnedSatang: number | null; unusedCreditSatang: number | null; walletBalancesSatang: number | null; occupancyPercent: number | null; noShowPercent: number | null;
  newCustomers: number | null; returningCustomers: number | null; onlinePercent: number | null;
}
/** Whole percent, rounded to the nearest, from a numerator and a denominator; null when there is nothing to divide by. */
export const percent = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part * 100) / whole) : null);
export function tilesOf(d: Partial<Overview>): Tiles {
  const cash = d['cash-by-type'];
  const rev = d['revenue-earned']?.[0];
  const owed = d['value-owed'];
  const occ = d['occupancy'];
  const nsr = d['no-show-rate']?.[0];
  const nvr = d['new-vs-returning']?.[0];
  const ovs = d['online-vs-staff'];
  const sum = (rows: Rows | undefined, k: string) => (rows ? rows.reduce((a, r) => a + num(r[k]), 0) : null);
  const line = (l: string, k: string) => (owed ? owed.filter((r) => r['line'] === l).reduce((a, r) => a + num(r[k]), 0) : null);
  const booked = sum(occ, 'booked');
  const bookable = sum(occ, 'bookable');
  const online = ovs ? ovs.filter((r) => r['source'] === 'online').reduce((a, r) => a + num(r['bookings']), 0) : null;
  const all = sum(ovs, 'bookings');
  return {
    cashReceivedSatang: sum(cash, 'amount_satang'), revenueEarnedSatang: rev ? num(rev['total_satang']) : null, unusedCreditSatang: line('credit', 'amount_satang'), walletBalancesSatang: line('wallet', 'amount_satang'),
    occupancyPercent: booked !== null && bookable !== null ? percent(booked, bookable) : null,
    noShowPercent: nsr ? (num(nsr['played']) + num(nsr['no_shows']) > 0 ? Math.round(num(nsr['rate_basis_points']) / 100) : null) : null,
    newCustomers: nvr ? num(nvr['new_customers']) : null, returningCustomers: nvr ? num(nvr['returning_customers']) : null, onlinePercent: online !== null && all !== null ? percent(online, all) : null,
  };
}

export interface Cell { weekday: number; hour: number; booked: number; bookable: number; percent: number | null }
/** The occupancy by day and hour, summed over the courts (the board's heat map). */
export function heatmap(rows: Rows | undefined): { hours: number[]; cells: Cell[] } {
  const by = new Map<string, Cell>();
  for (const r of rows ?? []) {
    const weekday = num(r['weekday']);
    const hour = num(r['hour']);
    const k = `${weekday}:${hour}`;
    const c = by.get(k) ?? { weekday, hour, booked: 0, bookable: 0, percent: null };
    c.booked += num(r['booked']);
    c.bookable += num(r['bookable']);
    by.set(k, c);
  }
  const cells = [...by.values()].map((c) => ({ ...c, percent: percent(c.booked, c.bookable) }));
  return { hours: [...new Set(cells.map((c) => c.hour))].sort((a, b) => a - b), cells };
}
export interface PartnerRow { name: string; redemptions: number; revenueSatang: number; newCustomers: number }
export const partnersOf = (rows: Rows | undefined): PartnerRow[] => (rows ?? []).map((r) => ({ name: String(r['partner_name'] ?? ''), redemptions: num(r['redemptions']), revenueSatang: num(r['revenue_satang']), newCustomers: num(r['new_customers']) }));

// ---- coach payouts ------------------------------------------------------------------------------------------------------------------------------
export interface Payout {
  payout_id: string | null; coach_id: string; coach_name: string | null; status: 'open' | 'paid'; solo_sessions: number; group_sessions: number; base_satang: number | null;
  solo_pay_satang: number | null; group_pay_satang: number | null; flags: string[]; amount_satang: number | null; adjustments_satang: number; total_satang: number | null; paid_at: string | null;
}
export const loadPayouts = async (slug: string, month: string, f: Fetch): Promise<Outcome<Payout[]>> => {
  const r = await call<Payout[] | null>(slug, `/staff/coach-pay?month=${month}`, f);
  return r.kind === 'ok' ? { kind: 'ok', body: r.body ?? [] } : r;
};
export const payoutsCsvHref = (slug: string, month: string): string => `/api/c/${encodeURIComponent(slug)}/staff/coach-pay/csv?month=${month}`;
export const FLAG_KEY: Record<string, string> = {
  solo_pay_unset: 'A-new.rep_flag_solo', group_pay_unset: 'A-new.rep_flag_group', group_percent_no_base: 'A-new.rep_flag_percent', solo_portion_missing: 'A-new.rep_flag_portion',
};
export const sessionsOf = (p: Pick<Payout, 'solo_sessions' | 'group_sessions'>): number => p.solo_sessions + p.group_sessions;
/** The month's totals: what is owed (known totals only), what is paid, and how many coaches are paid; a coach with an unset amount is counted as unsettled, not as zero. */
export function payoutTotals(rows: readonly Payout[]): { owed: number; paid: number; paidCount: number; coaches: number; unset: number; sessions: number } {
  let owed = 0;
  let paid = 0;
  let paidCount = 0;
  let unset = 0;
  for (const r of rows) {
    if (r.total_satang === null) {
      unset += 1;
      continue;
    }
    owed += r.total_satang;
    if (r.status === 'paid') {
      paid += r.total_satang;
      paidCount += 1;
    }
  }
  return { owed, paid, paidCount, coaches: rows.length, unset, sessions: rows.reduce((a, r) => a + sessionsOf(r), 0) };
}
export type AdjustBody = { ok: true; body: { delta_satang: number; reason: string } } | { ok: false; key: string };
/** An adjustment is a signed amount in baht (not zero) and a written reason. */
export function adjustBody(amount: string, reason: string): AdjustBody {
  const t = amount.trim();
  const sign = t.startsWith('-') ? -1 : 1;
  const s = bahtToSatang(t.replace(/^[+-]/, ''));
  if (s === 'bad' || s === null || s === 0) return { ok: false, key: 'A-new.rep_err_amount' };
  if (reason.trim() === '') return { ok: false, key: 'A-new.rep_err_reason' };
  return { ok: true, body: { delta_satang: sign * s, reason: reason.trim() } };
}
export const adjust = (slug: string, payoutId: string, body: { delta_satang: number; reason: string }, f: Fetch) => call<{ id: string }>(slug, `/staff/coach-pay/${encodeURIComponent(payoutId)}/adjustments`, f, { method: 'POST', body });
export const markPaid = (slug: string, payoutId: string, f: Fetch) => call<{ id: string }>(slug, `/staff/coach-pay/${encodeURIComponent(payoutId)}/paid`, f, { method: 'POST', body: {} });
export const baht = satangToBaht;

export const REPORT_ERROR_KEY: Record<string, string> = {
  forbidden: 'A-new.rep_err_forbidden', not_found: 'A-new.rep_err_gone', amount_unset: 'A-new.rep_err_unset', already_paid: 'A-new.rep_err_paid', reason_required: 'A-new.rep_err_reason', invalid_delta: 'A-new.rep_err_amount',
  negative_total: 'A-new.rep_err_negative', invalid_month: 'A-new.rep_err_month', bad_input: 'A-new.rep_err_amount',
};
export function reportErrorKey(o: Outcome<unknown>): string {
  if (o.kind === 'forbidden') return 'A-new.rep_err_forbidden';
  if (o.kind === 'not_found') return 'A-new.rep_err_gone';
  if (o.kind === 'refused') return REPORT_ERROR_KEY[o.code] ?? 'A-new.rep_err_general';
  return 'A-new.rep_err_general';
}
