// F11-T14 A02c Sell a package (ADMIN-04): choose a package, sell by PromptPay QR (the page waits until paid) or for cash with a reason; Thai and English at 1280
// and 375 px (CC-5). The API is faked in the browser; no database.
// Run: node --test --test-concurrency=1 'apps/web/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { SHOTS } from './harness.mjs';
import { chromium, noSideways, openAdmin, startApp } from './admin-harness.mjs';

let app;
let browser;
before(async () => {
  app = await startApp(3124);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

const ID = '00000000-0000-4000-8000-0000000000c1';
const url = `/c/hunter/admin/customers/${ID}/sell-package`;
const PROFILE = { customerId: ID, displayName: 'Ploy', fullName: 'Ploy Srisuk', phone: '+66812345678', language: 'th', level: null, dateOfBirth: '1994-03-14', claimState: null, signedIn: true, active: true, tags: [], createdAt: '2026-12-01T03:00:00Z' };
const PRODUCTS = [
  { productId: 'p1', nameTh: 'แพ็ก 10 ชั่วโมง', nameEn: '10 hour bundle', creditType: 'court_hour', credits: 10, validityMonths: 3, priceGroupId: null, coachTierId: null, priceSatang: 450000, pricePerCreditSatang: 45000, savingSatang: 50000 },
  { productId: 'p2', nameTh: 'คลาสเดี่ยว 5 ครั้ง', nameEn: 'Solo 5 pack', creditType: 'solo_class', credits: 5, validityMonths: 2, priceGroupId: 'g1', coachTierId: 't1', priceSatang: 400000, pricePerCreditSatang: 80000, savingSatang: null },
];
const QUOTE = { priceGroupId: 'g1', lines: [{ netSatang: 450000 }], subtotalSatang: 450000, discountSatang: 0, totalSatang: 450000, walletSatang: 50000, moneySatang: 400000, quoteHash: 'a'.repeat(64) };
const P = `/staff/customers/${ID}`;

function server(state = {}) {
  const s = { products: PRODUCTS, orderStatus: 'open', ...state };
  return (method, path, search, body) => {
    if (path === P) return { status: 200, body: PROFILE };
    if (path === `${P}/bookings` || path === `${P}/orders` || path === `${P}/notes`) return { status: 200, body: [] };
    if (path === '/packages') return { status: 200, body: s.products };
    if (path === '/staff/orders/package/quote') return s.quote ?? { status: 200, body: QUOTE };
    if (path === '/staff/orders/package/pay') return s.pay ?? { status: 200, body: { orderId: 'o1', confirmed: false, payment: { id: 'pay1', amountSatang: 400000, qrImageBase64: 'iVBORw0KGgo=', qrExpiresAt: '2027-01-12T03:30:00Z' } } };
    if (path === '/orders/o1') return { status: 200, body: { status: s.orderStatus } };
    if (path === `${P}/package-sale`) return s.cash ?? { status: 200, body: { orderId: 'o2', paymentId: 'x', cashSatang: 400000, walletSatang: 50000 } };
    return undefined;
  };
}
const open = (api, o) => openAdmin(browser, api, o);

describe('A02c Sell a package', () => {
  it('lists the club\'s packages by kind with hours, validity and price per hour; the customer is named; nothing is chosen for the desk', async () => {
    const { page, context } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('sell').waitFor();
    assert.match(await page.getByTestId('sell-for').innerText(), /At the counter for Ploy Srisuk/);
    assert.match(await page.getByTestId('sell-group-court_hour').innerText(), /10 hour bundle/);
    assert.match(await page.getByTestId('sell-group-court_hour').innerText(), /10 court hours · valid 3 months · ฿450 an hour/);
    assert.match(await page.getByTestId('sell-group-solo_class').innerText(), /Solo 5 pack/);
    assert.equal(await page.getByTestId('product-p1').isChecked(), false);
    assert.equal(await page.getByTestId('sell-go').isDisabled(), true);
    assert.equal(await page.getByTestId('sell-back').getAttribute('href'), `/c/hunter/admin/customers/${ID}`);
    await page.screenshot({ path: join(SHOTS, 'admin-sell.png'), fullPage: true });
    await context.close();
  });

  it('by QR: it quotes, pays by the quote hash with an Idempotency-Key, shows the QR and its expiry, and says when the order is paid', async () => {
    const api = server();
    const { page, context, calls } = await open((...a) => api(...a));
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('product-p1').check();
    await page.getByTestId('sell-go').click();
    await page.getByTestId('sell-qr').waitFor();
    assert.match(await page.getByTestId('sell-qr').innerText(), /฿4,000/);
    assert.match(await page.getByTestId('sell-qr').innerText(), /Waiting for payment/);
    assert.match(await page.getByTestId('sell-qr-img').getAttribute('src'), /^data:image\/png;base64,iVBOR/);
    assert.deepEqual(calls.find((c) => c.path === '/staff/orders/package/quote').body, { customerId: ID, productId: 'p1' });
    const pay = calls.find((c) => c.path === '/staff/orders/package/pay');
    assert.deepEqual(pay.body, { customerId: ID, productId: 'p1', quoteHash: 'a'.repeat(64) });
    assert.match(pay.key ?? '', /^[\x21-\x7e]{8,200}$/);
    await context.close();
  });

  it('the QR page polls the order and shows Paid; an order that ended says nothing was sold and offers to start again', async () => {
    const paid = server({ orderStatus: 'paid' });
    const a = await open(paid);
    await a.page.goto(`${app.base}${url}`);
    await a.page.getByTestId('product-p1').check();
    await a.page.getByTestId('sell-go').click();
    await a.page.getByTestId('sell-done-msg').waitFor({ timeout: 10000 });
    assert.match(await a.page.getByTestId('sell-done-msg').innerText(), /Paid\. The package is now/);
    await a.context.close();
    const ended = server({ orderStatus: 'released' });
    const b = await open(ended);
    await b.page.goto(`${app.base}${url}`);
    await b.page.getByTestId('product-p1').check();
    await b.page.getByTestId('sell-go').click();
    await b.page.getByTestId('sell-again').waitFor({ timeout: 10000 });
    assert.match(await b.page.getByTestId('sell-qr').innerText(), /Nothing was sold/);
    await b.context.close();
  });

  it('for cash: a reason is needed first (and a note for Other); the sale is sent with its key and the amounts are said', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('product-p1').check();
    await page.getByTestId('method-cash').check();
    await page.getByTestId('sell-go').click();
    await page.getByTestId('sell-err').waitFor();
    assert.equal(calls.filter((c) => c.path.endsWith('/package-sale')).length, 0);
    await page.getByTestId('cash-reason').selectOption('other');
    await page.getByTestId('sell-go').click();
    await page.waitForFunction(() => /note/i.test(document.querySelector('[data-testid="sell-err"]')?.textContent ?? ''));
    await page.getByTestId('cash-note').fill('Card machine down');
    await page.getByTestId('sell-go').click();
    await page.getByTestId('sell-done-msg').waitFor();
    assert.match(await page.getByTestId('sell-done-msg').innerText(), /Cash taken ฿4,000, wallet used ฿500/);
    const sale = calls.find((c) => c.path.endsWith('/package-sale'));
    assert.deepEqual(sale.body, { productId: 'p1', reasonCode: 'other', note: 'Card machine down' });
    assert.match(sale.key ?? '', /^[\x21-\x7e]{8,200}$/);
    await context.close();
  });

  it('a refusal is named (not for this customer, QR could not be made); an unknown customer and a lost network have their own states', async () => {
    const a = await open(server({ quote: { status: 400, body: { code: 'selection_invalid' } } }));
    await a.page.goto(`${app.base}${url}`);
    await a.page.getByTestId('product-p2').check();
    await a.page.getByTestId('sell-go').click();
    await a.page.waitForFunction(() => /not for this customer/.test(document.querySelector('[data-testid="sell-err"]')?.textContent ?? ''));
    await a.context.close();
    const b = await open(server({ pay: { status: 503, body: { code: 'payment_unavailable' } } }));
    await b.page.goto(`${app.base}${url}`);
    await b.page.getByTestId('product-p1').check();
    await b.page.getByTestId('sell-go').click();
    await b.page.waitForFunction(() => /QR could not be made/.test(document.querySelector('[data-testid="sell-err"]')?.textContent ?? ''));
    await b.context.close();
    const c = await open(() => ({ status: 404, body: { code: 'not_found' } }));
    await c.page.goto(`${app.base}${url}`);
    await c.page.getByTestId('sell-missing').waitFor();
    await c.context.close();
    const d = await open(() => 'offline');
    await d.page.goto(`${app.base}${url}`);
    await d.page.getByTestId('sell-error').waitFor();
    await d.context.close();
  });

  for (const lang of ['th', 'en']) {
    for (const width of [1280, 375]) {
      it(`${lang} at ${width}px: no sideways scroll with long package names and the QR`, async () => {
        const long = 'แพ็กเกจเหมาชั่วโมงสนามพิเศษช่วงเปิดตัวสำหรับสมาชิกผู้ใหญ่ Soft opening special bundle for all adult members of the club';
        const { page, context } = await open(server({ products: [{ ...PRODUCTS[0], nameTh: long, nameEn: long }, PRODUCTS[1]] }), { lang, width });
        await page.goto(`${app.base}${url}`);
        await page.getByTestId('sell').waitFor();
        assert.equal(await noSideways(page), true);
        await page.getByTestId('method-cash').check();
        assert.equal(await noSideways(page), true);
        await page.getByTestId('method-qr').check();
        await page.getByTestId('product-p1').check();
        await page.getByTestId('sell-go').click();
        await page.getByTestId('sell-qr').waitFor();
        assert.equal(await noSideways(page), true);
        await page.screenshot({ path: join(SHOTS, `admin-sell-${lang}-${width}.png`), fullPage: true });
        await context.close();
      });
    }
  }
});
