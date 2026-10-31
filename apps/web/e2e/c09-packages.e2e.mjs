// F06-T17 C9 Packages: PKG-02-AC7 to AC9, D173, CC-5 (longest strings at 320 px, Thai and English).
// Run: node --test --test-concurrency=1 apps/web/e2e/c09-packages.e2e.mjs  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { chromium, openPage, SHOTS, startApp } from './harness.mjs';

const guest = { inClient: false, loggedIn: false, idToken: 'id-token', language: 'th' };
const LONG_EN = 'Court hours bundle for weekday mornings, weekend evenings and the holiday season with every court';
const LONG_TH = 'แพ็กเกจชั่วโมงคอร์ตสำหรับช่วงเช้าวันธรรมดา ช่วงเย็นวันหยุดสุดสัปดาห์ และช่วงเทศกาลวันหยุดยาวทุกคอร์ต';
const none = { coachTierId: null, priceGroupId: null, priceGroupNameTh: null, priceGroupNameEn: null };
const PRODUCTS = [
  { ...none, productId: 'p-10', nameTh: 'แพ็กเกจ 10 ชั่วโมง', nameEn: '10 hour bundle', creditType: 'court_hour', credits: 10, validityMonths: 3, priceSatang: 450000, pricePerCreditSatang: 45000, savingSatang: 50000 },
  { ...none, productId: 'p-long', nameTh: LONG_TH, nameEn: LONG_EN, creditType: 'court_hour', credits: 20, validityMonths: 5, priceSatang: 12800000, pricePerCreditSatang: 640000, savingSatang: 1234500 },
  { ...none, productId: 'p-solo', nameTh: 'แพ็ก 8 คลาส', nameEn: '8 class pack', creditType: 'solo_class', credits: 8, validityMonths: 3, priceSatang: 560000, pricePerCreditSatang: 70000, savingSatang: 80000, coachTierId: 't', priceGroupId: 'a', priceGroupNameTh: 'ผู้ใหญ่', priceGroupNameEn: 'Adult' },
  { ...none, productId: 'p-grp', nameTh: 'แพ็กคลาสกลุ่ม 8 ครั้ง', nameEn: 'Group 8 session pack', creditType: 'group_session', credits: 8, validityMonths: 3, priceSatang: 320000, pricePerCreditSatang: 40000, savingSatang: null, priceGroupId: 's', priceGroupNameTh: 'นักเรียนและเยาวชนอายุต่ำกว่า 18 ปี', priceGroupNameEn: 'Students and juniors under 18' },
];

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

async function open(lang, { width = 375, height = 812, products = PRODUCTS, query = '' } = {}) {
  const o = await openPage(browser, { liff: guest, lang, me: null, width, height });
  await o.page.route('**/api/c/hunter/packages', (r) => (products === 'offline' ? r.abort('internetdisconnected') : r.fulfill({ status: 200, json: products })));
  await o.page.goto(`${app.base}/c/hunter/packages${query}`);
  return o;
}

describe('C9 Packages', () => {
  it('a guest sees the court bundles with price, price an hour and saving; the tabs switch and keep the address', async () => {
    for (const lang of ['th', 'en']) {
      const { page, context, calls } = await open(lang);
      await page.getByTestId('panel-court').waitFor();
      assert.equal(await page.getByTestId('product').count(), 2);
      const first = await page.getByTestId('product').first().innerText();
      assert.match(first, lang === 'en' ? /฿4,500[\s\S]*฿450 an hour[\s\S]*Save ฿500/ : /฿4,500[\s\S]*ชั่วโมงละ ฿450[\s\S]*ประหยัด ฿500/);
      assert.equal(await page.getByTestId('buy').first().getAttribute('href'), '/c/hunter/packages/p-10');
      await page.screenshot({ path: join(SHOTS, `C9-court-${lang}.png`) });
      await page.getByTestId('tab-group').click();
      await page.getByTestId('panel-group').waitFor();
      assert.equal(new URL(page.url()).searchParams.get('tab'), 'group');
      assert.equal(await page.getByTestId('saving').count(), 0);
      await page.getByTestId('tab-solo').click();
      assert.equal(await page.getByTestId('product').count(), 1);
      assert.deepEqual(calls.filter((c) => c.method !== 'GET'), []);
      await context.close();
    }
  });

  it('?tab=group opens Group classes; offline shows the retry state', async () => {
    const { page, context } = await open('en', { query: '?tab=group' });
    await page.getByTestId('panel-group').waitFor();
    await context.close();
    const off = await open('th', { products: 'offline' });
    await off.page.getByTestId('offline').waitFor();
    await off.context.close();
  });

  it('CC-5: at 320 px with the longest strings nothing scrolls sideways, Buy and the tabs stay on one line', async () => {
    for (const lang of ['th', 'en']) {
      for (const tab of ['court', 'group']) {
        const { page, context } = await open(lang, { width: 320, height: 568, query: tab === 'court' ? '' : `?tab=${tab}` });
        await page.getByTestId(`panel-${tab}`).waitFor();
        await page.evaluate(() => document.fonts.ready);
        const r = await page.evaluate(() => {
          const oneLine = (el) => {
            const s = el.querySelector('span') ?? el;
            const lh = parseFloat(getComputedStyle(s).lineHeight) || parseFloat(getComputedStyle(s).fontSize) * 1.6;
            return Math.round(s.getBoundingClientRect().height / lh) === 1;
          };
          const cards = [...document.querySelectorAll('[data-testid=product]')];
          return {
            sideways: document.documentElement.scrollWidth > window.innerWidth,
            cardsFit: cards.every((c) => c.getBoundingClientRect().right <= window.innerWidth && c.scrollWidth <= c.clientWidth),
            buyOneLine: [...document.querySelectorAll('[data-testid=buy]')].every(oneLine),
            tabsOneLine: [...document.querySelectorAll('.pk-tab')].every(oneLine),
            pricesOneLine: [...document.querySelectorAll('.pk-price, .pk-save')].every(oneLine),
            navVisible: document.querySelector('.bottom-nav').getBoundingClientRect().bottom <= window.innerHeight,
            bodyScrolls: getComputedStyle(document.querySelector('.pk-body')).overflowY === 'auto',
            tabInView: (() => { const b = document.querySelector('.pk-tab[aria-selected=true]').getBoundingClientRect(); return b.left >= 0 && b.right <= window.innerWidth; })(),
            groupWhole: [...document.querySelectorAll('[data-testid=group]')].every((g) => g.scrollWidth <= g.clientWidth),
          };
        });
        assert.deepEqual(r, { sideways: false, cardsFit: true, buyOneLine: true, tabsOneLine: true, pricesOneLine: true, navVisible: true, bodyScrolls: true, tabInView: true, groupWhole: true }, `${lang} ${tab}`);
        await page.screenshot({ path: join(SHOTS, `C9-${tab}-320-${lang}.png`), fullPage: true });
        await context.close();
      }
    }
  });
});
