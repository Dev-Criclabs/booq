// F11-T22 A16 Settings (ADMIN-16): rules, opening hours, courts (label hint, no "Court 1" doubling), business and tax, BOOQ support window; the accountant
// reads the business card only; Thai and English at 1280 and 375 px (CC-5). The API is faked in the browser; no database.
// Run: node --test --test-concurrency=1 'apps/web/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { SHOTS } from './harness.mjs';
import { chromium, DESK_PAGES, noSideways, openAdmin, startApp } from './admin-harness.mjs';

let app;
let browser;
before(async () => {
  app = await startApp(3120);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

const url = '/c/hunter/admin/settings';
const BIZ = { legal_name: 'บริษัท ฮันเตอร์ เทนนิส คลับ จำกัด', tax_id: '0105500000001', tax_branch: '00000', registered_address: '1 Sukhumvit Road, Bangkok', receipt_prefix: 'HTC', vat_enabled: false };
const rule = (key, value = null, over = {}) => ({ key, value, unset: value === null, required: false, available: true, ...over });
const RULES = [
  rule('booking_window_days', 14), rule('cancel_window_hours'), rule('max_future_court_hours'), rule('hold_minutes', 15), rule('package_qr_minutes'),
  rule('waitlist_claim_minutes'), rule('waitlist_no_offer_hours'), rule('auto_slip_check'), rule('rest_cap_hours'), rule('group_min_players'), rule('group_max_players'),
  rule('below_min_alert_minutes'), rule('package_expiry_reminder_days', [7, 3]), rule('wallet_expiry_months'), rule('resource_label', 'court'), rule('birthday_discount'),
  rule('vat_enabled', false),
];
const SETUP = () => ({
  business: BIZ,
  hours: [{ weekday: 1, open: '07:00', close: '22:00' }, { weekday: 2, open: '07:00', close: '22:00' }],
  locations: [{ id: 'l1', name: 'Hunter Main' }],
  resources: [{ id: 'c1', location_id: 'l1', name: '1', sport: 'tennis', type: 'outdoor', lights: true, max_players: 4, active: true }],
  supportWindowUntil: null,
});

function server(state = {}) {
  const s = { setup: SETUP(), rules: RULES, ...state };
  return (method, path, search, body) => {
    if (path === '/club/setup') return { status: 200, body: s.setup };
    if (path === '/settings' && method === 'GET') return { status: 200, body: s.rules };
    if (path.startsWith('/settings/') && method === 'PUT') return s.putRule ? s.putRule(path, body) : { status: 200, body: { key: path.slice(10), value: body.value } };
    if (path === '/club/business') { s.setup = { ...s.setup, business: { ...s.setup.business, ...body } }; return { status: 200, body: s.setup.business }; }
    if (path === '/hours') return { status: 200, body: { hours: s.setup.hours } };
    if (path === '/resources' && method === 'POST') return { status: 200, body: { id: 'c2' } };
    if (path.startsWith('/resources/') && method === 'PUT') return { status: 200, body: { id: 'c1' } };
    if (path === '/support-window') { s.setup = { ...s.setup, supportWindowUntil: body.on ? '2099-01-01T03:00:00Z' : null }; return { status: 200, body: { on: body.on, until: s.setup.supportWindowUntil } }; }
    return undefined;
  };
}
const open = (api, o) => openAdmin(browser, api, o);
const msgOf = (page, id) => page.getByTestId(id).innerText();

describe('A16 Settings, owner', () => {
  it('draws the rule groups, hours, courts, business and support; unset rules stay empty', async () => {
    const { page, context } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('settings-page').waitFor();
    for (const g of ['booking', 'payment', 'coaches', 'packages', 'other']) await page.getByTestId(`set-group-${g}`).waitFor();
    for (const id of ['set-hours', 'set-courts', 'set-business', 'set-support']) await page.getByTestId(id).waitFor();
    assert.equal(await page.getByTestId('rule-booking_window_days-input').inputValue(), '14');
    assert.equal(await page.getByTestId('rule-cancel_window_hours-input').inputValue(), '');
    assert.equal(await page.getByTestId('rule-package_expiry_reminder_days-input').inputValue(), '7, 3');
    assert.equal(await page.getByTestId('nav-settings').getAttribute('aria-current'), 'page');
    await page.screenshot({ path: join(SHOTS, 'admin-settings.png'), fullPage: true });
    await context.close();
  });

  it('saves one rule on its own; a wrong value is refused before the server and a server refusal keeps what was typed', async () => {
    const { page, context, calls } = await open(server({ putRule: () => ({ status: 400, body: { code: 'invalid_value' } }) }));
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('rule-booking_window_days-input').waitFor();
    await page.getByTestId('rule-booking_window_days-input').fill('0');
    await page.getByTestId('rule-booking_window_days-save').click();
    await page.getByTestId('rule-booking_window_days-msg').waitFor();
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 0);
    await page.getByTestId('rule-booking_window_days-input').fill('30');
    await page.getByTestId('rule-booking_window_days-save').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="rule-booking_window_days-msg"]')?.getAttribute('role') === 'alert');
    const put = calls.find((c) => c.method === 'PUT' && c.path === '/settings/booking_window_days');
    assert.deepEqual(put.body, { value: 30 });
    assert.equal(await page.getByTestId('rule-booking_window_days-input').inputValue(), '30');
    await context.close();
  });

  it('court name: the hint says it holds only the label, and "Court 1" is refused so it does not show twice', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('set-courts').waitFor();
    assert.match(await page.getByTestId('set-courts').innerText(), /label/i);
    await page.getByTestId('c-c1-name').fill('Court 2');
    await page.getByTestId('c-c1-save').click();
    await page.getByTestId('court-c1').getByTestId('set-msg').waitFor();
    assert.equal(calls.filter((c) => c.path.startsWith('/resources/')).length, 0);
    await page.getByTestId('c-c1-name').fill('2');
    await page.getByTestId('c-c1-save').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="court-c1"] [data-testid="set-msg"]')?.getAttribute('role') === 'status');
    assert.deepEqual(calls.find((c) => c.method === 'PUT' && c.path === '/resources/c1').body, { id: 'c1', name: '2' });
    await page.getByTestId('new-name').fill('คอร์ต 3');
    await page.getByTestId('new-add').click();
    await page.getByTestId('court-new').getByTestId('set-msg').waitFor();
    assert.equal(calls.filter((c) => c.method === 'POST' && c.path === '/resources').length, 0);
    await page.getByTestId('new-name').fill('3');
    await page.getByTestId('new-add').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="court-new"] [data-testid="set-msg"]')?.getAttribute('role') === 'status');
    assert.deepEqual(calls.find((c) => c.method === 'POST' && c.path === '/resources').body, { location_id: 'l1', name: '3', sport: 'tennis', lights: false });
    await context.close();
  });

  it('hours save only the changed days; business saves only what changed and refuses a short tax ID', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('hours-3').waitFor();
    await page.getByTestId('closed-2').check();
    await page.getByTestId('hours-save').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="set-hours"] [data-testid="set-msg"]'));
    assert.deepEqual(calls.find((c) => c.path === '/hours').body, { hours: [{ weekday: 2, closed: true }] });
    await page.getByTestId('biz-tax_id').fill('123');
    await page.getByTestId('biz-save').click();
    await page.getByTestId('set-business').getByTestId('set-msg').waitFor();
    assert.equal(calls.filter((c) => c.path === '/club/business').length, 0);
    await page.getByTestId('biz-tax_id').fill('0105500000002');
    await page.getByTestId('biz-save').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="set-business"] [data-testid="set-msg"]')?.getAttribute('role') === 'status');
    assert.deepEqual(calls.find((c) => c.path === '/club/business').body, { tax_id: '0105500000002' });
    await context.close();
  });

  it('BOOQ support window turns on and off', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('support-toggle').click();
    await page.waitForFunction(() => /\d/.test(document.querySelector('[data-testid="support-state"]')?.textContent ?? ''));
    await page.getByTestId('support-toggle').click();
    await page.waitForFunction(() => !/\d/.test(document.querySelector('[data-testid="support-state"]')?.textContent ?? ''));
    assert.deepEqual(calls.filter((c) => c.path === '/support-window').map((c) => c.body), [{ on: true }, { on: false }]);
    await context.close();
  });
});

describe('A16 Settings, other roles and states', () => {
  it('the accountant sees the business card read only and nothing else', async () => {
    const { page, context } = await open(server({ setup: { business: BIZ } }), { pages: DESK_PAGES.concat(['A16']) });
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('set-business').waitFor();
    assert.equal(await page.getByTestId('biz-save').count(), 0);
    assert.equal(await page.getByTestId('set-hours').count(), 0);
    assert.equal(await page.getByTestId('set-courts').count(), 0);
    assert.equal(await page.getByTestId('set-group-booking').count(), 0);
    assert.equal(await page.getByTestId('biz-legal_name').getAttribute('readonly'), '');
    await context.close();
  });

  it('a refused role and a lost network have their own states, and retry works', async () => {
    const no = await open(() => ({ status: 403, body: { code: 'forbidden' } }));
    await no.page.goto(`${app.base}${url}`);
    await no.page.getByTestId('set-forbidden').waitFor();
    await no.context.close();
    let up = false;
    const flaky = await open((...a) => (up ? server()(...a) : 'offline'));
    await flaky.page.goto(`${app.base}${url}`);
    await flaky.page.getByTestId('set-error').waitFor();
    up = true;
    await flaky.page.getByTestId('set-error').getByRole('button').click();
    await flaky.page.getByTestId('settings-page').waitFor();
    await flaky.context.close();
  });

  for (const lang of ['th', 'en']) {
    for (const width of [1280, 375]) {
      it(`${lang} at ${width}px: no sideways scroll, buttons do not wrap, long text survives`, async () => {
        const long = 'บริษัท ฮันเตอร์ เทนนิส คลับ แอนด์ สปอร์ต เรสซิเดนซ์ จำกัด (มหาชน) สาขาใหญ่ ถนนสุขุมวิท กรุงเทพมหานคร';
        const api = server({ setup: { ...SETUP(), business: { ...BIZ, legal_name: long, registered_address: long.repeat(2) } } });
        const { page, context } = await open(api, { lang, width });
        await page.goto(`${app.base}${url}`);
        await page.getByTestId('settings-page').waitFor();
        assert.equal(await noSideways(page), true);
        const wrapped = await page.evaluate(() => [...document.querySelectorAll('.adm-btn')].filter((b) => b.getClientRects()[0] && b.getClientRects()[0].height > 2.6 * parseFloat(getComputedStyle(b).fontSize) * 1.5).length);
        assert.equal(wrapped, 0);
        await page.screenshot({ path: join(SHOTS, `admin-settings-${lang}-${width}.png`), fullPage: true });
        await context.close();
      });
    }
  }
});
