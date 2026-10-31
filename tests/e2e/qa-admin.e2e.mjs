// QA journeys on the club admin console (F11-T12, T15, T23): the same clipping audit as qa-journeys.e2e.mjs at 320 px and at desktop width, with the longest Thai and
// English names, notes, tags and club name, on the admin home, A5 Customers, A6 Customer profile and the staff page. Uses the lane's admin harness
// (apps/web/e2e/admin-harness.mjs). Run: node --test --test-concurrency=1 tests/e2e/*.e2e.mjs
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, openAdmin, startApp, CLUB, OWNER_PAGES, DESK_PAGES } from '../../apps/web/e2e/admin-harness.mjs';

const OUT = join(fileURLToPath(new URL('.', import.meta.url)), 'screenshots');
const LONG_TH = 'นางสาวสมหญิงจริงใจสุดยอดนามสกุลยาวมากเป็นพิเศษที่สุดในโลกสุดๆ';
const LONG_EN = 'Priyaporn Srisukcharoenpornsawat-Wongsakulpanich the Third';
const LONG_CLUB = { ...CLUB, nameTh: 'สโมสรเทนนิสฮันเตอร์เพื่อสุขภาพและการออกกำลังกายสำหรับทุกวัย', nameEn: 'Hunter Tennis and Wellness Club for Every Age and Level' };
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ID = id(1);
const customer = (n, over = {}) => ({ customerId: id(n), name: `Customer ${n}`, phone: `+6681000${String(n).padStart(4, '0')}`, tags: [], claimState: null, signedIn: true, lastBookingAt: '2027-01-12T17:30:00Z', bookings: 3, ...over });
const rows = [customer(1, { name: LONG_TH, tags: ['ยิมพาร์ทเนอร์ที่ยาวมากเป็นพิเศษ', 'Influencer and long term partner gym', 'VIP', 'Coach referral'] }), customer(2, { name: LONG_EN, claimState: 'unclaimed', signedIn: false }), customer(3, { name: null })];
const profile = { customerId: ID, displayName: LONG_EN, fullName: LONG_TH + ' ' + LONG_EN, phone: '+66812345678', language: 'th', level: 'beginner', dateOfBirth: '1994-03-14', claimState: null, signedIn: true, active: true, tags: ['ยิมพาร์ทเนอร์ที่ยาวมากเป็นพิเศษ', 'VIP', 'Influencer and long term partner gym'], createdAt: '2026-12-01T03:00:00Z' };
const booking = (n, over = {}) => ({ bookingId: `b${n}`, orderId: `o${n}`, type: 'court', courtName: '1', coachName: null, classNameTh: null, classNameEn: null, startAt: `2025-01-0${n}T10:00:00Z`, endAt: `2025-01-0${n}T11:00:00Z`, status: 'confirmed', source: 'online', cancelKind: null, cancelOutcome: null, ...over });
const VALUE = { packages: [{ packageId: 'p1', nameTh: 'แพ็กเกจฝึกซ้อมเทนนิสสำหรับเด็กเล็กและผู้เริ่มต้น 10 ชั่วโมง', nameEn: 'Beginner and junior tennis practice bundle of ten hours', creditType: 'court_hour', creditsTotal: 10, creditsLeft: 7, status: 'active', purchasedAt: '2027-01-09T03:00:00Z', expiresAt: '2027-04-09T03:00:00Z' }], wallet: { balanceSatang: 50000, ledger: [{ at: '2027-01-10T03:00:00Z', change: 50000, reason: 'cancel', note: LONG_TH }] }, creditLedger: [] };
const NOTES = [{ noteId: 'n1', note: 'บันทึกที่ยาวมากเป็นพิเศษ '.repeat(8) + ' Long note '.repeat(12), by: LONG_EN, at: '2027-01-12T03:00:00Z' }];
const STAFF = [{ id: id(1), display_name: LONG_EN, roles: ['owner', 'player'], active: true }, { id: id(2), display_name: LONG_TH, roles: ['front_desk', 'accountant', 'coach', 'player'], active: true }];
const api = (m, p) => {
  if (p === '/staff/customers') return { status: 200, body: { customers: rows, next: null } };
  if (p === `/staff/customers/${ID}`) return { status: 200, body: profile };
  if (p === `/staff/customers/${ID}/bookings`) return { status: 200, body: [booking(1), booking(2, { status: 'cancelled', cancelKind: 'player_cancel', cancelOutcome: 'returned' }), booking(3, { type: 'class_seat', classNameEn: 'Adult beginner clinic with a very long name for the class', classNameTh: 'คลินิกมือใหม่ผู้ใหญ่ที่มีชื่อยาวมากเป็นพิเศษสำหรับคลาส', courtName: 'Main outdoor court by the east entrance' })] };
  if (p === `/staff/customers/${ID}/orders`) return { status: 200, body: [] };
  if (p === `/staff/customers/${ID}/credits`) return { status: 200, body: VALUE };
  if (p === `/staff/customers/${ID}/notes`) return { status: 200, body: NOTES };
  if (p === '/staff' ) return { status: 200, body: STAFF };
  if (p === '/staff/invites') return { status: 200, body: [] };
  if (p === '/staff/audit') return { status: 200, body: { entries: [], next: null } };
  return undefined;
};
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
  app = await startApp(3133);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

const screens = [
  { name: 'admin home', path: '/c/hunter/admin', wait: '[data-testid=nav-customers], nav' },
  { name: 'A5 customers', path: '/c/hunter/admin/customers', wait: '[data-testid=cust-table]' },
  { name: 'A6 customer profile', path: `/c/hunter/admin/customers/${ID}`, wait: '[data-testid=profile]' },
  { name: 'staff', path: '/c/hunter/admin/staff', wait: '[data-testid=staff-table]' },
];

describe('QA: the admin console has nothing cut off with the longest strings', () => {
  for (const s of screens) {
    for (const lang of ['th', 'en']) {
      for (const width of [320, 1280]) {
        it(`${s.name}, ${lang}, ${width} px`, async () => {
          const { page, context } = await openAdmin(browser, api, { lang, width, height: width === 320 ? 568 : 900 });
          await page.route('**/api/c/hunter/staff/shell', (r) => r.fulfill({ status: 200, json: { pages: OWNER_PAGES, club: LONG_CLUB, paused: null, lineCap: null, lineTokenReason: null } }));
          await page.goto(`${app.base}${s.path}`);
          await page.locator(s.wait).first().waitFor();
          await page.evaluate(() => document.fonts.ready);
          const problems = (await page.evaluate(AUDIT)).filter((x) => !x.includes('adm-club'));   // the club name in the top bar: QA-UI-2 below
          await page.screenshot({ path: join(OUT, `admin-${s.name.replace(/\W+/g, '-')}-${lang}-${width}.png`), fullPage: true });
          await context.close();
          assert.deepEqual(problems, []);
        });
      }
    }
  }
});

// QA-UI-2 (severity 5): the admin top bar ends a long club name with an ellipsis at 320 px, and nothing else on the page shows the full name (no title, no tooltip on touch).
// D179 says the club name has no length limit. Marked todo: it passes when the bar wraps or the name is readable elsewhere.
describe('QA-UI-2 the admin top bar shows the whole club name', () => {
  it('320 px, Thai and English', { todo: 'QA-UI-2' }, async () => {
    for (const lang of ['th', 'en']) {
      const { page, context } = await openAdmin(browser, api, { lang, width: 320, height: 568 });
      await page.route('**/api/c/hunter/staff/shell', (r) => r.fulfill({ status: 200, json: { pages: OWNER_PAGES, club: LONG_CLUB, paused: null, lineCap: null, lineTokenReason: null } }));
      await page.goto(`${app.base}/c/hunter/admin`);
      await page.getByTestId('adm-club').waitFor();
      const cut = await page.getByTestId('adm-club').evaluate((e) => e.scrollWidth > e.clientWidth + 1);
      await context.close();
      assert.equal(cut, false, `${lang}: the club name is cut with an ellipsis`);
    }
  });
});
