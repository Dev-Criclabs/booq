// F02-T20 C2 Profile setup: AUTH-02-AC1 to AC7, CC-5.
// Run: node --test --test-concurrency=1 'apps/web/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { chromium, openPage, SHOTS, startApp } from './harness.mjs';

const NEXT = '/c/hunter/checkout?court=2&date=2027-01-09&from=18:00&to=19:00';
const setup = (base, next = NEXT) => `${base}/c/hunter/profile-setup?next=${encodeURIComponent(next)}`;
const liff = { inClient: false, loggedIn: true, idToken: 'id-token', language: 'th', displayName: 'ploy.s' };

let app;
let browser;
before(async () => {
  app = await startApp(3108);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

describe('C2 Profile setup (F02-T20)', () => {
  it('AUTH-02-AC6: a new player goes from sign in to C2 and on to payment with the slot kept', async () => {
    const { page, context, calls } = await openPage(browser, { liff, lang: 'en', session: { status: 200, body: { state: 'needs_profile' } } });
    await page.goto(`${app.base}/c/hunter/sign-in?next=${encodeURIComponent(NEXT)}`);
    await page.getByTestId('continue').waitFor();
    assert.equal(await page.locator('h1').innerText(), 'Hi, ploy.s');
    assert.equal(await page.getByTestId('continue').innerText(), 'Continue to payment');
    assert.equal(await page.locator('input[name=fullName]').inputValue(), '', 'the full name is not filled from LINE');
    await page.screenshot({ path: join(SHOTS, 'C2-profile-setup-en.png') });
    await page.locator('input[name=fullName]').fill('Ploy Srisuk');
    await page.locator('input[name=phone]').fill('081 234 5678');
    await page.locator('input[name=consent]').check();
    await page.getByTestId('continue').click();
    await page.waitForURL((u) => u.pathname === '/c/hunter/checkout');
    assert.equal(new URL(page.url()).search, NEXT.split('/c/hunter/checkout')[1]);
    const sent = calls.find((c) => c.path === '/api/c/hunter/auth/profile');
    const body = JSON.parse(sent.body);
    assert.deepEqual(Object.keys(body).sort(), ['consent', 'fullName', 'language', 'noticeVersion', 'phone']);
    assert.equal(body.consent, true);
    assert.equal(body.language, 'en');
    await context.close();
  });

  it('AUTH-02-AC2, AC3: without consent the screen says what is missing and nothing is sent', async () => {
    const { page, context, calls } = await openPage(browser, { liff, lang: 'th' });
    await page.goto(setup(app.base));
    await page.locator('input[name=fullName]').fill('พลอย ศรีสุข');
    await page.locator('input[name=phone]').fill('0812345678');
    await page.getByTestId('continue').click();
    await page.locator('#err-consent').waitFor();
    assert.equal(await page.locator('#err-consent').innerText(), 'กรุณายอมรับเพื่อดำเนินการต่อ');
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
    await context.close();
  });

  it('AUTH-02-AC2: a refusal from the server is shown next to the field', async () => {
    const { page, context } = await openPage(browser, { liff, lang: 'en', profile: { status: 400, body: { code: 'invalid', fields: { phone: 'phone_invalid' } } } });
    await page.goto(setup(app.base));
    await page.locator('input[name=fullName]').fill('Ploy Srisuk');
    await page.locator('input[name=phone]').fill('12');
    await page.locator('input[name=consent]').check();
    await page.getByTestId('continue').click();
    await page.locator('#err-phone').waitFor();
    assert.match(await page.locator('#err-phone').innerText(), /not valid/);
    assert.equal(page.url().includes('/profile-setup'), true);
    await context.close();
  });

  it('CC-5: in Thai at 320 px the consent line wraps inside its card, the button stays on one line, nothing scrolls sideways', async () => {
    for (const lang of ['th', 'en']) {
      const { page, context } = await openPage(browser, { liff: { ...liff, displayName: 'ploy.srisuk.hunter.tennis.club' }, lang, width: 320, height: 568 });
      await page.goto(setup(app.base));
      await page.getByTestId('continue').waitFor();
      await page.getByTestId('continue').click(); // show every field message: the longest screen
      await page.locator('#err-consent').waitFor();
      await page.evaluate(() => document.fonts.ready);
      const r = await page.evaluate(() => {
        const btn = document.querySelector('[data-testid=continue]');
        const s = btn.querySelector('span');
        const lh = parseFloat(getComputedStyle(s).lineHeight) || parseFloat(getComputedStyle(s).fontSize) * 1.6;
        const line = document.querySelector('.consent-line span').getBoundingClientRect();
        const body = document.querySelector('.form-body').getBoundingClientRect();
        return {
          sideways: document.documentElement.scrollWidth > window.innerWidth,
          buttonLines: Math.round(s.getBoundingClientRect().height / lh),
          buttonHeight: btn.getBoundingClientRect().height,
          buttonVisible: btn.getBoundingClientRect().bottom <= window.innerHeight,
          consentInside: line.right <= body.right + 0.5,
          bodyScrolls: getComputedStyle(document.querySelector('.form-body')).overflowY === 'auto',
        };
      });
      assert.equal(r.sideways, false, `${lang}: sideways scroll`);
      assert.equal(r.buttonLines, 1, `${lang}: button wraps`);
      assert.ok(r.buttonHeight >= 50, `${lang}: button squashed`);
      assert.equal(r.buttonVisible, true, `${lang}: button pushed off screen`);
      assert.equal(r.consentInside, true, `${lang}: consent line overflows`);
      assert.equal(r.bodyScrolls, true);
      await page.screenshot({ path: join(SHOTS, `C2-profile-setup-${lang}-320-errors.png`) });
      await context.close();
    }
  });
});
