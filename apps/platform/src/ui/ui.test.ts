import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkLink, finishEnrolment, groupSecret, startEnrolment, tokenFromHash } from './enrol';
import { fill, hasKey, t } from './i18n';
import { safeNext, signInWithCode, signInWithPassword, stepUp } from './auth';
import { deactivate, errorKey, invite, loadTeam, resetFactor } from './staff';

// The console pages' logic and text (F01-T17c). No browser: fetch is faked; the screens are covered by the Playwright test.
const reply = (status: number, json: unknown) => (async () => new Response(JSON.stringify(json), { status })) as unknown as typeof fetch;
const calls = () => {
  const seen: Array<{ url: string; method: string; body: unknown }> = [];
  const f = (async (url: string, init: RequestInit) => {
    seen.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  return { seen, f };
};

describe('text', () => {
  it('every key a page uses exists in the language files (no key is shown raw)', () => {
    const dir = __dirname;
    const keys = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f))) {
      for (const m of readFileSync(join(dir, file), 'utf8').matchAll(/['"`](X-(?:new\.[a-z_]+|\d{4}))['"`]/g)) keys.add(m[1]!);
    }
    expect(keys.size).toBeGreaterThan(20);
    expect([...keys].filter((k) => !hasKey(k))).toEqual([]);
  });
  it('fills named variables and leaves an unknown one visible', () => {
    expect(fill('Hello {name}, {other}', { name: 'Sam' })).toBe('Hello Sam, {other}');
    expect(t('X-new.enrol_greeting', { name: 'Sam' })).toContain('Sam');
    expect(t('X-not-a-key')).toBe('X-not-a-key');
  });
});

describe('enrolment steps', () => {
  it('reads the token from the fragment only when it looks like one', () => {
    expect(tokenFromHash('#' + 'a'.repeat(43))).toBe('a'.repeat(43));
    for (const bad of ['', '#', '#short', '#' + 'a'.repeat(300), '#abc def ghi jkl mno pqr stu']) expect(tokenFromHash(bad)).toBeNull();
  });
  it('shows the setup key in groups of four', () => {
    expect(groupSecret('ABCDEFGHIJKLMNOP')).toBe('ABCD EFGH IJKL MNOP');
    expect(groupSecret('ABCDEF')).toBe('ABCD EF');
  });
  it('check: a good link greets by name, an unknown one is invalid, an outage is unavailable', async () => {
    expect(await checkLink(reply(200, { displayName: 'Sam' }), 't')).toEqual({ kind: 'ok', displayName: 'Sam' });
    expect(await checkLink(reply(404, { code: 'invalid_link' }), 't')).toEqual({ kind: 'invalid' });
    expect(await checkLink(reply(503, { code: 'identity_unavailable' }), 't')).toEqual({ kind: 'unavailable' });
    expect(await checkLink((async () => { throw new Error('offline'); }) as unknown as typeof fetch, 't')).toEqual({ kind: 'unavailable' });
  });
  it('start: the answer, or the key to show for each refusal', async () => {
    expect(await startEnrolment(reply(200, { enrolmentId: 'e', secret: 'S', uri: 'otpauth://x' }), 't', 'pw')).toEqual({ kind: 'ok', enrolmentId: 'e', secret: 'S', uri: 'otpauth://x' });
    expect(await startEnrolment(reply(400, { code: 'weak_password' }), 't', 'pw')).toEqual({ kind: 'error', key: 'X-new.enrol_weak_password' });
    expect(await startEnrolment(reply(404, { code: 'invalid_link' }), 't', 'pw')).toEqual({ kind: 'error', key: 'X-new.enrol_invalid_link', link: true });
    expect(await startEnrolment(reply(503, { code: 'identity_unavailable' }), 't', 'pw')).toEqual({ kind: 'error', key: 'X-new.enrol_unavailable' });
    expect(await startEnrolment(reply(429, { code: 'rate_limited' }), 't', 'pw')).toEqual({ kind: 'error', key: 'X-new.enrol_unavailable' });
  });
  it('finish: sends the code without spaces; wrong, too many and expired are told apart', async () => {
    const c = calls();
    await finishEnrolment(c.f, 'e', '123 456');
    expect(c.seen[0]).toEqual({ url: '/api/enrol/finish', method: 'POST', body: { enrolmentId: 'e', code: '123456' } });
    expect(await finishEnrolment(reply(200, { ok: true }), 'e', '1')).toEqual({ kind: 'done' });
    expect(await finishEnrolment(reply(401, { code: 'bad_code' }), 'e', '1')).toEqual({ kind: 'error', key: 'X-new.enrol_bad_code' });
    expect(await finishEnrolment(reply(429, { code: 'too_many_attempts' }), 'e', '1')).toEqual({ kind: 'error', key: 'X-new.enrol_too_many_attempts', restart: true });
    expect(await finishEnrolment(reply(404, { code: 'invalid_enrolment' }), 'e', '1')).toEqual({ kind: 'error', key: 'X-new.enrol_invalid_enrolment', restart: true });
  });
});

describe('team page', () => {
  it('lists the team, or says why not', async () => {
    const team = [{ id: 'a', displayName: 'Ada', email: 'a@x', role: 'platform_admin', active: true }];
    expect(await loadTeam(reply(200, { team }))).toEqual({ kind: 'ok', team });
    expect(await loadTeam(reply(401, { code: 'unauthenticated' }))).toEqual({ kind: 'error', key: 'X-new.staff_sign_in_required', signIn: true });
    expect(await loadTeam(reply(403, { code: 'forbidden' }))).toEqual({ kind: 'error', key: 'X-new.staff_forbidden' });
  });
  it('an invite or a reset gives the link once; a deactivation gives none; each refusal has its text', async () => {
    expect(await invite(reply(200, { staffId: 's', enrolmentLink: 'https://c.example/enrol#tok' }), { email: 'a@b.co', displayName: 'A', role: 'onboarding_specialist' })).toEqual({ kind: 'link', link: 'https://c.example/enrol#tok' });
    expect(await resetFactor(reply(200, { enrolmentLink: 'https://c.example/enrol#t2' }), 'id')).toEqual({ kind: 'link', link: 'https://c.example/enrol#t2' });
    expect(await deactivate(reply(200, {}), 'id')).toEqual({ kind: 'done' });
    expect(await invite(reply(409, { code: 'email_taken' }), { email: 'a@b.co', displayName: 'A', role: 'platform_admin' })).toEqual({ kind: 'error', key: 'X-new.staff_email_taken' });
    expect(await deactivate(reply(409, { code: 'last_admin' }), 'id')).toEqual({ kind: 'error', key: 'X-new.staff_last_admin' });
    expect(await resetFactor(reply(403, { code: 'step_up_required' }), 'id')).toEqual({ kind: 'error', key: 'X-new.staff_step_up_required', stepUp: true });
    expect(await resetFactor((async () => { throw new Error('offline'); }) as unknown as typeof fetch, 'id')).toEqual({ kind: 'error', key: 'X-new.staff_unavailable' });
  });
  it('maps codes to keys, and the ids are encoded into the path', async () => {
    expect(errorKey(503, 'not_configured')).toBe('X-new.staff_enrolment_not_configured');
    expect(errorKey(409, 'same_person')).toBe('X-new.staff_same_person');
    expect(errorKey(400, 'bad_input')).toBe('X-new.staff_bad_input');
    expect(errorKey(500, undefined)).toBe('X-new.staff_unavailable');
    const c = calls();
    await resetFactor(c.f, 'a/b');
    expect(c.seen[0]!.url).toBe('/api/staff/a%2Fb/reset-factor');
  });
});

describe('sign-in', () => {
  it('only an address on this site is followed after sign-in', () => {
    expect(safeNext('/staff')).toBe('/staff');
    expect(safeNext('/step-up')).toBe('/step-up');
    for (const bad of [null, undefined, '', 'https://evil.example', '//evil.example', '/\\evil', 'javascript:alert(1)', '/a?b=c', '/a b']) expect(safeNext(bad), String(bad)).toBe('/staff');
  });
  it('the first step gives a challenge; each refusal has its own text; a wrong email and a wrong password are one answer', async () => {
    const c = calls();
    await signInWithPassword(c.f, ' ada@booq.example ', 'pw');
    expect(c.seen[0]).toEqual({ url: '/api/auth/sign-in', method: 'POST', body: { email: 'ada@booq.example', password: 'pw' } });
    expect(await signInWithPassword(reply(200, { challengeId: 'c1' }), 'a@b.co', 'pw')).toEqual({ kind: 'challenge', challengeId: 'c1' });
    expect(await signInWithPassword(reply(401, { code: 'invalid_credentials' }), 'a@b.co', 'pw')).toEqual({ kind: 'error', key: 'X-new.signin_invalid_credentials' });
    expect(await signInWithPassword(reply(503, { code: 'identity_unavailable' }), 'a@b.co', 'pw')).toEqual({ kind: 'error', key: 'X-new.signin_unavailable' });
    expect(await signInWithPassword(reply(429, { code: 'rate_limited' }), 'a@b.co', 'pw')).toEqual({ kind: 'error', key: 'X-new.signin_rate_limited' });
    expect(await signInWithPassword((async () => { throw new Error('offline'); }) as unknown as typeof fetch, 'a@b.co', 'pw')).toEqual({ kind: 'error', key: 'X-new.signin_unavailable' });
  });
  it('the second step sends the code without spaces; a wrong code can be retried, a lock or an expired step goes back to the password', async () => {
    const c = calls();
    await signInWithCode(c.f, 'c1', '123 456');
    expect(c.seen[0]).toEqual({ url: '/api/auth/second-factor', method: 'POST', body: { challengeId: 'c1', code: '123456' } });
    expect(await signInWithCode(reply(200, { ok: true }), 'c1', '1')).toEqual({ kind: 'done' });
    expect(await signInWithCode(reply(401, { code: 'bad_code' }), 'c1', '1')).toEqual({ kind: 'error', key: 'X-new.enrol_bad_code', restart: false });
    expect(await signInWithCode(reply(423, { code: 'locked' }), 'c1', '1')).toEqual({ kind: 'error', key: 'X-new.signin_locked', restart: true });
    expect(await signInWithCode(reply(401, { code: 'challenge_invalid' }), 'c1', '1')).toEqual({ kind: 'error', key: 'X-new.signin_challenge_invalid', restart: true });
  });
  it('a step-up sends the password and the code; a wrong password and a wrong code are one answer; a ended session says so', async () => {
    const c = calls();
    await stepUp(c.f, 'pw', '123 456');
    expect(c.seen[0]).toEqual({ url: '/api/auth/step-up', method: 'POST', body: { password: 'pw', code: '123456' } });
    expect(await stepUp(reply(200, { ok: true }), 'pw', '1')).toEqual({ kind: 'done' });
    expect(await stepUp(reply(401, { code: 'bad_code' }), 'pw', '1')).toEqual({ kind: 'error', key: 'X-new.stepup_failed' });
    expect(await stepUp(reply(423, { code: 'locked' }), 'pw', '1')).toEqual({ kind: 'error', key: 'X-new.signin_locked' });
    expect(await stepUp(reply(401, { code: 'session_invalid' }), 'pw', '1')).toEqual({ kind: 'error', key: 'X-new.stepup_session_ended', signedOut: true });
    expect(await stepUp(reply(401, { code: 'unauthenticated' }), 'pw', '1')).toEqual({ kind: 'error', key: 'X-new.stepup_session_ended', signedOut: true });
  });
});
