// F04-T17, T18 C10 Checkout and its states: R3-AC3, R4-AC5, R5-AC6, R8-AC1 to AC4; CC-5.
// Run: node --test --test-concurrency=1 'apps/web/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { chromium, openPage, SHOTS, startApp } from './harness.mjs';

const COURT = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const ADDON = '66666666-6666-4666-8666-666666666666';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const NOPRICE = 'e1e1e1e1-0000-4000-8000-000000000008';
const person = { fullName: 'Somchai Jaidee', phone: '0812345678', dateOfBirth: '1990-01-01', level: null, language: 'th', priceGroup: 'adult' };
const me = { profile: person };
const liff = { inClient: false, loggedIn: true, idToken: 't', language: 'th' };
const ADDRESS = `/c/hunter/checkout?court=2&courtId=${COURT}&date=2027-01-09&from=18:00&to=19:00`;
const line = (kind, position, unit, extra = {}) => ({ position, kind, hourIndex: 0, startsAt: '2027-01-09T11:00:00.000Z', coachId: null, addOnId: null, unitPriceSatang: unit, discountSatang: 0, birthdayDiscountSatang: 0, codeDiscountSatang: 0, netSatang: unit, creditUnits: 0, creditValueSatang: 0, walletSatang: 0, moneySatang: unit, ...extra });
const quote = (over = {}) => ({ lines: [line('court_hour', 1, 50000)], subtotalSatang: 50000, discountSatang: 0, totalSatang: 50000, creditValueSatang: 0, walletSatang: 0, moneySatang: 50000, codeNotApplied: false, quoteHash: 'a'.repeat(64), ...over });
const addOns = [{ id: ADDON, nameTh: 'ลูกเทนนิสชุด 3 ลูก', nameEn: 'Balls (set of 3)', priceSatang: 10000 }];
const coaches = [
  { coachId: COACH, displayName: 'Coach One', tier: { nameTh: 'โค้ช', nameEn: 'Coach' }, priceSatang: 80000 },
  { coachId: NOPRICE, displayName: 'Coach Two', tier: null, priceSatang: null },
];

let app;
let browser;
before(async () => {
  app = await startApp(3117);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

/** Opens the checkout with the checkout API faked: `quoteFor(body)` and `payFor(body)` answer { status, json } (or { abort: true }). */
async function open({ lang = 'en', width = 375, quoteFor = () => ({ status: 200, json: quote() }), payFor = () => ({ status: 200, json: { orderId: 'o1', holdExpiresAt: '2027-01-09T10:15:00Z', payment: { id: 'p1', amountSatang: 50000, qrImageBase64: 'x', qrExpiresAt: '2027-01-09T10:10:00Z' }, confirmed: false } }), club, address = ADDRESS, asGuest = false } = {}) {
  const { page, context, calls } = await openPage(browser, { liff, lang, width, ...(asGuest ? {} : { me }), ...(club ? { club } : {}) });
  const bodies = { quote: [], pay: [], payHeaders: [] };
  await page.route('**/api/c/hunter/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const reply = (a) => (a.abort ? route.abort('internetdisconnected') : route.fulfill({ status: a.status, json: a.json }));
    if (path.endsWith('/checkout/quote')) {
      const b = JSON.parse(req.postData() ?? '{}');
      bodies.quote.push(b);
      return reply(quoteFor(b));
    }
    if (path.endsWith('/checkout/pay')) {
      const b = JSON.parse(req.postData() ?? '{}');
      bodies.pay.push(b);
      bodies.payHeaders.push(req.headers()['idempotency-key']);
      return reply(payFor(b));
    }
    if (path.endsWith('/add-ons')) return route.fulfill({ status: 200, json: addOns });
    if (path.endsWith('/coaches/offerable')) return route.fulfill({ status: 200, json: coaches });
    return route.fallback();
  });
  await page.goto(`${app.base}${address}`);
  return { page, context, calls, bodies };
}
const text = (page) => page.locator('body').innerText();
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `c10-${name}.png`), fullPage: true });

describe('C10 Checkout (F04-T17)', () => {
  it('shows the summary and the bill the server priced, with the amount due', async () => {
    const { page, context } = await open();
    await page.getByTestId('due').waitFor();
    const t = await text(page);
    assert.match(t, /Checkout/);
    assert.match(t, /Court 2 · 1 hour/);
    assert.match(t, /Sat 9 Jan 2027 · 18:00 to 19:00/);
    assert.match(t, /Court hour\s*฿500/);
    assert.match(t, /Amount due\s*฿500/);
    assert.match(t, /None/);
    await shot(page, 'summary-en');
    await context.close();
  });

  it('R3-AC3: add-ons are one row that expands; picking one asks for a new quote with its id, never an amount', async () => {
    const { page, context, bodies } = await open({
      quoteFor: (b) => ({ status: 200, json: b.addOnIds.length ? quote({ lines: [line('court_hour', 1, 50000), line('add_on', 2, 10000, { addOnId: ADDON })], subtotalSatang: 60000, totalSatang: 60000, moneySatang: 60000, quoteHash: 'b'.repeat(64) }) : quote() }),
    });
    await page.getByTestId('add-on').click();
    await page.getByTestId('bill').locator('details').waitFor();
    assert.deepEqual(bodies.quote.at(-1).addOnIds, [ADDON]);
    assert.match(await page.getByTestId('due').innerText(), /฿600/);
    assert.equal(await page.getByTestId('bill').locator('details li').isVisible(), false);
    await page.getByTestId('bill').locator('summary').click();
    assert.match(await page.getByTestId('bill').locator('details li').innerText(), /Balls/);
    assert.doesNotMatch(JSON.stringify(bodies.quote), /price|total|satang/i);
    await context.close();
  });

  it('a coach with a price can be picked and one with no price has no pick action (COACH-02-AC4)', async () => {
    const { page, context, bodies } = await open();
    const list = page.getByTestId('coach');
    await list.first().waitFor();
    assert.equal(await list.nth(1).isDisabled(), true);
    assert.doesNotMatch(await list.nth(1).innerText(), /฿/);
    await list.first().click();
    await page.waitForFunction(() => true);
    await page.waitForTimeout(150);
    assert.equal(bodies.quote.at(-1).coachId, COACH);
    await page.getByTestId('coach-none').click();
    await page.waitForTimeout(150);
    assert.equal(bodies.quote.at(-1).coachId, null);
    await context.close();
  });

  it('R4-AC5: a refused code stays on the code field and the booking is still priced without it', async () => {
    const { page, context, bodies } = await open({ quoteFor: (b) => (b.code ? { status: 422, json: { code: 'code_expired' } } : { status: 200, json: quote() }) });
    await page.getByTestId('due').waitFor();
    await page.getByTestId('code-input').fill('spring10');
    await page.getByTestId('code-apply').click();
    await page.getByTestId('code-error').waitFor();
    assert.match(await page.getByTestId('code-error').innerText(), /cannot be used today/);
    await page.waitForTimeout(150);
    assert.equal(bodies.quote.at(-1).code, null);
    assert.match(await page.getByTestId('due').innerText(), /฿500/);
    assert.equal(await page.getByTestId('pay').isEnabled(), true);
    await context.close();
  });

  it('R5-AC6: Pay sends the hash of the quote on screen; a changed price comes back as a new total and nothing moves on', async () => {
    let first = true;
    const { page, context, bodies } = await open({
      payFor: () => (first ? ((first = false), { status: 200, json: { priceChanged: true, quote: quote({ moneySatang: 60000, totalSatang: 60000, subtotalSatang: 60000, quoteHash: 'c'.repeat(64) }) } }) : { status: 200, json: { orderId: 'o9', holdExpiresAt: null, payment: null, confirmed: true } }),
    });
    await page.getByTestId('due').waitFor();
    await page.getByTestId('pay').click();
    await page.getByTestId('notice').waitFor();
    assert.match(await page.getByTestId('notice').innerText(), /price changed/);
    assert.match(await page.getByTestId('due').innerText(), /฿600/);
    assert.equal(bodies.pay[0].quoteHash, 'a'.repeat(64));
    assert.ok(page.url().includes('/checkout'));
    await page.getByTestId('pay').click();
    await page.waitForURL('**/confirmed?order=o9');
    assert.equal(bodies.pay[1].quoteHash, 'c'.repeat(64));
    assert.notEqual(bodies.payHeaders[0], bodies.payHeaders[1]);
    await context.close();
  });

  it('a second tap on the same quote is the same Pay: the same Idempotency-Key (D47)', async () => {
    const { page, context, bodies } = await open({ payFor: () => ({ status: 503, json: { code: 'payment_unavailable' } }) });
    await page.getByTestId('due').waitFor();
    await page.getByTestId('pay').click();
    await page.getByTestId('pay-error').waitFor();
    await page.getByTestId('pay').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="pay-error"]').length === 1);
    await page.waitForTimeout(200);
    assert.equal(bodies.payHeaders.length, 2);
    assert.equal(bodies.payHeaders[0], bodies.payHeaders[1]);
    assert.match(await page.getByTestId('pay-error').innerText(), /Nothing was booked or charged/);
    await context.close();
  });
});

describe('C10c bundle offer (F04 R6-AC1, AC2)', () => {
  it('shows the offer the server sends, and nothing when there is none; declining changes nothing', async () => {
    const withOffer = await open({ quoteFor: () => ({ status: 200, json: quote({ bundleOffer: { productId: ADDON, priceSatang: 450000, hours: 10, hoursUsedNow: 1 } }) }) });
    await withOffer.page.getByTestId('bundle-offer').waitFor();
    assert.match(await withOffer.page.getByTestId('bundle-offer').innerText(), /10 hour bundle · ฿4,500/);
    assert.match(await withOffer.page.getByTestId('due').innerText(), /฿500/);
    await withOffer.context.close();
    const none = await open();
    await none.page.getByTestId('due').waitFor();
    assert.equal(await none.page.getByTestId('bundle-offer').count(), 0);
    await none.context.close();
  });
});

describe('C11 hand-off and the checkout states (F04-T18; R8-AC1 to AC4)', () => {
  it('a payment that started hands the order to C11; one with nothing to pay confirms and goes to the bookings', async () => {
    const started = await open();
    await started.page.getByTestId('due').waitFor();
    await started.page.getByTestId('pay').click();
    await started.page.waitForURL('**/pay/o1?payment=p1');
    await started.context.close();
    const free = await open({ quoteFor: () => ({ status: 200, json: quote({ moneySatang: 0 }) }), payFor: () => ({ status: 200, json: { orderId: 'o2', holdExpiresAt: null, payment: null, confirmed: true } }) });
    await free.page.getByTestId('due').waitFor();
    assert.match(await text(free.page), /No payment needed/);
    assert.match(await free.page.getByTestId('pay').innerText(), /Confirm booking/);
    await free.page.getByTestId('pay').click();
    await free.page.waitForURL('**/confirmed?order=o2');
    await free.context.close();
  });

  it('R8-AC3 offline: the offline state says nothing was booked or charged and the action tries again', async () => {
    let down = true;
    const { page, context } = await open({ quoteFor: () => (down ? { abort: true } : { status: 200, json: quote() }) });
    await page.getByTestId('offline').waitFor();
    assert.match(await text(page), /Nothing was booked or charged/);
    await shot(page, 'offline-en');
    down = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByTestId('due').waitFor();
    await context.close();
  });

  it('paused: the club is paused, so the paused text shows and no quote is asked', async () => {
    const { page, context, bodies } = await open({ club: { nameTh: 'ฮันเตอร์', nameEn: 'Hunter', defaultLanguage: 'th', status: 'paused', liffId: 'liff-test', languages: ['th', 'en'], noticeVersion: 'v1' } });
    await page.getByTestId('paused').waitFor();
    assert.match(await text(page), /Online booking is paused/);
    assert.equal(bodies.quote.length, 0);
    await context.close();
  });

  it('R8-AC2 a taken slot: Pay is refused and the player goes back to pick again; nothing stays held', async () => {
    const { page, context } = await open({ payFor: () => ({ status: 409, json: { code: 'slot_unavailable', params: { by: 'other' } } }) });
    await page.getByTestId('due').waitFor();
    await page.getByTestId('pay').click();
    await page.getByTestId('refused').waitFor();
    assert.match(await text(page), /no longer available\. Nothing was booked or charged/);
    await shot(page, 'taken-en');
    await page.getByRole('button', { name: 'Back to courts' }).click();
    await page.waitForURL('**/book');
    await context.close();
  });

  it('a made up address (not a whole run of hours) is the bad choice state and asks for no quote', async () => {
    const { page, context, bodies } = await open({ address: `/c/hunter/checkout?court=2&courtId=nope&date=2027-01-09&from=18:00&to=19:00` });
    await page.getByTestId('bad-choice').waitFor();
    assert.equal(bodies.quote.length, 0);
    await context.close();
  });

  it('R8-AC4 a guest signs in first and comes back to the same address', async () => {
    const { page, context } = await open({ asGuest: true });
    await page.waitForURL('**/sign-in?next=*');
    assert.ok(decodeURIComponent(page.url()).includes('/checkout?court=2'));
    await context.close();
  });
});

describe('layout at 320 px in both languages (CC-5)', () => {
  for (const lang of ['th', 'en']) {
    it(`${lang}: no sideways scroll, no clipped or wrapped button, with the longest names`, async () => {
      const longCoach = [{ coachId: COACH, displayName: 'ปรียาภรณ์ ศรีสุขเจริญพรสวัสดิ์ Priyaporn Srisukcharoenpornsawat', tier: { nameTh: 'หัวหน้าโค้ชระดับแข่งขันนานาชาติ', nameEn: 'Head Coach of international competition' }, priceSatang: 123456 }];
      const { page, context } = await open({ lang, width: 320 });
      await page.route('**/api/c/hunter/coaches/offerable**', (r) => r.fulfill({ status: 200, json: longCoach }));
      await page.reload();
      await page.getByTestId('due').waitFor();
      await page.getByTestId('coach').first().waitFor();
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(wide <= 0, `page scrolls sideways by ${wide}px`);
      const pay = page.getByTestId('pay');
      const box = await pay.boundingBox();
      const lines = await pay.locator('span').evaluate((e) => { const r = document.createRange(); r.selectNodeContents(e); return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size; });
      assert.ok(box && box.width <= 320, 'pay button fits');
      assert.ok(lines <= 1, `pay label wraps into ${lines} lines`);
      await shot(page, `320-${lang}`);
      await context.close();
    });
  }
});
