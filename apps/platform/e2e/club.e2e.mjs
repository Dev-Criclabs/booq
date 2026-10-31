// F01 console: one club (P3 and the support view): status and checklist, owner invite, webhook addresses, club basics, step-up.
// Run: node --test --test-concurrency=1 'apps/platform/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { chromium, openPage, SHOTS, startApp } from './harness.mjs';

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

const ID = 'c-1';
const club = (over = {}) => ({ id: ID, slug: 'hunter', status: 'testing', name_th: 'ฮันเตอร์', name_en: 'Hunter Tennis Club', legal_name: null, owner_name: 'Nok Owner', owner_phone: '0811111111', owner_line: null, owner_email: 'nok@example.com', ...over });
const DETAIL = {
  progress: {
    setup: [{ item: 'basics', done: true, owed_by: 'booq' }, { item: 'line', done: false, owed_by: 'booq' }, { item: 'legal_notice', done: true, owed_by: 'booq' }],
    launch: [{ item: 'line_test', result: 'pass', owed_by: 'booq' }, { item: 'product_priced', result: 'pending', owed_by: 'owner' }, { item: 'brand_new_check', result: 'missing', owed_by: 'booq' }],
  },
  counts: { bookingsConfirmed30d: 7, lineMessagesSent30d: 120 },
};
const SUPPORT = (over = {}) => ({ setup: { mode: 'edit', health: [], checkRequestedAt: null, club: club(), hours: [{ weekday: 1, open: '06:00', close: '22:00' }], locations: [], resources: [{ id: 'r1', name: 'Court 1', sport: 'tennis', active: true }], settings: [], features: [{ feature_key: 'coach_add_at_checkout', enabled: true }], featureKeys: [{ feature_key: 'coach_add_at_checkout', requires_payment_option: null }, { feature_key: 'slip_only_thing', requires_payment_option: 'slip' }], ...over } });

/** A console serving this club to an admin. `over` replaces any answer ("METHOD /path" -> answer or function). */
const SETTINGS = (over = {}) => ({
  editable: true,
  settings: [
    { key: 'hold_minutes', value: null, unset: true, required: true, available: true },
    { key: 'booking_window_days', value: 30, unset: false, required: true, available: true },
    { key: 'max_future_court_hours', value: null, unset: true, required: false, available: true },
    { key: 'auto_slip_check', value: null, unset: true, required: false, available: false },
  ],
  ...over,
});

const api = ({ role = 'platform_admin', settings = SETTINGS(), support = SUPPORT(), invite = { status: 'none' }, over = {} } = {}) => (method, path, body) => {
  const key = `${method} ${path}`;
  if (over[key]) return typeof over[key] === 'function' ? over[key](body) : over[key];
  if (key === 'GET /auth/me') return { status: 200, body: { id: 'a1', role, displayName: 'Ada', stepUpFresh: true } };
  if (key === `GET /clubs/${ID}`) return { status: 200, body: DETAIL };
  if (key === `GET /clubs/${ID}/support/setup`) return { status: 200, body: support };
  if (key === `GET /clubs/${ID}/settings`) return { status: 200, body: settings };
  if (key === `GET /clubs/${ID}/owner-invite`) return { status: 200, body: { invite } };
  return { status: 404, body: { code: 'not_found' } };
};

describe('the club page', () => {
  it('shows the status, the counts, the checklist with who owes each item, the live checks and the support view', async () => {
    const { page, context } = await openPage(browser, api(), { width: 1024, height: 900 });
    await page.goto(`${app.base}/clubs/${ID}`);
    await page.getByTestId('setup').waitFor();
    assert.equal(await page.locator('h1').innerText(), 'Hunter Tennis Club');
    assert.equal(await page.getByTestId('status').innerText(), 'Testing');
    assert.match(await page.getByTestId('mode').innerText(), /Edit mode/);
    assert.match(await page.getByTestId('club').innerText(), /Bookings, 30 days: 7 · LINE messages, 30 days: 120/);
    assert.match(await page.getByTestId('setup-basics').innerText(), /Club basics · Done · BOOQ/);
    assert.match(await page.getByTestId('setup-line').innerText(), /LINE · Not done · BOOQ/);
    assert.match(await page.getByTestId('setup-legal_notice').innerText(), /Legal notice published · Done/);
    assert.match(await page.getByTestId('launch-line_test').innerText(), /Passed · BOOQ/);
    assert.match(await page.getByTestId('launch-product_priced').innerText(), /Waiting · Owner/);
    assert.match(await page.getByTestId('launch-brand_new_check').innerText(), /brand_new_check · Missing/, 'an unknown check shows its own key, not invented text');
    assert.equal(await page.locator('#h-1-open').inputValue(), '06:00');
    assert.equal(await page.locator('#h-1-close').inputValue(), '22:00');
    assert.equal(await page.locator('#c-r1-name').inputValue(), 'Court 1');
    assert.equal(await page.getByTestId('feature-coach_add_at_checkout').isChecked(), true);
    await page.screenshot({ path: join(SHOTS, 'club.png'), fullPage: true });
    await context.close();
  });

  it('a Live club is read only: the basics cannot be saved and webhook addresses are off', async () => {
    const support = SUPPORT({ mode: 'look', club: club({ status: 'live' }) });
    const { page, context } = await openPage(browser, api({ support }), { width: 1024, height: 900 });
    await page.goto(`${app.base}/clubs/${ID}`);
    await page.getByTestId('basics-form').waitFor();
    assert.match(await page.getByTestId('mode').innerText(), /Read only/);
    assert.equal(await page.getByTestId('save-basics').count(), 0);
    assert.equal(await page.getByTestId('support-editor').count(), 0, 'no editing in read-only mode');
    assert.match(await page.getByTestId('hours').innerText(), /Monday 06:00–22:00/);
    assert.match(await page.getByTestId('courts').innerText(), /Court 1 · tennis/);
    assert.match(await page.getByTestId('features').innerText(), /coach_add_at_checkout · On/);
    assert.equal(await page.locator('#b-name_en').getAttribute('readonly'), '');
    assert.equal(await page.getByTestId('webhook-line').isDisabled(), true);
    await context.close();
  });

  it('changing the status: a blocked move lists what is missing by name; a good one reloads', async () => {
    let calls = 0;
    const over = {
      [`POST /clubs/${ID}/status`]: () => (++calls === 1 ? { status: 409, body: { code: 'blocked', missing: [{ item: 'line', owed_by: 'booq' }, { item: 'product_priced', owed_by: 'owner', result: 'pending' }] } } : { status: 200, body: { from: 'testing', to: 'live' } }),
    };
    const { page, context, calls: seen } = await openPage(browser, api({ over }), { width: 1024, height: 900 });
    await page.goto(`${app.base}/clubs/${ID}`);
    await page.getByTestId('status-form').waitFor();
    await page.locator('#to').selectOption('live');
    await page.locator('#reason').fill('  ready  ');
    await page.getByTestId('change-status').click();
    await page.getByTestId('blocked').waitFor();
    assert.match(await page.getByTestId('blocked').innerText(), /LINE[\s\S]*A product has a price/);
    assert.deepEqual(seen.find((c) => c.path.endsWith('/status')).body, { to: 'live', reason: 'ready' });
    await page.getByTestId('change-status').click();
    await page.getByTestId('notice').waitFor();
    assert.equal(await page.getByTestId('notice').innerText(), 'The status was changed.');
    assert.equal(await page.getByTestId('blocked').count(), 0);
    await context.close();
  });

  it('a stale second factor opens the step-up, then the same action runs again (owner invite)', async () => {
    let fresh = false;
    const over = {
      'POST /auth/step-up': () => ((fresh = true), { status: 200, body: { ok: true } }),
      [`POST /clubs/${ID}/owner-invite`]: () => (fresh ? { status: 200, body: { status: 'sent' } } : { status: 403, body: { code: 'step_up_required' } }),
    };
    const { page, context, calls } = await openPage(browser, api({ over }), { width: 1024, height: 900 });
    await page.goto(`${app.base}/clubs/${ID}`);
    assert.equal(await page.getByTestId('invite-status').innerText(), 'No invite has been sent yet.');
    await page.getByTestId('send-invite').click();
    await page.getByTestId('step-up').waitFor();
    await page.locator('#stepup-password').fill('pw');
    await page.locator('#stepup-code').fill('123456');
    await page.getByTestId('step-up-submit').click();
    await page.getByTestId('notice').waitFor();
    assert.equal(await page.getByTestId('notice').innerText(), "The invite was sent to the owner's email.");
    assert.equal(calls.filter((c) => c.path === `/clubs/${ID}/owner-invite` && c.method === 'POST').length, 2);
    await context.close();
  });

  it('owner invite text follows its state: pending and expired can be sent again, an opened one cannot', async () => {
    for (const [status, text, button] of [['pending', 'Sent. The owner has not opened it yet.', 'Resend'], ['expired', 'The invite has expired.', 'Resend'], ['redeemed', 'The owner opened the invite.', null]]) {
      const { page, context } = await openPage(browser, api({ invite: { status } }), { width: 1024, height: 900 });
      await page.goto(`${app.base}/clubs/${ID}`);
      await page.getByTestId('invite-status').waitFor();
      assert.equal(await page.getByTestId('invite-status').innerText(), text);
      if (button) assert.equal(await page.getByTestId('send-invite').innerText(), button);
      else assert.equal(await page.getByTestId('send-invite').count(), 0);
      await context.close();
    }
  });

  it('a webhook address is shown once, in a box that is forgotten when closed', async () => {
    const url = 'https://app.example/api/webhooks/line/TOKEN-ONLY-SHOWN-ONCE';
    const over = { [`POST /clubs/${ID}/webhook-tokens/line`]: { status: 200, body: { token: 'TOKEN-ONLY-SHOWN-ONCE', url, replaced: true } } };
    const { page, context } = await openPage(browser, api({ over }), { width: 1024, height: 900, origin: app.base });
    await page.goto(`${app.base}/clubs/${ID}`);
    await page.getByTestId('webhook-line').click();
    await page.getByTestId('address-box').waitFor();
    assert.equal(await page.getByTestId('address').inputValue(), url);
    assert.match(await page.getByTestId('address-box').innerText(), /shown only once[\s\S]*replaced an earlier address/);
    await page.getByTestId('address-copy').click();
    await page.getByTestId('address-copy').filter({ hasText: 'Copied' }).waitFor({ timeout: 5000 });
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), url);
    await page.getByTestId('address-done').click();
    assert.ok(!(await page.content()).includes('TOKEN-ONLY-SHOWN-ONCE'));
    await context.close();
  });

  it('a specialist does not see the admin actions (pause, webhook addresses)', async () => {
    const support = SUPPORT({ club: club({ status: 'live' }) });
    const { page, context } = await openPage(browser, api({ role: 'onboarding_specialist', support }), { width: 1024, height: 900 });
    await page.goto(`${app.base}/clubs/${ID}`);
    await page.getByTestId('setup').waitFor();
    await page.waitForTimeout(300);
    assert.equal(await page.getByTestId('pause').count(), 0);
    assert.equal(await page.getByTestId('webhook-line').count(), 0);
    await context.close();
  });

  it('an admin pauses a live club with a reason and resumes a paused one', async () => {
    const over = { [`POST /clubs/${ID}/pause`]: { status: 200, body: { ownerNotified: false } }, [`POST /clubs/${ID}/resume`]: { status: 200, body: {} } };
    const live = await openPage(browser, api({ support: SUPPORT({ mode: 'look', club: club({ status: 'live' }) }), over }), { width: 1024, height: 900 });
    await live.page.goto(`${app.base}/clubs/${ID}`);
    await live.page.getByTestId('pause-form').waitFor();
    assert.equal(await live.page.getByTestId('pause').isDisabled(), true, 'a reason is needed');
    await live.page.locator('#pause-reason').fill('Court resurfacing');
    await live.page.getByTestId('pause').click();
    await live.page.getByTestId('notice').waitFor();
    assert.deepEqual(live.calls.find((c) => c.path.endsWith('/pause')).body, { reason: 'Court resurfacing' });
    await live.context.close();
    const paused = await openPage(browser, api({ support: SUPPORT({ mode: 'look', club: club({ status: 'paused' }) }), over }), { width: 1024, height: 900 });
    await paused.page.goto(`${app.base}/clubs/${ID}`);
    await paused.page.getByTestId('pause-form').waitFor();
    assert.equal(await paused.page.getByTestId('status-form').count(), 0, 'a paused club is resumed, not moved');
    await paused.page.locator('#pause-reason').fill('Resurfacing done');
    await paused.page.getByTestId('resume').click();
    await paused.page.getByTestId('notice').waitFor();
    await paused.context.close();
  });

  it('saves only what changed in the basics, and says when the owner contact waits for a second admin', async () => {
    const over = { [`PUT /clubs/${ID}/support/setup/basics`]: { status: 200, body: { changed: ['owner_phone'], pendingOwnerContact: 'req-1' } } };
    const { page, context, calls } = await openPage(browser, api({ over }), { width: 1024, height: 900 });
    await page.goto(`${app.base}/clubs/${ID}`);
    await page.getByTestId('basics-form').waitFor();
    await page.locator('#b-owner_phone').fill('0822222222');
    await page.getByTestId('save-basics').click();
    await page.getByTestId('notice').waitFor();
    assert.equal(await page.getByTestId('notice').innerText(), "The change to the owner's contact waits for a second admin to approve it.");
    assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { owner_phone: '0822222222' });
    await context.close();
  });

  it('an unknown club, no session and a look-only refusal are told in words', async () => {
    const gone = await openPage(browser, (m, p) => (p === '/auth/me' ? { status: 401, body: {} } : { status: 404, body: { code: 'not_found' } }));
    await gone.page.goto(`${app.base}/clubs/${ID}`);
    await gone.page.getByTestId('load-error').waitFor();
    assert.match(await gone.page.getByTestId('load-error').innerText(), /does not exist, or it is not one of yours/);
    await gone.context.close();
    const out = await openPage(browser, (m, p) => ({ status: 401, body: { code: 'unauthenticated' } }));
    await out.page.goto(`${app.base}/clubs/${ID}`);
    await out.page.getByTestId('sign-in-link').waitFor();
    assert.equal(await out.page.getByTestId('sign-in-link').getAttribute('href'), `/sign-in?next=/clubs/${ID}`);
    await out.context.close();
    const over = { [`PUT /clubs/${ID}/support/setup/basics`]: { status: 409, body: { code: 'look_only' } } };
    const { page, context } = await openPage(browser, api({ over }), { width: 1024, height: 900 });
    await page.goto(`${app.base}/clubs/${ID}`);
    await page.locator('#b-name_en').fill('Renamed');
    await page.getByTestId('save-basics').click();
    await page.getByTestId('notice').waitFor();
    assert.match(await page.getByTestId('notice').innerText(), /live or paused, so it can be looked at but not changed/);
    await context.close();
  });

  it('fits 320 px with a very long name: nothing scrolls sideways and the buttons stay on one line', async () => {
    const support = SUPPORT({ club: club({ name_en: 'An Extraordinarily Long Club Name That Goes On And On '.repeat(3), owner_email: 'a-very-long-owner-address-that-keeps-going@a-very-long-domain-name.example' }) });
    const { page, context } = await openPage(browser, api({ support, invite: { status: 'pending' } }), { width: 320, height: 640 });
    await page.goto(`${app.base}/clubs/${ID}`);
    await page.getByTestId('basics-form').waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`);
    for (const b of await page.locator('main button').all()) assert.ok((await b.boundingBox()).height < 60, 'a button wraps');
    await page.screenshot({ path: join(SHOTS, 'club-320.png'), fullPage: true });
    await context.close();
  });

  it('hours: only the changed day is sent; a bad time is refused before anything is sent, naming the day', async () => {
    const over = { [`PUT /clubs/${ID}/support/setup/resources-hours`]: { status: 200, body: { changed: ['hours'] } } };
    const { page, context, calls } = await openPage(browser, api({ over }), { width: 1024, height: 900 });
    await page.goto(`${app.base}/clubs/${ID}`);
    await page.getByTestId('hours-form').waitFor();
    await page.locator('#h-3-open').fill('7:00');
    await page.locator('#h-3-close').fill('22:00');
    await page.getByTestId('save-hours').click();
    assert.equal(await page.getByTestId('support-problem-hours').innerText(), 'Use 24-hour time such as 06:00 (closing can be 24:00). (Wednesday)');
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 0);
    await page.locator('#h-3-open').fill('07:00');
    await page.getByTestId('save-hours').click();
    await page.getByTestId('notice').waitFor();
    assert.equal(await page.getByTestId('notice').innerText(), 'Saved.');
    assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { hours: [{ weekday: 3, open: '07:00', close: '22:00' }] });
    await context.close();
  });

  it('courts: only the changed fields are sent, a court is switched off not deleted, and an unchanged form says so', async () => {
    const over = { [`PUT /clubs/${ID}/support/setup/resources-hours`]: { status: 200, body: { changed: ['resources'] } } };
    const { page, context, calls } = await openPage(browser, api({ over }), { width: 1024, height: 900 });
    await page.goto(`${app.base}/clubs/${ID}`);
    await page.getByTestId('courts-form').waitFor();
    await page.getByTestId('save-courts').click();
    assert.equal(await page.getByTestId('support-problem-courts').innerText(), 'Nothing was changed.');
    await page.locator('#c-r1-name').fill('Centre Court');
    await page.locator('#c-r1-sport').selectOption('padel');
    await page.getByTestId('court-r1').locator('input[type=checkbox]').nth(1).uncheck();
    await page.getByTestId('save-courts').click();
    await page.getByTestId('notice').waitFor();
    assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { resources: [{ id: 'r1', name: 'Centre Court', sport: 'padel', active: false }] });
    await context.close();
  });

  it('a court with players that are not a number is refused naming the court', async () => {
    const { page, context, calls } = await openPage(browser, api(), { width: 1024, height: 900 });
    await page.goto(`${app.base}/clubs/${ID}`);
    await page.getByTestId('courts-form').waitFor();
    await page.locator('#c-r1-players').fill('four');
    await page.getByTestId('save-courts').click();
    assert.equal(await page.getByTestId('support-problem-courts').innerText(), 'Players must be a whole number above zero. (Court 1)');
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 0);
    await context.close();
  });

  it('adding a court uses the first location; with no location it says it cannot', async () => {
    const over = { [`PUT /clubs/${ID}/support/setup/resources-hours`]: { status: 200, body: { changed: ['resources'] } } };
    const withLocation = await openPage(browser, api({ support: SUPPORT({ locations: [{ id: 'loc-1', name: 'Main' }] }), over }), { width: 1024, height: 900 });
    await withLocation.page.goto(`${app.base}/clubs/${ID}`);
    await withLocation.page.getByTestId('add-court-form').waitFor();
    await withLocation.page.locator('#new-court-name').fill('Court 2');
    await withLocation.page.locator('#new-court-sport').selectOption('pickleball');
    await withLocation.page.getByTestId('add-court').click();
    await withLocation.page.getByTestId('notice').waitFor();
    assert.deepEqual(withLocation.calls.find((c) => c.method === 'PUT').body, { resources: [{ location_id: 'loc-1', name: 'Court 2', sport: 'pickleball' }] });
    await withLocation.context.close();
    const none = await openPage(browser, api(), { width: 1024, height: 900 });
    await none.page.goto(`${app.base}/clubs/${ID}`);
    await none.page.getByTestId('add-court-form').waitFor();
    await none.page.locator('#new-court-name').fill('Court 2');
    await none.page.getByTestId('add-court').click();
    assert.match(await none.page.getByTestId('support-problem-new').innerText(), /no location yet/);
    assert.equal(none.calls.filter((c) => c.method === 'PUT').length, 0);
    await none.context.close();
  });

  it('adding a location sends just its name; an empty name is refused before sending', async () => {
    const over = { [`PUT /clubs/${ID}/support/setup/resources-hours`]: { status: 200, body: { changed: ['locations'] } } };
    const { page, context, calls } = await openPage(browser, api({ over }), { width: 1024, height: 900 });
    await page.goto(`${app.base}/clubs/${ID}`);
    await page.getByTestId('add-location-form').waitFor();
    await page.getByTestId('add-location').click();
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 0);
    await page.locator('#new-location').fill(' Main ');
    await page.getByTestId('add-location').click();
    await page.getByTestId('notice').waitFor();
    assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { locations: [{ name: 'Main' }] });
    await context.close();
  });

  it('switches: only a changed one is sent', async () => {
    const over = { [`PUT /clubs/${ID}/support/setup/features`]: { status: 200, body: { changed: ['coach_add_at_checkout'] } } };
    const { page, context, calls } = await openPage(browser, api({ over }), { width: 1024, height: 900 });
    await page.goto(`${app.base}/clubs/${ID}`);
    await page.getByTestId('features-form').waitFor();
    assert.equal(await page.getByTestId('feature-slip_only_thing').count(), 0);
    await page.getByTestId('feature-coach_add_at_checkout').uncheck();
    await page.getByTestId('save-features').click();
    await page.getByTestId('notice').waitFor();
    assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { features: { coach_add_at_checkout: false } });
    await context.close();
  });

  it('settings: nothing is filled in for an unset one; a change is sent alone, a stale second factor asks again, an empty needed one is refused', async () => {
    let fresh = false;
    const over = {
      'POST /auth/step-up': () => ((fresh = true), { status: 200, body: { ok: true } }),
      [`PUT /clubs/${ID}/settings/hold_minutes`]: () => (fresh ? { status: 200, body: { key: 'hold_minutes', value: 15 } } : { status: 403, body: { code: 'step_up_required' } }),
    };
    const { page, context, calls } = await openPage(browser, api({ over }), { width: 1024, height: 900 });
    await page.goto(`${app.base}/clubs/${ID}`);
    await page.getByTestId('setting-hold_minutes').waitFor();
    assert.equal(await page.locator('#s-hold_minutes').inputValue(), '', 'an unset setting stays empty');
    assert.equal(await page.locator('#s-booking_window_days').inputValue(), '30');
    assert.equal(await page.locator('#s-auto_slip_check').isDisabled(), true, 'a setting that does not apply cannot be edited');
    await page.getByTestId('save-setting-hold_minutes').click();
    assert.match(await page.getByTestId('setting-problem-hold_minutes').innerText(), /cannot be left empty/);
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 0);
    await page.locator('#s-hold_minutes').selectOption('15');
    await page.getByTestId('save-setting-hold_minutes').click();
    await page.getByTestId('step-up').waitFor();
    await page.locator('#stepup-password').fill('pw');
    await page.locator('#stepup-code').fill('123456');
    await page.getByTestId('step-up-submit').click();
    await page.getByTestId('notice').getByText('The setting was saved.').waitFor();
    const puts = calls.filter((c) => c.method === 'PUT');
    assert.equal(puts.length, 2, 'the same save ran again after the step-up');
    assert.deepEqual(puts[1].body, { value: 15 });
    await context.close();
  });

  it('settings: a club that is look only shows the values and no boxes', async () => {
    const { page, context } = await openPage(browser, api({ settings: SETTINGS({ editable: false }) }), { width: 1024, height: 900 });
    await page.goto(`${app.base}/clubs/${ID}`);
    await page.getByTestId('setting-hold_minutes').waitFor();
    assert.equal(await page.getByTestId('setting-value-booking_window_days').innerText(), '30');
    assert.equal(await page.getByTestId('setting-value-hold_minutes').innerText(), 'Not set');
    assert.equal(await page.getByTestId('save-setting-hold_minutes').count(), 0);
    await context.close();
  });

  it('connections: LINE is tested as typed; a stale second factor asks again and the same save runs again', async () => {
    let fresh = false;
    const over = {
      'POST /auth/step-up': () => ((fresh = true), { status: 200, body: { ok: true } }),
      [`PUT /clubs/${ID}/support/setup/line`]: () => (fresh ? { status: 200, body: { changed: ['x'], connectionTest: { result: 'pass' } } } : { status: 403, body: { code: 'step_up_required' } }),
    };
    const { page, context, calls } = await openPage(browser, api({ over }), { width: 1024, height: 1000 });
    await page.goto(`${app.base}/clubs/${ID}`);
    await page.getByTestId('conn-line').waitFor();
    await page.getByTestId('conn-line_channel_token').fill('MARKER-token');
    await page.getByTestId('conn-submit').click();
    await page.getByTestId('step-up').waitFor();
    await page.locator('#stepup-password').fill('pw');
    await page.locator('#stepup-code').fill('123456');
    await page.getByTestId('step-up-submit').click();
    await page.getByTestId('notice').getByText('Saved. The check passed.').waitFor();
    assert.equal(calls.filter((c) => c.path.endsWith('/support/setup/line')).length, 2);
    await context.close();
  });

  it('Test all again: the last results show, the button asks the worker, the page waits and shows the new results', async () => {
    const HEALTH_OLD = [{ check_key: 'line_token', status: 'failed', reason: 'token_rejected', checked_at: '2026-12-01T03:00:00Z' }];
    const HEALTH_NEW = [{ check_key: 'line_token', status: 'ok', reason: null, checked_at: '2026-12-01T03:01:00Z' }];
    let state = 'idle';
    let reads = 0;
    const over = {
      [`POST /clubs/${ID}/support/connection-check`]: () => ((state = 'waiting'), { status: 200, body: { requestedAt: '2026-12-01T03:00:30Z' } }),
      [`GET /clubs/${ID}/support/setup`]: () => {
        if (state === 'waiting' && ++reads >= 3) state = 'done';
        const health = state === 'done' ? HEALTH_NEW : HEALTH_OLD;
        return { status: 200, body: SUPPORT({ health, checkRequestedAt: state === 'waiting' ? '2026-12-01T03:00:30Z' : null }) };
      },
    };
    const { page, context } = await openPage(browser, api({ over }), { width: 1024, height: 1000 });
    await page.goto(`${app.base}/clubs/${ID}`);
    await page.getByTestId('health-line_token').waitFor();
    assert.match(await page.getByTestId('health-line_token').innerText(), /LINE connection · Failed · LINE did not accept the channel access token/);
    await page.getByTestId('recheck').click();
    await page.getByTestId('health-waiting').waitFor();
    assert.equal(await page.getByTestId('recheck').isDisabled(), true);
    await page.getByTestId('health-waiting').waitFor({ state: 'detached', timeout: 20000 });
    assert.match(await page.getByTestId('health-line_token').innerText(), /LINE connection · Passed/);
    await context.close();
  });

  it('connections: a club that is look only shows no boxes to save', async () => {
    const { page, context } = await openPage(browser, api({ support: SUPPORT({ mode: 'look' }) }), { width: 1024, height: 1000 });
    await page.goto(`${app.base}/clubs/${ID}`);
    await page.getByTestId('conn-line').waitFor();
    assert.equal(await page.getByTestId('conn-submit').count(), 0);
    assert.equal(await page.getByTestId('conn-line_channel_token').isDisabled(), true);
    await context.close();
  });

  it('the API refusing an edit (the owner window closed) is told in words', async () => {
    const over = { [`PUT /clubs/${ID}/support/setup/resources-hours`]: { status: 409, body: { code: 'look_only' } } };
    const { page, context } = await openPage(browser, api({ over }), { width: 1024, height: 900 });
    await page.goto(`${app.base}/clubs/${ID}`);
    await page.getByTestId('hours-form').waitFor();
    await page.locator('#h-3-open').fill('06:00');
    await page.locator('#h-3-close').fill('22:00');
    await page.getByTestId('save-hours').click();
    await page.getByTestId('notice').waitFor();
    assert.match(await page.getByTestId('notice').innerText(), /live or paused, so it can be looked at but not changed/);
    await context.close();
  });
});
