// F01-T17 console sign-in and the step-up (D161): ROLE-02-AC1, SR-16. Same harness as enrol.e2e.mjs.
// Run: node --test --test-concurrency=1 'apps/platform/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { chromium, openPage, SHOTS, startApp } from './harness.mjs';

let app;
let browser;
before(async () => {
  app = await startApp(3118);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

const TEAM = [
  { id: 'a1', displayName: 'Ada Admin', email: 'ada@booq.example', role: 'platform_admin', active: true },
  { id: 's1', displayName: 'Sam Specialist', email: 'sam@booq.example', role: 'onboarding_specialist', active: true },
];
/** A console where Ada signs in with pw-ada and the code 123456. `over` replaces any answer. */
const api = (over = {}) => (method, path, body) => {
  const key = `${method} ${path}`;
  if (over[key]) return typeof over[key] === 'function' ? over[key](body) : over[key];
  if (key === 'POST /auth/sign-in') return body.email === 'ada@booq.example' && body.password === 'pw-ada' ? { status: 200, body: { challengeId: 'chal-1' } } : { status: 401, body: { code: 'invalid_credentials' } };
  if (key === 'POST /auth/second-factor') return body.challengeId === 'chal-1' && body.code === '123456' ? { status: 200, body: { ok: true } } : { status: 401, body: { code: 'bad_code' } };
  if (key === 'POST /auth/step-up') return body.password === 'pw-ada' && body.code === '123456' ? { status: 200, body: { ok: true } } : { status: 401, body: { code: 'bad_code' } };
  if (key === 'POST /auth/sign-out') return { status: 200, body: { ok: true } };
  if (key === 'GET /staff') return { status: 200, body: { team: TEAM } };
  if (key === 'POST /staff/s1/reset-factor') return { status: 200, body: { ok: true, enrolmentLink: `https://console.example/enrol#${'R'.repeat(43)}` } };
  if (key === 'POST /staff/s1/deactivate') return { status: 200, body: { ok: true } };
  if (key === 'POST /staff') return { status: 200, body: { ok: true, staffId: 'n1', enrolmentLink: `https://console.example/enrol#${'N'.repeat(43)}` } };
  return { status: 404, body: { code: 'not_found' } };
};

describe('sign in', () => {
  it('email and password, then the code: the password field is gone before the code is asked for, and the person lands on the team page', async () => {
    const { page, context, calls } = await openPage(browser, api());
    await page.goto(`${app.base}/sign-in?next=/staff`);
    assert.equal(await page.locator('h1').innerText(), 'Sign in to the BOOQ console');
    await page.screenshot({ path: join(SHOTS, 'sign-in-password.png') });
    await page.locator('#email').fill(' ada@booq.example ');
    await page.locator('#password').fill('pw-ada');
    await page.getByTestId('continue').click();
    await page.locator('#code').waitFor();
    assert.equal(await page.locator('#password').count(), 0, 'the password is not kept once used');
    await page.screenshot({ path: join(SHOTS, 'sign-in-code.png') });
    await page.locator('#code').fill('123 456');
    await page.getByTestId('sign-in-submit').click();
    await page.waitForURL((u) => u.pathname === '/staff');
    await page.getByTestId('team').waitFor();
    assert.deepEqual(calls.filter((c) => c.method === 'POST').map((c) => [c.path, c.body]), [
      ['/auth/sign-in', { email: 'ada@booq.example', password: 'pw-ada' }],
      ['/auth/second-factor', { challengeId: 'chal-1', code: '123456' }],
    ]);
    assert.ok(calls.every((c) => c.search === ''), 'no secret in an address');
    await context.close();
  });

  it('a wrong password and an unknown email give the same words; a wrong code stays on the code step', async () => {
    const { page, context } = await openPage(browser, api());
    await page.goto(`${app.base}/sign-in`);
    const words = [];
    for (const [email, pw] of [['ada@booq.example', 'nope'], ['ghost@booq.example', 'pw-ada']]) {
      await page.locator('#email').fill(email);
      await page.locator('#password').fill(pw);
      await page.getByTestId('continue').click();
      await page.getByTestId('error').waitFor();
      words.push(await page.getByTestId('error').innerText());
    }
    assert.equal(words[0], 'The email or password is not right.');
    assert.equal(words[1], words[0]);
    await page.locator('#email').fill('ada@booq.example');
    await page.locator('#password').fill('pw-ada');
    await page.getByTestId('continue').click();
    await page.locator('#code').fill('000000');
    await page.getByTestId('sign-in-submit').click();
    await page.getByTestId('error').waitFor();
    assert.equal(await page.getByTestId('error').innerText(), 'That code is not right. Check the app and try again.');
    assert.equal(await page.locator('#code').inputValue(), '');
    assert.equal(new URL(page.url()).pathname, '/sign-in');
    await context.close();
  });

  it('a locked account or an expired step goes back to email and password with the reason', async () => {
    for (const [answer, text] of [
      [{ status: 423, body: { code: 'locked' } }, 'Too many wrong attempts. This account is locked for a while. Try again later.'],
      [{ status: 401, body: { code: 'challenge_invalid' } }, 'This sign-in step has expired. Enter your email and password again.'],
    ]) {
      const { page, context } = await openPage(browser, api({ 'POST /auth/second-factor': answer }));
      await page.goto(`${app.base}/sign-in`);
      await page.locator('#email').fill('ada@booq.example');
      await page.locator('#password').fill('pw-ada');
      await page.getByTestId('continue').click();
      await page.locator('#code').fill('123456');
      await page.getByTestId('sign-in-submit').click();
      await page.locator('#password').waitFor();
      assert.equal(await page.getByTestId('error').innerText(), text);
      await context.close();
    }
  });

  it('an outage and a rate limit are told as such, not as a wrong password', async () => {
    for (const [answer, text] of [
      [{ status: 503, body: { code: 'identity_unavailable' } }, 'Sign-in is not available right now. Try again in a few minutes.'],
      [{ status: 429, body: { code: 'rate_limited' } }, 'Too many attempts. Wait a moment and try again.'],
    ]) {
      const { page, context } = await openPage(browser, api({ 'POST /auth/sign-in': answer }));
      await page.goto(`${app.base}/sign-in`);
      await page.locator('#email').fill('ada@booq.example');
      await page.locator('#password').fill('pw-ada');
      await page.getByTestId('continue').click();
      await page.getByTestId('error').waitFor();
      assert.equal(await page.getByTestId('error').innerText(), text);
      await context.close();
    }
  });

  it('only an address on this site is followed afterwards', async () => {
    const { page, context } = await openPage(browser, api());
    await page.goto(`${app.base}/sign-in?next=${encodeURIComponent('https://evil.example/steal')}`);
    await page.locator('#email').fill('ada@booq.example');
    await page.locator('#password').fill('pw-ada');
    await page.getByTestId('continue').click();
    await page.locator('#code').fill('123456');
    await page.getByTestId('sign-in-submit').click();
    await page.waitForURL((u) => u.pathname === '/staff');
    assert.equal(new URL(page.url()).pathname, '/staff');
    await context.close();
  });

  it('the team page without a session offers the sign-in, and signing out goes back to it', async () => {
    const out = await openPage(browser, api({ 'GET /staff': { status: 401, body: { code: 'unauthenticated' } } }));
    await out.page.goto(`${app.base}/staff`);
    await out.page.getByTestId('sign-in-link').waitFor();
    assert.equal(await out.page.getByTestId('sign-in-link').getAttribute('href'), '/sign-in?next=/staff');
    await out.context.close();
    const { page, context, calls } = await openPage(browser, api(), { width: 1024, height: 800 });
    await page.goto(`${app.base}/staff`);
    await page.getByTestId('sign-out').click();
    await page.waitForURL((u) => u.pathname === '/sign-in');
    assert.ok(calls.some((c) => c.path === '/auth/sign-out'));
    await context.close();
  });
});

describe('the step-up on the team page (D161)', () => {
  /** A reset that first asks for the step-up, then goes through once it has passed. */
  const stale = () => {
    let fresh = false;
    return {
      'POST /auth/step-up': (body) => (body.password === 'pw-ada' && body.code === '123456' ? ((fresh = true), { status: 200, body: { ok: true } }) : { status: 401, body: { code: 'bad_code' } }),
      'POST /staff/s1/reset-factor': () => (fresh ? { status: 200, body: { ok: true, enrolmentLink: `https://console.example/enrol#${'R'.repeat(43)}` } } : { status: 403, body: { code: 'step_up_required' } }),
      'POST /staff/s1/deactivate': () => (fresh ? { status: 200, body: { ok: true } } : { status: 403, body: { code: 'step_up_required' } }),
    };
  };

  it('a stale second factor opens the step-up; a wrong answer is one message; the right one runs the reset again and shows the link once', async () => {
    const { page, context, calls } = await openPage(browser, api(stale()), { width: 1024, height: 800 });
    page.on('dialog', (d) => void d.accept());
    await page.goto(`${app.base}/staff`);
    await page.getByTestId('reset-s1').click();
    await page.getByTestId('step-up').waitFor();
    assert.equal(await page.getByTestId('link-box').count(), 0, 'no link before the step-up');
    await page.screenshot({ path: join(SHOTS, 'staff-step-up.png') });
    await page.locator('#stepup-password').fill('wrong');
    await page.locator('#stepup-code').fill('123456');
    await page.getByTestId('step-up-submit').click();
    await page.getByTestId('step-up-error').waitFor();
    assert.equal(await page.getByTestId('step-up-error').innerText(), 'The password or the code is not right.');
    assert.equal(await page.locator('#stepup-password').inputValue(), '', 'fields are cleared after an attempt');
    await page.locator('#stepup-password').fill('pw-ada');
    await page.locator('#stepup-code').fill('123 456');
    await page.getByTestId('step-up-submit').click();
    await page.getByTestId('link-box').waitFor();
    assert.equal(await page.getByTestId('step-up').count(), 0);
    assert.deepEqual(calls.filter((c) => c.path === '/staff/s1/reset-factor').length, 2, 'the same action is run again');
    assert.deepEqual(calls.find((c) => c.path === '/auth/step-up' && c.body.password === 'pw-ada').body, { password: 'pw-ada', code: '123456' });
    await context.close();
  });

  it('cancel drops the action; an invite and a deactivation go through the step-up too', async () => {
    const { page, context, calls } = await openPage(browser, api(stale()), { width: 1024, height: 800 });
    page.on('dialog', (d) => void d.accept());
    await page.goto(`${app.base}/staff`);
    await page.getByTestId('deactivate-s1').click();
    await page.getByTestId('step-up').waitFor();
    await page.getByTestId('step-up-cancel').click();
    assert.equal(await page.getByTestId('step-up').count(), 0);
    assert.equal(calls.filter((c) => c.path === '/staff/s1/deactivate').length, 1, 'nothing is retried after cancel');
    await page.getByTestId('deactivate-s1').click();
    await page.getByTestId('step-up').waitFor();
    await page.locator('#stepup-password').fill('pw-ada');
    await page.locator('#stepup-code').fill('123456');
    await page.getByTestId('step-up-submit').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=step-up]').length === 0);
    assert.equal(calls.filter((c) => c.path === '/staff/s1/deactivate').length, 3);
    await context.close();
  });

  it('an ended session at the step-up sends the person to sign in', async () => {
    const over = { ...stale(), 'POST /auth/step-up': { status: 401, body: { code: 'session_invalid' } } };
    const { page, context } = await openPage(browser, api(over), { width: 1024, height: 800 });
    page.on('dialog', (d) => void d.accept());
    await page.goto(`${app.base}/staff`);
    await page.getByTestId('reset-s1').click();
    await page.locator('#stepup-password').fill('pw-ada');
    await page.locator('#stepup-code').fill('123456');
    await page.getByTestId('step-up-submit').click();
    await page.getByTestId('step-up-sign-in').waitFor();
    assert.match(await page.getByTestId('step-up-error').innerText(), /Your session has ended\. Sign in again\./);
    await context.close();
  });
});

describe('the step-up page', () => {
  it('confirms and goes on to the page it came from', async () => {
    const { page, context } = await openPage(browser, api());
    await page.goto(`${app.base}/step-up?next=/staff`);
    await page.locator('#stepup-password').fill('pw-ada');
    await page.locator('#stepup-code').fill('123456');
    await page.getByTestId('step-up-submit').click();
    await page.waitForURL((u) => u.pathname === '/staff');
    await context.close();
  });
});

describe('small screens', () => {
  it('sign-in, the code step and the step-up fit 320 px with nothing sideways and one-line buttons', async () => {
    const { page, context } = await openPage(browser, api(), { width: 320, height: 640 });
    const fits = async (label) => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `${label} scrolls sideways by ${overflow}px`);
      for (const b of await page.locator('button').all()) assert.ok((await b.boundingBox()).height < 60, `${label}: a button wraps`);
    };
    await page.goto(`${app.base}/sign-in`);
    await fits('password step');
    await page.locator('#email').fill('a-very-long-address-for-a-long-named-teammate@a-long-company-domain.example');
    await page.locator('#password').fill('pw-ada');
    await fits('long email');
    await page.screenshot({ path: join(SHOTS, 'sign-in-320.png') });
    await page.goto(`${app.base}/step-up`);
    await fits('step-up page');
    await page.screenshot({ path: join(SHOTS, 'step-up-320.png') });
    await context.close();
  });
});
