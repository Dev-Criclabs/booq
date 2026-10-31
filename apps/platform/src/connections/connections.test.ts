import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlatformDb, type PlatformDb } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { generateKeyPair } from '@booq/secrets';
import { createSupportService } from '../support/support';
import { createConnections, type BeamProbe, type LineProbe } from './connections';

// F01-T23 part c: the line and payments sections of the support view, and "Test connection"
// (PLAT-02-AC8, D27, D32, SR-02, SR-03, SR-16; design 5.2 and 6.3).
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LIVE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const keys = generateKeyPair();
const TOKEN = 'MARKER-line-token-abcd1234';
const SECRET = 'MARKER-line-secret-wxyz9876';
const BEAM_KEY = 'MARKER-beam-key-test-QRST';

let tdb: TestDatabase;
let pdb: PlatformDb;
let svc: ReturnType<typeof createSupportService>;
let admin: string;
let spec: string;
let loner: string;
let lineCalls: Array<{ channelAccessToken: string; expectedBasicId?: string | undefined }>;
let beamCalls: Array<{ apiKey: string; merchantId: string; mode: string }>;
let lineResult: { ok: true; basicId?: string } | { ok: false; code: string };
let beamResult: { ok: true; merchantId: string } | { ok: false; code: string };

const line: LineProbe = { check: async (i) => (lineCalls.push(i), lineResult) };
const beam: BeamProbe = { check: async (i) => (beamCalls.push(i), beamResult) };

async function staff(email: string, role: string, auth: string, name: string): Promise<string> {
  return (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1, $2, $3, $4) returning id`, [auth, email, name, role])).rows[0].id;
}
const put = (who: string, section: string, body: unknown, fresh = true, club = CLUB) => svc.putSetup(who, club, section, body, { stepUpFresh: fresh });
const lineRow = async () => (await tdb.query(`select * from public.line_connection where club_id = $1`, [CLUB])).rows[0];
const payRow = async () => (await tdb.query(`select * from public.payment_connection where club_id = $1`, [CLUB])).rows[0];
const everything = async () => JSON.stringify([
  (await tdb.query(`select * from platform.audit_log`)).rows,
  (await tdb.query(`select * from public.audit_entry`)).rows,
  (await tdb.query(`select * from public.owner_notice`)).rows,
  (await tdb.query(`select secret_last4 from public.line_connection`)).rows,
]);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1, 'a', 'ก', 'A', 'testing'), ($2, 'b', 'ข', 'B', 'live')`, [CLUB, LIVE]);
  admin = await staff('admin@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000001', 'Ada Admin');
  spec = await staff('spec@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000002', 'Sam Specialist');
  loner = await staff('loner@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000003', 'Lee Loner');
  for (const c of [CLUB, LIVE]) await tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1, $2)`, [spec, c]);
  pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
  lineCalls = [];
  beamCalls = [];
  lineResult = { ok: true, basicId: '@club-a' };
  beamResult = { ok: true, merchantId: 'M-TEST-1' };
  svc = createSupportService({ db: pdb, connections: createConnections({ encryptKey: keys.publicKey, line, beam }) });
});
afterEach(async () => {
  await pdb.end();
  await tdb.close();
});

describe('LINE section (P2 step 4)', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    login_channel_id: '1650000001', messaging_channel_id: '1650000002', liff_id: '1650000001-AbCdEfGh', oa_basic_id: '@club-a',
    line_plan_kind: 'paid', plan_message_limit: 15000, line_channel_token: TOKEN, line_channel_secret: SECRET, ...over,
  });

  it('saves the ids and the secrets: secrets are encrypted, only the last four show, and nothing else is returned', async () => {
    const r = await put(spec, 'line', body());
    expect(r).toMatchObject({ ok: true });
    expect(JSON.stringify(r)).not.toContain('MARKER');
    const row = await lineRow();
    expect(row).toMatchObject({ login_channel_id: '1650000001', messaging_channel_id: '1650000002', liff_id: '1650000001-AbCdEfGh', oa_basic_id: '@club-a', line_plan_kind: 'paid', plan_message_limit: 15000, tested_at: null });
    expect(row.secret_last4).toEqual({ line_channel_token: '1234', line_channel_secret: '9876' });
    const secrets = (await tdb.query(`select kind, ciphertext from public.club_secret where club_id = $1 order by kind`, [CLUB])).rows;
    expect(secrets.map((s) => s.kind)).toEqual(['line_channel_secret', 'line_channel_token']);
    for (const s of secrets) expect(s.ciphertext).not.toContain('MARKER');
    expect(lineCalls).toEqual([]);                       // no test asked for, none run
  });

  it('a marker secret is in no log, entry, notice or response', async () => {
    await put(spec, 'line', body({ test: true }));
    expect(await everything()).not.toMatch(/MARKER/);
  });

  it('with test: the probe runs with the typed token and a pass records tested_at; a fail saves nothing and says why', async () => {
    const pass = await put(spec, 'line', body({ test: true }));
    expect(pass).toMatchObject({ ok: true, connectionTest: { result: 'pass' } });
    expect(lineCalls).toEqual([{ channelAccessToken: TOKEN, expectedBasicId: '@club-a', loginChannelId: '1650000001', liffId: '1650000001-AbCdEfGh' }]);
    expect((await lineRow()).tested_at).not.toBeNull();

    lineResult = { ok: false, code: 'messaging_api_token_rejected' };
    const fail = await put(spec, 'line', body({ test: true, line_plan_kind: 'free' }));
    expect(fail).toEqual({ ok: false, code: 'connection_test_failed', connectionTest: { result: 'fail', code: 'messaging_api_token_rejected' } });
    expect((await lineRow()).tested_at).not.toBeNull();
    expect((await lineRow()).line_plan_kind, 'a refused save changes nothing').toBe('paid');
  });

  it('D167: save anyway writes a failed test with tested_at empty and records line_token as failed in club_health; a later pass clears it', async () => {
    const health = async () => (await tdb.query(`select check_key, status, reason from platform.club_health where club_id = $1 order by check_key`, [CLUB])).rows;
    lineResult = { ok: false, code: 'messaging_api_token_rejected' };
    expect(await put(spec, 'line', body({ test: true, save_anyway: true }))).toMatchObject({ ok: true, connectionTest: { result: 'fail' } });
    expect((await lineRow()).tested_at).toBeNull();
    expect(await health()).toEqual([{ check_key: 'line_token', status: 'failed', reason: 'token_rejected' }]);
    lineResult = { ok: true, basicId: '@club-a' };
    await put(spec, 'line', body({ test: true }));
    expect(await health()).toEqual([{ check_key: 'line_token', status: 'ok', reason: null }]);
  });

  it('save_anyway is only allowed together with a test', async () => {
    expect(await put(spec, 'line', body({ save_anyway: true }))).toEqual({ ok: false, code: 'invalid' });
    expect(await put(spec, 'line', body({ test: true, save_anyway: 'yes' }))).toEqual({ ok: false, code: 'invalid' });
  });

  it('a form fault in the login channel or LIFF id is a failed test that has no health row of its own', async () => {
    lineResult = { ok: false, code: 'liff_not_in_login_channel' };
    await put(spec, 'line', body({ test: true, save_anyway: true }));
    expect((await tdb.query(`select count(*)::int as n from platform.club_health where club_id = $1`, [CLUB])).rows[0].n).toBe(0);
  });

  it('a different official account than the one typed is a failed test', async () => {
    lineResult = { ok: true, basicId: '@someone-else' };
    expect(await put(spec, 'line', body({ test: true }))).toEqual({ ok: false, code: 'connection_test_failed', connectionTest: { result: 'fail', code: 'oa_mismatch' } });
    expect(await lineRow(), 'nothing is saved').toBeUndefined();
  });

  it('changing anything after a pass makes the connection untested again', async () => {
    await put(spec, 'line', body({ test: true }));
    expect((await lineRow()).tested_at).not.toBeNull();
    await put(spec, 'line', { liff_id: '1650000001-ZzZzZzZz' });
    expect((await lineRow()).tested_at).toBeNull();
  });

  it('refuses a test with no token, bad values and unknown fields; nothing is written', async () => {
    for (const b of [{ test: true, liff_id: 'x' }, { line_plan_kind: 'gold' }, { plan_message_limit: 0 }, { plan_message_limit: 1.5 }, { line_channel_token: '' }, { tested_at: 'now' }, { secret_last4: {} }, {}, null]) {
      expect(await put(spec, 'line', b), JSON.stringify(b)).toEqual({ ok: false, code: 'invalid' });
    }
    expect(await lineRow()).toBeUndefined();
  });

  it('needs a fresh second factor (SR-16) and an assigned specialist or admin', async () => {
    expect(await put(spec, 'line', body(), false)).toEqual({ ok: false, code: 'step_up_required' });
    expect(await put(loner, 'line', body())).toEqual({ ok: false, code: 'not_found' });
    expect((await put(admin, 'line', body())).ok).toBe(true);
    expect(await lineRow()).toBeDefined();
  });

  it('a Live club is look only unless the owner window is open; inside the window the owner gets a notice', async () => {
    expect(await put(spec, 'line', body(), true, LIVE)).toEqual({ ok: false, code: 'look_only' });
    await tdb.query(`update public.club set allow_booq_changes_set_at = app.now(), allow_booq_changes_until = app.now() + interval '24 hours' where id = $1`, [LIVE]);
    expect((await put(spec, 'line', body(), true, LIVE)).ok).toBe(true);
    const n = (await tdb.query(`select kind, subject, by_staff_label from public.owner_notice where club_id = $1`, [LIVE])).rows;
    expect(n.length).toBeGreaterThan(0);
    expect(n.every((x) => x.kind === 'platform_change' && x.by_staff_label === 'Sam Specialist')).toBe(true);
  });

  it('is logged in P6 with the field names and secret kinds but never their values', async () => {
    await put(spec, 'line', body({ test: true }));
    const row = (await tdb.query(`select detail from platform.audit_log where action = 'support.setup_changed'`)).rows[0];
    expect(row.detail).toMatchObject({ section: 'line', tested: true });
    expect(row.detail.secrets.sort()).toEqual(['line_channel_secret', 'line_channel_token']);
    expect(JSON.stringify(row.detail)).not.toContain('1650000001');
  });

  it('without the connection service the sections stay unavailable', async () => {
    const bare = createSupportService({ db: pdb });
    expect(await bare.putSetup(spec, CLUB, 'line', body(), { stepUpFresh: true })).toEqual({ ok: false, code: 'section_unavailable' });
  });
});

describe('payments section (P2 step 5, D32)', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    payment_option: 'beam', merchant_id_test: 'M-TEST-1', beam_api_key_test: BEAM_KEY, beam_hmac_key_test: 'MARKER-hmac-test-7788', ...over,
  });

  it('saves the option, the merchant ids and both key sets as secrets; the last four show', async () => {
    const r = await put(spec, 'payments', body({ merchant_id_live: 'M-LIVE-1', beam_api_key_live: 'MARKER-beam-key-live-LIVE', beam_hmac_key_live: 'MARKER-hmac-live-0099' }));
    expect(r.ok).toBe(true);
    expect((await tdb.query(`select payment_option from public.club where id = $1`, [CLUB])).rows[0].payment_option).toBe('beam');
    const row = await payRow();
    expect(row).toMatchObject({ merchant_id_test: 'M-TEST-1', merchant_id_live: 'M-LIVE-1', tested_at: null });
    expect(row.secret_last4).toEqual({ beam_api_key_test: 'QRST', beam_hmac_key_test: '7788', beam_api_key_live: 'LIVE', beam_hmac_key_live: '0099' });
    expect((await tdb.query(`select count(*)::int as n from public.club_secret where kind like 'beam%'`)).rows[0].n).toBe(4);
    expect(await everything()).not.toMatch(/MARKER/);
  });

  it('a test of the test key set calls Beam read-only with that set; a pass needs the same merchant id back', async () => {
    const pass = await put(spec, 'payments', body({ test: true, test_mode: 'test' }));
    expect(pass).toMatchObject({ ok: true, connectionTest: { result: 'pass' } });
    expect(beamCalls).toEqual([{ apiKey: BEAM_KEY, merchantId: 'M-TEST-1', mode: 'test' }]);
    expect((await payRow()).tested_at).not.toBeNull();
    beamResult = { ok: true, merchantId: 'M-SOMEONE-ELSE' };
    expect(await put(spec, 'payments', body({ test: true, test_mode: 'test' }))).toEqual({ ok: false, code: 'connection_test_failed', connectionTest: { result: 'fail', code: 'merchant_mismatch' } });
    expect((await payRow()).tested_at, 'a refused save changes nothing').not.toBeNull();
  });

  it('D167: a Beam key refused and saved anyway shows beam_keys failed; an unreachable Beam shows beam_charge', async () => {
    const health = async () => (await tdb.query(`select check_key, reason from platform.club_health where club_id = $1 and status = 'failed'`, [CLUB])).rows;
    beamResult = { ok: false, code: 'key_refused' };
    await put(spec, 'payments', body({ test: true, test_mode: 'test', save_anyway: true }));
    expect(await health()).toEqual([{ check_key: 'beam_keys', reason: 'key_refused' }]);
    beamResult = { ok: false, code: 'unreachable' };
    await put(spec, 'payments', body({ test: true, test_mode: 'test', save_anyway: true }));
    expect(await health()).toEqual([{ check_key: 'beam_keys', reason: 'key_refused' }, { check_key: 'beam_charge', reason: 'unreachable' }]);
  });

  it('refuses a test without the matching key and merchant in the request, an unknown option, an unknown field', async () => {
    for (const b of [{ test: true, test_mode: 'test', merchant_id_test: 'M' }, { test: true, merchant_id_test: 'M', beam_api_key_test: 'k' }, { payment_option: 'cash' }, { webhook_token_hash_test: 'x' }, { test_mode: 'live' }, {}]) {
      expect(await put(spec, 'payments', b), JSON.stringify(b)).toEqual({ ok: false, code: 'invalid' });
    }
    expect(beamCalls).toEqual([]);
  });

  it('needs a fresh second factor and respects the window on a Live club', async () => {
    expect(await put(spec, 'payments', body(), false)).toEqual({ ok: false, code: 'step_up_required' });
    expect(await put(spec, 'payments', body(), true, LIVE)).toEqual({ ok: false, code: 'look_only' });
  });
});

describe('Test connection on its own (design 5.2)', () => {
  it('runs the probe with the values given, writes nothing, and logs pass or fail in P6', async () => {
    expect(await svc.testConnection(spec, CLUB, 'line', { channel_access_token: TOKEN, oa_basic_id: '@club-a' })).toEqual({ ok: true, result: 'pass' });
    lineResult = { ok: false, code: 'unauthorized' };
    expect(await svc.testConnection(spec, CLUB, 'line', { channel_access_token: TOKEN })).toEqual({ ok: true, result: 'fail', code: 'unauthorized' });
    expect(await svc.testConnection(admin, CLUB, 'beam', { mode: 'test', api_key: BEAM_KEY, merchant_id: 'M-TEST-1' })).toEqual({ ok: true, result: 'pass' });
    expect(await lineRow()).toBeUndefined();
    expect(await payRow()).toBeUndefined();
    const logged = (await tdb.query(`select action, detail from platform.audit_log where action = 'club.connection_tested' order by occurred_at, id`)).rows;
    expect(logged.map((l) => [l.detail.connection, l.detail.result])).toEqual([['line', 'pass'], ['line', 'fail'], ['beam', 'pass']]);
    expect(await everything()).not.toMatch(/MARKER/);
  });

  it('an unassigned specialist or unknown club gets not_found and the probe is not called; a bad body is invalid', async () => {
    expect(await svc.testConnection(loner, CLUB, 'line', { channel_access_token: TOKEN })).toEqual({ ok: false, code: 'not_found' });
    expect(await svc.testConnection(spec, 'aaaaaaaa-0000-4000-8000-0000000000ff', 'line', { channel_access_token: TOKEN })).toEqual({ ok: false, code: 'not_found' });
    expect(lineCalls).toEqual([]);
    expect(await svc.testConnection(spec, CLUB, 'line', {})).toEqual({ ok: false, code: 'invalid' });
    expect(await svc.testConnection(spec, CLUB, 'beam', { mode: 'sandbox', api_key: 'k', merchant_id: 'm' })).toEqual({ ok: false, code: 'invalid' });
  });

  it('a probe that throws counts as a failed test, not a server error', async () => {
    const boom = createSupportService({ db: pdb, connections: createConnections({ encryptKey: keys.publicKey, line: { check: async () => { throw new Error('network'); } }, beam }) });
    expect(await boom.testConnection(spec, CLUB, 'line', { channel_access_token: TOKEN })).toEqual({ ok: true, result: 'fail', code: 'unreachable' });
  });
});

describe('"Test all again" (D167)', () => {
  const ask = (who: string, club = CLUB) => svc.requestConnectionCheck(who, club);
  const requests = async () => (await tdb.query(`select club_id, requested_by from platform.connection_check_request`)).rows;

  it('asks the worker: one open request per club, shown in the setup with the last results; nothing is probed or read here', async () => {
    const r = await ask(spec);
    expect(r).toMatchObject({ ok: true });
    expect(await requests()).toEqual([{ club_id: CLUB, requested_by: spec }]);
    await ask(admin);
    expect(await requests()).toEqual([{ club_id: CLUB, requested_by: admin }]);
    await tdb.query(`insert into platform.club_health (club_id, check_key, status, reason) values ($1,'line_token','failed','token_rejected')`, [CLUB]);
    const got = await svc.getSetup(spec, CLUB);
    expect(got).toMatchObject({ ok: true, setup: { health: [{ check_key: 'line_token', status: 'failed', reason: 'token_rejected' }], checkRequestedAt: expect.anything() } });
    expect(lineCalls).toEqual([]);
    expect(beamCalls).toEqual([]);
  });

  it('works on a Live club too (a look only visit), is logged in P6, and an unassigned specialist gets not_found', async () => {
    expect(await ask(spec, LIVE)).toMatchObject({ ok: true });
    expect((await tdb.query(`select action, club_id from platform.audit_log where action = 'support.connection_check_requested'`)).rows).toEqual([{ action: 'support.connection_check_requested', club_id: LIVE }]);
    expect(await ask(loner)).toEqual({ ok: false, code: 'not_found' });
    expect(await ask(spec, 'not-an-id')).toEqual({ ok: false, code: 'not_found' });
  });
});

