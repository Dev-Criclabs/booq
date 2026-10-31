// F11-T15 A5 Customers (ADMIN-06): list, search, tag filter, paging, walk-in chip, export link, states; Thai and English at 1280 and 375 px (CC-5).
// Run: node --test --test-concurrency=1 'apps/web/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { SHOTS } from './harness.mjs';
import { chromium, DESK_PAGES, noSideways, openAdmin, startApp } from './admin-harness.mjs';

let app;
let browser;
before(async () => {
  app = await startApp(3114);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const customer = (n, over = {}) => ({ customerId: id(n), name: `Customer ${n}`, phone: `+6681000${String(n).padStart(4, '0')}`, tags: [], claimState: null, signedIn: true, lastBookingAt: '2027-01-12T17:30:00Z', bookingCount: n, createdAt: '2026-12-01T03:00:00Z', ...over });
const LONG = 'นางสาวสมหญิงจริงใจสุดยอดนามสกุลยาวมากเป็นพิเศษที่สุดในโลกสุดๆ';
const PAGE1 = Array.from({ length: 3 }, (_, i) => customer(i + 1));
const list = (rows, next = null) => ({ status: 200, body: { customers: rows, next } });

describe('A5 Customers', () => {
  it('lists the customers with phone, bookings, last visit and tags; a walk-in is marked; the whole list known shows its count', async () => {
    const rows = [customer(1, { tags: ['Partner gym', 'Influencer'] }), customer(2, { claimState: 'unclaimed', signedIn: false, lastBookingAt: null }), customer(3, { name: null })];
    const { page, context } = await openAdmin(browser, (m, p) => (p === '/staff/customers' ? list(rows) : undefined));
    await page.goto(`${app.base}/c/hunter/admin/customers`);
    await page.getByTestId('cust-table').waitFor();
    assert.equal((await page.getByTestId('cust-count').innerText()).trim(), '· 3 players');
    const first = await page.getByTestId(`cust-${id(1)}`).innerText();
    assert.match(first, /Customer 1/);
    assert.match(first, /\+66810000001/);
    assert.match(first, /13 Jan/);
    assert.match(first, /Partner gym/);
    assert.match(first, /Influencer/);
    assert.match(await page.getByTestId(`cust-${id(2)}`).innerText(), /Walk in/);
    assert.match(await page.getByTestId(`cust-${id(3)}`).innerText(), /No name yet/);
    assert.equal(await page.getByTestId(`cust-${id(1)}`).locator('a').getAttribute('href'), `/c/hunter/admin/customers/${id(1)}`);
    assert.equal(await page.getByTestId('cust-export').getAttribute('href'), '/api/c/hunter/staff/customers/csv');
    assert.equal(await page.getByTestId('nav-customers').getAttribute('aria-current'), 'page');
    await page.screenshot({ path: join(SHOTS, 'admin-customers.png'), fullPage: true });
    await context.close();
  });

  it('search and the tag filter are sent to the server, trimmed; nothing matching says so; clearing brings the list back', async () => {
    const { page, context, calls } = await openAdmin(browser, (m, p, s) => {
      if (p !== '/staff/customers') return undefined;
      if (s.includes('q=zzz')) return list([]);
      if (s.includes('tag=')) return list([customer(1, { tags: ['Partner gym'] })]);
      return list(PAGE1);
    });
    await page.goto(`${app.base}/c/hunter/admin/customers`);
    await page.getByTestId('cust-table').waitFor();
    await page.getByTestId('cust-search').fill(' zzz ');
    await page.getByTestId('cust-empty').waitFor();
    assert.match(await page.getByTestId('cust-empty').innerText(), /No customers match this search/);
    await page.getByTestId('cust-search').fill('');
    await page.getByTestId('cust-tag-filter').fill('Partner gym');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="cust-0000"]').length === 1);
    const searches = calls.filter((c) => c.path === '/staff/customers').map((c) => c.search);
    assert.ok(searches.includes('?q=zzz'), searches.join(' '));
    assert.ok(searches.some((s) => s === '?tag=Partner+gym'), searches.join(' '));
    await page.getByTestId('cust-tag-filter').fill('');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="cust-0000"]').length === 3);
    await context.close();
  });

  it('a long list pages: Show more asks for the next page with its cursor, adds the rows and then the count appears', async () => {
    const { page, context, calls } = await openAdmin(browser, (m, p, s) => (p === '/staff/customers' ? (s.includes('cursor=NEXT') ? list([customer(4), customer(3)]) : list(PAGE1, 'NEXT')) : undefined));
    await page.goto(`${app.base}/c/hunter/admin/customers`);
    await page.getByTestId('cust-more').waitFor();
    assert.equal(await page.getByTestId('cust-count').count(), 0, 'the count of a partial list would mislead');
    await page.getByTestId('cust-more').click();
    await page.getByTestId('cust-count').waitFor();
    assert.equal((await page.getByTestId('cust-count').innerText()).trim(), '· 4 players');
    assert.equal(await page.getByTestId('cust-more').count(), 0);
    assert.ok(calls.some((c) => c.search === '?cursor=NEXT'));
    await context.close();
  });

  it('empty club, a role the server refuses, and a lost network (with Try again) each have their own state', async () => {
    let empty = await openAdmin(browser, () => list([]));
    await empty.page.goto(`${app.base}/c/hunter/admin/customers`);
    assert.match(await empty.page.getByTestId('cust-empty').innerText(), /There are no customers yet/);
    await empty.context.close();

    const denied = await openAdmin(browser, () => ({ status: 403, body: { code: 'forbidden' } }));
    await denied.page.goto(`${app.base}/c/hunter/admin/customers`);
    await denied.page.getByTestId('cust-forbidden').waitFor();
    await denied.context.close();

    let up = false;
    const flaky = await openAdmin(browser, () => (up ? list(PAGE1) : 'offline'));
    await flaky.page.goto(`${app.base}/c/hunter/admin/customers`);
    await flaky.page.getByTestId('cust-error').waitFor();
    up = true;
    await flaky.page.getByTestId('cust-error').getByRole('button').click();
    await flaky.page.getByTestId('cust-table').waitFor();
    await flaky.context.close();
  });

  it('Thai and English, long names and many tags, at 1280 and 375 px: the table scrolls inside its box and the page does not scroll sideways', async () => {
    const rows = [customer(1, { name: LONG, tags: ['ยิมพาร์ทเนอร์ที่ยาวมากเป็นพิเศษ', 'Influencer', 'Partner gym', 'VIP'] }), customer(2, { name: 'Very Long Customer Name That Keeps Going And Going Without A Single Break', phone: '+66812345678' })];
    for (const lang of ['th', 'en']) {
      for (const width of [1280, 375]) {
        const { page, context } = await openAdmin(browser, (m, p) => (p === '/staff/customers' ? list(rows) : undefined), { lang, width });
        await page.goto(`${app.base}/c/hunter/admin/customers`);
        await page.getByTestId('cust-table').waitFor();
        assert.equal(await noSideways(page), true, `${lang} ${width}`);
        await page.screenshot({ path: join(SHOTS, `admin-customers-${lang}-${width}.png`), fullPage: true });
        await context.close();
      }
    }
  });

  it('front desk sees the list and the export link (the server decides the export permission, not the page)', async () => {
    const { page, context } = await openAdmin(browser, (m, p) => (p === '/staff/customers' ? list(PAGE1) : undefined), { pages: DESK_PAGES });
    await page.goto(`${app.base}/c/hunter/admin/customers`);
    await page.getByTestId('cust-table').waitFor();
    assert.equal(await page.getByTestId('cust-export').count(), 1);
    await context.close();
  });
});
