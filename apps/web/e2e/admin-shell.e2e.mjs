// F11-T12 Club admin console shell: sidebar by role, banners (paused, LINE limit, LINE connection), sign in, states, Thai and English at
// 1280 and narrow widths (ADMIN-01; CC-5). The API is faked in the browser; no database.
// Run: node --test --test-concurrency=1 'apps/web/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { chromium, SHOTS, startApp } from './harness.mjs';

let app;
let browser;
before(async () => {
  app = await startApp(3113);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

const CLUB = { nameTh: 'ฮันเตอร์ เทนนิส คลับ', nameEn: 'Hunter Tennis Club', status: 'live', defaultLanguage: 'th' };
const OWNER_PAGES = ['A0', 'A1', 'A2', 'A5', 'A6', 'A7', 'A8', 'A9', 'A9b', 'A10', 'A12', 'A13', 'A14', 'A16', 'A17'];
const DESK_PAGES = ['A1', 'A2', 'A5', 'A6', 'A12'];
const shell = (over = {}) => ({ pages: OWNER_PAGES, club: CLUB, paused: null, lineCap: null, lineTokenReason: null, booqSupportLineUrl: null, ...over });

async function open({ answer = { status: 200, body: shell() }, lang = 'en', width = 1280, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, locale: lang === 'th' ? 'th-TH' : 'en-GB' });
  await context.addCookies([{ name: 'lang', value: lang, url: 'http://localhost' }]);
  const page = await context.newPage();
  const calls = [];
  await page.route('**/fonts.{googleapis,gstatic}.com/**', (r) => r.continue().catch(() => r.abort()));
  await page.route('**/api/c/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    calls.push(path);
    const a = typeof answer === 'function' ? answer(calls) : answer;
    if (a === 'offline') return route.abort('internetdisconnected');
    return route.fulfill({ status: a.status, json: a.body });
  });
  return { page, context, calls };
}
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

describe('the shell', () => {
  it('the owner sees the sidebar groups of the board and the club name; pages without a screen yet are shown, not linked', async () => {
    const { page, context } = await open();
    await page.goto(`${app.base}/c/hunter/admin`);
    await page.getByTestId('adm-nav').waitFor();
    const text = await page.getByTestId('adm-nav').innerText();
    for (const w of ['Setup checklist', 'Calendar', 'Customers', 'Closures', 'Coaches', 'Group classes', 'Products and pricing', 'Promotions', 'Settings', 'Staff and audit log', 'Reports', 'Receipts']) assert.match(text, new RegExp(w), w);
    assert.equal(await page.getByTestId('nav-pricing').count(), 1, 'A9 and A9b are one entry');
    assert.equal(await page.getByTestId('adm-club').innerText(), 'Hunter Tennis Club');
    assert.equal(await page.getByTestId('adm-banners').count(), 0);
    assert.match(await page.getByTestId('adm-welcome').innerText(), /Choose a page from the menu/);
    await page.screenshot({ path: join(SHOTS, 'admin-shell-owner.png'), fullPage: true });
    await context.close();
  });

  it('front desk sees only Calendar, Customers and Closures', async () => {
    const { page, context } = await open({ answer: { status: 200, body: shell({ pages: DESK_PAGES }) } });
    await page.goto(`${app.base}/c/hunter/admin`);
    await page.getByTestId('adm-nav').waitFor();
    assert.deepEqual(await page.locator('[data-testid^="nav-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid'))), ['nav-calendar', 'nav-customers', 'nav-closures']);
    await context.close();
  });

  it('paused, a refused LINE connection and the LINE limit show as banners on the page, Thai and English, no sideways scroll at 375 px', async () => {
    const body = shell({ paused: { reason: 'Payment problem with the card processor, please wait for BOOQ to message you', since: '2027-01-12T17:30:00Z' }, lineCap: 'reminders_stopped', lineTokenReason: 'token_rejected' });
    for (const lang of ['en', 'th']) {
      for (const width of [1280, 375]) {
        const { page, context } = await open({ answer: { status: 200, body }, lang, width });
        await page.goto(`${app.base}/c/hunter/admin`);
        await page.getByTestId('adm-banners').waitFor();
        assert.deepEqual(await page.locator('[data-testid^="banner-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid'))), ['banner-paused', 'banner-line_token', 'banner-line_cap']);
        const paused = await page.getByTestId('banner-paused').innerText();
        assert.match(paused, lang === 'en' ? /paused by BOOQ since 13 Jan · Payment problem/ : /ตั้งแต่ 13 ม\.ค\. · Payment problem/);
        assert.equal(await noSideways(page), true, `${lang} ${width}`);
        await page.screenshot({ path: join(SHOTS, `admin-shell-banners-${lang}-${width}.png`), fullPage: true });
        await context.close();
      }
    }
  });

  it('the Message BOOQ button is hidden while BOOQ has set no address, and links to it (D178) once the server sends it', async () => {
    const paused = { reason: 'r', since: '2027-01-12T17:30:00Z' };
    const none = await open({ answer: { status: 200, body: shell({ paused }) } });
    await none.page.goto(`${app.base}/c/hunter/admin`);
    await none.page.getByTestId('banner-paused').waitFor();
    assert.equal(await none.page.getByTestId('message-booq').count(), 0);
    await none.context.close();
    const some = await open({ answer: { status: 200, body: shell({ paused, booqSupportLineUrl: 'https://line.me/R/ti/p/@booq' }) } });
    await some.page.goto(`${app.base}/c/hunter/admin`);
    await some.page.getByTestId('message-booq').waitFor();
    assert.equal(await some.page.getByTestId('message-booq').getAttribute('href'), 'https://line.me/R/ti/p/@booq');
    await some.context.close();
    const bad = await open({ answer: { status: 200, body: shell({ paused, booqSupportLineUrl: 'javascript:alert(1)' }) } });
    await bad.page.goto(`${app.base}/c/hunter/admin`);
    await bad.page.getByTestId('banner-paused').waitFor();
    assert.equal(await bad.page.getByTestId('message-booq').count(), 0);
    await bad.context.close();
  });

  it('the language toggle switches the text at once and remembers the choice', async () => {
    const { page, context } = await open({ lang: 'th' });
    await page.goto(`${app.base}/c/hunter/admin`);
    await page.getByTestId('adm-nav').waitFor();
    assert.match(await page.getByTestId('adm-nav').innerText(), /ปฏิทิน/);
    assert.equal(await page.getByTestId('adm-club').innerText(), 'ฮันเตอร์ เทนนิส คลับ');
    await page.locator('.lang-toggle button[lang="en"]').click();
    assert.match(await page.getByTestId('adm-nav').innerText(), /Calendar/);
    assert.equal(await page.getByTestId('adm-club').innerText(), 'Hunter Tennis Club');
    assert.match((await context.cookies()).find((c) => c.name === 'lang').value, /en/);
    await context.close();
  });
});

describe('the states', () => {
  it('a guest is sent to sign in and comes back to the console', async () => {
    const { page, context } = await open({ answer: { status: 401, body: { code: 'unauthenticated' } } });
    await page.goto(`${app.base}/c/hunter/admin`);
    await page.waitForURL('**/c/hunter/sign-in?next=%2Fc%2Fhunter%2Fadmin');
    await context.close();
  });

  it('a person without a staff role is told so, with nothing of the console shown', async () => {
    const { page, context } = await open({ answer: { status: 403, body: { code: 'forbidden' } } });
    await page.goto(`${app.base}/c/hunter/admin`);
    await page.getByTestId('adm-forbidden').waitFor();
    assert.match(await page.getByTestId('adm-forbidden').innerText(), /This area is for the club's staff/);
    assert.equal(await page.getByTestId('adm-nav').count(), 0);
    await context.close();
  });

  it('an unknown club says so', async () => {
    const { page, context } = await open({ answer: { status: 404, body: { code: 'not_found' } } });
    await page.goto(`${app.base}/c/nope/admin`);
    await page.getByTestId('adm-not_found').waitFor();
    await context.close();
  });

  it('offline shows the retry, and the retry loads the shell', async () => {
    let up = false;
    const { page, context } = await open({ answer: () => (up ? { status: 200, body: shell() } : 'offline') });
    await page.goto(`${app.base}/c/hunter/admin`);
    await page.getByTestId('adm-offline').waitFor();
    up = true;
    await page.getByTestId('adm-offline').getByRole('button').click();
    await page.getByTestId('adm-nav').waitFor();
    await context.close();
  });
});
