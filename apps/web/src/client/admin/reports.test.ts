import { describe, expect, it } from 'vitest';
import { adminHasKey } from './i18n';
import { adjustBody, csvHref, FLAG_KEY, heatmap, monthOfDay, monthRange, partnersOf, payoutTotals, percent, REPORT_ERROR_KEY, reportErrorKey, tilesOf, type Payout } from './reports';

// F11-T21 A13 Reports and A13b Coach payouts (ADMIN-14): the figures are the reports' own; the page only lays them out. A coach whose pay is unset is unsettled, never zero.
describe('the month', () => {
  it('a Bangkok day gives its month; a month gives its first and last day', () => {
    expect(monthOfDay('2027-02-10')).toBe('2027-02');
    expect(monthRange('2027-02')).toEqual({ from: '2027-02-01', to: '2027-02-28' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange('2027-12')).toEqual({ from: '2027-12-01', to: '2027-12-31' });
  });
  it('the CSV links name the range, or the day for what is owed', () => {
    expect(csvHref('hunter', 'cash-by-type', '2027-01')).toBe('/api/c/hunter/staff/reports/cash-by-type/csv?from=2027-01-01&to=2027-01-31');
    expect(csvHref('hunter', 'value-owed', '2027-01')).toBe('/api/c/hunter/staff/reports/value-owed/csv?asOf=2027-01-31');
  });
});

describe('tiles', () => {
  const data = {
    'cash-by-type': [{ method: 'beam', payments: 5, amount_satang: 450000 }, { method: 'cash', payments: 1, amount_satang: 100000 }],
    'revenue-earned': [{ credits_used: 3, credit_value_satang: 135000, single_sales_satang: 200000, total_satang: 335000 }],
    'value-owed': [{ line: 'credit', packages: 2, credits: 8, amount_satang: 360000 }, { line: 'wallet', packages: 1, credits: 0, amount_satang: 40000 }, { line: 'imported_wallet', packages: 1, credits: 0, amount_satang: 99999 }],
    occupancy: [{ resource_id: 'a', weekday: 1, hour: 9, booked: 3, bookable: 4 }, { resource_id: 'b', weekday: 1, hour: 9, booked: 1, bookable: 4 }],
    'online-vs-staff': [{ source: 'online', bookings: 6 }, { source: 'staff', bookings: 2 }],
    'no-show-rate': [{ played: 18, no_shows: 2, rate_basis_points: 1000 }],
    'new-vs-returning': [{ new_customers: 4, returning_customers: 11 }],
  };
  it('sums cash, reads revenue, owed (credit and wallet only, imported kept apart), occupancy, no-show, customers and the online share', () => {
    expect(tilesOf(data)).toEqual({ cashReceivedSatang: 550000, revenueEarnedSatang: 335000, unusedCreditSatang: 360000, walletBalancesSatang: 40000, occupancyPercent: 50, noShowPercent: 10, newCustomers: 4, returningCustomers: 11, onlinePercent: 75 });
  });
  it('a report that is missing is no figure, never zero; nothing played is no rate', () => {
    expect(tilesOf({})).toMatchObject({ cashReceivedSatang: null, revenueEarnedSatang: null, unusedCreditSatang: null, occupancyPercent: null, noShowPercent: null, newCustomers: null, onlinePercent: null });
    expect(tilesOf({ 'no-show-rate': [{ played: 0, no_shows: 0, rate_basis_points: 0 }] }).noShowPercent).toBeNull();
    expect(percent(1, 0)).toBeNull();
    expect(percent(1, 3)).toBe(33);
  });
  it('the heat map sums the courts for each weekday and hour', () => {
    const h = heatmap(data.occupancy);
    expect(h.hours).toEqual([9]);
    expect(h.cells).toEqual([{ weekday: 1, hour: 9, booked: 4, bookable: 8, percent: 50 }]);
    expect(heatmap(undefined).cells).toEqual([]);
  });
  it('partners are laid out with their redemptions and revenue', () => {
    expect(partnersOf([{ partner_name: 'Cafe', redemptions: 4, revenue_satang: 120000, new_customers: 1 }])).toEqual([{ name: 'Cafe', redemptions: 4, revenueSatang: 120000, newCustomers: 1 }]);
  });
});

describe('payouts', () => {
  const row = (over: Partial<Payout> = {}): Payout => ({ payout_id: 'p', coach_id: 'c', coach_name: 'Cat', status: 'open', solo_sessions: 4, group_sessions: 2, base_satang: null, solo_pay_satang: null, group_pay_satang: null, flags: [], amount_satang: 1000000, adjustments_satang: 0, total_satang: 1000000, paid_at: null, ...over });
  it('totals what is owed and paid; a coach with an unset amount is counted apart, not as zero', () => {
    const t = payoutTotals([row(), row({ coach_id: 'd', status: 'paid', total_satang: 500000, paid_at: '2027-02-01T03:00:00Z' }), row({ coach_id: 'e', total_satang: null, amount_satang: null, flags: ['solo_pay_unset'] })]);
    expect(t).toEqual({ owed: 1500000, paid: 500000, paidCount: 1, coaches: 3, unset: 1, sessions: 18 });
  });
  it('an adjustment is a signed amount in baht, not zero, with a written reason', () => {
    expect(adjustBody('200', 'Cover shift')).toEqual({ ok: true, body: { delta_satang: 20000, reason: 'Cover shift' } });
    expect(adjustBody('-50.5', ' Late ')).toEqual({ ok: true, body: { delta_satang: -5050, reason: 'Late' } });
    expect(adjustBody('0', 'x')).toEqual({ ok: false, key: 'A-new.rep_err_amount' });
    expect(adjustBody('abc', 'x')).toEqual({ ok: false, key: 'A-new.rep_err_amount' });
    expect(adjustBody('10', '  ')).toEqual({ ok: false, key: 'A-new.rep_err_reason' });
  });
});

describe('refusals and text', () => {
  it('each refusal has its own words', () => {
    expect(reportErrorKey({ kind: 'refused', status: 409, code: 'amount_unset' })).toBe('A-new.rep_err_unset');
    expect(reportErrorKey({ kind: 'refused', status: 409, code: 'already_paid' })).toBe('A-new.rep_err_paid');
    expect(reportErrorKey({ kind: 'refused', status: 400, code: 'weird' })).toBe('A-new.rep_err_general');
    expect(reportErrorKey({ kind: 'forbidden' })).toBe('A-new.rep_err_forbidden');
  });
  it('every key the pages use exists in both languages', () => {
    const keys = ['A-0066', 'A-0097', 'A-0165', 'A-0193', 'A-0281', 'A-0282', 'A-0283', 'A-0284', 'A-0285', 'A-0286', 'A-0287', 'A-0288', 'A-0289', 'A-0290', 'A-0291', 'A-0292', 'A-0293', 'A-0297', 'A-0373', 'A-0444', 'A-0445', 'A-0446', 'A-0449', 'A-0450', 'A-0451', 'A-0452', 'A-0454', 'A-0456',
      'A-new.cal_hour', 'A-new.coach_no_name', 'A-new.coach_not_set', 'P-0040', 'P-0041', 'P-0042', 'P-0043', 'P-0044', 'P-0045', 'P-0138', ...Object.values(FLAG_KEY), ...Object.values(REPORT_ERROR_KEY),
      ...['month', 'view', 'none', 'customers', 'failed', 'owed_for', 'unset_count', 'no_payouts', 'adjust', 'adj_amount', 'adj_reason', 'adj_go', 'adjusted', 'paid_done', 'flag_other', 'err_general'].map((k) => `A-new.rep_${k}`)];
    for (const lang of ['th', 'en'] as const) for (const k of keys) expect(adminHasKey(lang, k), `${lang} ${k}`).toBe(true);
  });
});
