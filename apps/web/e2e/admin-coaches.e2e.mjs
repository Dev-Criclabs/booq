// F11-T16 A7 Coaches (ADMIN-08): the list, leave to approve or decline, solo classes that need a substitute, the owner's editor (tier, public profile, consent, publish,
// price overrides, pay); front desk reads the list and who is away; Thai and English at 1280 and 375 px (CC-5). The API is faked in the browser; no database.
// Run: node --test --test-concurrency=1 'apps/web/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { SHOTS } from './harness.mjs';
import { chromium, DESK_PAGES, noSideways, openAdmin, startApp } from './admin-harness.mjs';

let app;
let browser;
before(async () => {
  app = await startApp(3126);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

const url = '/c/hunter/admin/coaches';
const COACHES = [
  { coachId: 'c1', displayName: 'Coach Cat', tierId: 't1', active: true, published: true },
  { coachId: 'c2', displayName: 'Coach Dan', tierId: null, active: false, published: false },
];
const FULL = {
  ...COACHES[0], consentAt: '2027-01-01T03:00:00Z', overrides: [{ priceGroupId: 'g1', priceSatang: 90000 }],
  profile: { bioTh: null, bioEn: 'Hello', certificationsTh: null, certificationsEn: null, specialtiesTh: [], specialtiesEn: ['Serve'], agesLevelsTh: null, agesLevelsEn: null, languages: ['en'], photoPath: null },
};
const LEAVE = [{ leaveId: 'l1', coachId: 'c1', startDate: '2027-01-20', endDate: '2027-01-20', fromHour: null, toHour: null, status: 'pending', type: null, note: 'Personal' }];
const FLAGS = [{ bookingId: 'b1', coachId: 'c1', resourceId: 'k1', startAt: '2027-01-20T02:00:00Z', endAt: '2027-01-20T03:00:00Z', reason: 'leave' }];
const AWAY = [{ leaveId: 'l2', coachId: 'c2', coachName: 'Coach Dan', startDate: '2027-01-25', endDate: '2027-01-26', fromHour: null, toHour: null, status: 'approved' }];
const PAY = { monthlyBaseSatang: null, soloPayKind: null, soloPayValue: null, groupPayKind: null, groupPayValue: null };

function server(state = {}) {
  const s = { leave: LEAVE, flags: FLAGS, ...state };
  return (method, path, search, body) => {
    if (path === '/staff/coaches') return { status: 200, body: COACHES };
    if (path === '/staff/coaches/c1' && method === 'GET') return { status: 200, body: FULL };
    if (path === '/staff/coaches/c1' && method === 'PUT') return s.put ?? { status: 200, body: { ...FULL, ...(body.active === false ? { active: false } : {}) } };
    if (path === '/staff/coaches/c1/pay' && method === 'GET') return { status: 200, body: PAY };
    if (path === '/staff/coaches/c1/pay' && method === 'PUT') return { status: 200, body: { ...PAY, monthlyBaseSatang: body.monthlyBaseSatang } };
    if (path === '/staff/leave') return { status: 200, body: s.leave };
    if (path === '/staff/leave/l1/decision') return { status: 200, body: { ok: true } };
    if (path === '/staff/flagged-sessions') return { status: 200, body: s.flags };
    if (path === '/staff/leave-calendar') return { status: 200, body: AWAY };
    if (path === '/staff/bookings/b1/substitutes') return { status: 200, body: s.subs ?? [COACHES[1]] };
    if (path === '/staff/bookings/b1/substitute') return s.sub ?? { status: 200, body: { substitutionId: 's1' } };
    if (path === '/staff/setup/coach-tiers') return { status: 200, body: [{ id: 't1', nameTh: 'หัวหน้าโค้ช', nameEn: 'Head Coach' }] };
    if (path === '/staff/setup/price-groups') return { status: 200, body: [{ id: 'g1', nameTh: 'ผู้ใหญ่', nameEn: 'Adult' }, { id: 'g2', nameTh: 'นักเรียน', nameEn: 'Student' }] };
    if (path === '/courts') return { status: 200, body: { status: 'live', today: '2027-01-18', bookingWindowDays: 14, courts: [], openingHours: [] } };
    return undefined;
  };
}
const open = (api, o) => openAdmin(browser, api, o);
const writes = (calls, re) => calls.filter((c) => c.method !== 'GET' && re.test(c.path));

describe('A7 Coaches, owner', () => {
  it('lists the coaches with tier and state, counts the leave requests, and shows who is away', async () => {
    const { page, context } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('coach-table').waitFor();
    assert.match(await page.getByTestId('coach-summary').innerText(), /2 coaches · 1 leave request/);
    const cat = await page.getByTestId('coach-c1').innerText();
    assert.match(cat, /Coach Cat/);
    assert.match(cat, /Head Coach/);
    assert.match(cat, /Active/);
    assert.match(await page.getByTestId('coach-c2').innerText(), /No tier/);
    assert.match(await page.getByTestId('coach-away').innerText(), /Coach Dan/);
    assert.equal(await page.getByTestId('nav-coaches').getAttribute('aria-current'), 'page');
    assert.equal(await page.getByTestId('coach-add').getAttribute('href'), '/c/hunter/admin/staff?role=coach');
    await page.screenshot({ path: join(SHOTS, 'admin-coaches.png'), fullPage: true });
    await context.close();
  });

  it('approve and decline a leave request', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('approve-l1').click();
    await page.getByTestId('coach-msg').waitFor();
    assert.deepEqual(writes(calls, /decision/)[0].body, { approve: true });
    await page.getByTestId('decline-l1').click();
    await page.waitForTimeout(300);
    assert.deepEqual(writes(calls, /decision/).map((c) => c.body), [{ approve: true }, { approve: false }]);
    await context.close();
  });

  it('a solo class that needs a substitute lists only the free coaches and assigns one with the flag\'s reason', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('flag-b1').waitFor();
    await page.getByTestId('assign-b1').click();
    await page.getByTestId('flag-msg').waitFor();
    assert.equal(writes(calls, /substitute$/).length, 0);
    await page.getByTestId('sub-b1').selectOption('c2');
    await page.getByTestId('assign-b1').click();
    await page.waitForTimeout(300);
    assert.deepEqual(writes(calls, /substitute$/)[0].body, { coachId: 'c2', reason: 'leave' });
    await context.close();
    const none = await open(server({ subs: [] }));
    await none.page.goto(`${app.base}${url}`);
    await none.page.getByTestId('flag-b1').getByText(/No other coach is free/).waitFor();
    await none.context.close();
  });

  it('the editor shows the stored profile with unset values empty; consent is needed to publish; only changes are saved; overrides go in satang', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('edit-c1').click();
    await page.getByTestId('coach-editor').waitFor();
    assert.equal(await page.getByTestId('co-bioEn').inputValue(), 'Hello');
    assert.equal(await page.getByTestId('co-bioTh').inputValue(), '');
    assert.equal(await page.getByTestId('co-ovr-g1').inputValue(), '900');
    assert.equal(await page.getByTestId('co-ovr-g2').inputValue(), '');
    assert.equal(await page.getByTestId('co-tier').inputValue(), 't1');
    assert.match(await page.getByTestId('coach-editor').innerText(), /Thai missing/);
    await page.getByTestId('co-save').click();
    await page.getByTestId('co-msg').waitFor();
    assert.equal(writes(calls, /coaches\/c1$/).length, 0);
    await page.getByTestId('co-bioTh').fill('สวัสดี');
    await page.getByTestId('co-ovr-g2').fill('800.50');
    await page.getByTestId('co-save').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="co-msg"]')?.getAttribute('role') === 'status');
    assert.deepEqual(writes(calls, /coaches\/c1$/)[0].body, { profile: { bio_th: 'สวัสดี' }, overrides: [{ priceGroupId: 'g2', priceSatang: 80050 }] });
    await context.close();
  });

  it('pay: unset values are empty; a kind needs its amount; the whole set is saved with money in satang', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('edit-c1').click();
    await page.getByTestId('coach-pay').waitFor();
    assert.equal(await page.getByTestId('pay-base').inputValue(), '');
    await page.getByTestId('pay-solo-kind').selectOption('percent');
    await page.getByTestId('pay-save').click();
    await page.getByTestId('pay-msg').waitFor();
    assert.equal(writes(calls, /pay$/).length, 0);
    await page.getByTestId('pay-solo-value').fill('60');
    await page.getByTestId('pay-base').fill('20000');
    await page.getByTestId('pay-save').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="pay-msg"]')?.getAttribute('role') === 'status');
    assert.deepEqual(writes(calls, /pay$/)[0].body, { monthlyBaseSatang: 2000000, soloPayKind: 'percent', soloPayValue: 6000, groupPayKind: null, groupPayValue: null });
    await context.close();
  });
});

describe('A7 Coaches, front desk and states', () => {
  it('front desk reads the list and who is away, and has no leave, substitute, edit or pay', async () => {
    const { page, context, calls } = await open(server(), { pages: DESK_PAGES.concat(['A7']) });
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('coach-table').waitFor();
    assert.equal(await page.getByTestId('coach-leave').count(), 0);
    assert.equal(await page.getByTestId('coach-flagged').count(), 0);
    assert.equal(await page.getByTestId('edit-c1').count(), 0);
    assert.equal(await page.getByTestId('coach-add').count(), 0);
    assert.match(await page.getByTestId('coach-away').innerText(), /Coach Dan/);
    assert.equal(calls.filter((c) => c.path === '/staff/leave' || c.path === '/staff/flagged-sessions').length, 0);
    await context.close();
  });

  it('a refused role and a lost network have their own states', async () => {
    const no = await open(() => ({ status: 403, body: { code: 'forbidden' } }));
    await no.page.goto(`${app.base}${url}`);
    await no.page.getByTestId('coach-forbidden').waitFor();
    await no.context.close();
    const off = await open(() => 'offline');
    await off.page.goto(`${app.base}${url}`);
    await off.page.getByTestId('coach-error').waitFor();
    await off.context.close();
  });

  for (const lang of ['th', 'en']) {
    for (const width of [1280, 375]) {
      it(`${lang} at ${width}px: no sideways scroll with long names and the editor open`, async () => {
        const long = 'โค้ชสมชาย ใจดีมากมายหลายประการ Coach Somchai Jaidee-Wongsawat the Third';
        const api = (m, p, s, b) => (p === '/staff/coaches' ? { status: 200, body: [{ ...COACHES[0], displayName: long }, COACHES[1]] } : server()(m, p, s, b));
        const { page, context } = await open(api, { lang, width });
        await page.goto(`${app.base}${url}`);
        await page.getByTestId('coach-table').waitFor();
        assert.equal(await noSideways(page), true);
        await page.getByTestId('edit-c1').click();
        await page.getByTestId('coach-pay').waitFor();
        assert.equal(await noSideways(page), true);
        await page.screenshot({ path: join(SHOTS, `admin-coaches-${lang}-${width}.png`), fullPage: true });
        await context.close();
      });
    }
  }
});
