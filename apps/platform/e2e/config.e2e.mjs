// F01 console: platform settings (P6 config). The values every club shares; none has a default; an admin changes one. D161.
// Run: node --test --test-concurrency=1 'apps/platform/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { chromium, openPage, SHOTS, startApp } from './harness.mjs';

let app;
let browser;
before(async () => {
  app = await startApp(3122);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

const api = ({ role = 'platform_admin', values = { invite_ttl_hours: 72, pay_tap_limit_count: 5, required_launch_checks: [{ key: 'line_test', owed_by: 'booq' }], some_future_key: { a: 1 } }, over = {} } = {}) => {
  const state = { ...values };
  return (method, path, body) => {
    const key = `${method} ${path}`;
    if (over[key]) return typeof over[key] === 'function' ? over[key](body) : over[key];
    if (key === 'GET /auth/me') return { status: 200, body: { id: 'a1', role, displayName: 'Ada', stepUpFresh: true } };
    if (key === 'GET /config') return { status: 200, body: { config: Object.entries(state).map(([k, v]) => ({ key: k, value: v })) } };
    const put = /^PUT \/config\/(\w+)$/.exec(key);
    if (put) {
      state[put[1]] = body.value;
      return { status: 200, body: {} };
    }
    return { status: 404, body: { code: 'not_found' } };
  };
};

describe('platform settings', () => {
  it('shows each known setting with its value, "Not set" where nothing is set, and other values apart', async () => {
    const { page, context } = await openPage(browser, api(), { width: 1024, height: 900 });
    await page.goto(`${app.base}/config`);
    await page.getByTestId('settings').waitFor();
    assert.equal(await page.locator('h1').innerText(), 'Platform settings');
    assert.equal(await page.locator('#v-invite_ttl_hours').inputValue(), '72');
    assert.equal(await page.locator('#v-pay_tap_limit_count').inputValue(), '5');
    assert.equal(await page.locator('#v-required_launch_checks').inputValue(), '[{"key":"line_test","owed_by":"booq"}]');
    assert.equal(await page.getByTestId('unset-console_enrolment_ttl_hours').innerText(), 'Not set');
    assert.equal(await page.locator('#v-console_enrolment_ttl_hours').inputValue(), '', 'no default is filled in');
    assert.equal(await page.getByTestId('unset-invite_ttl_hours').count(), 0);
    assert.match(await page.getByTestId('others').innerText(), /some_future_key: \{"a":1\}/);
    assert.equal(await page.getByTestId('nav-config').getAttribute('aria-current'), 'page');
    await page.screenshot({ path: join(SHOTS, 'config.png'), fullPage: true });
    await context.close();
  });

  it('an admin sets a value that was not set and changes one; the page shows it as saved', async () => {
    const { page, context, calls } = await openPage(browser, api(), { width: 1024, height: 900 });
    await page.goto(`${app.base}/config`);
    await page.locator('#v-console_enrolment_ttl_hours').fill(' 24 ');
    await page.getByTestId('save-console_enrolment_ttl_hours').click();
    await page.getByTestId('message-console_enrolment_ttl_hours').filter({ hasText: 'The value was saved.' }).waitFor();
    assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { value: 24 });
    assert.equal(await page.getByTestId('unset-console_enrolment_ttl_hours').count(), 0, 'it is set now');
    await page.locator('#v-required_launch_checks').fill('[{"key":"line_test","owed_by":"booq"},{"key":"owner_verified","owed_by":"booq"}]');
    await page.getByTestId('save-required_launch_checks').click();
    await page.getByTestId('message-required_launch_checks').filter({ hasText: 'saved' }).waitFor();
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 2);
    await context.close();
  });

  it('a value that is not a number, or not a list, is refused before anything is sent', async () => {
    const { page, context, calls } = await openPage(browser, api(), { width: 1024, height: 900 });
    await page.goto(`${app.base}/config`);
    await page.locator('#v-invite_ttl_hours').fill('soon');
    await page.getByTestId('save-invite_ttl_hours').click();
    assert.equal(await page.getByTestId('message-invite_ttl_hours').innerText(), 'Enter a number above zero.');
    await page.locator('#v-required_launch_checks').fill('{ nope');
    await page.getByTestId('save-required_launch_checks').click();
    assert.equal(await page.getByTestId('message-required_launch_checks').innerText(), 'Enter a valid list.');
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 0);
    await context.close();
  });

  it('the API refusing a value says so next to that setting', async () => {
    const over = { 'PUT /config/invite_ttl_hours': { status: 400, body: { code: 'invalid' } } };
    const { page, context } = await openPage(browser, api({ over }), { width: 1024, height: 900 });
    await page.goto(`${app.base}/config`);
    await page.locator('#v-invite_ttl_hours').fill('5');
    await page.getByTestId('save-invite_ttl_hours').click();
    await page.getByTestId('message-invite_ttl_hours').waitFor();
    assert.equal(await page.getByTestId('message-invite_ttl_hours').innerText(), 'That value is not accepted for this setting.');
    await context.close();
  });

  it('a stale second factor opens the step-up and then the same save runs again', async () => {
    let fresh = false;
    const over = {
      'POST /auth/step-up': () => ((fresh = true), { status: 200, body: { ok: true } }),
      'PUT /config/invite_ttl_hours': () => (fresh ? { status: 200, body: {} } : { status: 403, body: { code: 'step_up_required' } }),
    };
    const { page, context, calls } = await openPage(browser, api({ over }), { width: 1024, height: 900 });
    await page.goto(`${app.base}/config`);
    await page.locator('#v-invite_ttl_hours').fill('48');
    await page.getByTestId('save-invite_ttl_hours').click();
    await page.getByTestId('step-up').waitFor();
    await page.locator('#stepup-password').fill('pw');
    await page.locator('#stepup-code').fill('123456');
    await page.getByTestId('step-up-submit').click();
    await page.getByTestId('message-invite_ttl_hours').filter({ hasText: 'saved' }).waitFor();
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 2);
    await context.close();
  });

  it('a specialist can read the values but not change them', async () => {
    const { page, context } = await openPage(browser, api({ role: 'onboarding_specialist' }), { width: 1024, height: 900 });
    await page.goto(`${app.base}/config`);
    await page.getByTestId('admin-only').waitFor();
    assert.equal(await page.getByTestId('admin-only').innerText(), 'Only a platform admin can change these values.');
    assert.equal(await page.locator('[data-testid^=save-]').count(), 0);
    assert.equal(await page.locator('#v-invite_ttl_hours').getAttribute('readonly'), '');
    await context.close();
  });

  it('no session offers the sign-in; an outage says so', async () => {
    const out = await openPage(browser, () => ({ status: 401, body: { code: 'unauthenticated' } }));
    await out.page.goto(`${app.base}/config`);
    assert.equal(await out.page.getByTestId('sign-in-link').getAttribute('href'), '/sign-in?next=/config');
    await out.context.close();
    const down = await openPage(browser, () => 'offline');
    await down.page.goto(`${app.base}/config`);
    await down.page.getByTestId('load-error').waitFor();
    await down.context.close();
  });

  it('fits 320 px: nothing scrolls sideways, the boxes and the buttons are full size', async () => {
    const { page, context } = await openPage(browser, api(), { width: 320, height: 640 });
    await page.goto(`${app.base}/config`);
    await page.getByTestId('settings').waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`);
    for (const i of await page.locator('main input').all()) assert.ok((await i.boundingBox()).height >= 44, 'a box is at least 44 px tall');
    await page.screenshot({ path: join(SHOTS, 'config-320.png'), fullPage: true });
    await context.close();
  });
});
