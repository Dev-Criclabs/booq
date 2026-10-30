import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkLink, finishEnrolment, groupSecret, startEnrolment, tokenFromHash } from './enrol';
import { fill, hasKey, t } from './i18n';
import { BASICS_FIELDS, changeStatus, errorKey as clubErrorKey, issueWebhookToken, itemKey, LAUNCH_KEY, loadClub, pauseClub, RESULT_KEY, saveBasics, sendOwnerInvite, SETUP_KEY } from './club';
import { loadLaunch, MARK_KEY, openChecks, recordResult } from './launch';
import { counts, FILTER_KEY, loadClubs, STATUS_KEY, visible, type ClubRow } from './clubs';
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

describe('clubs list (P1)', () => {
  const club = (clubId: string, status: ClubRow['status'], n = 0): ClubRow => ({ clubId, nameTh: 'ก', nameEn: clubId, status, bookingsConfirmed30d: n });
  const all = [club('a', 'live', 5), club('b', 'live'), club('c', 'testing'), club('d', 'draft'), club('e', 'paused')];
  it('counts each status and filters', () => {
    expect(counts(all)).toEqual({ all: 5, live: 2, testing: 1, draft: 1, paused: 1 });
    expect(visible(all, 'all')).toHaveLength(5);
    expect(visible(all, 'live').map((c) => c.clubId)).toEqual(['a', 'b']);
    expect(visible(all, 'paused').map((c) => c.clubId)).toEqual(['e']);
    expect(counts([])).toEqual({ all: 0, live: 0, testing: 0, draft: 0, paused: 0 });
  });
  it('every status and filter has a label key that exists, and the counts fill in', () => {
    for (const k of [...Object.values(STATUS_KEY), ...Object.values(FILTER_KEY)]) expect(hasKey(k), k).toBe(true);
    expect(t(FILTER_KEY.live, { count: 2 })).toBe('Live · 2');
    expect(t(FILTER_KEY.all, { count: 5 })).toBe('All · 5');
  });
  it('loads the list, or says why not', async () => {
    expect(await loadClubs(reply(200, { clubs: all }))).toEqual({ kind: 'ok', clubs: all });
    expect(await loadClubs(reply(401, { code: 'unauthenticated' }))).toEqual({ kind: 'error', key: 'X-new.staff_sign_in_required', signIn: true });
    expect(await loadClubs(reply(403, { code: 'forbidden' }))).toEqual({ kind: 'error', key: 'X-new.staff_forbidden' });
    expect(await loadClubs(reply(500, {}))).toEqual({ kind: 'error', key: 'X-new.clubs_unavailable' });
    expect(await loadClubs((async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toEqual({ kind: 'error', key: 'X-new.clubs_unavailable' });
  });
});

describe('club page', () => {
  const detail = { progress: { setup: [{ item: 'basics', done: true, owed_by: 'booq' }], launch: [{ item: 'line_test', result: 'pass', owed_by: 'booq' }] }, counts: { bookingsConfirmed30d: 4, lineMessagesSent30d: 9 } };
  const support = { setup: { mode: 'edit', club: { name_en: 'Hunter', status: 'testing' }, hours: [], locations: [], resources: [], settings: [], features: [] } };
  const router = (answers: Record<string, { status: number; json: unknown }>) => (async (url: string, init?: RequestInit) => {
    const a = answers[`${init?.method ?? 'GET'} ${url.replace('/api', '')}`] ?? { status: 404, json: { code: 'not_found' } };
    return new Response(JSON.stringify(a.json), { status: a.status });
  }) as unknown as typeof fetch;

  it('every item and result the API can name has a text key that exists', () => {
    for (const k of [...Object.values(SETUP_KEY), ...Object.values(LAUNCH_KEY), ...Object.values(RESULT_KEY)]) expect(hasKey(k), k).toBe(true);
    expect(itemKey(SETUP_KEY, 'something_new')).toBe('something_new'); // an unknown item shows its own key, never invented text
    for (let d = 1; d <= 7; d += 1) expect(hasKey(`X-new.weekday_${d}`)).toBe(true);
  });
  it('loads the detail, the support view and the owner invite together', async () => {
    const r = await loadClub(router({ 'GET /clubs/c1': { status: 200, json: detail }, 'GET /clubs/c1/support/setup': { status: 200, json: support }, 'GET /clubs/c1/owner-invite': { status: 200, json: { invite: { status: 'pending' } } } }), 'c1');
    expect(r).toMatchObject({ kind: 'ok', club: { counts: { bookingsConfirmed30d: 4 }, invite: { status: 'pending' }, support: { mode: 'edit' } } });
  });
  it('a club without an invite record still loads; an unknown club, no session and an outage each say so', async () => {
    const ok = { 'GET /clubs/c1': { status: 200, json: detail }, 'GET /clubs/c1/support/setup': { status: 200, json: support } };
    expect(await loadClub(router(ok), 'c1')).toMatchObject({ kind: 'ok', club: { invite: { status: 'none' } } });
    expect(await loadClub(router({ 'GET /clubs/c1': { status: 404, json: { code: 'not_found' } }, 'GET /clubs/c1/support/setup': { status: 404, json: {} } }), 'c1')).toEqual({ kind: 'error', key: 'X-new.club_not_found', notFound: true });
    expect(await loadClub(router({ 'GET /clubs/c1': { status: 401, json: {} }, 'GET /clubs/c1/support/setup': { status: 401, json: {} } }), 'c1')).toMatchObject({ kind: 'error', signIn: true });
    expect(await loadClub((async () => { throw new Error('offline'); }) as unknown as typeof fetch, 'c1')).toEqual({ kind: 'error', key: 'X-new.club_unavailable' });
  });
  it('each refusal code has its own text; a stale second factor asks for the step-up', () => {
    for (const code of ['look_only', 'section_unavailable', 'invalid', 'bad_input', 'reason_required', 'transition_not_allowed', 'use_pause', 'owner_contact_missing', 'mail_failed', 'not_configured']) expect(hasKey(clubErrorKey(409, code)), code).toBe(true);
    expect(clubErrorKey(403, 'step_up_required')).toBe('X-new.staff_step_up_required');
    expect(clubErrorKey(500, undefined)).toBe('X-new.club_unavailable');
  });
  it('a status change sends the status and the trimmed reason; a blocked one lists what is missing', async () => {
    const c = calls();
    await changeStatus(c.f, 'c1', 'testing', '  ready  ');
    await changeStatus(c.f, 'c1', 'live', '');
    expect(c.seen.map((x) => x.body)).toEqual([{ to: 'testing', reason: 'ready' }, { to: 'live' }]);
    expect(await changeStatus(router({ 'POST /clubs/c1/status': { status: 409, json: { code: 'blocked', missing: [{ item: 'line', owed_by: 'booq' }] } } }), 'c1', 'testing', '')).toEqual({ kind: 'blocked', missing: [{ item: 'line', owed_by: 'booq' }] });
    expect(await changeStatus(router({ 'POST /clubs/c1/status': { status: 403, json: { code: 'step_up_required' } } }), 'c1', 'live', '')).toMatchObject({ kind: 'error', stepUp: true });
    expect(await pauseClub(router({ 'POST /clubs/c1/pause': { status: 200, json: { ownerNotified: false } } }), 'c1', 'x')).toEqual({ kind: 'done' });
  });
  it('the owner invite and the webhook address', async () => {
    expect(await sendOwnerInvite(router({ 'POST /clubs/c1/owner-invite': { status: 200, json: { status: 'sent' } } }), 'c1')).toEqual({ kind: 'done' });
    expect(await sendOwnerInvite(router({ 'POST /clubs/c1/owner-invite': { status: 409, json: { code: 'owner_contact_missing' } } }), 'c1')).toEqual({ kind: 'error', key: 'X-new.club_owner_contact_missing' });
    expect(await issueWebhookToken(router({ 'POST /clubs/c1/webhook-tokens/line': { status: 200, json: { token: 't', url: 'https://app.example/api/webhooks/line/t', replaced: true } } }), 'c1', 'line')).toEqual({ kind: 'token', url: 'https://app.example/api/webhooks/line/t', replaced: true });
    expect(await issueWebhookToken(router({ 'POST /clubs/c1/webhook-tokens/beam_live': { status: 409, json: { code: 'look_only' } } }), 'c1', 'beam_live')).toEqual({ kind: 'error', key: 'X-new.club_look_only' });
  });
  it('basics: only what changed is sent, an empty value clears the field, nothing changed sends nothing', async () => {
    const was = { name_th: 'ก', name_en: 'Hunter', legal_name: null, owner_name: 'Nok', owner_phone: '081', owner_line: null, owner_email: 'n@x.co' };
    const same = Object.fromEntries(BASICS_FIELDS.map((k) => [k, was[k] ?? ''])) as Record<(typeof BASICS_FIELDS)[number], string>;
    const c = calls();
    expect(await saveBasics(c.f, 'c1', same, was)).toEqual({ kind: 'saved', pendingOwnerContact: false });
    expect(c.seen).toEqual([]);
    await saveBasics(c.f, 'c1', { ...same, name_en: ' Hunter Club ', owner_name: '' }, was);
    expect(c.seen[0]).toEqual({ url: '/api/clubs/c1/support/setup/basics', method: 'PUT', body: { name_en: 'Hunter Club', owner_name: null } });
    expect(await saveBasics(router({ 'PUT /clubs/c1/support/setup/basics': { status: 200, json: { changed: ['owner_phone'], pendingOwnerContact: 'req-1' } } }), 'c1', { ...same, owner_phone: '082' }, was)).toEqual({ kind: 'saved', pendingOwnerContact: true });
    expect(await saveBasics(router({ 'PUT /clubs/c1/support/setup/basics': { status: 409, json: { code: 'look_only' } } }), 'c1', { ...same, name_en: 'X' }, was)).toEqual({ kind: 'error', key: 'X-new.club_look_only' });
  });
});

describe('launch page', () => {
  const launch = { clubName: 'Hunter', clubStatus: 'testing', items: [{ item: 'product_priced', result: 'pending', owed_by: 'owner', recorded: true }, { item: 'line_test', result: 'pass', owed_by: 'booq', recorded: false }] };
  it('loads the checks, counts the open ones, and says why when it cannot', async () => {
    expect(await loadLaunch(reply(200, launch), 'c1')).toEqual({ kind: 'ok', launch });
    expect(openChecks(launch.items as never)).toBe(1);
    expect(openChecks([])).toBe(0);
    expect(await loadLaunch(reply(404, { code: 'not_found' }), 'c1')).toMatchObject({ kind: 'error', key: 'X-new.club_not_found', notFound: true });
    expect(await loadLaunch(reply(401, {}), 'c1')).toMatchObject({ kind: 'error', signIn: true });
    expect(await loadLaunch(reply(200, { items: 'no' }), 'c1')).toMatchObject({ kind: 'error' });
    expect(await loadLaunch((async () => { throw new Error('offline'); }) as unknown as typeof fetch, 'c1')).toEqual({ kind: 'error', key: 'X-new.club_unavailable' });
    for (const k of Object.values(MARK_KEY)) expect(hasKey(k), k).toBe(true);
  });
  it('records a result with the check named in the path, and each refusal has its text', async () => {
    const c = calls();
    await recordResult(c.f, 'c1', 'product_priced', 'pass');
    expect(c.seen[0]).toEqual({ url: '/api/clubs/c1/launch/product_priced', method: 'PUT', body: { result: 'pass' } });
    expect(await recordResult(reply(200, {}), 'c1', 'x', 'fail')).toEqual({ kind: 'done' });
    expect(await recordResult(reply(409, { code: 'not_testing' }), 'c1', 'x', 'pass')).toEqual({ kind: 'error', key: 'X-new.launch_not_testing' });
    expect(await recordResult(reply(400, { code: 'not_recorded' }), 'c1', 'x', 'pass')).toEqual({ kind: 'error', key: 'X-new.launch_not_recorded' });
    expect(await recordResult(reply(403, { code: 'step_up_required' }), 'c1', 'x', 'pass')).toMatchObject({ kind: 'error', stepUp: true });
    expect(await recordResult(reply(403, { code: 'forbidden' }), 'c1', 'x', 'pass')).toEqual({ kind: 'error', key: 'X-new.staff_forbidden' });
  });
});
