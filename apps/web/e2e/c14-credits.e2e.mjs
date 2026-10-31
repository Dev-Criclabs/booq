// F06-T18 C14 Credits and wallet: PKG-01-AC10, PKG-03-AC3, CC-5 (longest strings at 320 px, Thai and English).
// Run: node --test --test-concurrency=1 apps/web/e2e/c14-credits.e2e.mjs  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { chromium, openPage, SHOTS, startApp } from './harness.mjs';

const liff = { inClient: false, loggedIn: true, idToken: 'id-token', language: 'th', displayName: 'ploy.s' };
const me = () => ({ profile: { fullName: 'Ploy Srisuk', phone: '0812345678', dateOfBirth: '1994-03-14', level: null, language: 'en', priceGroup: 'adult' } });
const LONG_EN = 'Court hours bundle for weekday mornings, weekend evenings and the holiday season with every court';
const LONG_TH = 'แพ็กเกจชั่วโมงคอร์ตสำหรับช่วงเช้าวันธรรมดา ช่วงเย็นวันหยุดสุดสัปดาห์ และช่วงเทศกาลวันหยุดยาวทุกคอร์ต';
const CREDITS = {
  walletSatang: 123456789,
  packages: [
    { packageId: 'k1', nameTh: LONG_TH, nameEn: LONG_EN, creditType: 'court_hour', creditsLeft: 17, creditsTotal: 20, expiresAt: '2027-04-05T16:59:59.999Z', status: 'active' },
    { packageId: 'k2', nameTh: 'แพ็กคลาสกลุ่ม 8 ครั้ง', nameEn: 'Group 8 session pack', creditType: 'group_session', creditsLeft: 7, creditsTotal: 8, expiresAt: '2027-04-05T16:59:59.999Z', status: 'active' },
  ],
};
const entry = (id, at, reason, change, packageId = null) => ({ id, at, reason, change, packageId, bookingId: null, orderId: null });
const LEDGER = {
  credit: [
    { entries: [entry('c3', '2027-01-09T02:00:00Z', 'use', -1, 'k1'), entry('c2', '2027-01-06T02:00:00Z', 'import_transfer', 20, 'k1')], nextCursor: 'c-next' },
    { entries: [entry('c1', '2027-01-02T02:00:00Z', 'forfeit', -1, 'k2')], nextCursor: null },
  ],
  wallet: [{ entries: [entry('w2', '2027-01-08T02:14:00Z', 'duplicate_payment', 123456789), entry('w1', '2027-01-03T02:00:00Z', 'spend', -20000)], nextCursor: null }],
};

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

async function open(lang, { width = 375, height = 812, signedIn = true } = {}) {
  const o = await openPage(browser, { liff: signedIn ? liff : { ...liff, loggedIn: false }, lang, me: signedIn ? me() : null, width, height });
  await o.page.route('**/api/c/hunter/me/credits', (r) => r.fulfill({ status: 200, json: CREDITS }));
  await o.page.route('**/api/c/hunter/me/ledger**', (r) => {
    const q = new URL(r.request().url()).searchParams;
    const pages = LEDGER[q.get('kind')];
    return r.fulfill({ status: 200, json: q.get('cursor') ? pages[1] : pages[0] });
  });
  await o.page.goto(`${app.base}/c/hunter/credits`);
  return o;
}

describe('C14 Credits and wallet', () => {
  it('a guest is sent to sign in and back here', async () => {
    const { page, context } = await open('en', { signedIn: false });
    await page.waitForURL(/\/c\/hunter\/sign-in\?next=%2Fc%2Fhunter%2Fcredits/);
    await context.close();
  });

  it('the balance is the route’s; packages and both ledgers newest first; See full history loads the rest', async () => {
    for (const lang of ['th', 'en']) {
      const { page, context, calls } = await open(lang);
      await page.getByTestId('wallet').waitFor();
      assert.equal(await page.getByTestId('wallet-balance').innerText(), '฿1,234,567.89');
      assert.equal(await page.getByTestId('package').count(), 2);
      const reasons = async () => page.getByTestId('movement').evaluateAll((els) => els.map((e) => `${e.dataset.kind}:${e.dataset.reason}`));
      assert.deepEqual(await reasons(), ['credit:use', 'wallet:duplicate_payment', 'credit:import_transfer']);
      await page.getByTestId('more').click();
      await page.getByTestId('more').waitFor({ state: 'detached' });
      assert.deepEqual(await reasons(), ['credit:use', 'wallet:duplicate_payment', 'credit:import_transfer', 'wallet:spend', 'credit:forfeit']);
      assert.deepEqual(calls.filter((c) => c.method !== 'GET'), []);
      await page.screenshot({ path: join(SHOTS, `C14-${lang}.png`), fullPage: true });
      await context.close();
    }
  });

  it('CC-5: at 320 px with the longest strings nothing scrolls sideways, amounts and the button stay whole', async () => {
    for (const lang of ['th', 'en']) {
      const { page, context } = await open(lang, { width: 320, height: 568 });
      await page.getByTestId('wallet').waitFor();
      await page.evaluate(() => document.fonts.ready);
      const r = await page.evaluate(() => {
        const lines = (el) => {
          const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.6;
          return Math.round(el.getBoundingClientRect().height / lh);
        };
        return {
          sideways: document.documentElement.scrollWidth > window.innerWidth,
          balanceFits: (() => { const b = document.querySelector('[data-testid=wallet-balance]'); return b.getBoundingClientRect().right <= window.innerWidth - 16; })(),
          rowsFit: [...document.querySelectorAll('[data-testid=movement]')].every((x) => x.scrollWidth <= x.clientWidth),
          moreOneLine: lines(document.querySelector('[data-testid=more] span')) === 1,
          navVisible: document.querySelector('.bottom-nav').getBoundingClientRect().bottom <= window.innerHeight,
          bodyScrolls: getComputedStyle(document.querySelector('.cr-body')).overflowY === 'auto',
        };
      });
      assert.deepEqual(r, { sideways: false, balanceFits: true, rowsFit: true, moreOneLine: true, navVisible: true, bodyScrolls: true }, lang);
      await page.screenshot({ path: join(SHOTS, `C14-320-${lang}.png`), fullPage: true });
      await context.close();
    }
  });
});
