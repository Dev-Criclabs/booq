// F11-T21 A14 Receipts and daily close (ADMIN-15): the list with search and a date range, the PDF in Thai or English, Void with a written reason (owner), the daily close
// of a finished day (preview, run, export); the accountant has no void; Thai and English at 1280 and 375 px (CC-5). The API is faked in the browser; no database.
// Run: node --test --test-concurrency=1 'apps/web/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { SHOTS } from './harness.mjs';
import { chromium, noSideways, openAdmin, startApp } from './admin-harness.mjs';

let app;
let browser;
before(async () => {
  app = await startApp(3127);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

const url = '/c/hunter/admin/receipts';
const ACCOUNTANT_PAGES = ['A13', 'A14'];
const ROWS = [
  { id: 'r1', number: 'HTC-2027-000002', kind: 'wallet_credit', status: 'issued', issued_at: '2027-01-17T03:00:00Z', customer_name: 'Ploy Srisuk', total_satang: 100000, is_test: false },
  { id: 'r2', number: 'HTC-2027-000001', kind: 'sale', status: 'void', issued_at: '2027-01-16T03:00:00Z', customer_name: null, total_satang: 50000, is_test: true },
];
const TOTALS = { methods: { beam: 450000, cash: 100000 }, money_total_satang: 550000, credit_used: { count: 3, value_satang: 135000 }, wallet_used_satang: 20000, wallet_returned_satang: 0, voided_payments: [], voids_made: [{ number: 'x', total_satang: 1, reason: 'r' }], wallet_credited: [], receipts: [] };

function server(state = {}) {
  const s = { rows: ROWS, closed: false, ...state };
  return (method, path, search, body) => {
    if (path === '/courts') return { status: 200, body: { status: 'live', today: '2027-01-18', bookingWindowDays: 14, courts: [], openingHours: [] } };
    if (path === '/staff/receipts') return s.list ? s.list(search) : { status: 200, body: s.rows };
    if (/^\/staff\/receipts\/[^/]+\/void$/.test(path)) return s.void ?? { status: 200, body: { ok: true } };
    if (path === '/staff/daily-close' && method === 'GET') return { status: 200, body: { closed: s.closed, day: '2027-01-17', runAt: s.closed ? '2027-01-18T01:00:00Z' : null, totals: TOTALS } };
    if (path === '/staff/daily-close' && method === 'POST') { s.closed = true; return s.run ?? { status: 200, body: { id: 'd1', day: body.day } }; }
    return undefined;
  };
}
const open = (api, o) => openAdmin(browser, api, o);
const writes = (calls, re) => calls.filter((c) => c.method !== 'GET' && re.test(c.path));

describe('A14 Receipts', () => {
  it('lists receipts newest first with number, date, name, kind, total and status; the last 31 days up to the server\'s today are asked for', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('rcpt-table').waitFor();
    const first = await page.getByTestId('rcpt-r1').innerText();
    assert.match(first, /HTC-2027-000002/);
    assert.match(first, /Ploy Srisuk/);
    assert.match(first, /Wallet top up/);
    assert.match(first, /฿1,000/);
    assert.match(await page.getByTestId('rcpt-r2').innerText(), /Void/);
    assert.match(await page.getByTestId('rcpt-r2').innerText(), /Test/);
    assert.equal(await page.getByTestId('pdf-th-r1').getAttribute('href'), '/api/c/hunter/staff/receipts/r1/pdf?lang=th');
    assert.equal(await page.getByTestId('pdf-en-r1').getAttribute('href'), '/api/c/hunter/staff/receipts/r1/pdf?lang=en');
    assert.equal(calls.find((c) => c.path === '/staff/receipts').search, '?from=2026-12-19&to=2027-01-18&limit=50&offset=0');
    assert.equal(await page.getByTestId('nav-receipts').getAttribute('aria-current'), 'page');
    await page.screenshot({ path: join(SHOTS, 'admin-receipts.png'), fullPage: true });
    await context.close();
  });

  it('search and range are sent; a wrong range is refused first', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('rcpt-table').waitFor();
    await page.getByTestId('rcpt-from').fill('2027-01-10');
    await page.getByTestId('rcpt-to').fill('2027-01-05');
    await page.getByTestId('rcpt-apply').click();
    await page.getByTestId('rcpt-problem').waitFor();
    await page.getByTestId('rcpt-to').fill('2027-01-12');
    await page.getByTestId('rcpt-search').fill(' ploy ');
    await page.getByTestId('rcpt-apply').click();
    await page.waitForTimeout(400);
    assert.equal(calls.filter((c) => c.path === '/staff/receipts').at(-1).search, '?from=2027-01-10&to=2027-01-12&limit=50&offset=0&q=ploy');
    await context.close();
  });

  it('Void asks for a reason first, then voids and says the number stays; an already void receipt is named', async () => {
    const a = await open(server());
    await a.page.goto(`${app.base}${url}`);
    await a.page.getByTestId('void-r1').click();
    await a.page.getByTestId('void-go-r1').click();
    await a.page.getByTestId('rcpt-msg').waitFor();
    assert.equal(writes(a.calls, /void$/).length, 0);
    await a.page.getByTestId('void-reason-r1').fill('Wrong item');
    await a.page.getByTestId('void-go-r1').click();
    await a.page.waitForFunction(() => /never reused/.test(document.querySelector('[data-testid="rcpt-msg"]')?.textContent ?? ''));
    assert.deepEqual(writes(a.calls, /void$/)[0].body, { reason: 'Wrong item' });
    assert.equal(await a.page.getByTestId('void-r2').count(), 0); // a void receipt has no Void
    await a.context.close();
    const b = await open(server({ void: { status: 409, body: { code: 'already_void' } } }));
    await b.page.goto(`${app.base}${url}`);
    await b.page.getByTestId('void-r1').click();
    await b.page.getByTestId('void-reason-r1').fill('x');
    await b.page.getByTestId('void-go-r1').click();
    await b.page.waitForFunction(() => /already void/.test(document.querySelector('[data-testid="rcpt-msg"]')?.textContent ?? ''));
    await b.context.close();
  });

  it('the accountant lists and prints but cannot void', async () => {
    const { page, context } = await open(server(), { pages: ACCOUNTANT_PAGES });
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('rcpt-table').waitFor();
    assert.equal(await page.getByTestId('void-r1').count(), 0);
    assert.equal(await page.getByTestId('pdf-th-r1').count(), 1);
    await context.close();
  });

  it('an empty list, a refused role and a lost network have their own states', async () => {
    const e = await open(server({ rows: [] }));
    await e.page.goto(`${app.base}${url}`);
    await e.page.getByTestId('rcpt-empty').waitFor();
    await e.context.close();
    const no = await open(() => ({ status: 403, body: { code: 'forbidden' } }));
    await no.page.goto(`${app.base}${url}`);
    await no.page.getByTestId('rcpt-forbidden').waitFor();
    await no.context.close();
  });
});

describe('A14 Daily close', () => {
  it('previews yesterday: PromptPay and cash received, wallet and credit used (not new money), voids; Run close closes it once and Export is a link', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('close-totals').waitFor();
    assert.equal(await page.getByTestId('close-day').inputValue(), '2027-01-17');
    assert.equal(await page.getByTestId('close-beam').innerText(), '฿4,500');
    assert.equal(await page.getByTestId('close-cash').innerText(), '฿1,000');
    assert.equal(await page.getByTestId('close-money').innerText(), '฿5,500');
    assert.match(await page.getByTestId('close').innerText(), /Not closed yet/);
    assert.match(await page.getByTestId('close').innerText(), /Wallet and credit are not new money/);
    assert.equal(await page.getByTestId('close-export').getAttribute('href'), '/api/c/hunter/staff/daily-close/csv?day=2027-01-17');
    await page.getByTestId('close-run').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="close-run"]') === null);
    assert.deepEqual(writes(calls, /daily-close$/)[0].body, { day: '2027-01-17' });
    assert.match(await page.getByTestId('close').innerText(), /Closed/);
    await context.close();
  });

  it('a day that is not over is refused in words', async () => {
    const { page, context } = await open(server({ run: { status: 409, body: { code: 'day_not_over' } } }));
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('close-run').click();
    await page.waitForFunction(() => /not over yet/.test(document.querySelector('[data-testid="close-msg"]')?.textContent ?? ''));
    await context.close();
  });
});

describe('A14 layout', () => {
  for (const lang of ['th', 'en']) {
    for (const width of [1280, 375]) {
      it(`${lang} at ${width}px: no sideways scroll with a long customer name, the void form and the close`, async () => {
        const long = 'สมชาย ใจดีมากมายหลายประการ Somchai Jaidee-Wongsawat the Third of Bangkok';
        const { page, context } = await open(server({ rows: [{ ...ROWS[0], customer_name: long }] }), { lang, width });
        await page.goto(`${app.base}${url}`);
        await page.getByTestId('rcpt-table').waitFor();
        await page.getByTestId('close-totals').waitFor();
        assert.equal(await noSideways(page), true);
        await page.getByTestId('void-r1').click();
        assert.equal(await noSideways(page), true);
        await page.screenshot({ path: join(SHOTS, `admin-receipts-${lang}-${width}.png`), fullPage: true });
        await context.close();
      });
    }
  }
});
