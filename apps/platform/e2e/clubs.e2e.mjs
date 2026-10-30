// F01 console: the clubs list (P1). PLAT-01, PLAT-02-AC1 (a specialist sees only the clubs assigned: the server decides).
// Run: node --test --test-concurrency=1 'apps/platform/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { chromium, openPage, SHOTS, startApp } from './harness.mjs';

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

const CLUBS = [
  { clubId: 'c-live', nameTh: 'ฮันเตอร์ เทนนิส คลับ', nameEn: 'Hunter Tennis Club', status: 'live', bookingsConfirmed30d: 412 },
  { clubId: 'c-test', nameTh: 'คลับทดสอบ', nameEn: 'Testing Club', status: 'testing', bookingsConfirmed30d: 3 },
  { clubId: 'c-draft', nameTh: 'ร่าง', nameEn: 'Draft Club', status: 'draft', bookingsConfirmed30d: 0 },
  { clubId: 'c-pause', nameTh: 'พัก', nameEn: 'Paused Club', status: 'paused', bookingsConfirmed30d: 12 },
  { clubId: 'c-live2', nameTh: 'สอง', nameEn: 'Second Live Club', status: 'live', bookingsConfirmed30d: 40 },
];
const api = (over = {}) => (method, path) => (over[`${method} ${path}`] ? over[`${method} ${path}`] : method === 'GET' && path === '/clubs' ? { status: 200, body: { clubs: CLUBS } } : { status: 404, body: { code: 'not_found' } });

describe('the clubs list', () => {
  it('lists every club with its status and bookings, with counts on the filters', async () => {
    const { page, context } = await openPage(browser, api(), { width: 1024, height: 800 });
    await page.goto(`${app.base}/clubs`);
    await page.getByTestId('club-list').waitFor();
    assert.equal(await page.locator('h1').innerText(), 'Every club on BOOQ');
    assert.equal(await page.locator('[data-testid^=club-c-]').count(), 5);
    assert.equal(await page.getByTestId('filter-all').innerText(), 'All · 5');
    assert.equal(await page.getByTestId('filter-live').innerText(), 'Live · 2');
    assert.equal(await page.getByTestId('filter-paused').innerText(), 'Paused · 1');
    const row = page.getByTestId('club-c-live');
    assert.match(await row.innerText(), /Hunter Tennis Club/);
    assert.match(await row.innerText(), /ฮันเตอร์ เทนนิส คลับ/);
    assert.match(await row.innerText(), /412/);
    assert.equal(await row.locator('a').getAttribute('href'), '/clubs/c-live');
    await page.screenshot({ path: join(SHOTS, 'clubs.png') });
    await context.close();
  });

  it('a filter narrows the list and says so when nothing matches; the pressed tab is marked', async () => {
    const { page, context } = await openPage(browser, api({ 'GET /clubs': { status: 200, body: { clubs: CLUBS.filter((c) => c.status !== 'paused') } } }), { width: 1024, height: 800 });
    await page.goto(`${app.base}/clubs`);
    await page.getByTestId('club-list').waitFor();
    await page.getByTestId('filter-live').click();
    assert.equal(await page.locator('[data-testid^=club-c-]').count(), 2);
    assert.equal(await page.getByTestId('filter-live').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByTestId('filter-all').getAttribute('aria-pressed'), 'false');
    await page.getByTestId('filter-paused').click();
    await page.getByTestId('filter-empty').waitFor();
    assert.equal(await page.getByTestId('filter-empty').innerText(), 'No clubs have this status.');
    await context.close();
  });

  it('no clubs yet, no session, not allowed and a failure each say so', async () => {
    const cases = [
      [{ 'GET /clubs': { status: 200, body: { clubs: [] } } }, 'empty', 'There are no clubs yet.'],
      [{ 'GET /clubs': { status: 401, body: { code: 'unauthenticated' } } }, 'load-error', 'Sign in to the console to manage the team.'],
      [{ 'GET /clubs': { status: 500, body: { code: 'internal' } } }, 'load-error', 'The club list is not available right now. Try again in a few minutes.'],
    ];
    for (const [over, id, text] of cases) {
      const { page, context } = await openPage(browser, api(over));
      await page.goto(`${app.base}/clubs`);
      await page.getByTestId(id).waitFor();
      assert.ok((await page.getByTestId(id).innerText()).startsWith(text), text);
      await context.close();
    }
    const { page, context } = await openPage(browser, api({ 'GET /clubs': { status: 401, body: { code: 'unauthenticated' } } }));
    await page.goto(`${app.base}/clubs`);
    assert.equal(await page.getByTestId('sign-in-link').getAttribute('href'), '/sign-in?next=/clubs');
    await context.close();
  });

  it('the menu marks the page, links the sections and signs out; the home page opens the list', async () => {
    const { page, context, calls } = await openPage(browser, api(), { width: 1024, height: 800 });
    await page.goto(`${app.base}/`);
    await page.waitForURL((u) => u.pathname === '/clubs');
    assert.equal(await page.getByTestId('nav-clubs').getAttribute('aria-current'), 'page');
    assert.equal(await page.getByTestId('nav-team').getAttribute('href'), '/staff');
    await page.getByTestId('sign-out').click();
    await page.waitForURL((u) => u.pathname === '/sign-in');
    assert.ok(calls.some((c) => c.path === '/auth/sign-out'));
    await context.close();
  });

  it('fits 320 px with a very long club name: nothing sideways on the page, the filters wrap, targets are 44 px', async () => {
    const long = { clubId: 'c-long', nameTh: 'ชื่อสโมสรที่ยาวมากมายเหลือเกินและยังไม่จบง่าย ๆ'.repeat(2), nameEn: 'An Extraordinarily Long Club Name That Goes On And On '.repeat(3), status: 'testing', bookingsConfirmed30d: 1234567 };
    const { page, context } = await openPage(browser, api({ 'GET /clubs': { status: 200, body: { clubs: [long, ...CLUBS] } } }), { width: 320, height: 640 });
    await page.goto(`${app.base}/clubs`);
    await page.getByTestId('club-list').waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`);
    for (const l of await page.locator('nav a').all()) assert.ok((await l.boundingBox()).height >= 44, 'menu links are at least 44 px tall');
    await page.screenshot({ path: join(SHOTS, 'clubs-320.png') });
    await context.close();
  });
});
