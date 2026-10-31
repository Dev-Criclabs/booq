// F11-T21 A13 Reports and A13b Coach payouts (ADMIN-14): the month's figures with their CSV links, the occupancy by day and hour, partners, and the coach payouts with adjustments
// and Mark paid (owner); the accountant reads only; Thai and English at 1280 and 375 px (CC-5). The API is faked in the browser; no database.
// Run: node --test --test-concurrency=1 'apps/web/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { SHOTS } from './harness.mjs';
import { chromium, noSideways, openAdmin, startApp } from './admin-harness.mjs';

let app;
let browser;
before(async () => {
  app = await startApp(3128);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

const url = '/c/hunter/admin/reports';
const ACCOUNTANT_PAGES = ['A13', 'A14'];
const REPORTS = {
  'cash-by-type': [{ method: 'beam', payments: 5, amount_satang: 450000 }, { method: 'cash', payments: 1, amount_satang: 100000 }],
  'package-sales': [{ orders: 2, packages: 2, money_satang: 800000 }],
  'revenue-earned': [{ credits_used: 3, credit_value_satang: 135000, single_sales_satang: 200000, total_satang: 335000 }],
  'value-owed': [{ line: 'credit', packages: 2, credits: 8, amount_satang: 360000 }, { line: 'wallet', packages: 1, credits: 0, amount_satang: 40000 }],
  occupancy: [{ resource_id: 'a', weekday: 1, hour: 9, booked: 3, bookable: 4 }, { resource_id: 'b', weekday: 1, hour: 9, booked: 1, bookable: 4 }, { resource_id: 'a', weekday: 6, hour: 18, booked: 4, bookable: 4 }],
  'online-vs-staff': [{ source: 'online', bookings: 6 }, { source: 'staff', bookings: 2 }],
  'no-show-rate': [{ played: 18, no_shows: 2, rate_basis_points: 1000 }],
  'new-vs-returning': [{ new_customers: 4, returning_customers: 11 }],
  partner: [{ partner_id: 'p1', partner_name: 'Partner cafe', redemptions: 4, revenue_satang: 120000, new_customers: 1, repeat_30: 0, repeat_60: 0 }],
};
const PAYOUTS = [
  { payout_id: 'po1', coach_id: 'c1', coach_name: 'Coach Cat', status: 'open', solo_sessions: 8, group_sessions: 4, base_satang: 1000000, solo_pay_satang: 600000, group_pay_satang: 200000, flags: [], amount_satang: 1800000, adjustments_satang: 20000, total_satang: 1820000, paid_at: null },
  { payout_id: 'po2', coach_id: 'c2', coach_name: 'Coach Dan', status: 'paid', solo_sessions: 2, group_sessions: 0, base_satang: null, solo_pay_satang: 100000, group_pay_satang: 0, flags: [], amount_satang: 100000, adjustments_satang: 0, total_satang: 100000, paid_at: '2027-02-01T03:00:00Z' },
  { payout_id: 'po3', coach_id: 'c3', coach_name: 'Coach Eve', status: 'open', solo_sessions: 3, group_sessions: 0, base_satang: null, solo_pay_satang: null, group_pay_satang: 0, flags: ['solo_pay_unset'], amount_satang: null, adjustments_satang: 0, total_satang: null, paid_at: null },
];

function server(state = {}) {
  const s = { reports: REPORTS, payouts: PAYOUTS, ...state };
  return (method, path, search, body) => {
    if (path === '/courts') return { status: 200, body: { status: 'live', today: '2027-01-18', bookingWindowDays: 14, courts: [], openingHours: [] } };
    const rep = /^\/staff\/reports\/([a-z-]+)$/.exec(path);
    if (rep) return s.failing?.includes(rep[1]) ? { status: 500, body: undefined } : { status: 200, body: s.reports[rep[1]] ?? [] };
    if (path === '/staff/coach-pay' && method === 'GET') return { status: 200, body: s.payouts };
    if (/^\/staff\/coach-pay\/[^/]+\/adjustments$/.test(path)) return s.adjust ?? { status: 200, body: { id: 'a1' } };
    if (/^\/staff\/coach-pay\/[^/]+\/paid$/.test(path)) return s.paid ?? { status: 200, body: { id: 'po1' } };
    return undefined;
  };
}
const open = (api, o) => openAdmin(browser, api, o);
const writes = (calls, re) => calls.filter((c) => c.method !== 'GET' && re.test(c.path));

describe('A13 Reports', () => {
  it('shows the month\'s figures from the reports, each with its CSV; the month is the server\'s current month', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('rep-overview').waitFor();
    assert.equal(await page.getByTestId('rep-month').inputValue(), '2027-01');
    assert.match(await page.getByTestId('tile-cash').innerText(), /฿5,500/);
    assert.match(await page.getByTestId('tile-revenue').innerText(), /฿3,350/);
    assert.match(await page.getByTestId('tile-owed').innerText(), /฿4,000/);
    assert.match(await page.getByTestId('tile-owed').innerText(), /Unused credit ฿3,600 \+ wallets ฿400/);
    assert.match(await page.getByTestId('tile-occupancy').innerText(), /67%/);
    assert.match(await page.getByTestId('tile-occupancy').innerText(), /No show rate 10%/);
    assert.match(await page.getByTestId('tile-customers').innerText(), /4 new/);
    assert.match(await page.getByTestId('tile-customers').innerText(), /11 returning · online 75%/);
    assert.match(await page.getByTestId('rep-partners').innerText(), /Partner cafe/);
    assert.match(await page.getByTestId('rep-partners').innerText(), /4 used · ฿1,200/);
    assert.equal(await page.getByTestId('csv-cash-by-type').getAttribute('href'), '/api/c/hunter/staff/reports/cash-by-type/csv?from=2027-01-01&to=2027-01-31');
    assert.equal(await page.getByTestId('csv-value-owed').getAttribute('href'), '/api/c/hunter/staff/reports/value-owed/csv?asOf=2027-01-31');
    assert.ok(calls.some((c) => c.path === '/staff/reports/occupancy' && c.search === '?from=2027-01-01&to=2027-01-31'));
    assert.ok(calls.some((c) => c.path === '/staff/reports/value-owed' && c.search === '?asOf=2027-01-31'));
    await page.screenshot({ path: join(SHOTS, 'admin-reports.png'), fullPage: true });
    await context.close();
  });

  it('the occupancy by day and hour sums the courts into a share per cell', async () => {
    const { page, context } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('rep-heat').waitFor();
    assert.equal(await page.getByTestId('heat-1-9').innerText(), '50%');
    assert.equal(await page.getByTestId('heat-6-18').innerText(), '100%');
    assert.equal(await page.getByTestId('heat-2-9').innerText(), '');
    await context.close();
  });

  it('changing the month asks for that month; a report that fails is named and the rest still show', async () => {
    const { page, context, calls } = await open(server({ failing: ['partner'] }));
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('rep-failed').waitFor();
    assert.match(await page.getByTestId('rep-failed').innerText(), /1 reports could not be loaded/);
    assert.match(await page.getByTestId('tile-cash').innerText(), /฿5,500/);
    await page.getByTestId('rep-month').fill('2026-12');
    await page.waitForTimeout(500);
    assert.ok(calls.some((c) => c.path === '/staff/reports/cash-by-type' && c.search === '?from=2026-12-01&to=2026-12-31'));
    await context.close();
  });

  it('a report with no data is "No figure", not zero', async () => {
    const { page, context } = await open(server({ reports: {} }));
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('rep-overview').waitFor();
    assert.match(await page.getByTestId('tile-revenue').innerText(), /No figure/);
    await context.close();
  });

  it('a refused role says so', async () => {
    const { page, context } = await open(() => ({ status: 403, body: { code: 'forbidden' } }));
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('rep-forbidden').waitFor();
    await context.close();
  });
});

describe('A13b Coach payouts', () => {
  it('totals the month, shows each coach\'s sessions, adjustment, what is owed and status; a coach with pay not set shows it, not zero', async () => {
    const { page, context } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('rep-tab-payouts').click();
    await page.getByTestId('pay-table').waitFor();
    assert.match(await page.getByTestId('pay-owed').innerText(), /Owed for January 2027/i);
    assert.match(await page.getByTestId('pay-owed').innerText(), /฿19,200/);
    assert.match(await page.getByTestId('pay-owed').innerText(), /1 coaches have no amount yet/);
    assert.match(await page.getByTestId('pay-sessions').innerText(), /17/);
    assert.match(await page.getByTestId('pay-paid').innerText(), /฿1,000/);
    assert.match(await page.getByTestId('pay-paid').innerText(), /1 of 3 coaches/);
    assert.match(await page.getByTestId('pay-c1').innerText(), /\+฿200/);
    assert.equal(await page.getByTestId('owed-c1').innerText(), '฿18,200');
    assert.match(await page.getByTestId('pay-c2').innerText(), /Paid Mon 1 Feb/);
    assert.match(await page.getByTestId('pay-c3').innerText(), /solo pay not set/);
    assert.equal(await page.getByTestId('owed-c3').innerText(), 'Not set');
    assert.equal(await page.getByTestId('markpaid-c3').isDisabled(), true);
    assert.equal(await page.getByTestId('markpaid-c2').count(), 0);
    assert.equal(await page.getByTestId('csv-payouts').getAttribute('href'), '/api/c/hunter/staff/coach-pay/csv?month=2027-01');
    await context.close();
  });

  it('Mark paid sends the payout; an adjustment needs an amount and a reason and is sent in satang with its sign', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('rep-tab-payouts').click();
    await page.getByTestId('markpaid-c1').click();
    await page.getByTestId('pay-msg').waitFor();
    assert.equal(writes(calls, /paid$/)[0].path, '/staff/coach-pay/po1/paid');
    await page.getByTestId('adj-c1').click();
    await page.getByTestId('adj-go-c1').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="pay-msg"]')?.getAttribute('role') === 'alert');
    assert.equal(writes(calls, /adjustments$/).length, 0);
    await page.getByTestId('adj-amount-c1').fill('-150.5');
    await page.getByTestId('adj-reason-c1').fill('Late start');
    await page.getByTestId('adj-go-c1').click();
    await page.waitForFunction(() => /was added/.test(document.querySelector('[data-testid="pay-msg"]')?.textContent ?? ''));
    assert.deepEqual(writes(calls, /adjustments$/)[0].body, { delta_satang: -15050, reason: 'Late start' });
    await context.close();
  });

  it('a refusal of Mark paid is named; the accountant reads the payouts but has no Mark paid or Adjust', async () => {
    const a = await open(server({ paid: { status: 409, body: { code: 'amount_unset' } } }));
    await a.page.goto(`${app.base}${url}`);
    await a.page.getByTestId('rep-tab-payouts').click();
    await a.page.getByTestId('markpaid-c1').click();
    await a.page.waitForFunction(() => /amount is not set/.test(document.querySelector('[data-testid="pay-msg"]')?.textContent ?? ''));
    await a.context.close();
    const b = await open(server(), { pages: ACCOUNTANT_PAGES });
    await b.page.goto(`${app.base}${url}`);
    await b.page.getByTestId('rep-tab-payouts').click();
    await b.page.getByTestId('pay-table').waitFor();
    assert.equal(await b.page.getByTestId('markpaid-c1').count(), 0);
    assert.equal(await b.page.getByTestId('adj-c1').count(), 0);
    await b.context.close();
  });
});

describe('A13 layout', () => {
  for (const lang of ['th', 'en']) {
    for (const width of [1280, 375]) {
      it(`${lang} at ${width}px: no sideways scroll on the overview or the payouts`, async () => {
        const long = 'โค้ชสมชาย ใจดีมากมายหลายประการ Coach Somchai Jaidee-Wongsawat the Third';
        const api = server({ payouts: [{ ...PAYOUTS[0], coach_name: long }, PAYOUTS[2]] });
        const { page, context } = await open(api, { lang, width });
        await page.goto(`${app.base}${url}`);
        await page.getByTestId('rep-overview').waitFor();
        assert.equal(await noSideways(page), true);
        await page.getByTestId('rep-tab-payouts').click();
        await page.getByTestId('pay-table').waitFor();
        await page.getByTestId('adj-c1').click();
        assert.equal(await noSideways(page), true);
        await page.screenshot({ path: join(SHOTS, `admin-reports-${lang}-${width}.png`), fullPage: true });
        await context.close();
      });
    }
  }
});
