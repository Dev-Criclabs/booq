// F02-T21 date of birth step and Personal details: AUTH-02-AC11, AC12, AC15, AC18, AC19, AC26; AUTH-01-AC9; CC-5.
// Run: node --test --test-concurrency=1 'apps/web/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { chromium, openPage, SHOTS, startApp } from './harness.mjs';

const PAGE = '/c/hunter/profile/personal-details';
const liff = { inClient: false, loggedIn: true, idToken: 'id-token', language: 'th', displayName: 'ploy.s' };
const profile = () => ({ fullName: 'Ploy Srisuk', phone: '081 234 5678', dateOfBirth: '1994-03-14', level: 'beginner', language: 'en', priceGroup: 'adult' });
const puts = (calls) => calls.filter((c) => c.method === 'PUT' && c.path.endsWith('/me/profile')).map((c) => JSON.parse(c.body));

let app;
let browser;
before(async () => {
  app = await startApp(3110);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

describe('Personal details (C17)', () => {
  it('AUTH-01-AC9: a guest opening it signs in first and comes back to it', async () => {
    const { page, context } = await openPage(browser, { stubCheckout: true, liff: { ...liff, loggedIn: false }, lang: 'en', me: null });
    await page.goto(`${app.base}${PAGE}`);
    await page.waitForURL((u) => u.pathname === '/c/hunter/sign-in');
    assert.equal(new URL(page.url()).searchParams.get('next'), PAGE);
    await context.close();
  });

  it('AUTH-02-AC18, AC19, AC15: the date of birth is editable any number of times, read back with the international year', async () => {
    const me = { profile: profile() };
    const { page, context, calls } = await openPage(browser, { stubCheckout: true, liff, lang: 'en', me });
    await page.goto(`${app.base}${PAGE}`);
    await page.getByTestId('save').waitFor();
    assert.equal(await page.getByTestId('dob-readout').innerText(), '14 March 1994');
    assert.equal(await page.getByText(/front desk/i).count(), 0);
    await page.screenshot({ path: join(SHOTS, 'C17-personal-details-en.png') });
    for (const [day, year] of [['15', '1995'], ['16', '1996']]) {
      await page.locator('select[name=dobDay]').selectOption(day);
      await page.locator('input[name=dobYear]').fill(year);
      await page.getByTestId('save').click();
      await page.getByTestId('saved').waitFor();
    }
    assert.deepEqual(puts(calls), [{ dateOfBirth: '1995-03-15' }, { dateOfBirth: '1996-03-16' }]);
    await context.close();
  });

  it('AUTH-02-AC26: the language toggle changes the screen and is saved on the player record', async () => {
    const me = { profile: profile() };
    const { page, context, calls } = await openPage(browser, { stubCheckout: true, liff, lang: 'en', me });
    await page.goto(`${app.base}${PAGE}`);
    await page.getByTestId('save').waitFor();
    await page.getByRole('button', { name: 'ไทย', exact: true }).click();
    await page.locator('h1', { hasText: 'ข้อมูลส่วนตัว' }).waitFor();
    assert.equal(await page.getByTestId('dob-readout').innerText(), '14 มีนาคม 1994');
    await page.waitForFunction(() => document.cookie.includes('lang=th'));
    assert.deepEqual(puts(calls), [{ language: 'th' }]);
    await page.screenshot({ path: join(SHOTS, 'C17-personal-details-th.png') });
    await context.close();
  });

  it('CC-5: at 320 px with the longest strings and messages, nothing scrolls sideways and Save stays on one line', async () => {
    for (const lang of ['th', 'en']) {
      const me = { profile: { ...profile(), language: lang, fullName: 'ศรีสุขสวัสดิ์วัฒนาพงศ์ไพบูลย์ ณ อยุธยา', dateOfBirth: null } };
      const { page, context } = await openPage(browser, { stubCheckout: true, liff: { ...liff, displayName: 'ploy.srisuk.hunter.tennis.club' }, lang, me, width: 320, height: 568 });
      await page.goto(`${app.base}${PAGE}`);
      await page.getByTestId('save').waitFor();
      await page.locator('input[name=dobYear]').fill('19'); // partly filled: shows the date message
      await page.getByTestId('save').click();
      await page.locator('#dob-error').waitFor();
      await page.evaluate(() => document.fonts.ready);
      const r = await page.evaluate(() => {
        const btn = document.querySelector('[data-testid=save]');
        const s = btn.querySelector('span');
        const lh = parseFloat(getComputedStyle(s).lineHeight) || parseFloat(getComputedStyle(s).fontSize) * 1.6;
        return {
          sideways: document.documentElement.scrollWidth > window.innerWidth,
          lines: Math.round(s.getBoundingClientRect().height / lh),
          visible: btn.getBoundingClientRect().bottom <= window.innerHeight,
          chipsWrap: [...document.querySelectorAll('.chip')].every((c) => c.scrollWidth <= c.clientWidth + 1),
        };
      });
      assert.equal(r.sideways, false, `${lang}: sideways scroll`);
      assert.equal(r.lines, 1, `${lang}: Save wraps`);
      assert.equal(r.visible, true, `${lang}: Save is off screen`);
      assert.equal(r.chipsWrap, true, `${lang}: a level chip is cut`);
      await page.screenshot({ path: join(SHOTS, `C17-personal-details-${lang}-320-longest.png`) });
      await context.close();
    }
  });
});

describe('date of birth step (Student items)', () => {
  const NEXT = '/c/hunter/checkout?package=student-10';
  const step = (base) => `${base}/c/hunter/date-of-birth?next=${encodeURIComponent(NEXT)}`;
  const under18 = (dob) => (dob && dob > '2008-10-30' ? 'student' : 'adult');

  it('AUTH-02-AC11: with no date on file the field is required; a date under 18 goes on with the item kept', async () => {
    const me = { profile: { ...profile(), dateOfBirth: null }, groupFor: under18 };
    const { page, context, calls } = await openPage(browser, { stubCheckout: true, liff, lang: 'th', me });
    await page.goto(step(app.base));
    await page.getByTestId('continue').waitFor();
    await page.screenshot({ path: join(SHOTS, 'dob-step-th.png') });
    await page.getByTestId('continue').click();
    await page.locator('#dob-error').waitFor();
    assert.equal(puts(calls).length, 0, 'nothing sent without a date');
    await page.locator('select[name=dobDay]').selectOption('5');
    await page.locator('select[name=dobMonth]').selectOption('5');
    await page.locator('input[name=dobYear]').fill('2012');
    assert.equal(await page.getByTestId('dob-readout').innerText(), '5 พฤษภาคม 2012');
    await page.getByTestId('continue').click();
    await page.waitForURL((u) => u.pathname === '/c/hunter/checkout');
    assert.equal(new URL(page.url()).searchParams.get('package'), 'student-10');
    assert.deepEqual(puts(calls), [{ dateOfBirth: '2012-05-05' }]);
    await context.close();
  });

  it('AUTH-02-AC12: a date making the player 18 or older says the item is for under 18', async () => {
    const me = { profile: { ...profile(), dateOfBirth: null }, groupFor: under18 };
    const { page, context } = await openPage(browser, { stubCheckout: true, liff, lang: 'en', me });
    await page.goto(step(app.base));
    await page.locator('select[name=dobDay]').selectOption('14');
    await page.locator('select[name=dobMonth]').selectOption('3');
    await page.locator('input[name=dobYear]').fill('1994');
    await page.getByTestId('continue').click();
    await page.getByTestId('too-old').waitFor();
    assert.match(await page.getByTestId('too-old').innerText(), /under 18/);
    assert.equal(new URL(page.url()).pathname, '/c/hunter/date-of-birth');
    await page.screenshot({ path: join(SHOTS, 'dob-step-en-too-old.png') });
    await context.close();
  });
});
