// F12-T11, T12: the coach portal shell and K1 Today (CPORT-01; CC-5). Boards H-K1-Today and T-K1-Today.
// Run: node --test --test-concurrency=1 'apps/web/e2e/coach-k1.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { chromium, openPage, SHOTS, startApp } from './harness.mjs';
import { coachFakes, daySessions } from './coach-fakes.mjs';

const liff = { inClient: false, loggedIn: true, idToken: 'id-token', language: 'th' };
const me = { profile: { fullName: 'Coach One', phone: '0812345678', dateOfBirth: null, level: null, language: 'th', priceGroup: 'adult' } };

let app;
let browser;
before(async () => {
  app = await startApp(3131);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

const open = (opts) => openPage(browser, { liff, me: { ...me }, ...opts });
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

describe('K1 Today', () => {
  it('CPORT-01: three solo classes and one group today, only the coach\'s own, in time order, with Done and Next from the clock', async () => {
    for (const lang of ['th', 'en']) {
      const { page, context } = await open({ lang, extra: coachFakes() });
      await page.goto(`${app.base}/c/hunter/coach`);
      await page.getByTestId('session-row').first().waitFor();
      const rows = await page.getByTestId('session-row').evaluateAll((els) => els.map((e) => ({ kind: e.dataset.kind, phase: e.dataset.phase, text: e.textContent })));
      assert.deepEqual(rows.map((r) => [r.kind, r.phase]), [['solo', 'done'], ['solo', 'done'], ['group', 'next'], ['solo', 'later']], lang);
      assert.match(rows[2].text, lang === 'en' ? /Adult beginner clinic/ : /คลินิกมือใหม่ผู้ใหญ่/);
      assert.match(rows[2].text, lang === 'en' ? /5 of 6 players · Beginner/ : /ผู้เล่น 5 จาก 6 คน · มือใหม่/);
      assert.match(rows[0].text, /Somchai Jaidee/);
      assert.equal(await page.getByTestId('tile-solo').locator('b').textContent(), '3');
      assert.equal(await page.getByTestId('tile-group').locator('b').textContent(), '1');
      assert.equal(await page.getByTestId('tile-players').locator('b').textContent(), '8');
      assert.match(await page.getByTestId('rest-note').textContent(), lang === 'en' ? /4 teaching hours today\. Booking never gives you more than 6 in a row\./ : /วันนี้สอน 4 ชั่วโมง/);
      assert.equal(await page.locator('.coach-nav a').count(), 5);
      assert.equal(await page.locator('.coach-nav a[aria-current=page]').getAttribute('data-testid'), 'nav-today');
      await page.screenshot({ path: join(SHOTS, `K1-today-${lang}.png`) });
      await context.close();
    }
  });

  it('CC-5: at 320 px with the longest names nothing scrolls sideways and the bar stays on screen, in Thai and English', async () => {
    for (const lang of ['th', 'en']) {
      const { page, context } = await open({ lang, width: 320, height: 568, extra: coachFakes({ today: daySessions(Date.now(), { long: true }) }) });
      await page.goto(`${app.base}/c/hunter/coach`);
      await page.getByTestId('session-row').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await sideways(page), false, `${lang}: sideways scroll`);
      const r = await page.evaluate(() => ({
        navBottom: document.querySelector('.coach-nav').getBoundingClientRect().bottom,
        rowsOverflow: [...document.querySelectorAll('.srow')].some((e) => e.scrollWidth > e.clientWidth + 1),
        height: window.innerHeight,
        navLinks: [...document.querySelectorAll('.coach-nav a')].map((a) => a.getBoundingClientRect().width),
      }));
      assert.ok(r.navBottom <= r.height + 1, `${lang}: the bar is pushed off`);
      assert.equal(r.rowsOverflow, false, `${lang}: a row overflows`);
      assert.ok(r.navLinks.every((w) => w > 40), `${lang}: a tab is squeezed`);
      await page.screenshot({ path: join(SHOTS, `K1-today-${lang}-320.png`) });
      await context.close();
    }
  });

  it('an empty day says so and shows no rest line; a held class and a class the owner is checking say so', async () => {
    const empty = await open({ lang: 'en', extra: coachFakes({ today: [] }) });
    await empty.page.goto(`${app.base}/c/hunter/coach`);
    await empty.page.getByTestId('empty').waitFor();
    assert.equal(await empty.page.getByTestId('rest-note').count(), 0);
    assert.equal(await empty.page.getByTestId('tile-solo').locator('b').textContent(), '0');
    await empty.context.close();
    const rows = daySessions();
    rows[3] = { ...rows[3], held: true, status: 'awaiting_payment' };
    rows[2] = { ...rows[2], needs_attention: true };
    const odd = await open({ lang: 'en', extra: coachFakes({ today: rows }) });
    await odd.page.goto(`${app.base}/c/hunter/coach`);
    await odd.page.getByTestId('session-row').first().waitFor();
    const text = await odd.page.locator('.coach-body').textContent();
    assert.match(text, /Waiting for payment/);
    assert.match(text, /Owner is checking/);
    await odd.context.close();
  });

  it('a person who is not a coach is told so (the server answers 403), a guest goes to sign in, and offline offers a retry', async () => {
    const notCoach = await open({ lang: 'en', extra: coachFakes({ today: 'forbidden' }) });
    await notCoach.page.goto(`${app.base}/c/hunter/coach`);
    await notCoach.page.getByTestId('not-coach').waitFor();
    assert.match(await notCoach.page.getByTestId('not-coach').textContent(), /for the club's coaches/);
    await notCoach.context.close();
    const guest = await openPage(browser, { liff, me: null, lang: 'en', extra: coachFakes() });
    await guest.page.goto(`${app.base}/c/hunter/coach`);
    await guest.page.waitForURL(/\/c\/hunter\/sign-in\?next=%2Fc%2Fhunter%2Fcoach/);
    await guest.context.close();
    const off = await open({ lang: 'en', extra: async ({ path }) => (/\/coach\/today$/.test(path) ? { status: 500, json: {} } : null) });
    await off.page.goto(`${app.base}/c/hunter/coach`);
    await off.page.getByTestId('error').waitFor();
    await off.context.close();
  });
});
