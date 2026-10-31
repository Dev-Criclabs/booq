// F01 console: the new club wizard (P2, five steps). The API is faked in the browser; no database.
// Run: node --test --test-concurrency=1 'apps/platform/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { chromium, openPage, SHOTS, startApp } from './harness.mjs';

let app;
let browser;
before(async () => {
  app = await startApp(3124);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

const ID = 'c-1';
const club = (over = {}) => ({ id: ID, slug: 'hunter', status: 'draft', name_th: 'ฮันเตอร์', name_en: 'Hunter Tennis Club', legal_name: null, tax_id: null, tax_branch: null, registered_address: null, owner_name: null, owner_phone: null, owner_line: null, owner_email: null, default_language: 'th', payment_option: null, plan_trial_ends_at: null, billing_starts_at: null, ...over });
const SUPPORT = (over = {}) => ({ setup: { mode: 'edit', club: club(), hours: [], locations: [{ id: 'l1', name: 'Main' }], resources: [], settings: [], features: [], featureKeys: [{ feature_key: 'coach_add_at_checkout', requires_payment_option: null }], ...over } });
const DETAIL = { progress: { setup: [], launch: [] }, counts: null };

const api = ({ over = {}, support = SUPPORT() } = {}) => (method, path, body) => {
  const key = `${method} ${path}`;
  if (over[key]) return typeof over[key] === 'function' ? over[key](body) : over[key];
  if (key === 'GET /auth/me') return { status: 200, body: { id: 'a1', role: 'platform_admin', displayName: 'Ada', stepUpFresh: true } };
  if (key === `GET /clubs/${ID}`) return { status: 200, body: DETAIL };
  if (key === `GET /clubs/${ID}/support/setup`) return { status: 200, body: support };
  if (key === `GET /clubs/${ID}/owner-invite`) return { status: 200, body: { invite: { status: 'none' } } };
  return { status: 404, body: { code: 'not_found' } };
};
const puts = (calls) => calls.filter((c) => c.method === 'PUT');

describe('the new club wizard', () => {
  it('step 1: the web address name follows the English name until it is edited; the club is created as typed, then step 2 opens', async () => {
    const over = { 'POST /clubs': { status: 200, body: { id: ID } } };
    const { page, context, calls } = await openPage(browser, api({ over }), { width: 1024, height: 1000 });
    await page.goto(`${app.base}/clubs/new`);
    await page.getByTestId('step-basics-form').waitFor();
    assert.match(await page.getByTestId('step-header').innerText(), /not saved yet/);
    await page.getByTestId('w-name_en').fill('Hunter Tennis Club');
    assert.equal(await page.getByTestId('w-slug').inputValue(), 'hunter-tennis-club');
    await page.getByTestId('next').click();
    assert.equal(await page.getByTestId('w-problem-name_th').innerText(), 'This is needed.');
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
    await page.getByTestId('w-name_th').fill('ฮันเตอร์ เทนนิส คลับ');
    await page.getByTestId('w-slug').fill('hunter');
    await page.getByTestId('w-name_en').fill('Hunter Tennis');
    assert.equal(await page.getByTestId('w-slug').inputValue(), 'hunter', 'an edited name stays');
    await page.getByTestId('w-tax_id').fill('123');
    await page.getByTestId('next').click();
    assert.match(await page.getByTestId('w-problem-tax_id').innerText(), /13 digits/);
    await page.getByTestId('w-tax_id').fill('0105555555555');
    await page.getByTestId('w-owner_email').fill('nok@example.com');
    await page.screenshot({ path: join(SHOTS, 'wizard-1.png'), fullPage: true });
    await page.getByTestId('next').click();
    await page.waitForURL(`**/clubs/${ID}/setup?step=2`);
    assert.deepEqual(calls.find((c) => c.method === 'POST').body, { name_th: 'ฮันเตอร์ เทนนิส คลับ', name_en: 'Hunter Tennis', slug: 'hunter', tax_id: '0105555555555', owner_email: 'nok@example.com', default_language: 'th' });
    await page.getByText('Same plan and price for every club').waitFor();
    await context.close();
  });

  it('a stale second factor opens the step-up, then the same create runs again; a taken name is told', async () => {
    let fresh = false;
    let taken = true;
    const over = {
      'POST /auth/step-up': () => ((fresh = true), { status: 200, body: { ok: true } }),
      'POST /clubs': () => (!fresh ? { status: 403, body: { code: 'step_up_required' } } : taken ? ((taken = false), { status: 409, body: { code: 'slug_taken' } }) : { status: 200, body: { id: ID } }),
    };
    const { page, context, calls } = await openPage(browser, api({ over }), { width: 1024, height: 900 });
    await page.goto(`${app.base}/clubs/new`);
    await page.getByTestId('w-name_th').fill('ก');
    await page.getByTestId('w-name_en').fill('A');
    await page.getByTestId('next').click();
    await page.getByTestId('step-up').waitFor();
    await page.locator('#stepup-password').fill('pw');
    await page.locator('#stepup-code').fill('123456');
    await page.getByTestId('step-up-submit').click();
    assert.match(await page.getByTestId('notice').innerText(), /already uses this web address name/);
    await page.getByTestId('next').click();
    await page.waitForURL(`**/clubs/${ID}/setup?step=2`);
    assert.equal(calls.filter((c) => c.path === '/clubs').length, 3);
    await context.close();
  });

  it('step 2: the plan is words only; the dates save as days in Bangkok; billing before the trial ends is refused', async () => {
    const over = { [`PUT /clubs/${ID}/support/setup/plan`]: { status: 200, body: { changed: ['plan_trial_ends_at'] } } };
    const { page, context, calls } = await openPage(browser, api({ over }), { width: 1024, height: 900 });
    await page.goto(`${app.base}/clubs/${ID}/setup?step=2`);
    await page.getByTestId('step-plan-form').waitFor();
    assert.doesNotMatch(await page.getByTestId('step-plan-form').innerText(), /฿|THB/);
    await page.getByTestId('w-trial').fill('2027-01-02');
    await page.getByTestId('w-billing').fill('2027-01-01');
    await page.getByTestId('save-draft').click();
    assert.match(await page.getByTestId('w-problem-plan').innerText(), /before the trial ends/);
    assert.equal(puts(calls).length, 0);
    await page.getByTestId('w-billing').fill('');
    await page.getByTestId('save-draft').click();
    await page.getByTestId('step-header').getByText(/saved as draft \d\d:\d\d/).waitFor();
    assert.deepEqual(puts(calls)[0].body, { plan_trial_ends_at: '2027-01-02T00:00:00+07:00' });
    await context.close();
  });

  it('steps 3 to 5: courts without the switches, LINE says it is not available yet, payments save the choice and open the club', async () => {
    const over = { [`PUT /clubs/${ID}/support/setup/basics`]: { status: 200, body: { changed: ['payment_option'] } } };
    const { page, context, calls } = await openPage(browser, api({ over }), { width: 1024, height: 900 });
    await page.goto(`${app.base}/clubs/${ID}/setup?step=3`);
    await page.getByTestId('add-court-form').waitFor();
    assert.equal(await page.getByTestId('features-form').count(), 0);
    await page.getByTestId('next').click();
    await page.waitForURL('**/setup?step=4');
    assert.match(await page.getByTestId('not-available').innerText(), /cannot be entered here yet/);
    await page.getByTestId('next').click();
    await page.waitForURL('**/setup?step=5');
    assert.doesNotMatch(await page.getByTestId('step-payments-form').innerText(), /Refunds go back/);
    assert.match(await page.getByTestId('step-payments-form').innerText(), /never as cash/);
    await page.getByTestId('option-slip').check();
    await page.getByTestId('finish').click();
    await page.waitForURL(`**/clubs/${ID}`);
    assert.deepEqual(puts(calls)[0].body, { payment_option: 'slip' });
    await context.close();
  });

  it('a live club is look only here, and a narrow screen does not scroll sideways', async () => {
    const live = SUPPORT();
    live.setup.mode = 'look';
    const a = await openPage(browser, api({ support: live }), { width: 320, height: 700 });
    await a.page.goto(`${app.base}/clubs/${ID}/setup?step=1`);
    await a.page.getByTestId('wizard-locked').waitFor();
    assert.equal(await a.page.getByTestId('w-name_en').isDisabled(), true);
    assert.equal(await a.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await a.context.close();
    const b = await openPage(browser, api(), { width: 320, height: 700 });
    await b.page.goto(`${app.base}/clubs/new`);
    await b.page.getByTestId('step-basics-form').waitFor();
    assert.equal(await b.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await b.context.close();
  });
});
