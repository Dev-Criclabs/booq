// F01-T17c console pages: the enrolment page (/enrol#token) and the team page (/staff). ROLE-02-AC1, AC4, D123, D148.
// Run: node --test --test-concurrency=1 'apps/platform/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { chromium, openPage, SHOTS, startApp } from './harness.mjs';

const TOKEN = 'T'.repeat(43);
let app;
let browser;
before(async () => {
  app = await startApp(3117);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

/** A console whose enrolment goes well: any password of 8+ characters, the code 123456. */
const enrolApi = (over = {}) => (method, path, body) => {
  if (over[path]) return over[path](body);
  if (path === '/enrol/check') return body.token === TOKEN ? { status: 200, body: { displayName: 'Sam Specialist' } } : { status: 404, body: { code: 'invalid_link' } };
  if (path === '/enrol/start') return body.password.length < 8 ? { status: 400, body: { code: 'weak_password' } } : { status: 200, body: { enrolmentId: 'enrol-1', secret: 'JBSWY3DPEHPK3PXPJBSWY3DP', uri: 'otpauth://totp/BOOQ:sam?secret=JBSWY3DPEHPK3PXP' } };
  if (path === '/enrol/finish') return body.code === '123456' ? { status: 200, body: { ok: true } } : { status: 401, body: { code: 'bad_code' } };
  return { status: 404, body: { code: 'not_found' } };
};

describe('the enrolment page', () => {
  it('is served so that the link cannot leak: no referrer, no cache, no framing', async () => {
    for (const path of ['/enrol', '/staff']) {
      const res = await fetch(`${app.base}${path}`);
      assert.equal(res.headers.get('referrer-policy'), 'no-referrer', path);
      assert.equal(res.headers.get('cache-control'), 'no-store', path);
      assert.equal(res.headers.get('x-frame-options'), 'DENY', path);
    }
  });

  it('a good link: greeting, password, setup key, code, done; the token never goes in an address and the fragment is cleared', async () => {
    const { page, context, calls } = await openPage(browser, enrolApi());
    await page.goto(`${app.base}/enrol#${TOKEN}`);
    await page.getByTestId('continue').waitFor();
    assert.equal(await page.locator('h1').innerText(), 'Set up your sign-in');
    assert.match(await page.locator('main p').first().innerText(), /Welcome, Sam Specialist/);
    assert.equal(new URL(page.url()).hash, '', 'the token is removed from the address once read');
    await page.screenshot({ path: join(SHOTS, 'enrol-password.png') });
    await page.locator('#password').fill('a-long-enough-password');
    await page.getByTestId('continue').click();
    await page.getByTestId('finish').waitFor();
    assert.equal(await page.getByTestId('secret').innerText(), 'JBSW Y3DP EHPK 3PXP JBSW Y3DP');
    assert.match((await page.getByTestId('open-app').getAttribute('href')) ?? '', /^otpauth:\/\/totp\//);
    assert.equal(await page.locator('#password').count(), 0, 'the password field is gone once used');
    await page.screenshot({ path: join(SHOTS, 'enrol-code.png') });
    await page.locator('#code').fill('123 456');
    await page.getByTestId('finish').click();
    await page.getByTestId('done').waitFor();
    assert.equal(await page.getByTestId('done').innerText(), 'Your sign-in is ready. You can sign in now.');
    assert.deepEqual(calls.map((c) => c.path), ['/enrol/check', '/enrol/start', '/enrol/finish']);
    assert.ok(calls.every((c) => c.search === '' && c.method === 'POST'), 'the token is only ever in a body');
    assert.deepEqual(calls[2].body, { enrolmentId: 'enrol-1', code: '123456' });
    await context.close();
  });

  it('no token, a malformed one or an unknown one is the invalid-link message, and nothing else is shown', async () => {
    for (const hash of ['', '#short', `#${'U'.repeat(43)}`]) {
      const { page, context, calls } = await openPage(browser, enrolApi());
      await page.goto(`${app.base}/enrol${hash}`);
      await page.getByTestId('invalid').waitFor();
      assert.equal(await page.getByTestId('invalid').innerText(), 'This link is not valid any more. Ask a BOOQ admin for a new one.');
      assert.equal(await page.locator('input').count(), 0);
      assert.equal(calls.length, hash === `#${'U'.repeat(43)}` ? 1 : 0, 'a malformed link is not even sent');
      await context.close();
    }
  });

  it('a password the provider refuses stays on the password step with its message; a wrong code on the code step', async () => {
    const { page, context } = await openPage(browser, enrolApi());
    await page.goto(`${app.base}/enrol#${TOKEN}`);
    await page.locator('#password').fill('short');
    await page.getByTestId('continue').click();
    await page.getByTestId('error').waitFor();
    assert.equal(await page.getByTestId('error').innerText(), 'This password is not accepted. Choose a longer or less common one.');
    assert.equal(await page.locator('#password').getAttribute('aria-invalid'), 'true');
    await page.locator('#password').fill('a-long-enough-password');
    await page.getByTestId('continue').click();
    await page.locator('#code').fill('000000');
    await page.getByTestId('finish').click();
    await page.getByTestId('error').waitFor();
    assert.equal(await page.getByTestId('error').innerText(), 'That code is not right. Check the app and try again.');
    assert.equal(await page.locator('#code').inputValue(), '', 'the wrong code is cleared');
    await context.close();
  });

  it('too many wrong codes sends the person back to the password step with the reason', async () => {
    const { page, context } = await openPage(browser, enrolApi({ '/enrol/finish': () => ({ status: 429, body: { code: 'too_many_attempts' } }) }));
    await page.goto(`${app.base}/enrol#${TOKEN}`);
    await page.locator('#password').fill('a-long-enough-password');
    await page.getByTestId('continue').click();
    await page.locator('#code').fill('000000');
    await page.getByTestId('finish').click();
    await page.locator('#password').waitFor();
    assert.equal(await page.getByTestId('error').innerText(), 'Too many wrong codes. Enter your password again to start over.');
    await context.close();
  });

  it('an unreachable console or sign-in service says so; no page is blank', async () => {
    const down = await openPage(browser, () => 'offline');
    await down.page.goto(`${app.base}/enrol#${TOKEN}`);
    await down.page.getByTestId('unavailable').waitFor();
    await down.context.close();
    const out = await openPage(browser, enrolApi({ '/enrol/start': () => ({ status: 503, body: { code: 'identity_unavailable' } }) }));
    await out.page.goto(`${app.base}/enrol#${TOKEN}`);
    await out.page.locator('#password').fill('a-long-enough-password');
    await out.page.getByTestId('continue').click();
    await out.page.getByTestId('error').waitFor();
    assert.equal(await out.page.getByTestId('error').innerText(), 'Sign-in set-up is not available right now. Try again in a few minutes.');
    await out.context.close();
  });

  it('works at 320 px with a very long setup key and zoomed text: nothing scrolls sideways, the buttons stay on one line', async () => {
    const { page, context } = await openPage(browser, enrolApi({ '/enrol/start': () => ({ status: 200, body: { enrolmentId: 'e', secret: 'A'.repeat(64), uri: 'otpauth://totp/x' } }) }), { width: 320, height: 640 });
    await page.goto(`${app.base}/enrol#${TOKEN}`);
    await page.locator('#password').fill('a-long-enough-password');
    await page.getByTestId('continue').click();
    await page.getByTestId('secret').waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`);
    const button = await page.getByTestId('finish').boundingBox();
    assert.ok(button.height < 60, 'the button is one line');
    await page.screenshot({ path: join(SHOTS, 'enrol-code-320.png') });
    await context.close();
  });
});

const TEAM = [
  { id: 'a1', displayName: 'Ada Admin', email: 'ada@booq.example', role: 'platform_admin', active: true },
  { id: 's1', displayName: 'Sam Specialist', email: 'sam@booq.example', role: 'onboarding_specialist', active: true },
  { id: 'd1', displayName: 'Dee Gone', email: 'dee@booq.example', role: 'onboarding_specialist', active: false },
];
const staffApi = (over = {}) => (method, path, body) => {
  if (over[`${method} ${path}`]) return over[`${method} ${path}`](body);
  if (method === 'GET' && path === '/staff') return { status: 200, body: { team: TEAM } };
  if (method === 'POST' && path === '/staff') return { status: 200, body: { ok: true, staffId: 'n1', enrolmentLink: `https://console.example/enrol#${TOKEN}` } };
  if (method === 'POST' && path === '/staff/s1/reset-factor') return { status: 200, body: { ok: true, enrolmentLink: `https://console.example/enrol#${'R'.repeat(43)}` } };
  if (method === 'POST' && path === '/staff/s1/deactivate') return { status: 200, body: { ok: true } };
  return { status: 404, body: { code: 'not_found' } };
};

describe('the team page', () => {
  it('lists the team; an invite shows the link once, in a box that is forgotten when closed', async () => {
    const { page, context, calls } = await openPage(browser, staffApi(), { width: 1024, height: 800, origin: app.base });
    await page.goto(`${app.base}/staff`);
    await page.getByTestId('team').waitFor();
    assert.equal(await page.locator('[data-testid^=member-]').count(), 3);
    assert.equal(await page.getByTestId('reset-d1').count(), 0, 'a deactivated teammate has no actions');
    await page.screenshot({ path: join(SHOTS, 'staff.png') });
    await page.locator('#displayName').fill('New Person');
    await page.locator('#email').fill('new@booq.example');
    await page.locator('#role').selectOption('platform_admin');
    await page.getByTestId('invite').click();
    await page.getByTestId('link-box').waitFor();
    assert.equal(await page.getByTestId('link').inputValue(), `https://console.example/enrol#${TOKEN}`);
    assert.match(await page.getByTestId('link-box').innerText(), /New Person\. It is shown only once/);
    assert.deepEqual(calls.find((c) => c.method === 'POST').body, { email: 'new@booq.example', displayName: 'New Person', role: 'platform_admin' });
    assert.equal(await page.locator('#email').inputValue(), '', 'the form is cleared after an invite');
    await page.getByTestId('copy').click();
    await page.getByTestId('copy').filter({ hasText: 'Copied' }).waitFor({ timeout: 5000 });
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `https://console.example/enrol#${TOKEN}`);
    await page.getByTestId('link-done').click();
    assert.equal(await page.getByTestId('link-box').count(), 0);
    assert.ok(!(await page.content()).includes(TOKEN), 'the link is gone from the page once closed');
    await context.close();
  });

  it('reset asks first, ends with a new link; deactivate asks first and shows no link', async () => {
    const { page, context, calls } = await openPage(browser, staffApi(), { width: 1024, height: 800 });
    const asked = [];
    page.on('dialog', (d) => { asked.push(d.message()); void d.accept(); });
    await page.goto(`${app.base}/staff`);
    await page.getByTestId('reset-s1').click();
    await page.getByTestId('link-box').waitFor();
    assert.deepEqual(asked, ['Reset the second factor of Sam Specialist? Their open sessions end and they get a new enrolment link.']);
    assert.match(await page.getByTestId('link').inputValue(), /enrol#R+$/);
    await page.getByTestId('link-done').click();
    await page.getByTestId('deactivate-s1').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=message]').length === 0);
    assert.equal(asked[1], 'Deactivate Sam Specialist? They can no longer sign in.');
    assert.equal(await page.getByTestId('link-box').count(), 0);
    assert.ok(calls.some((c) => c.path === '/staff/s1/deactivate'));
    await context.close();
  });

  it('declining the confirmation sends nothing', async () => {
    const { page, context, calls } = await openPage(browser, staffApi(), { width: 1024, height: 800 });
    page.on('dialog', (d) => void d.dismiss());
    await page.goto(`${app.base}/staff`);
    await page.getByTestId('deactivate-s1').click();
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
    await context.close();
  });

  it('refusals are told in words: not signed in, not an admin, link life not set, email taken', async () => {
    const cases = [
      [{ 'GET /staff': () => ({ status: 401, body: { code: 'unauthenticated' } }) }, 'load-error', 'Sign in to the console to manage the team.'],
      [{ 'GET /staff': () => ({ status: 403, body: { code: 'forbidden' } }) }, 'load-error', 'Only a platform admin can manage the team.'],
    ];
    for (const [over, id, text] of cases) {
      const { page, context } = await openPage(browser, staffApi(over));
      await page.goto(`${app.base}/staff`);
      await page.getByTestId(id).waitFor();
      assert.equal(await page.getByTestId(id).innerText(), text);
      await context.close();
    }
    for (const [over, text] of [
      [{ 'POST /staff': () => ({ status: 503, body: { code: 'not_configured' } }) }, 'The life of enrolment links is not set. A BOOQ admin must set it in settings first.'],
      [{ 'POST /staff': () => ({ status: 409, body: { code: 'email_taken' } }) }, 'A teammate with this email already exists.'],
    ]) {
      const { page, context } = await openPage(browser, staffApi(over), { width: 1024, height: 800 });
      await page.goto(`${app.base}/staff`);
      await page.locator('#displayName').fill('N');
      await page.locator('#email').fill('n@booq.example');
      await page.getByTestId('invite').click();
      await page.getByTestId('message').waitFor();
      assert.equal(await page.getByTestId('message').innerText(), text);
      assert.equal(await page.getByTestId('link-box').count(), 0);
      await context.close();
    }
  });
});
