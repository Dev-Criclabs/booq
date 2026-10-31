// Shared by the club admin console suites (F11): a browser page with the club API faked by path, so no database is needed. `api` is a
// function (method, path, search, body) returning { status, body } or 'offline'; every call is recorded for the test to inspect.
import { chromium, startApp } from './harness.mjs';

export { chromium, startApp };

export const CLUB = { nameTh: 'ฮันเตอร์ เทนนิส คลับ', nameEn: 'Hunter Tennis Club', status: 'live', defaultLanguage: 'th' };
export const OWNER_PAGES = ['A0', 'A1', 'A2', 'A5', 'A6', 'A7', 'A8', 'A9', 'A9b', 'A10', 'A12', 'A13', 'A14', 'A16', 'A17'];
export const DESK_PAGES = ['A1', 'A2', 'A5', 'A6', 'A12'];
export const shell = (over = {}) => ({ pages: OWNER_PAGES, club: CLUB, paused: null, lineCap: null, lineTokenReason: null, ...over });

export async function openAdmin(browser, api, { lang = 'en', width = 1280, height = 900, pages = OWNER_PAGES } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, locale: lang === 'th' ? 'th-TH' : 'en-GB', acceptDownloads: true });
  await context.addCookies([{ name: 'lang', value: lang, url: 'http://localhost' }]);
  const page = await context.newPage();
  const calls = [];
  await page.route('**/fonts.{googleapis,gstatic}.com/**', (r) => r.continue().catch(() => r.abort()));
  await page.route('**/api/c/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api\/c\/[^/]+/, '');
    const body = req.postData() ? JSON.parse(req.postData()) : undefined;
    calls.push({ method: req.method(), path, search: url.search, body });
    if (path === '/staff/shell') return route.fulfill({ status: 200, json: shell({ pages }) });
    const r = api(req.method(), path, url.search, body, calls);
    if (r === 'offline') return route.abort('internetdisconnected');
    if (r === undefined) return route.fulfill({ status: 404, json: { code: 'not_found' } });
    return route.fulfill({ status: r.status, json: r.body });
  });
  return { page, context, calls };
}

export const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
