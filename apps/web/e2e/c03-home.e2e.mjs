// F02-T22 Guest Home, the add-the-account ask, sign in on person pages: AUTH-01-AC1, AC8, AC9; LINE-01-AC8, AC9; CC-5.
// Run: node --test --test-concurrency=1 'apps/web/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { chromium, openPage, SHOTS, startApp } from './harness.mjs';

const browserGuest = { inClient: false, loggedIn: false, idToken: 'id-token', language: 'th' };
const profile = { fullName: 'Ploy Srisuk', phone: '0812345678', dateOfBirth: null, level: null, language: 'en', priceGroup: 'adult' };

let app;
let browser;
before(async () => {
  app = await startApp(3111);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

describe('Home (C3)', () => {
  it('AUTH-01-AC1, AC8: a guest sees the guest Home with Find a court time and Sign in, and nothing is asked or created', async () => {
    for (const lang of ['th', 'en']) {
      const { page, context, calls } = await openPage(browser, { liff: browserGuest, lang, me: null });
      await page.goto(`${app.base}/c/hunter`);
      await page.getByTestId('guest-card').waitFor();
      assert.equal(await page.getByTestId('find-court').getAttribute('href'), '/c/hunter/book');
      assert.equal(await page.getByTestId('sign-in').getAttribute('href'), '/c/hunter/sign-in?next=%2Fc%2Fhunter');
      assert.equal(await page.getByTestId('friend-ask').count(), 0);
      assert.deepEqual(calls.filter((c) => c.method !== 'GET'), []);
      await page.screenshot({ path: join(SHOTS, `C3-guest-home-${lang}.png`) });
      await context.close();
    }
  });

  it('CC-5: at 320 px with the longest strings nothing scrolls sideways and the buttons stay on one line', async () => {
    for (const lang of ['th', 'en']) {
      const { page, context } = await openPage(browser, { liff: browserGuest, lang, me: null, width: 320, height: 568 });
      await page.goto(`${app.base}/c/hunter`);
      await page.getByTestId('guest-card').waitFor();
      await page.evaluate(() => document.fonts.ready);
      const r = await page.evaluate(() => {
        const btn = document.querySelector('[data-testid=find-court]');
        const s = btn.querySelector('span');
        const lh = parseFloat(getComputedStyle(s).lineHeight) || parseFloat(getComputedStyle(s).fontSize) * 1.6;
        const signIn = document.querySelector('[data-testid=sign-in]');
        return {
          sideways: document.documentElement.scrollWidth > window.innerWidth,
          lines: Math.round(s.getBoundingClientRect().height / lh),
          signInOneLine: signIn.getBoundingClientRect().height < 40,
          navVisible: document.querySelector('.bottom-nav').getBoundingClientRect().bottom <= window.innerHeight,
          overlap: document.querySelector('.mini-wordmark .w1').getBoundingClientRect().right > document.querySelector('.home-top-actions').getBoundingClientRect().left,
        };
      });
      assert.equal(r.sideways, false, `${lang}: sideways scroll`);
      assert.equal(r.lines, 1, `${lang}: Find a court time wraps`);
      assert.equal(r.signInOneLine, true, `${lang}: Sign in wraps`);
      assert.equal(r.navVisible, true, `${lang}: the bottom nav is pushed off`);
      assert.equal(r.overlap, false, `${lang}: the wordmark runs under the header buttons`);
      await page.screenshot({ path: join(SHOTS, `C3-guest-home-${lang}-320-longest.png`) });
      await context.close();
    }
  });

  it('LINE-01-AC9 (A-7): a signed in non-friend sees the ask once per session; their friend state is reported', async () => {
    const me = { profile };
    const { page, context, calls } = await openPage(browser, { liff: { inClient: true, loggedIn: true, idToken: 't', language: 'en', friend: false }, lang: 'en', me });
    await page.goto(`${app.base}/c/hunter`);
    await page.getByTestId('friend-ask').waitFor();
    assert.equal(await page.getByTestId('guest-card').count(), 0);
    assert.equal(await page.getByTestId('sign-in').count(), 0);
    // Add on LINE opens LINE's add-friend page for the club's Official Account (oaBasicId in the config).
    assert.equal(await page.getByRole('link', { name: 'Add on LINE' }).getAttribute('href'), 'https://line.me/R/ti/p/%40hunter');
    const reported = calls.filter((c) => c.path === '/api/c/hunter/me/line-friend').map((c) => JSON.parse(c.body));
    assert.deepEqual(reported[0], { friendFlag: false });
    await page.screenshot({ path: join(SHOTS, 'C3-home-friend-ask-en.png') });
    await page.reload();
    await page.locator('.home-greeting').waitFor();
    await page.waitForTimeout(500);
    assert.equal(await page.getByTestId('friend-ask').count(), 0, 'asked once per session');
    await context.close();
  });

  it('without an Official Account id the ask is the note alone', async () => {
    const { CLUB } = await import('./harness.mjs');
    const { page, context } = await openPage(browser, { liff: { inClient: true, loggedIn: true, idToken: 't', language: 'en', friend: false }, lang: 'en', me: { profile }, club: { ...CLUB, oaBasicId: null } });
    await page.goto(`${app.base}/c/hunter`);
    await page.getByTestId('friend-ask').waitFor();
    assert.equal(await page.getByRole('link', { name: 'Add on LINE' }).count(), 0);
    await context.close();
  });

  it('a friend is never asked', async () => {
    const { page, context } = await openPage(browser, { liff: { inClient: true, loggedIn: true, idToken: 't', language: 'en', friend: true }, lang: 'en', me: { profile } });
    await page.goto(`${app.base}/c/hunter`);
    await page.locator('.home-greeting').waitFor();
    await page.waitForTimeout(500);
    assert.equal(await page.getByTestId('friend-ask').count(), 0);
    await context.close();
  });
});

describe('person pages (AUTH-01-AC9)', () => {
  for (const path of ['/c/hunter/bookings', '/c/hunter/profile']) {
    it(`a guest opening ${path} signs in first and lands back on it`, async () => {
      const { page, context, calls } = await openPage(browser, { liff: browserGuest, lang: 'en' });
      // A guest until the sign in has gone through, then a person.
      await page.route('**/api/c/hunter/me/profile', (r) =>
        calls.some((c) => c.path.endsWith('/auth/session')) ? r.fulfill({ status: 200, json: profile }) : r.fulfill({ status: 401, json: { code: 'sign_in_required' } }),
      );
      await page.goto(`${app.base}${path}`);
      await page.waitForURL((u) => u.pathname === '/c/hunter/sign-in');
      assert.equal(new URL(page.url()).searchParams.get('next'), path);
      await page.getByTestId('line-login').click();
      await page.waitForURL((u) => u.pathname === path);
      await page.locator('.bar-title').waitFor();
      if (path.endsWith('/profile')) assert.equal(await page.getByTestId('personal-details').getAttribute('href'), '/c/hunter/profile/personal-details');
      await context.close();
    });
  }
});
