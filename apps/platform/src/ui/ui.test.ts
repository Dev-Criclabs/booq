import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkLink, finishEnrolment, groupSecret, startEnrolment, tokenFromHash } from './enrol';
import { fill, hasKey, t } from './i18n';
import { BASICS_FIELDS, changeStatus, errorKey as clubErrorKey, issueWebhookToken, itemKey, LAUNCH_KEY, loadClub, pauseClub, RESULT_KEY, saveBasics, sendOwnerInvite, SETUP_KEY } from './club';
import { loadLaunch, MARK_KEY, openChecks, recordResult } from './launch';
import { isKnown, KNOWN, labelKey, loadConfig, parse, saveValue, show } from './config';
import { check, emptyTexts, fromCurrent, loadLegal, publish, when, kindKey, languageKey, partKey, KINDS, LANGUAGES, PARTS } from './legal';
import { applicableSwitches, courtDraft, courtsPatch, featuresPatch, hoursDraft, hoursPatch, newCourt, newLocation, saveSection, trimSeconds, WEEKDAYS } from './support-edit';
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

describe('settings page', () => {
  it('every setting the page knows has a text key that exists', () => {
    expect(KNOWN.length).toBeGreaterThan(10);
    for (const { key } of KNOWN) expect(hasKey(labelKey(key)), key).toBe(true);
    expect(isKnown('pay_tap_limit_count')).toBe(true);
    expect(isKnown('invented')).toBe(false);
    expect(KNOWN.filter((k) => k.fixed).map((k) => k.key)).toEqual(['line_cap_alert_percent', 'line_cap_reminders_stop_percent', 'line_cap_over_limit_percent']);
    expect(hasKey('X-new.config_fixed')).toBe(true);
  });
  it('a number must be above zero and a list must be a list; nothing is guessed', () => {
    expect(parse('number', ' 72 ')).toEqual({ ok: true, value: 72 });
    expect(parse('number', '1.5')).toEqual({ ok: true, value: 1.5 });
    for (const bad of ['', '0', '-1', 'abc', '1e3', '1,5', ' ']) expect(parse('number', bad), bad).toEqual({ ok: false, key: 'X-new.config_number_needed' });
    expect(parse('list', '[{"key":"a"}]')).toEqual({ ok: true, value: [{ key: 'a' }] });
    for (const bad of ['', '{}', '"x"', '[', 'null']) expect(parse('list', bad), bad).toEqual({ ok: false, key: 'X-new.config_json_needed' });
    expect(show(5)).toBe('5');
    expect(show([{ a: 1 }])).toBe('[{"a":1}]');
  });
  it('loads the values by key, or says why not', async () => {
    expect(await loadConfig(reply(200, { config: [{ key: 'a', value: 1 }, { key: 'b', value: [2] }] }))).toEqual({ kind: 'ok', values: { a: 1, b: [2] } });
    expect(await loadConfig(reply(401, {}))).toMatchObject({ kind: 'error', signIn: true });
    expect(await loadConfig((async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toEqual({ kind: 'error', key: 'X-new.club_unavailable' });
  });
  it('saves a parsed value; a bad one sends nothing; each refusal has its text', async () => {
    const c = calls();
    expect(await saveValue(c.f, 'invite_ttl_hours', 'number', '48')).toEqual({ kind: 'saved' });
    expect(c.seen[0]).toEqual({ url: '/api/config/invite_ttl_hours', method: 'PUT', body: { value: 48 } });
    expect(await saveValue(c.f, 'invite_ttl_hours', 'number', 'soon')).toEqual({ kind: 'error', key: 'X-new.config_number_needed' });
    expect(c.seen).toHaveLength(1);
    expect(await saveValue(reply(400, { code: 'invalid' }), 'x', 'number', '1')).toEqual({ kind: 'error', key: 'X-new.config_invalid' });
    expect(await saveValue(reply(403, { code: 'step_up_required' }), 'x', 'number', '1')).toMatchObject({ kind: 'error', stepUp: true });
    expect(await saveValue(reply(403, { code: 'forbidden' }), 'x', 'number', '1')).toEqual({ kind: 'error', key: 'X-new.staff_forbidden' });
  });
});

describe('legal page', () => {
  const full = () => {
    const x = emptyTexts();
    for (const k of KINDS) for (const l of LANGUAGES) { x[k][l].title = `T ${k} ${l}`; x[k][l].body = `B ${k} ${l} {clubName} {legalName}`; }
    return x;
  };
  it('writes a date in Bangkok time with the international year', () => {
    expect(when('2026-12-29T17:05:00Z')).toBe('30 December 2026, 00:05');
    expect(when('2026-12-29T03:00:00Z')).toBe('29 December 2026, 10:00');
  });
  it('every label the page uses has a text key that exists', () => {
    for (const k of KINDS) expect(hasKey(kindKey(k)), k).toBe(true);
    for (const l of LANGUAGES) expect(hasKey(languageKey(l)), l).toBe(true);
    for (const p of PARTS) expect(hasKey(partKey(p)), p).toBe(true);
  });
  it('the form starts from the newest version, or empty when nothing is published', () => {
    expect(fromCurrent({ releases: [], current: null })).toEqual(emptyTexts());
    const seed = full();
    expect(fromCurrent({ releases: [{ version: 'v1', publishedAt: '2026-12-01T00:00:00Z', publishedBy: null }], current: { version: 'v1', texts: seed } })).toEqual(seed);
  });
  it('checks for an empty field and for a {field} the system does not fill in, before sending', () => {
    expect(check(full())).toBeNull();
    const empty = full();
    empty.terms.th.body = '  ';
    expect(check(empty)).toEqual({ key: 'X-new.legal_missing', kind: 'terms', language: 'th', part: 'body' });
    const odd = full();
    odd.privacy.en.title = 'Hello {playerName}';
    expect(check(odd)).toEqual({ key: 'X-new.legal_unknown_field', field: 'playerName' });
  });
  it('loads what is published, or says why not', async () => {
    const view = { releases: [{ version: 'v1', publishedAt: '2026-12-01T00:00:00Z', publishedBy: 'Ada' }], current: { version: 'v1', texts: full() } };
    expect(await loadLegal(reply(200, view))).toEqual({ kind: 'ok', view });
    expect(await loadLegal(reply(200, { releases: [], current: null }))).toEqual({ kind: 'ok', view: { releases: [], current: null } });
    expect(await loadLegal(reply(401, {}))).toMatchObject({ kind: 'error', signIn: true });
    expect(await loadLegal((async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toEqual({ kind: 'error', key: 'X-new.club_unavailable' });
  });
  it('publishes the texts as they are; a bad one sends nothing; the API refusals have their text', async () => {
    const c = calls();
    expect(await publish(reply(200, { version: 'v3' }), full())).toEqual({ kind: 'published', version: 'v3' });
    await publish(c.f, full());
    expect(c.seen[0]!.url).toBe('/api/legal/releases');
    expect(c.seen[0]!.body).toEqual({ texts: full() });
    const bad = full();
    bad.terms.en.title = '';
    expect(await publish(c.f, bad)).toMatchObject({ kind: 'error', key: 'X-new.legal_missing' });
    expect(c.seen).toHaveLength(1);
    expect(await publish(reply(400, { code: 'invalid', reason: 'unknown_field', field: 'x' }), full())).toMatchObject({ kind: 'error', key: 'X-new.legal_unknown_field', problem: { field: 'x' } });
    expect(await publish(reply(400, { code: 'invalid', reason: 'missing_text', kind: 'terms', language: 'en' }), full())).toMatchObject({ kind: 'error', key: 'X-new.legal_missing' });
    expect(await publish(reply(400, { code: 'invalid', reason: 'invalid_texts' }), full())).toEqual({ kind: 'error', key: 'X-new.legal_invalid' });
    expect(await publish(reply(403, { code: 'step_up_required' }), full())).toMatchObject({ kind: 'error', stepUp: true });
    expect(await publish(reply(403, { code: 'forbidden' }), full())).toEqual({ kind: 'error', key: 'X-new.staff_forbidden' });
  });
});

describe('support view editing', () => {
  const was = hoursDraft([{ weekday: 1, open: '06:00:00', close: '24:00:00' }, { weekday: 2, open: '06:00:00', close: '22:00:00' }]);
  it('hours: seconds are trimmed, nothing changed sends nothing, a change sends only that day', () => {
    expect(trimSeconds('06:00:00')).toBe('06:00');
    expect(was[1]).toEqual({ open: '06:00', close: '24:00' });
    expect(was[3]).toEqual({ open: '', close: '' });
    expect(hoursPatch(was, was)).toEqual({ ok: true, hours: [] });
    expect(hoursPatch(was, { ...was, 2: { open: '07:00', close: '21:30' } })).toEqual({ ok: true, hours: [{ weekday: 2, open: '07:00', close: '21:30' }] });
    expect(hoursPatch(was, { ...was, 3: { open: '06:00', close: '24:00' } })).toEqual({ ok: true, hours: [{ weekday: 3, open: '06:00', close: '24:00' }] });
  });
  it('hours: both or neither, 24-hour time, closing later than opening', () => {
    expect(hoursPatch(was, { ...was, 3: { open: '06:00', close: '' } })).toEqual({ ok: false, weekday: 3, key: 'X-new.support_hours_both' });
    for (const bad of ['6:00', '25:00', '06:60', 'soon', '24:00x']) expect(hoursPatch(was, { ...was, 3: { open: bad, close: '22:00' } }), bad).toMatchObject({ ok: false, weekday: 3, key: 'X-new.support_hours_format' });
    expect(hoursPatch(was, { ...was, 3: { open: '22:00', close: '06:00' } })).toMatchObject({ ok: false, key: 'X-new.support_hours_order' });
    expect(hoursPatch(was, { ...was, 3: { open: '24:00', close: '24:00' } })).toMatchObject({ ok: false, key: 'X-new.support_hours_format' });
    expect(WEEKDAYS).toHaveLength(7);
  });
  const court = { id: 'r1', name: 'Court 1', sport: 'tennis', type: 'outdoor', lights: true, max_players: 4, active: true };
  it('courts: only the changed fields of the changed courts are sent, an empty players box clears it', () => {
    const d = courtDraft(court);
    expect(d).toEqual({ name: 'Court 1', sport: 'tennis', type: 'outdoor', lights: true, max_players: '4', active: true });
    expect(courtDraft({ id: 'r9', name: 'Court 9', sport: 'tennis', type: null, max_players: null, active: true })).toMatchObject({ type: '', max_players: '', lights: false });
    const base = { r1: d, r2: { ...d, name: 'Court 2' } };
    expect(courtsPatch(base, base)).toEqual({ ok: true, resources: [] });
    expect(courtsPatch(base, { ...base, r1: { ...d, name: ' Centre ', active: false, max_players: '' } })).toEqual({ ok: true, resources: [{ id: 'r1', name: 'Centre', active: false, max_players: null }] });
    expect(courtsPatch(base, { ...base, r2: { ...base.r2, type: '', sport: 'padel', lights: false } })).toEqual({ ok: true, resources: [{ id: 'r2', sport: 'padel', type: null, lights: false }] });
  });
  it('switches: the catalogue is filtered by payment option, an absent row is off', () => {
    const f = [{ feature_key: 'a', enabled: true }];
    const cat = [{ feature_key: 'a', requires_payment_option: null }, { feature_key: 'b', requires_payment_option: null }, { feature_key: 's', requires_payment_option: 'slip' }];
    const sup = (option: string | null) => ({ club: { payment_option: option }, features: f, featureKeys: cat }) as never;
    expect(applicableSwitches(sup('beam'))).toEqual([{ key: 'a', enabled: true }, { key: 'b', enabled: false }]);
    expect(applicableSwitches(sup('slip')).map((k) => k.key)).toEqual(['a', 'b', 's']);
  });
  it('location: a name is needed and at most 100 characters', () => {
    expect(newLocation(' Main ')).toEqual({ ok: true, location: { name: 'Main' } });
    for (const bad of ['', '  ', 'x'.repeat(101)]) expect(newLocation(bad)).toEqual({ ok: false, key: 'X-new.support_location_name' });
  });
  it('courts: a name cannot be emptied and players must be a whole number above zero', () => {
    const d = courtDraft(court);
    expect(courtsPatch({ r1: d }, { r1: { ...d, name: '  ' } })).toEqual({ ok: false, id: 'r1', key: 'X-new.support_court_name' });
    for (const bad of ['0', '-1', '2.5', 'four', '1000']) expect(courtsPatch({ r1: d }, { r1: { ...d, max_players: bad } }), bad).toEqual({ ok: false, id: 'r1', key: 'X-new.support_court_players_bad' });
  });
  it('a new court goes into the first location; without one, or without a name, it is refused', () => {
    expect(newCourt([{ id: 'l1', name: 'Main' }, { id: 'l2', name: 'Annex' }], { name: ' Court 3 ', sport: 'padel' })).toEqual({ ok: true, resource: { location_id: 'l1', name: 'Court 3', sport: 'padel' } });
    expect(newCourt([], { name: 'Court 3', sport: 'padel' })).toEqual({ ok: false, key: 'X-new.support_court_no_location' });
    expect(newCourt([{ id: 'l1', name: 'Main' }], { name: ' ', sport: 'padel' })).toEqual({ ok: false, key: 'X-new.support_court_name' });
  });
  it('switches: only an existing one that changed is sent', () => {
    expect(featuresPatch({ coaches: true, classes: false }, { coaches: false, classes: false })).toEqual({ coaches: false });
    expect(featuresPatch({ coaches: true }, { coaches: true })).toEqual({});
    expect(featuresPatch({ coaches: true }, { coaches: true, invented: true })).toEqual({});
  });
  it('saving names the section in the path; a refusal has its text', async () => {
    const c = calls();
    await saveSection(c.f, 'c1', 'resources-hours', { hours: [] });
    expect(c.seen[0]).toEqual({ url: '/api/clubs/c1/support/setup/resources-hours', method: 'PUT', body: { hours: [] } });
    expect(await saveSection(reply(200, {}), 'c1', 'features', {})).toEqual({ kind: 'saved' });
    expect(await saveSection(reply(409, { code: 'look_only' }), 'c1', 'features', {})).toEqual({ kind: 'error', key: 'X-new.club_look_only' });
    expect(await saveSection(reply(400, { code: 'invalid' }), 'c1', 'features', {})).toEqual({ kind: 'error', key: 'X-new.club_invalid' });
    expect(await saveSection((async () => { throw new Error('offline'); }) as unknown as typeof fetch, 'c1', 'features', {})).toEqual({ kind: 'error', key: 'X-new.club_unavailable' });
  });
});
