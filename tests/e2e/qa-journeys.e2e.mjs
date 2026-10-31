// QA journeys on the player app (Playwright library + node:test), using the lane's harness (apps/web/e2e/harness.mjs): next dev with the LIFF fake and a faked
// club API, so no database is needed. These do not repeat apps/web/e2e. They add what the lane does not check:
//   * clipping: any box whose text is cut off (overflow hidden or an ellipsis) at 320 px with the longest th and en strings, on every built page;
//   * BOOK-01 states with colour off, and in forced colors mode (high contrast), including the selected hour;
//   * what Continue does today, and a guest's way into a person page and back.
// Run: node --test --test-concurrency=1 tests/e2e/*.e2e.mjs
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, openPage, SHOTS, startApp, CLUB } from '../../apps/web/e2e/harness.mjs';

const OUT = join(fileURLToPath(new URL('.', import.meta.url)), 'screenshots');
const guest = { inClient: false, loggedIn: false, idToken: 't', language: 'th' };
const LONG_TH = 'สนามเทนนิสกลางแจ้งหมายเลขหนึ่งติดทางเข้าด้านทิศตะวันออก';
const LONG_EN = 'Main outdoor tennis court number one by the east entrance';
const LONG_CLUB = { ...CLUB, nameTh: 'สโมสรเทนนิสฮันเตอร์เพื่อสุขภาพและการออกกำลังกายสำหรับทุกวัย', nameEn: 'Hunter Tennis and Wellness Club for Every Age and Level' };
const TODAY = '2027-01-09';
const courts = [{ id: 'c1', name: LONG_EN, sport: 'tennis' }, { id: 'c2', name: '2', sport: 'tennis' }];
const info = (over = {}) => ({ status: 'live', today: TODAY, bookingWindowDays: 6, courts, openingHours: [], ...over });
const hour = (date, h, state, waitlist = false) => ({ start: `${date}T${String(h).padStart(2, '0')}:00:00+07:00`, state, waitlist });
const c1 = { 16: 'past', 17: 'taken', 18: 'held', 19: 'open', 20: 'open', 21: 'closed', 22: 'mine', 23: 'open' };
const day = (date) => ({ date, courts: [{ ...courts[0], hours: Object.entries(c1).map(([h, s]) => hour(date, +h, s, s === 'taken')) }, { ...courts[1], hours: Object.keys(c1).map((h) => hour(date, +h, +h === 16 ? 'past' : 'open')) }], dayFull: false, waitlist: false });
const days = Array.from({ length: 7 }, (_, i) => ({ date: new Date(Date.parse(`${TODAY}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), courts: courts.map((c) => ({ id: c.id, openHours: 9 })), dayFull: false, waitlist: false }));
const schedule = (over = {}) => ({ courts: info(), days, dayFor: day, ...over });
const person = { fullName: 'ปรียาภรณ์ ศรีสุขเจริญพรสวัสดิ์ Priyaporn Srisukcharoenpornsawat', phone: '0812345678', dateOfBirth: '1990-01-01', level: null, language: 'th', priceGroup: 'adult' };

// Runs in the page: every box whose content is cut off or pushed outside the viewport, and every button or link whose text wraps.
const AUDIT = () => {
  const out = [];
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
  const name = (e) => `${e.tagName.toLowerCase()}${e.dataset?.testid ? `[${e.dataset.testid}]` : ''}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''}`;
  for (const e of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || e.closest('svg')) continue;
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const clips = (v) => v === 'hidden' || v === 'clip';
    if (clips(cs.overflowX) || clips(cs.overflowY)) {
      // Only text that is really cut: a descendant with its own text that reaches past this box (a decoration with no text does not count).
      for (const d of e.querySelectorAll('*')) {
        if (d.closest('[aria-hidden=true]') || d.closest('svg')) continue;
        if (![...d.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const q = d.getBoundingClientRect();
        if (q.width === 0 || q.height === 0) continue;
        if (clips(cs.overflowY) && q.bottom > r.bottom + 1) out.push(`cut off at the bottom: "${d.textContent.trim().slice(0, 40)}" inside ${name(e)}`);
        if (clips(cs.overflowX) && q.right > r.right + 1) out.push(`cut off sideways: "${d.textContent.trim().slice(0, 40)}" inside ${name(e)}`);
      }
    }
    if (hasText && cs.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1) out.push(`ellipsis hides text: ${name(e)} "${e.textContent.trim().slice(0, 40)}"`);
    const scroller = (() => { for (let a = e.parentElement; a; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; })();
    if (hasText && !scroller && (r.right > vw + 1 || r.left < -1)) out.push(`outside the screen: ${name(e)} "${e.textContent.trim().slice(0, 40)}"`);
    if (e.matches('button, a[role=button], [data-testid=continue], .btn') && [...e.children].filter((c) => c.textContent.trim()).length < 2) {
      // One text label: its lines are the distinct tops of the rectangles of its text nodes (an icon beside it is not a line).
      const tops = new Set();
      const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const q of range.getClientRects()) if (q.width > 0) tops.add(Math.round(q.top / 4));
      }
      if (tops.size > 1) out.push(`button text wraps: ${name(e)} "${e.textContent.trim().slice(0, 40)}"`);
    }
  }
  return [...new Set(out)];
};

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

const pages = [
  { name: 'C1 welcome', path: '/c/hunter/sign-in', opts: { me: null } },
  { name: 'C3 guest home', path: '/c/hunter', opts: { me: null } },
  { name: 'C4 schedule', path: '/c/hunter/book', opts: { schedule: schedule() }, wait: 'grid' },
  { name: 'C4 paused', path: '/c/hunter/book', opts: { schedule: schedule({ courts: info({ status: 'paused' }) }) }, wait: null },
  { name: 'My bookings (signed in)', path: '/c/hunter/bookings', opts: { me: { profile: person } }, wait: null },
  { name: 'Profile (signed in)', path: '/c/hunter/profile', opts: { me: { profile: person } }, wait: null },
];

describe('QA: nothing is cut off at 320 px with the longest strings, in Thai and English', () => {
  for (const p of pages) {
    for (const lang of ['th', 'en']) {
      it(`${p.name}, ${lang}`, async () => {
        const { page, context } = await openPage(browser, { liff: guest, lang, club: LONG_CLUB, width: 320, height: 568, ...p.opts });
        await page.goto(`${app.base}${p.path}`);
        if (p.wait) await page.getByTestId(p.wait).waitFor();
        else await page.waitForLoadState('networkidle');
        await page.evaluate(() => document.fonts.ready);
        const problems = await page.evaluate(AUDIT);
        await page.screenshot({ path: join(OUT, `${p.name.replace(/\W+/g, '-')}-${lang}-320.png`), fullPage: true });
        await context.close();
        assert.deepEqual(problems, []);
      });
    }
  }
});

// QA-UI-1: the club name has no length limit in the spec, and the welcome hero (C1) clips the last line of a long English name at 320 px.
// Marked todo so the run stays green; it passes when the hero grows with its text.
describe('QA-UI-1 the welcome hero holds a long club name', () => {
  for (const [label, nameEn] of [['55 characters', LONG_CLUB.nameEn], ['101 characters', 'Hunter Tennis and Wellness Club for Every Age and Level of Experience in Bangkok and Nearby Provinces']]) {
    it(`${label}`, { todo: label.startsWith('101') ? 'QA-UI-1' : false }, async () => {
      const { page, context } = await openPage(browser, { liff: guest, lang: 'en', club: { ...CLUB, nameEn }, width: 320, height: 568, me: null });
      await page.goto(`${app.base}/c/hunter/sign-in`);
      await page.locator('.welcome-hero').waitFor();
      await page.evaluate(() => document.fonts.ready);
      const problems = await page.evaluate(AUDIT);
      await context.close();
      assert.deepEqual(problems, []);
    });
  }
});

describe('QA: BOOK-01 states with colour off and in forced colors', () => {
  const stateReport = (page) =>
    page.locator('.grid [data-state]').evaluateAll((els) =>
      els.map((e) => ({ state: e.dataset.state, label: e.getAttribute('aria-label') ?? '', text: e.querySelector('.slot-text')?.textContent ?? '', icon: e.querySelector('svg')?.innerHTML ?? '', button: e.tagName === 'BUTTON' })),
    );
  for (const mode of ['grayscale filter', 'forced colors']) {
    it(`${mode}: seven states, seven different words and icons, selected included`, async () => {
      const { page, context } = await openPage(browser, { liff: guest, lang: 'en', schedule: schedule() });
      if (mode === 'forced colors') await page.emulateMedia({ forcedColors: 'active' });
      await page.goto(`${app.base}/c/hunter/book`);
      await page.getByTestId('grid').waitFor();
      if (mode === 'grayscale filter') await page.addStyleTag({ content: 'html { filter: grayscale(1) contrast(1) !important; }' });
      await page.getByRole('button', { name: /Court 2 · 19:00 ·/ }).click();   // an open hour becomes selected
      const rows = await stateReport(page);
      const byState = new Map(rows.map((r) => [r.state, r]));
      assert.deepEqual([...byState.keys()].sort(), ['closed', 'held', 'mine', 'open', 'past', 'selected', 'taken']);
      for (const key of ['text', 'icon']) assert.equal(new Set([...byState.values()].map((r) => r[key])).size, 7, `${key} must differ in every state`);
      // A screen reader gets the state too: every cell has a name that carries its hour.
      for (const r of rows) assert.ok((r.label || r.text).length > 0, `${r.state} has no name`);
      await page.screenshot({ path: join(OUT, `C4-${mode.replace(/\W+/g, '-')}.png`) });
      await context.close();
    });
  }

  it('keyboard: only open hours take focus, Enter selects, and the focus is visible', async () => {
    const { page, context } = await openPage(browser, { liff: guest, lang: 'en', schedule: schedule() });
    await page.goto(`${app.base}/c/hunter/book`);
    await page.getByTestId('grid').waitFor();
    const focusable = await page.locator('.grid [data-state]').evaluateAll((els) => els.filter((e) => e.tabIndex >= 0).map((e) => e.dataset.state));
    assert.ok(focusable.length > 0 && focusable.every((s) => s === 'open'), `focusable states: ${[...new Set(focusable)]}`);
    const cell = page.getByRole('button', { name: /Court 2 · 19:00 ·/ });
    await cell.focus();
    const ring = await cell.evaluate((e) => { const cs = getComputedStyle(e); return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), shadow: cs.boxShadow }; });
    assert.ok(ring.style !== 'none' && ring.width > 0 || ring.shadow !== 'none', `no focus ring: ${JSON.stringify(ring)}`);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-state=selected]').count(), 1);
    await context.close();
  });
});

describe('QA: where the booking journey ends today', () => {
  it('Continue from C4 goes to /c/hunter/checkout; what is there? (C10 is not built)', { todo: 'C10 checkout page not built' }, async () => {
    const { page, context } = await openPage(browser, { liff: guest, lang: 'en', schedule: schedule() });
    await page.goto(`${app.base}/c/hunter/book`);
    await page.getByTestId('grid').waitFor();
    await page.getByRole('button', { name: /Court 2 · 19:00 ·/ }).click();
    await page.getByTestId('continue').click();
    await page.waitForURL((u) => u.pathname === '/c/hunter/checkout');
    const res = await page.goto(page.url());
    await context.close();
    assert.ok(res.status() < 400, `GET ${page.url()} answers ${res.status()}`);
  });
});
