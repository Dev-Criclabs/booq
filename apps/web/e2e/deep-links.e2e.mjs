// F02-T23 rich menu and share links: AUTH-01-AC10, AC14; BOOK-02-AC1 to AC3, AC5. A LIFF link
// https://liff.line.me/{liffId}/{path} reaches the club's endpoint /c/{slug} with the path in liff.state (design 3.1);
// these tests open the endpoint exactly as LINE does, inside LINE and in a browser.
// Run: node --test --test-concurrency=1 'apps/web/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { chromium, openPage, startApp } from './harness.mjs';

const inLine = { inClient: true, loggedIn: true, idToken: 't', language: 'th' };
const browser_ = { inClient: false, loggedIn: false, idToken: 't', language: 'th' };
// C4 reads the public schedule: one court, one open hour, today only.
const schedule = {
  courts: { status: 'live', today: '2027-01-09', bookingWindowDays: 0, courts: [{ id: 'c1', name: '1', sport: 'tennis' }], openingHours: [] },
  days: [],
  dayFor: (date) => ({ date, courts: [{ id: 'c1', name: '1', sport: 'tennis', hours: [{ start: `${date}T18:00:00+07:00`, state: 'open', waitlist: false }] }], dayFull: false, waitlist: false }),
};
const endpoint = (base, state) => `${base}/c/hunter?liff.state=${encodeURIComponent(state)}`;

let app;
let browser;
before(async () => {
  app = await startApp(3112);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

describe('deep links (F02-T23)', () => {
  for (const [where, liff] of [['inside LINE', inLine], ['in a browser', browser_]]) {
    it(`BOOK-02-AC1, AC2, AC5, AUTH-01-AC10: the Book a court tile opens C4 as a guest page, ${where}`, async () => {
      const { page, context, calls } = await openPage(browser, { liff, lang: 'en', me: null, schedule });
      await page.goto(endpoint(app.base, '/book'));
      await page.waitForURL((u) => u.pathname === '/c/hunter/book');
      await page.locator('[data-screen=C4]').waitFor();
      assert.equal(await page.locator('h1').innerText(), 'Book a court');
      assert.deepEqual(calls.filter((c) => c.method !== 'GET' || c.path.endsWith('/me/profile')), [], 'no sign in, no person check, nothing created');
      await context.close();
    });
  }

  it('AUTH-01-AC10: the My bookings tile needs a person, so it starts sign in and comes back to My bookings', async () => {
    const { page, context } = await openPage(browser, { liff: browser_, lang: 'en', me: null });
    await page.goto(endpoint(app.base, '/bookings'));
    await page.waitForURL((u) => u.pathname === '/c/hunter/sign-in');
    assert.equal(new URL(page.url()).searchParams.get('next'), '/c/hunter/bookings');
    await context.close();
  });

  it('AUTH-01-AC14: a message button keeps its page and query, inside the club', async () => {
    const { page, context } = await openPage(browser, { liff: inLine, lang: 'en', me: null, schedule });
    await page.goto(endpoint(app.base, '/book?date=2027-01-09'));
    await page.waitForURL((u) => u.pathname === '/c/hunter/book');
    assert.equal(new URL(page.url()).searchParams.get('date'), '2027-01-09');
    await context.close();
  });

  it('AUTH-01-AC14, CC-1: a liff.state that would leave the club is ignored and Home shows', async () => {
    for (const bad of ['//evil.test/c/hunter', '/../other-club/book']) {
      const { page, context } = await openPage(browser, { liff: browser_, lang: 'en', me: null });
      await page.goto(endpoint(app.base, bad));
      await page.getByTestId('guest-card').waitFor();
      assert.equal(new URL(page.url()).host, new URL(app.base).host);
      assert.equal(new URL(page.url()).pathname, '/c/hunter');
      await context.close();
    }
  });

});
