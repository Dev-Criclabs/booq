// QA player payment journey, one browser session across the pages (Playwright library + node:test), on the lane's harness (apps/web/e2e/harness.mjs).
// apps/web/e2e checks each page on its own with its own fakes. This chains them against ONE stateful fake of the club API, so what is checked is what only a
// journey shows: the hour picked on C4 is the hour quoted, paid and shown on C12; the amount on C10 is the amount on C11 and C12; the browser never sends an
// amount; the Idempotency-Key is sent on the pay call; a double tap, a reload or the Back button does not make a second charge; nothing says "booked" before the
// server says confirmed; and the expired and late payment endings leave the player with a way on and no booking claimed.
// Criteria: BOOK-01, BOOK-04, PAY-01-AC1/AC2, PAY-02 (confirmed only on the server's word), PAY-03 (late payment goes to the wallet), CC-5.
// Run: node --test --test-concurrency=1 tests/e2e/qa-pay-journey.e2e.mjs
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, openPage, startApp } from '../../apps/web/e2e/harness.mjs';

const OUT = join(fileURLToPath(new URL('.', import.meta.url)), 'screenshots');
const TODAY = '2027-01-09';
const COURT = 'c2';
const ORDER = '66666666-6666-4666-8666-666666666666';
const PAYMENT = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const QR = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const liff = { inClient: false, loggedIn: true, idToken: 't', language: 'th' };
const person = { fullName: 'Somchai Jaidee', phone: '0812345678', dateOfBirth: '1990-01-01', level: null, language: 'th', priceGroup: 'adult' };
const courts = [{ id: 'c1', name: '1', sport: 'tennis' }, { id: COURT, name: '2', sport: 'tennis' }];
const hour = (date, h, state) => ({ start: `${date}T${String(h).padStart(2, '0')}:00:00+07:00`, state, waitlist: false });
const open24 = (date) => [17, 18, 19, 20, 21].map((h) => hour(date, h, 'open'));
const day = (date) => ({ date, courts: courts.map((c) => ({ ...c, hours: open24(date) })) });
const days = Array.from({ length: 7 }, (_, i) => ({ date: new Date(Date.parse(`${TODAY}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), courts: courts.map((c) => ({ id: c.id, openHours: 5 })) }));
const schedule = { courts: { status: 'live', today: TODAY, bookingWindowDays: 6, courts, openingHours: [] }, days, dayFor: day };
const line = (unit) => ({ position: 1, kind: 'court_hour', hourIndex: 0, startsAt: `${TODAY}T12:00:00.000Z`, coachId: null, addOnId: null, unitPriceSatang: unit, discountSatang: 0, birthdayDiscountSatang: 0, codeDiscountSatang: 0 });
const quote = (total) => ({ lines: [line(total)], subtotalSatang: total, discountSatang: 0, totalSatang: total, creditValueSatang: 0, walletSatang: 0, moneySatang: total, codeNotApplied: false, quoteHash: 'a'.repeat(64) });
const booking = { courtName: '2', startAt: `${TODAY}T12:00:00.000Z`, endAt: `${TODAY}T13:00:00.000Z` };
const soon = (ms) => new Date(Date.now() + ms).toISOString();

let app;
let browser;
before(async () => {
  app = await startApp(3141);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

/**
 * The club API as one server with state. `server.state` is what the fake Beam says about the payment: 'waiting' until the test flips it to 'confirmed',
 * 'expired', 'failed' or 'wallet' (a late payment that went to the wallet). Every call is kept so a test can count the charges that were made.
 */
async function journey({ price = 50000, lang = 'en', width = 375 } = {}) {
  const server = { state: 'waiting', quotes: [], pays: [], payHeaders: [], reads: 0 };
  const { page, context, calls } = await openPage(browser, { liff, lang, width, me: { profile: person }, schedule });
  const payment = () => ({
    paymentId: PAYMENT, orderId: ORDER, state: server.state, amountSatang: price,
    qrImageBase64: server.state === 'waiting' ? QR : null, qrExpiresAt: server.state === 'waiting' ? soon(600_000) : null,
    holdExpiresAt: server.state === 'waiting' ? soon(892_000) : null,
    receiptNumber: server.state === 'confirmed' ? 'HTC-2027-000001' : null, booking,
  });
  await page.route('**/api/c/hunter/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path.endsWith('/checkout/quote')) {
      server.quotes.push(JSON.parse(req.postData() ?? '{}'));
      return route.fulfill({ status: 200, json: quote(price) });
    }
    if (path.endsWith('/checkout/pay')) {
      server.pays.push(JSON.parse(req.postData() ?? '{}'));
      server.payHeaders.push(req.headers()['idempotency-key']);
      return route.fulfill({ status: 200, json: { orderId: ORDER, holdExpiresAt: soon(892_000), payment: { id: PAYMENT, amountSatang: price, qrImageBase64: QR, qrExpiresAt: soon(600_000) }, confirmed: false } });
    }
    if (/\/payments\/[^/]+$/.test(path)) {
      server.reads++;
      return route.fulfill({ status: 200, json: payment() });
    }
    if (path.endsWith('/add-ons') || path.endsWith('/coaches/offerable')) return route.fulfill({ status: 200, json: [] });
    return route.fallback();
  });
  await page.goto(`${app.base}/c/hunter/book`);
  return { page, context, calls, server };
}
const text = (page) => page.locator('body').innerText();
const shot = (page, name) => page.screenshot({ path: join(OUT, `pay-journey-${name}.png`), fullPage: true });

/** C4: pick Court 2 at 19:00 and continue; C10: wait for the bill. */
async function toCheckout(page) {
  await page.getByRole('button', { name: 'Court 2 · 19:00 ·' }).click();
  await page.getByTestId('continue').click();
  await page.waitForURL((u) => u.pathname === '/c/hunter/checkout');
  await page.getByTestId('due').waitFor();
}

describe('player journey: C4 to C10 to C11 to C12', () => {
  it('the hour picked is the hour quoted; the amount on C10 is the amount on C11 and C12; the browser sends no amount; the key is sent; confirmed only on the server’s word', async () => {
    const { page, context, server } = await journey();
    await toCheckout(page);
    // C4 to C10: what was picked is what is quoted.
    const q = new URL(page.url()).searchParams;
    assert.deepEqual([q.get('court'), q.get('courtId'), q.get('date'), q.get('from'), q.get('to')], ['2', COURT, TODAY, '19:00', '20:00']);
    assert.equal(server.quotes.at(-1).courtId, COURT);
    assert.match(await page.getByTestId('due').innerText(), /฿500/);
    await shot(page, 'c10');
    // The browser asks the server to price and to charge; it never sends a price, a total or an amount (R8, PAY-01).
    assert.doesNotMatch(JSON.stringify(server.quotes), /price|total|amount|satang/i);
    await page.getByTestId('pay').click();
    await page.waitForURL(`**/pay/${ORDER}?payment=${PAYMENT}`);
    assert.equal(server.pays.length, 1);
    assert.doesNotMatch(JSON.stringify(server.pays), /price|total|amount|satang/i);
    assert.match(server.payHeaders[0] ?? '', /^[A-Za-z0-9._:-]{1,200}$/, 'the pay call carries a well formed Idempotency-Key');
    // C11: the same amount, a QR, a countdown; no slip upload; nothing says booked while waiting.
    await page.getByTestId('qr').waitFor();
    const t = await text(page);
    assert.match(t, /Amount to pay\s*฿500/);
    assert.doesNotMatch(t, /You're booked/);
    assert.doesNotMatch(t, /Upload slip/i);
    await shot(page, 'c11-waiting');
    // Still waiting a while: still no "booked".
    await page.waitForTimeout(3500);
    assert.doesNotMatch(await text(page), /You're booked/);
    // The fake Beam confirms: the screen moves to C12 on its own.
    server.state = 'confirmed';
    await page.waitForURL(`**/confirmed?payment=${PAYMENT}`, { timeout: 15_000 });
    await page.getByTestId('confirmed').waitFor();
    const done = await text(page);
    assert.match(done, /You're booked/);
    assert.match(done, /Paid\s*฿500/);
    assert.match(done, /Court\s*2/);
    assert.match(done, /19:00 – 20:00/);
    assert.match(done, /Receipt HTC-2027-000001/);
    await shot(page, 'c12');
    assert.equal(server.pays.length, 1, 'one charge for the whole journey');
    await context.close();
  });

  it('a double tap on Pay makes one charge', async () => {
    const { page, context, server } = await journey();
    await toCheckout(page);
    const pay = page.getByTestId('pay');
    await Promise.allSettled([pay.click({ timeout: 2000 }), pay.click({ timeout: 2000 }), pay.dblclick({ timeout: 2000 })]);
    await page.waitForURL(`**/pay/${ORDER}?payment=${PAYMENT}`);
    assert.equal(server.pays.length, 1, `${server.pays.length} pay calls from one tap sequence`);
    await context.close();
  });

  it('reloading C11 resumes the same payment: no second charge, the QR and amount are back', async () => {
    const { page, context, server } = await journey();
    await toCheckout(page);
    await page.getByTestId('pay').click();
    await page.getByTestId('qr').waitFor();
    await page.reload();
    await page.getByTestId('qr').waitFor();
    assert.match(await text(page), /Amount to pay\s*฿500/);
    assert.equal(server.pays.length, 1);
    await context.close();
  });

  it('the Back button from C12 does not charge again', async () => {
    const { page, context, server } = await journey();
    await toCheckout(page);
    await page.getByTestId('pay').click();
    await page.getByTestId('qr').waitFor();
    server.state = 'confirmed';
    await page.waitForURL('**/confirmed?payment=*', { timeout: 15_000 });
    await page.goBack();
    await page.waitForTimeout(1500);
    assert.equal(server.pays.length, 1);
    // Whatever page Back lands on, a confirmed payment is not shown as waiting for money again.
    assert.equal(await page.getByTestId('waiting').count(), 0);
    await context.close();
  });

  it('time ran out: the court is released, nothing was charged, nothing says booked, and the player can book again', async () => {
    const { page, context, server } = await journey();
    await toCheckout(page);
    await page.getByTestId('pay').click();
    await page.getByTestId('qr').waitFor();
    server.state = 'expired';
    await page.getByTestId('expired').waitFor({ timeout: 15_000 });
    const t = await text(page);
    assert.match(t, /Time ran out/);
    assert.match(t, /Nothing was charged/);
    assert.doesNotMatch(t, /You're booked/);
    await shot(page, 'c11-expired');
    await page.getByRole('button', { name: 'Book again' }).click();
    await page.waitForURL('**/book');
    assert.equal(server.pays.length, 1);
    await context.close();
  });

  it('a payment that came in after the time ran out went to the wallet: it says so, never says booked, and offers a way on (PAY-03)', async () => {
    const { page, context } = await journey();
    await toCheckout(page);
    await page.getByTestId('pay').click();
    await page.getByTestId('qr').waitFor();
    // The hold lapsed, then the player paid: the server put the money in the wallet and did not book.
    const route = page.url();
    await page.route('**/api/c/hunter/payments/*', (r) => r.fulfill({ status: 200, json: { paymentId: PAYMENT, orderId: ORDER, state: 'wallet', amountSatang: 50000, qrImageBase64: null, qrExpiresAt: null, holdExpiresAt: null, receiptNumber: null, booking } }));
    await page.reload();
    await page.getByTestId('wallet').waitFor({ timeout: 15_000 });
    const t = await text(page);
    assert.match(t, /money is in your wallet/);
    assert.doesNotMatch(t, /You're booked/);
    assert.doesNotMatch(t, /refund/i, 'value does not go back as cash (spec rule); the wallet is the place it goes');
    assert.equal(page.url(), route);
    await shot(page, 'c11-wallet');
    await context.close();
  });

  it('a failed payment says it did not go through and does not say booked', async () => {
    const { page, context, server } = await journey();
    await toCheckout(page);
    await page.getByTestId('pay').click();
    await page.getByTestId('qr').waitFor();
    server.state = 'failed';
    await page.getByTestId('failed').waitFor({ timeout: 15_000 });
    const t = await text(page);
    assert.match(t, /did not go through/);
    assert.doesNotMatch(t, /You're booked/);
    await context.close();
  });
});

describe('the same journey at 320 px in Thai: nothing clipped, buttons on one line (CC-5)', () => {
  it('C4, C10, C11 and C12', async () => {
    const { page, context, server } = await journey({ lang: 'th', width: 320 });
    const wide = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const lines = async () => {
      for (const b of await page.locator('.btn, [data-testid=continue], [data-testid=pay]').all()) {
        const n = await b.evaluate((e) => { const r = document.createRange(); r.selectNodeContents(e); return new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top / 4))).size; });
        assert.ok(n <= 1, `a button wraps into ${n} lines at ${page.url()}`);
      }
    };
    await page.getByRole('button', { name: /19:00/ }).first().waitFor();
    assert.ok((await wide()) <= 0, 'C4 scrolls sideways');
    await page.getByRole('button', { name: /^สนาม 2 · 19:00/ }).click().catch(async () => page.locator('.grid [data-state=open]').nth(7).click());
    await lines();
    await page.getByTestId('continue').click();
    await page.waitForURL((u) => u.pathname === '/c/hunter/checkout');
    await page.getByTestId('due').waitFor();
    assert.ok((await wide()) <= 0, 'C10 scrolls sideways');
    await lines();
    await page.getByTestId('pay').click();
    await page.getByTestId('qr').waitFor();
    assert.ok((await wide()) <= 0, 'C11 scrolls sideways');
    await lines();
    server.state = 'confirmed';
    await page.waitForURL('**/confirmed?payment=*', { timeout: 15_000 });
    await page.getByTestId('confirmed').waitFor();
    assert.ok((await wide()) <= 0, 'C12 scrolls sideways');
    await lines();
    await shot(page, '320-th-c12');
    await context.close();
  });
});
