// F01 console: the launch checks of one club (P4): recorded results, Go live. PLAT-04, PLAT-01-AC3, D161.
// Run: node --test --test-concurrency=1 'apps/platform/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { chromium, openPage, SHOTS, startApp } from './harness.mjs';

let app;
let browser;
before(async () => {
  app = await startApp(3121);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

const ID = 'c-1';
const items = () => [
  { item: 'line_test', result: 'pass', owed_by: 'booq', recorded: false },
  { item: 'product_priced', result: 'pending', owed_by: 'owner', recorded: true },
  { item: 'beam_key_swap', result: 'fail', owed_by: 'booq', recorded: true },
  { item: 'owner_verified', result: 'pass', owed_by: 'booq', recorded: true },
];
/** The console for this club. `state.items` is shared, so a recorded result shows after the reload. */
const api = ({ role = 'platform_admin', status = 'testing', state = { items: items() }, over = {} } = {}) => (method, path, body) => {
  const key = `${method} ${path}`;
  if (over[key]) return typeof over[key] === 'function' ? over[key](body) : over[key];
  if (key === 'GET /auth/me') return { status: 200, body: { id: 'a1', role, displayName: 'Ada', stepUpFresh: true } };
  if (key === `GET /clubs/${ID}/launch`) return { status: 200, body: { clubName: 'Hunter Tennis Club', clubStatus: status, items: state.items } };
  const put = /^PUT \/clubs\/c-1\/launch\/(\w+)$/.exec(key);
  if (put) {
    state.items = state.items.map((i) => (i.item === put[1] ? { ...i, result: body.result } : i));
    return { status: 200, body: {} };
  }
  return { status: 404, body: { code: 'not_found' } };
};

describe('the launch checks', () => {
  it('lists every check with its result, who owes it and whether it is recorded by hand', async () => {
    const { page, context } = await openPage(browser, api(), { width: 1024, height: 900 });
    await page.goto(`${app.base}/clubs/${ID}/launch`);
    await page.getByTestId('checks').waitFor();
    assert.equal(await page.locator('h1').innerText(), 'Launch · Hunter Tennis Club');
    assert.match(await page.getByTestId('check-line_test').innerText(), /LINE connection test · Passed · BOOQ · Worked out from the club's data/);
    assert.match(await page.getByTestId('check-product_priced').innerText(), /A product has a price · Waiting · Owner · Recorded by hand/);
    assert.match(await page.getByTestId('check-beam_key_swap').innerText(), /Failed/);
    assert.equal(await page.getByTestId('summary').innerText(), '2 checks have not passed yet.');
    assert.equal(await page.getByTestId('mark-line_test-pass').count(), 0, 'a derived check has no buttons');
    await page.screenshot({ path: join(SHOTS, 'launch.png'), fullPage: true });
    await context.close();
  });

  it('an admin records a result on a Testing club; the list and the summary follow', async () => {
    const { page, context, calls } = await openPage(browser, api(), { width: 1024, height: 900 });
    await page.goto(`${app.base}/clubs/${ID}/launch`);
    assert.equal(await page.getByTestId('mark-product_priced-pending').count(), 0, 'the current result is not offered');
    await page.getByTestId('mark-product_priced-pass').click();
    await page.getByTestId('notice').waitFor();
    assert.equal(await page.getByTestId('notice').innerText(), 'The result was recorded.');
    assert.equal(await page.getByTestId('result-product_priced').innerText(), 'Passed');
    assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { result: 'pass' });
    await page.getByTestId('mark-beam_key_swap-pass').click();
    await page.getByTestId('summary').filter({ hasText: 'Every check has passed.' }).waitFor();
    await context.close();
  });

  it('the step-up opens when the API asks, then the same record runs again', async () => {
    let fresh = false;
    const state = { items: items() };
    const base = api({ state });
    const over = {
      'POST /auth/step-up': () => ((fresh = true), { status: 200, body: { ok: true } }),
      [`PUT /clubs/${ID}/launch/product_priced`]: (body) => (fresh ? base('PUT', `/clubs/${ID}/launch/product_priced`, body) : { status: 403, body: { code: 'step_up_required' } }),
    };
    const { page, context, calls } = await openPage(browser, api({ state, over }), { width: 1024, height: 900 });
    await page.goto(`${app.base}/clubs/${ID}/launch`);
    await page.getByTestId('mark-product_priced-pass').click();
    await page.getByTestId('step-up').waitFor();
    await page.locator('#stepup-password').fill('pw');
    await page.locator('#stepup-code').fill('123456');
    await page.getByTestId('step-up-submit').click();
    await page.getByTestId('notice').waitFor();
    assert.equal(await page.getByTestId('result-product_priced').innerText(), 'Passed');
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 2);
    await context.close();
  });

  it('a specialist sees the list and why there are no buttons; a Live club says results are closed', async () => {
    const spec = await openPage(browser, api({ role: 'onboarding_specialist' }), { width: 1024, height: 900 });
    await spec.page.goto(`${app.base}/clubs/${ID}/launch`);
    await spec.page.getByTestId('admin-only').waitFor();
    assert.equal(await spec.page.getByTestId('admin-only').innerText(), 'Only a platform admin can record results.');
    assert.equal(await spec.page.locator('[data-testid^=mark-]').count(), 0);
    await spec.context.close();
    const live = await openPage(browser, api({ status: 'live' }), { width: 1024, height: 900 });
    await live.page.goto(`${app.base}/clubs/${ID}/launch`);
    await live.page.getByTestId('not-testing').waitFor();
    assert.equal(await live.page.locator('[data-testid^=mark-]').count(), 0);
    assert.equal(await live.page.getByTestId('go-live').count(), 0);
    await live.context.close();
  });

  it('Go live names what is still missing when the API blocks it, and succeeds when nothing is', async () => {
    let n = 0;
    const over = {
      [`POST /clubs/${ID}/status`]: () => (++n === 1 ? { status: 409, body: { code: 'blocked', missing: [{ item: 'product_priced', owed_by: 'owner', result: 'pending' }, { item: 'beam_key_swap', owed_by: 'booq', result: 'fail' }] } } : { status: 200, body: { from: 'testing', to: 'live' } }),
    };
    const { page, context, calls } = await openPage(browser, api({ over }), { width: 1024, height: 900 });
    await page.goto(`${app.base}/clubs/${ID}/launch`);
    await page.getByTestId('go-live').waitFor();
    assert.match(await page.locator('main').innerText(), /Unlocks when every line is ticked\. Logged in P6\./);
    await page.getByTestId('go-live').click();
    await page.getByTestId('blocked').waitFor();
    assert.match(await page.getByTestId('blocked').innerText(), /A product has a price[\s\S]*Beam live keys in place/);
    assert.deepEqual(calls.find((c) => c.path.endsWith('/status')).body, { to: 'live' });
    await page.getByTestId('go-live').click();
    await page.getByTestId('notice').waitFor();
    assert.equal(await page.getByTestId('notice').innerText(), 'The status was changed.');
    assert.equal(await page.getByTestId('blocked').count(), 0);
    await context.close();
  });

  it('refusals are told in words: not a recorded check, not Testing, an unknown club, no session, no list', async () => {
    for (const [code, status, text] of [['not_recorded', 400, 'This check is worked out from the club'], ['not_testing', 409, 'Results can only be recorded while the club is in Testing.']]) {
      const over = { [`PUT /clubs/${ID}/launch/product_priced`]: { status, body: { code } } };
      const { page, context } = await openPage(browser, api({ over }), { width: 1024, height: 900 });
      await page.goto(`${app.base}/clubs/${ID}/launch`);
      await page.getByTestId('mark-product_priced-pass').click();
      await page.getByTestId('notice').waitFor();
      assert.ok((await page.getByTestId('notice').innerText()).startsWith(text), text);
      await context.close();
    }
    const gone = await openPage(browser, (m, p) => (p === '/auth/me' ? { status: 401, body: {} } : { status: 404, body: { code: 'not_found' } }));
    await gone.page.goto(`${app.base}/clubs/${ID}/launch`);
    await gone.page.getByTestId('load-error').waitFor();
    await gone.context.close();
    const out = await openPage(browser, () => ({ status: 401, body: { code: 'unauthenticated' } }));
    await out.page.goto(`${app.base}/clubs/${ID}/launch`);
    assert.equal(await out.page.getByTestId('sign-in-link').getAttribute('href'), `/sign-in?next=/clubs/${ID}/launch`);
    await out.context.close();
    const empty = await openPage(browser, api({ state: { items: [] } }));
    await empty.page.goto(`${app.base}/clubs/${ID}/launch`);
    await empty.page.getByTestId('empty').waitFor();
    await empty.context.close();
  });

  it('fits 320 px: the buttons wrap onto lines of their own, nothing scrolls sideways', async () => {
    const { page, context } = await openPage(browser, api(), { width: 320, height: 640 });
    await page.goto(`${app.base}/clubs/${ID}/launch`);
    await page.getByTestId('checks').waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`);
    for (const b of await page.locator('main button').all()) assert.ok((await b.boundingBox()).height < 60, 'a button wraps');
    await page.screenshot({ path: join(SHOTS, 'launch-320.png'), fullPage: true });
    await context.close();
  });
});
