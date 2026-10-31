// F11-T14 A02 Booking create and A02b Booking detail (ADMIN-04): pick a customer who has signed in, the court and hours from the calendar's click, quote, sell by QR
// (waits until paid) or confirm; a changed price asks again; the detail shows status, amounts, history and lets a hold go; Thai and English at 1280 and 375 px (CC-5).
// The API is faked in the browser; no database. Run: node --test --test-concurrency=1 'apps/web/e2e/*.e2e.mjs'  (one next dev at a time).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { SHOTS } from './harness.mjs';
import { chromium, noSideways, openAdmin, startApp } from './admin-harness.mjs';

let app;
let browser;
before(async () => {
  app = await startApp(3125);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

const COURTS = { status: 'live', today: '2027-01-18', bookingWindowDays: 14, courts: [{ id: 'k1', name: '1', sport: 'tennis' }, { id: 'k2', name: '2', sport: 'tennis' }], openingHours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, open: '08:00', close: '22:00' })) };
const CUSTOMERS = [
  { customerId: 'c1', name: 'Ploy Srisuk', phone: '+66812345678', claimState: null, signedIn: true },
  { customerId: 'c2', name: 'Walk In Wan', phone: '+66899999999', claimState: 'unclaimed', signedIn: false },
];
const QUOTE = { lines: [{ position: 1, kind: 'court_hour', hourIndex: 0, startsAt: '2027-01-18T02:00:00.000Z', addOnId: null, unitPriceSatang: 30000, discountSatang: 0, netSatang: 30000 }, { position: 2, kind: 'add_on', hourIndex: 0, startsAt: '2027-01-18T02:00:00.000Z', addOnId: 'a1', unitPriceSatang: 5000, discountSatang: 0, netSatang: 5000 }],
  subtotalSatang: 35000, discountSatang: 0, totalSatang: 35000, creditValueSatang: 0, walletSatang: 5000, moneySatang: 30000, quoteHash: 'b'.repeat(64), codeNotApplied: false, cancelWindowHours: 24 };
const START = '2027-01-18T09:00:00+07:00';
const url = `/c/hunter/admin/bookings/new?court=k1&start=${encodeURIComponent(START)}`;

function server(state = {}) {
  const s = { orderStatus: 'open', ...state };
  return (method, path, search, body) => {
    if (path === '/courts') return { status: 200, body: COURTS };
    if (path === '/staff/setup/add-ons') return { status: 200, body: [{ id: 'a1', nameTh: 'ลูกเทนนิส', nameEn: 'Balls', priceSatang: 5000, active: true }] };
    if (path === '/staff/customers') return { status: 200, body: { customers: search.includes('zzz') ? [] : CUSTOMERS, next: null } };
    if (path === '/staff/orders/quote') return s.quote ?? { status: 200, body: QUOTE };
    if (path === '/staff/orders/pay') return s.pay ?? { status: 200, body: { orderId: 'o1', holdExpiresAt: '2027-01-18T01:10:00Z', confirmed: false, payment: { id: 'p1', amountSatang: 30000, qrImageBase64: 'iVBORw0KGgo=', qrExpiresAt: '2027-01-18T01:10:00Z' } } };
    if (path === '/orders/o1') return { status: 200, body: { status: s.orderStatus } };
    return undefined;
  };
}
const open = (api, o) => openAdmin(browser, api, o);
const hit = async (page) => {
  await page.getByTestId('book-search').fill('ploy');
  await page.getByTestId('hit-c1').click();
};

describe('A02 Booking create', () => {
  it('takes the court and hour from the calendar click; only a customer who has signed in can be chosen; Check price is off until a customer is chosen', async () => {
    const { page, context } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('book').waitFor();
    assert.equal(await page.getByTestId('book-court').inputValue(), 'k1');
    assert.match(await page.getByTestId('book-when').innerText(), /18 January 2027 · 09:00/);
    assert.equal(await page.getByTestId('book-quote-btn').isDisabled(), true);
    await page.getByTestId('book-search').fill('wan');
    await page.getByTestId('book-hits').waitFor();
    assert.equal(await page.getByTestId('hit-c2').isDisabled(), true);
    assert.match(await page.getByTestId('book-hits').innerText(), /Has not signed in yet/);
    await page.getByTestId('hit-c1').click();
    assert.match(await page.getByTestId('book-chosen').innerText(), /Ploy Srisuk · \+66812345678/);
    assert.equal(await page.getByTestId('book-quote-btn').isDisabled(), false);
    await page.screenshot({ path: join(SHOTS, 'admin-booking.png'), fullPage: true });
    await context.close();
  });

  it('with no start in the address it says to pick an empty hour in the calendar', async () => {
    const { page, context } = await open(server());
    await page.goto(`${app.base}/c/hunter/admin/bookings/new`);
    await page.getByTestId('book-no-start').waitFor();
    assert.equal(await page.getByTestId('book-quote-btn').isDisabled(), true);
    await context.close();
  });

  it('hours can be added and removed; the quote sends choices only and shows the server\'s lines and totals; a change makes the quote stale', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await hit(page);
    await page.getByTestId('addon-a1').check();
    await page.getByTestId('book-code').fill('spring');
    await page.getByTestId('book-quote-btn').click();
    await page.getByTestId('book-quote').waitFor();
    const q = calls.find((c) => c.path === '/staff/orders/quote');
    assert.deepEqual(q.body, { customerId: 'c1', courtId: 'k1', hours: ['2027-01-18T02:00:00.000Z'], addOnIds: ['a1'], code: 'spring' });
    const t = await page.getByTestId('book-quote').innerText();
    assert.match(t, /฿350/);
    assert.match(t, /Paid from wallet: ฿50/);
    assert.match(await page.getByTestId('book-due').innerText(), /฿300/);
    assert.match(t, /Free cancellation up to 24 hours/);
    await page.getByTestId('book-more').click();
    assert.match(await page.getByTestId('book-when').innerText(), /09:00, 10:00/);
    assert.equal(await page.getByTestId('book-quote').count(), 0);
    assert.equal(await page.getByTestId('book-sell').isDisabled(), true);
    await context.close();
  });

  it('Sell places the order with the quote hash and a key, shows the QR and its hold, and says Paid when the order is paid', async () => {
    const { page, context, calls } = await open(server({ orderStatus: 'paid' }));
    await page.goto(`${app.base}${url}`);
    await hit(page);
    await page.getByTestId('book-quote-btn').click();
    await page.getByTestId('book-sell').click();
    await page.getByTestId('book-done-msg').waitFor({ timeout: 10000 });
    assert.match(await page.getByTestId('book-done-msg').innerText(), /Paid\. The booking is confirmed/);
    const pay = calls.find((c) => c.path === '/staff/orders/pay');
    assert.equal(pay.body.quoteHash, 'b'.repeat(64));
    assert.equal(pay.body.customerId, 'c1');
    assert.match(pay.key ?? '', /^[\x21-\x7e]{8,200}$/);
    await context.close();
  });

  it('the QR page shows the amount and waits; an ended hold says nothing was booked and starts again', async () => {
    const a = await open(server());
    await a.page.goto(`${app.base}${url}`);
    await hit(a.page);
    await a.page.getByTestId('book-quote-btn').click();
    await a.page.getByTestId('book-sell').click();
    await a.page.getByTestId('book-qr').waitFor();
    assert.match(await a.page.getByTestId('book-qr').innerText(), /฿300/);
    assert.match(await a.page.getByTestId('book-qr').innerText(), /Waiting for payment/);
    assert.match(await a.page.getByTestId('book-qr-img').getAttribute('src'), /^data:image\/png;base64,/);
    await a.context.close();
    const b = await open(server({ orderStatus: 'released' }));
    await b.page.goto(`${app.base}${url}`);
    await hit(b.page);
    await b.page.getByTestId('book-quote-btn').click();
    await b.page.getByTestId('book-sell').click();
    await b.page.getByTestId('book-again').waitFor({ timeout: 10000 });
    assert.match(await b.page.getByTestId('book-qr').innerText(), /Nothing was booked/);
    await b.context.close();
  });

  it('nothing to pay confirms at once; a changed price shows the new total and asks again', async () => {
    const free = await open(server({ quote: { status: 200, body: { ...QUOTE, moneySatang: 0, totalSatang: 35000, walletSatang: 35000 } }, pay: { status: 200, body: { orderId: 'o1', holdExpiresAt: null, confirmed: true, payment: null } } }));
    await free.page.goto(`${app.base}${url}`);
    await hit(free.page);
    await free.page.getByTestId('book-quote-btn').click();
    await free.page.getByTestId('book-quote').waitFor();
    assert.match(await free.page.getByTestId('book-sell').innerText(), /Confirm booking/);
    await free.page.getByTestId('book-sell').click();
    await free.page.getByTestId('book-done-msg').waitFor();
    assert.match(await free.page.getByTestId('book-done-msg').innerText(), /Nothing was left to pay/);
    await free.context.close();
    const changed = await open(server({ pay: { status: 200, body: { priceChanged: true, quote: { ...QUOTE, totalSatang: 40000, moneySatang: 35000, quoteHash: 'c'.repeat(64) } } } }));
    await changed.page.goto(`${app.base}${url}`);
    await hit(changed.page);
    await changed.page.getByTestId('book-quote-btn').click();
    await changed.page.getByTestId('book-sell').click();
    await changed.page.waitForFunction(() => /price changed/i.test(document.querySelector('[data-testid="book-err"]')?.textContent ?? ''));
    assert.match(await changed.page.getByTestId('book-due').innerText(), /฿350/);
    await changed.context.close();
  });

  it('refusals are named: slot taken, over the hour limit with its number, code, not for sale', async () => {
    const cases = [
      [{ status: 409, body: { code: 'slot_unavailable', params: { by: 'booking' } } }, /just taken/],
      [{ status: 409, body: { code: 'limit_reached', params: { hours: 4 } } }, /limit of 4 hours/],
      [{ status: 422, body: { code: 'code_expired' } }, /code cannot be used/],
    ];
    for (const [quote, re] of cases) {
      const { page, context } = await open(server({ quote }));
      await page.goto(`${app.base}${url}`);
      await hit(page);
      await page.getByTestId('book-quote-btn').click();
      await page.waitForFunction((r) => new RegExp(r).test(document.querySelector('[data-testid="book-err"]')?.textContent ?? ''), re.source);
      await context.close();
    }
  });

  for (const lang of ['th', 'en']) {
    for (const width of [1280, 375]) {
      it(`${lang} at ${width}px: no sideways scroll with a long customer name and the quote and QR`, async () => {
        const long = 'สมชาย ใจดีมากมายหลายประการ Somchai Jaidee-Wongsawat the Third of Bangkok';
        const api = (m, p, s, b) => (p === '/staff/customers' ? { status: 200, body: { customers: [{ ...CUSTOMERS[0], name: long }], next: null } } : server()(m, p, s, b));
        const { page, context } = await open(api, { lang, width });
        await page.goto(`${app.base}${url}`);
        await hit(page);
        await page.getByTestId('book-quote-btn').click();
        await page.getByTestId('book-quote').waitFor();
        assert.equal(await noSideways(page), true);
        await page.getByTestId('book-sell').click();
        await page.getByTestId('book-qr').waitFor();
        assert.equal(await noSideways(page), true);
        await page.screenshot({ path: join(SHOTS, `admin-booking-${lang}-${width}.png`), fullPage: true });
        await context.close();
      });
    }
  }
});

describe('A02b Booking detail', () => {
  const B = { id: 'b1', orderId: 'o1', type: 'court_hour', status: 'awaiting_payment', court: { id: 'k1', name: '1' }, start: '2027-01-18T02:00:00Z', end: '2027-01-18T03:00:00Z', holdExpiresAt: '2027-01-18T01:10:00Z', holdEnded: false };
  const HISTORY = [{ at: '2027-01-18T00:05:00Z', kind: 'audit', action: 'booking.moved', actor: 'Mali Desk', source: 'admin', reason: null, detail: { old: { start_at: 'a' }, new: { start_at: 'b' } }, piiFields: [] }, { at: '2027-01-17T10:00:00Z', kind: 'audit', action: 'booking.created', actor: null, source: 'player_app', reason: null, detail: { old: null, new: { status: 'awaiting_payment' } }, piiFields: ['phone'] }];
  const detail = (over = {}, rel) => (m, p) => {
    if (p === '/bookings/b1') return { status: 200, body: { ...B, ...over } };
    if (p === '/staff/bookings/b1/history') return { status: 200, body: HISTORY };
    if (p === '/orders/o1') return { status: 200, body: { status: 'open', subtotalSatang: 30000, discountSatang: 0, totalSatang: 30000, creditValueSatang: 0, walletSatang: 0, moneySatang: 30000 } };
    if (p === '/staff/bookings/b1/release') return rel ?? { status: 200, body: { orderId: 'o1', status: 'released' } };
    return undefined;
  };

  it('shows court, day and hour, the status with its hold, the amounts and the history with who changed what; a personal field is only named', async () => {
    const { page, context } = await open(detail());
    await page.goto(`${app.base}/c/hunter/admin/bookings/b1`);
    await page.getByTestId('bd').waitFor();
    assert.match(await page.locator('#bd-title').innerText(), /Court 1 · 18 January 2027 09:00–10:00/);
    assert.match(await page.getByTestId('bd-status').innerText(), /Awaiting payment/);
    assert.match(await page.getByTestId('bd-status').innerText(), /Held until 08:10/);
    assert.match(await page.getByTestId('bd-order').innerText(), /฿300/);
    const h = await page.getByTestId('bd-history').innerText();
    assert.match(h, /booking\.moved/);
    assert.match(h, /Mali Desk/);
    assert.match(h, /System/);
    assert.doesNotMatch(h, /\+668/);
    assert.equal(await page.getByTestId('bd-back').getAttribute('href'), '/c/hunter/admin/calendar');
    await context.close();
  });

  it('a hold waiting for payment can be let go after asking; a confirmed booking has no release; refusals and missing bookings have their own states', async () => {
    const a = await open(detail());
    a.page.on('dialog', (d) => void d.accept());
    await a.page.goto(`${app.base}/c/hunter/admin/bookings/b1`);
    await a.page.getByTestId('bd-release').click();
    await a.page.getByTestId('bd-msg').waitFor();
    assert.equal(a.calls.filter((c) => c.path === '/staff/bookings/b1/release').length, 1);
    await a.context.close();
    const b = await open(detail({ status: 'confirmed', holdExpiresAt: null }));
    await b.page.goto(`${app.base}/c/hunter/admin/bookings/b1`);
    await b.page.getByTestId('bd').waitFor();
    assert.equal(await b.page.getByTestId('bd-release').count(), 0);
    await b.context.close();
    const c = await open(detail({}, { status: 409, body: { code: 'not_releasable' } }));
    c.page.on('dialog', (d) => void d.accept());
    await c.page.goto(`${app.base}/c/hunter/admin/bookings/b1`);
    await c.page.getByTestId('bd-release').click();
    await c.page.waitForFunction(() => /cannot be released/.test(document.querySelector('[data-testid="bd-msg"]')?.textContent ?? ''));
    await c.context.close();
    const d = await open(() => ({ status: 404, body: { code: 'not_found' } }));
    await d.page.goto(`${app.base}/c/hunter/admin/bookings/b1`);
    await d.page.getByTestId('bd-missing').waitFor();
    await d.context.close();
  });

  for (const lang of ['th', 'en']) {
    it(`${lang} at 375px: no sideways scroll`, async () => {
      const { page, context } = await open(detail(), { lang, width: 375 });
      await page.goto(`${app.base}/c/hunter/admin/bookings/b1`);
      await page.getByTestId('bd').waitFor();
      assert.equal(await noSideways(page), true);
      await page.screenshot({ path: join(SHOTS, `admin-booking-detail-${lang}-375.png`), fullPage: true });
      await context.close();
    });
  }
});
