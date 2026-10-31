// F05-T11 C11 Pay by PromptPay (Beam) and C12 Confirmed: PAY-01-AC1, AC2, PAY-02-AC6; CC-5.
// Run: node --test --test-concurrency=1 'apps/web/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { chromium, openPage, SHOTS, startApp } from './harness.mjs';

const PAY = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const ORDER = '66666666-6666-4666-8666-666666666666';
const QR = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const person = { fullName: 'Somchai Jaidee', phone: '0812345678', dateOfBirth: '1990-01-01', level: null, language: 'th', priceGroup: 'adult' };
const liff = { inClient: false, loggedIn: true, idToken: 't', language: 'th' };
const booking = { courtName: '2', startAt: '2027-01-09T11:00:00.000Z', endAt: '2027-01-09T12:00:00.000Z' };
const waiting = (over = {}) => ({ paymentId: PAY, orderId: ORDER, state: 'waiting', amountSatang: 50000, qrImageBase64: QR, qrExpiresAt: new Date(Date.now() + 600_000).toISOString(), holdExpiresAt: new Date(Date.now() + 892_000).toISOString(), booking, receiptNumber: null, ...over });
const confirmed = (over = {}) => waiting({ state: 'confirmed', qrImageBase64: null, qrExpiresAt: null, holdExpiresAt: null, receiptNumber: 'HTC-2027-000001', ...over });

let app;
let browser;
before(async () => {
  app = await startApp(3119);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

/** `answers`: a function of the call number giving { status, json } or { abort: true } for GET /payments/{id}. */
async function open(path, answers, { lang = 'en', width = 375 } = {}) {
  const { page, context, calls } = await openPage(browser, { liff, lang, width, me: { profile: person } });
  let n = 0;
  await page.route('**/api/c/hunter/payments/**', (route) => {
    const a = answers(n++);
    return a.abort ? route.abort('internetdisconnected') : route.fulfill({ status: a.status ?? 200, json: a.json });
  });
  await page.goto(`${app.base}${path}`);
  return { page, context, calls, count: () => n };
}
const PAYPATH = `/c/hunter/pay/${ORDER}?payment=${PAY}`;
const text = (page) => page.locator('body').innerText();
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `c11-${name}.png`), fullPage: true });

describe('C11 Pay by PromptPay (F05-T11)', () => {
  it('PAY-01-AC1, AC2: the QR for the exact amount, a countdown, save QR, and no slip upload', async () => {
    const { page, context } = await open(PAYPATH, () => ({ json: waiting() }));
    await page.getByTestId('qr').waitFor();
    const t = await text(page);
    assert.match(t, /Pay by PromptPay/);
    assert.match(t, /Amount to pay\s*฿500/);
    assert.match(t, /Slot held for/);
    assert.match(t, /Waiting for your payment/);
    assert.match(t, /No slip needed/);
    assert.doesNotMatch(t, /Upload slip/i);
    const timer = await page.getByTestId('timer').innerText();
    assert.match(timer, /^1[345]:\d\d$/);
    assert.match(await page.getByTestId('save-qr').getAttribute('href'), /^data:image\/png;base64,/);
    assert.equal(await page.getByTestId('qr').locator('img').getAttribute('src'), `data:image/png;base64,${QR}`);
    await shot(page, 'waiting-en');
    await context.close();
  });

  it('the countdown runs down each second', async () => {
    const { page, context } = await open(PAYPATH, () => ({ json: waiting() }));
    await page.getByTestId('timer').waitFor();
    const a = await page.getByTestId('timer').innerText();
    await page.waitForTimeout(2200);
    const b = await page.getByTestId('timer').innerText();
    const sec = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
    assert.ok(sec(a) - sec(b) >= 1, `${a} -> ${b}`);
    await context.close();
  });

  it('PAY-02: it asks again until the server says confirmed, then goes to C12; nothing says booked before that', async () => {
    const { page, context, count } = await open(PAYPATH, (n) => ({ json: n < 2 ? waiting() : confirmed() }));
    await page.getByTestId('waiting').waitFor();
    assert.doesNotMatch(await text(page), /You're booked/);
    await page.waitForURL(`**/confirmed?payment=${PAY}`, { timeout: 15_000 });
    assert.ok(count() >= 2);
    await context.close();
  });

  it('a failed ask keeps the screen, says so, and recovers on the next ask', async () => {
    let down = false;
    const { page, context } = await open(PAYPATH, () => (down ? { abort: true } : { json: waiting() }));
    await page.getByTestId('qr').waitFor();
    down = true;
    await page.getByTestId('poll-error').waitFor({ timeout: 8000 });
    assert.match(await text(page), /Amount to pay/);
    down = false;
    await page.waitForFunction(() => !document.querySelector('[data-testid="poll-error"]'), null, { timeout: 8000 });
    await context.close();
  });

  it('time ran out: nothing was charged, the court and time are named, and the player can book again or go home', async () => {
    const { page, context } = await open(PAYPATH, () => ({ json: waiting({ state: 'expired', qrImageBase64: null, holdExpiresAt: null }) }));
    await page.getByTestId('expired').waitFor();
    const t = await text(page);
    assert.match(t, /Time ran out/);
    assert.match(t, /Court 2 at 18:00 was released\. Nothing was charged/);
    await shot(page, 'expired-en');
    await page.getByRole('button', { name: 'Book again' }).click();
    await page.waitForURL('**/book');
    await context.close();
  });

  it('failed and late payment states', async () => {
    const failed = await open(PAYPATH, () => ({ json: waiting({ state: 'failed', qrImageBase64: null, holdExpiresAt: null }) }));
    await failed.page.getByTestId('failed').waitFor();
    assert.match(await text(failed.page), /did not go through/);
    await failed.context.close();
    const late = await open(PAYPATH, () => ({ json: waiting({ state: 'wallet', qrImageBase64: null, holdExpiresAt: null }) }));
    await late.page.getByTestId('wallet').waitFor();
    assert.match(await text(late.page), /money is in your wallet/);
    await late.context.close();
  });

  it('another person’s or an unknown payment, and a bad address, are not found', async () => {
    const nf = await open(PAYPATH, () => ({ status: 404, json: { code: 'not_found' } }));
    await nf.page.getByTestId('not-found').waitFor();
    await nf.context.close();
    const bad = await open(`/c/hunter/pay/${ORDER}?payment=nope`, () => ({ json: waiting() }));
    await bad.page.getByTestId('not-found').waitFor();
    assert.equal(bad.count(), 0);
    await bad.context.close();
  });
});

describe('C12 Confirmed (F05-T11)', () => {
  it('shows the booking, what was paid and the receipt, and a calendar file', async () => {
    const { page, context } = await open(`/c/hunter/confirmed?payment=${PAY}`, () => ({ json: confirmed() }));
    await page.getByTestId('confirmed').waitFor();
    const t = await text(page);
    assert.match(t, /You're booked/);
    assert.match(t, /Court\s*2/);
    assert.match(t, /18:00 – 19:00/);
    assert.match(t, /Sat 9 Jan 2027/);
    assert.match(t, /Paid\s*฿500/);
    assert.match(t, /Receipt HTC-2027-000001/);
    const ics = decodeURIComponent((await page.getByTestId('calendar').getAttribute('href')) ?? '');
    assert.match(ics, /DTSTART:20270109T110000Z/);
    await shot(page, 'confirmed-en');
    await page.getByTestId('done').click();
    await page.waitForURL(/\/c\/hunter\/?$/);
    await context.close();
  });

  it('a payment that is not confirmed is never shown as booked', async () => {
    const { page, context } = await open(`/c/hunter/confirmed?payment=${PAY}`, () => ({ json: waiting() }));
    await page.getByTestId('not-confirmed').waitFor();
    assert.doesNotMatch(await text(page), /You're booked/);
    await context.close();
  });
});

describe('wrong amount and an order with nothing to pay', () => {
  it('checking: says the club is checking, keeps the hold, and does not look like waiting', async () => {
    const { page, context } = await open(PAYPATH, () => ({ json: waiting({ state: 'checking', qrImageBase64: null }) }));
    await page.getByTestId('checking').waitFor();
    const t = await text(page);
    assert.match(t, /Checking your payment/);
    assert.match(t, /Slot held for/);
    assert.doesNotMatch(t, /Waiting for your payment/);
    await context.close();
  });
  it('C12 reads the order of a zero money booking: booked, no Paid row, no payment id', async () => {
    const { page, context } = await openPage(browser, { liff, lang: 'en', me: { profile: person } });
    await page.route('**/api/c/hunter/orders/*/confirmation', (r) => r.fulfill({ status: 200, json: confirmed({ paymentId: null, amountSatang: 0 }) }));
    await page.goto(`${app.base}/c/hunter/confirmed?order=${ORDER}`);
    await page.getByTestId('confirmed').waitFor();
    const t = await text(page);
    assert.match(t, /You're booked/);
    assert.match(t, /No payment needed/);
    assert.doesNotMatch(t, /Paid\s*฿/);
    await context.close();
  });
});

describe('layout at 320 px in both languages (CC-5)', () => {
  for (const lang of ['th', 'en']) {
    it(`${lang}: C11 and C12 do not scroll sideways and their buttons stay on one line`, async () => {
      for (const [path, ready, answer] of [[PAYPATH, 'qr', () => ({ json: waiting() })], [`/c/hunter/confirmed?payment=${PAY}`, 'confirmed', () => ({ json: confirmed({ booking: { ...booking, courtName: 'สนามเทนนิสกลางแจ้งหมายเลขหนึ่งติดทางเข้าด้านทิศตะวันออก' } }) })]]) {
        const { page, context } = await open(path, answer, { lang, width: 320 });
        await page.getByTestId(ready).waitFor();
        const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(wide <= 0, `${path} scrolls sideways by ${wide}px`);
        for (const b of await page.locator('.btn').all()) {
          const lines = await b.locator('span').first().evaluate((e) => { const r = document.createRange(); r.selectNodeContents(e); return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size; });
          assert.ok(lines <= 1, `a button wraps into ${lines} lines`);
        }
        await shot(page, `320-${lang}-${ready}`);
        await context.close();
      }
    });
  }
});
