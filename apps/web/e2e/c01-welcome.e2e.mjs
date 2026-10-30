// F02-T19 C1 Welcome: AUTH-01-AC6, LINE-01-AC1, AC2, AC6, AUTH-01-AC12, CC-5.
// Run: node --test 'apps/web/e2e/*.e2e.mjs'  (Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { chromium, openPage, SHOTS, startApp } from './harness.mjs';

const NEXT = '/c/hunter/checkout?court=2&date=2027-01-09&from=18:00&to=19:00';
const signIn = (base, next = NEXT) => `${base}/c/hunter/sign-in?next=${encodeURIComponent(next)}`;
const browserGuest = { inClient: false, loggedIn: false, idToken: 'id-token', language: 'th' };

let app;
let browser;
before(async () => {
  app = await startApp();
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

describe('C1 Welcome (F02-T19)', () => {
  it('LINE-01-AC6: shows a plain note and no checkbox, in Thai and English', async () => {
    for (const lang of ['th', 'en']) {
      const { page, context } = await openPage(browser, { liff: browserGuest, lang });
      await page.goto(signIn(app.base));
      await page.getByTestId('line-login').waitFor();
      assert.equal(await page.locator('input[type=checkbox]').count(), 0);
      assert.equal(await page.getByTestId('friend-note').count(), 1);
      await page.screenshot({ path: join(SHOTS, `C1-welcome-${lang}.png`) });
      await context.close();
    }
  });

  it('LINE-01-AC2, AUTH-01-AC2: one tap on Log in with LINE signs in and returns to the chosen slot', async () => {
    const { page, context, calls } = await openPage(browser, { liff: browserGuest, lang: 'en' });
    await page.goto(signIn(app.base));
    await page.getByTestId('line-login').click();
    await page.waitForURL((u) => u.pathname === '/c/hunter/checkout');
    assert.equal(new URL(page.url()).search, NEXT.split('/c/hunter/checkout')[1]);
    const posts = calls.filter((c) => c.method === 'POST');
    assert.deepEqual(posts.map((c) => c.path), ['/api/c/hunter/auth/session']);
    assert.deepEqual(JSON.parse(posts[0].body), { idToken: 'id-token' });
    await context.close();
  });

  it('a new player goes on to C2 with the choice kept', async () => {
    const { page, context } = await openPage(browser, { liff: { ...browserGuest, loggedIn: true }, session: { status: 200, body: { state: 'needs_profile' } } });
    await page.goto(signIn(app.base));
    await page.waitForURL((u) => u.pathname === '/c/hunter/profile-setup');
    assert.equal(new URL(page.url()).searchParams.get('next'), NEXT);
    await context.close();
  });

  it('LINE-01-AC1: inside LINE sign in finishes with no screen to tap', async () => {
    const { page, context } = await openPage(browser, { liff: { inClient: true, loggedIn: true, idToken: 'id-token', language: 'th' } });
    await page.goto(signIn(app.base));
    await page.waitForURL((u) => u.pathname === '/c/hunter/checkout');
    await context.close();
  });

  it('AUTH-01-AC6: Keep browsing goes back to browsing and creates nothing', async () => {
    const { page, context, calls } = await openPage(browser, { liff: browserGuest, lang: 'en' });
    await page.goto(signIn(app.base));
    await page.getByTestId('keep-browsing').click();
    await page.waitForURL((u) => u.pathname === '/c/hunter');
    assert.deepEqual(calls.filter((c) => c.method !== 'GET'), []);
    await context.close();
  });

  it('CC-5: buttons never wrap and nothing scrolls sideways with the longest strings, at 320 px', async () => {
    for (const lang of ['th', 'en']) {
      const { page, context } = await openPage(browser, {
        liff: browserGuest,
        lang,
        width: 320,
        height: 568,
        club: { ...(await import('./harness.mjs')).CLUB, nameTh: 'ฮันเตอร์ เทนนิส แอนด์ แบดมินตัน สปอร์ตคลับ ลำลูกกา', nameEn: 'Hunter Tennis and Badminton Sports Club Lam Lukka' },
      });
      await page.goto(signIn(app.base, '/c/hunter/checkout?court=12&date=2027-09-29&from=23:00&to=24:00'));
      await page.getByTestId('line-login').waitFor();
      await page.evaluate(() => document.fonts.ready);
      const report = await page.evaluate(() => ({
        sideways: document.documentElement.scrollWidth > window.innerWidth,
        buttons: [...document.querySelectorAll('.btn')].map((b) => {
          const s = b.querySelector('span');
          const lh = parseFloat(getComputedStyle(s).lineHeight) || parseFloat(getComputedStyle(s).fontSize) * 1.6;
          return { text: s.textContent, squashed: b.getBoundingClientRect().height < 44, lines: Math.round(s.getBoundingClientRect().height / lh), cut: s.scrollWidth > s.clientWidth + 1 };
        }),
        sheetScrolls: getComputedStyle(document.querySelector('.sheet')).overflowY === 'auto',
      }));
      assert.equal(report.sideways, false, `${lang}: the page scrolls sideways`);
      assert.equal(report.sheetScrolls, true);
      for (const b of report.buttons) {
        assert.equal(b.lines, 1, `${lang}: "${b.text}" wraps`);
        assert.equal(b.cut, false, `${lang}: "${b.text}" is cut`);
        assert.equal(b.squashed, false, `${lang}: "${b.text}" is squashed`);
      }
      await page.screenshot({ path: join(SHOTS, `C1-welcome-${lang}-320-longest.png`), fullPage: true });
      await context.close();
    }
  });

  it('AUTH-02-AC27: the toggle switches the language at once and keeps it in the lang cookie', async () => {
    const { page, context } = await openPage(browser, { liff: browserGuest, lang: 'th' });
    await page.goto(signIn(app.base));
    await page.getByTestId('line-login').waitFor();
    assert.match(await page.locator('h1').innerText(), /เข้าสู่ระบบเพื่อจอง/);
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    assert.equal(await page.locator('h1').innerText(), 'Sign in to book');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
    const cookies = await context.cookies();
    assert.equal(cookies.find((c) => c.name === 'lang')?.value, 'en');
    await context.close();
  });

  it('AUTH-01-AC12: LINE unreachable shows P-0326, P-0327 and Try again, and nothing is created', async () => {
    const { page, context, calls } = await openPage(browser, { liff: { ...browserGuest, offline: true }, lang: 'en' });
    await page.goto(signIn(app.base));
    await page.getByTestId('offline').waitFor();
    const text = await page.getByTestId('offline').innerText();
    assert.match(text, /Can't connect/);
    assert.match(text, /Nothing was booked or charged\./);
    assert.match(text, /Try again/);
    assert.deepEqual(calls.filter((c) => c.method !== 'GET'), []);
    await page.screenshot({ path: join(SHOTS, 'C1-offline-en.png') });
    await context.close();
  });

  it('AUTH-01-AC13: an unknown club shows not found', async () => {
    const { page, context } = await openPage(browser, { liff: browserGuest, club: null, lang: 'en' });
    await page.goto(signIn(app.base));
    await page.getByTestId('not-found').waitFor();
    await context.close();
  });
});
