// F11-T18 A9 Products and pricing, A9b Price groups and add-ons (ADMIN-10, ADMIN-11): the court rate, bundles, solo and group packages, coach tiers and their
// prices, price groups by age, add-ons; an unset price stays an empty box; only the owner; Thai and English at 1280 and 375 px (CC-5). The API is faked.
// Run: node --test --test-concurrency=1 'apps/web/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { SHOTS } from './harness.mjs';
import { chromium, noSideways, openAdmin, startApp } from './admin-harness.mjs';

let app;
let browser;
before(async () => {
  app = await startApp(3121);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

const url = '/c/hunter/admin/pricing';
const ADULT = { id: 'g1', nameTh: 'ผู้ใหญ่', nameEn: 'Adult', rule: { min_age: 18 }, position: 0 };
const STUDENT = { id: 'g2', nameTh: 'นักเรียน', nameEn: 'Student', rule: { max_age: 17 }, position: 1 };
const TIER = { id: 't1', nameTh: 'โค้ชหลัก', nameEn: 'Head Coach' };
const BUNDLE = { id: 'p1', nameTh: 'แพ็ก 10 ชั่วโมง', nameEn: '10 hour bundle', creditType: 'court_hour', credits: 10, validityMonths: 3, priceGroupId: null, coachTierId: null, priceSatang: null, active: true };
const ADDON = { id: 'a1', nameTh: 'ลูกเทนนิส', nameEn: 'Balls', priceSatang: null, active: true, position: 0 };

function server(over = {}) {
  const s = { groups: [ADULT, STUDENT], rules: [], tiers: [TIER], tierPrices: [], products: [BUNDLE], addOns: [ADDON], deleteGroup: undefined, ...over };
  return (method, path, search, body) => {
    const m = /^\/staff\/setup\/([a-z-]+)(?:\/([^/]+))?$/.exec(path);
    if (!m) return undefined;
    const [, res, id] = m;
    const lists = { 'price-groups': s.groups, 'court-prices': s.rules, 'coach-tiers': s.tiers, 'coach-tier-prices': s.tierPrices, 'package-products': s.products, 'add-ons': s.addOns };
    if (!lists[res]) return undefined;
    if (method === 'GET') return { status: 200, body: lists[res] };
    if (method === 'DELETE' && res === 'price-groups' && s.deleteGroup) return s.deleteGroup;
    return { status: 200, body: { id: id ?? 'new', ...body } };
  };
}
const open = (api, o) => openAdmin(browser, api, o);
const puts = (calls, re) => calls.filter((c) => c.method !== 'GET' && re.test(c.path));

describe('A9 Products and pricing', () => {
  it('draws the board tabs; the court rate and an unset bundle price are empty boxes, nothing is shown as a default', async () => {
    const { page, context } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('pricing-page').waitFor();
    assert.match(await page.getByTestId('pricing-page').innerText(), /Changes only affect new purchases/);
    assert.equal(await page.getByTestId('rate-in-g1').inputValue(), '');
    assert.equal(await page.getByTestId('rate-in-g2').inputValue(), '');
    assert.equal(await page.getByTestId('p-p1-price').inputValue(), '');
    assert.equal(await page.getByTestId('nav-pricing').getAttribute('aria-current'), 'page');
    assert.equal(await page.getByTestId('per-hour-p1').count(), 0);
    await page.screenshot({ path: join(SHOTS, 'admin-pricing.png'), fullPage: true });
    await context.close();
  });

  it('sets the court rate in baht as integer satang; a wrong amount is refused before the server', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('rate-in-g1').fill('12.345');
    await page.getByTestId('rate-save-g1').click();
    await page.getByTestId('price-msg').waitFor();
    assert.equal(puts(calls, /court-prices/).length, 0);
    await page.getByTestId('rate-in-g1').fill('300');
    await page.getByTestId('rate-save-g1').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="price-msg"]')?.getAttribute('role') === 'status');
    const c = puts(calls, /court-prices/)[0];
    assert.deepEqual([c.method, c.body], ['POST', { priceGroupId: 'g1', priceSatang: 30000 }]);
    await context.close();
  });

  it('a bundle shows its price per hour once priced; adding one needs both names; the kind and price go to the server', async () => {
    const api = server({ products: [{ ...BUNDLE, priceSatang: 450000 }] });
    const { page, context, calls } = await open(api);
    await page.goto(`${app.base}${url}`);
    assert.match(await page.getByTestId('per-hour-p1').innerText(), /฿450/);
    await page.getByTestId('new-court_hour-add').click();
    await page.getByTestId('product-new-court_hour').getByTestId('price-msg').waitFor();
    assert.equal(puts(calls, /package-products/).length, 0);
    await page.getByTestId('new-court_hour-nameTh').fill('แพ็ก 5');
    await page.getByTestId('new-court_hour-nameEn').fill('5 hour bundle');
    await page.getByTestId('new-court_hour-credits').fill('5');
    await page.getByTestId('new-court_hour-months').fill('2');
    await page.getByTestId('new-court_hour-add').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="product-new-court_hour"] [data-testid="price-msg"]')?.getAttribute('role') === 'status');
    const c = puts(calls, /package-products/)[0];
    assert.deepEqual([c.method, c.body], ['POST', { nameTh: 'แพ็ก 5', nameEn: '5 hour bundle', creditType: 'court_hour', credits: 5, validityMonths: 2, active: true }]);
    await context.close();
  });

  it('solo class packages need a price group and a coach tier; the coaching price per tier and group is set or cleared', async () => {
    const api = server({ tierPrices: [{ tierId: 't1', priceGroupId: 'g1', priceSatang: 90000 }] });
    const { page, context, calls } = await open(api);
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('tab-solo').click();
    assert.equal(await page.getByTestId('tp-in-t1-g1').inputValue(), '900');
    assert.equal(await page.getByTestId('tp-in-t1-g2').inputValue(), '');
    await page.getByTestId('tp-in-t1-g1').fill('');
    await page.getByTestId('tp-save-t1-g1').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="price-tier-prices"] [data-testid="price-msg"]'));
    assert.deepEqual(puts(calls, /coach-tier-prices/)[0].body, { tierId: 't1', priceGroupId: 'g1', priceSatang: null });
    await page.getByTestId('new-solo_class-nameTh').fill('ก');
    await page.getByTestId('new-solo_class-nameEn').fill('A');
    await page.getByTestId('new-solo_class-credits').fill('5');
    await page.getByTestId('new-solo_class-months').fill('3');
    await page.getByTestId('new-solo_class-add').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="product-new-solo_class"] [data-testid="price-msg"]')?.getAttribute('role') === 'alert');
    await page.getByTestId('new-solo_class-group').selectOption('g1');
    await page.getByTestId('new-solo_class-tier').selectOption('t1');
    await page.getByTestId('new-solo_class-add').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="product-new-solo_class"] [data-testid="price-msg"]')?.getAttribute('role') === 'status');
    assert.deepEqual(puts(calls, /package-products/)[0].body, { nameTh: 'ก', nameEn: 'A', creditType: 'solo_class', credits: 5, validityMonths: 3, priceGroupId: 'g1', coachTierId: 't1', active: true });
    await context.close();
  });

  it('the court part of a solo class is the group\'s court rate, shown read only with the coaching + court preview and a link to the court prices', async () => {
    const api = server({ rules: [{ id: 'r1', priceGroupId: 'g1', dayType: 'any', peak: 'any', priceSatang: 30000 }], tierPrices: [{ tierId: 't1', priceGroupId: 'g1', priceSatang: 90000 }] });
    const { page, context } = await open(api);
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('tab-solo').click();
    const t = await page.getByTestId('price-court-part').innerText();
    assert.match(t, /Adult · ฿300/);
    assert.match(await page.getByTestId('preview-t1-g1').innerText(), /฿900 \+ ฿300/);
    assert.match(await page.getByTestId('part-g2').innerText(), /Student · Not set/);
    assert.match(await page.getByTestId('preview-t1-g2').innerText(), /Not set yet/);
    await page.getByTestId('part-go').click();
    await page.getByTestId('price-court-rate').waitFor();
    await context.close();
  });

  it('coach tiers can be added and deleted; a delete the server refuses as in use says so', async () => {
    const api = (m, p, s, b) => (m === 'DELETE' && p === '/staff/setup/coach-tiers/t1' ? { status: 409, body: { code: 'in_use' } } : server()(m, p, s, b));
    const { page, context, calls } = await open(api);
    page.on('dialog', (d) => void d.accept());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('tab-tiers').click();
    await page.getByTestId('t-t1-delete').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="tier-t1"] [data-testid="price-msg"]')?.getAttribute('role') === 'alert');
    assert.match(await page.getByTestId('tier-t1').getByTestId('price-msg').innerText(), /still used/);
    await page.getByTestId('new-tier-nameTh').fill('โค้ช');
    await page.getByTestId('new-tier-nameEn').fill('Coach');
    await page.getByTestId('new-tier-add').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="tier-new"] [data-testid="price-msg"]')?.getAttribute('role') === 'status');
    assert.deepEqual(puts(calls, /coach-tiers$/)[0].body, { nameTh: 'โค้ช', nameEn: 'Coach' });
    await context.close();
  });
});

describe('A9b Price groups and add-ons', () => {
  it('a group is saved with its age rule and changes only what changed; an add-on with no price stays empty and sends none', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('tab-groups').click();
    assert.equal(await page.getByTestId('g-g1-minAge').inputValue(), '18');
    assert.equal(await page.getByTestId('a-a1-price').inputValue(), '');
    await page.getByTestId('g-g1-maxAge').fill('60');
    await page.getByTestId('g-g1-save').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="group-g1"] [data-testid="price-msg"]')?.getAttribute('role') === 'status');
    assert.deepEqual(puts(calls, /price-groups\/g1/)[0].body, { rule: { min_age: 18, max_age: 60 } });
    await page.getByTestId('new-addon-nameTh').fill('ไม้');
    await page.getByTestId('new-addon-nameEn').fill('Racket');
    await page.getByTestId('new-addon-add').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="addon-new"] [data-testid="price-msg"]')?.getAttribute('role') === 'status');
    assert.deepEqual(puts(calls, /add-ons$/)[0].body, { nameTh: 'ไม้', nameEn: 'Racket', active: true });
    await page.getByTestId('new-group-nameTh').fill('เด็ก');
    await page.getByTestId('new-group-nameEn').fill('Kid');
    await page.getByTestId('new-group-add').click();
    await page.getByTestId('group-new').getByTestId('price-msg').waitFor();
    assert.equal(puts(calls, /price-groups$/).length, 0);
    await context.close();
  });
});

describe('A9 states and layout', () => {
  it('a refused role and a lost network have their own states', async () => {
    const no = await open(() => ({ status: 403, body: { code: 'forbidden' } }));
    await no.page.goto(`${app.base}${url}`);
    await no.page.getByTestId('price-forbidden').waitFor();
    await no.context.close();
    let up = false;
    const flaky = await open((...a) => (up ? server()(...a) : 'offline'));
    await flaky.page.goto(`${app.base}${url}`);
    await flaky.page.getByTestId('price-error').waitFor();
    up = true;
    await flaky.page.getByTestId('price-error').getByRole('button').click();
    await flaky.page.getByTestId('pricing-page').waitFor();
    await flaky.context.close();
  });

  for (const lang of ['th', 'en']) {
    for (const width of [1280, 375]) {
      it(`${lang} at ${width}px: every tab, no sideways scroll, long names survive`, async () => {
        const long = 'แพ็กเกจเหมาชั่วโมงสนามพิเศษช่วงเปิดตัวสำหรับสมาชิกผู้ใหญ่และนักเรียนทุกระดับชั้นประจำปีการศึกษา Soft opening special bundle for all adult members';
        const api = server({ products: [{ ...BUNDLE, nameTh: long, nameEn: long, priceSatang: 450000 }], addOns: [{ ...ADDON, nameTh: long, nameEn: long }] });
        const { page, context } = await open(api, { lang, width });
        await page.goto(`${app.base}${url}`);
        await page.getByTestId('pricing-page').waitFor();
        for (const tab of ['courts', 'solo', 'group', 'tiers', 'groups']) {
          await page.getByTestId(`tab-${tab}`).click();
          assert.equal(await noSideways(page), true, tab);
        }
        await page.getByTestId('tab-courts').click();
        await page.screenshot({ path: join(SHOTS, `admin-pricing-${lang}-${width}.png`), fullPage: true });
        await context.close();
      });
    }
  }
});
