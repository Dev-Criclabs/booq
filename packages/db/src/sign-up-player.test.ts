import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F02-T09 lane D request / migration 0025: app.sign_up_player. One transaction: the person, the player role,
// the consent record, and the pending session upgraded to active. is_test comes from the invite row, never a parameter.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LINE = 'U' + 'a'.repeat(32);
const H = (c: string) => c.repeat(64);
const SESSION = H('a');
let tdb: TestDatabase;
let db: Db;
let statusA = 'live';
const STAFF = '99999999-0000-4000-8000-000000000001';

const ctx = (club = A) => ({ clubId: club, userId: null, roles: [] as never, source: 'player_app' as const });
const future = () => new Date(Date.now() + 3600_000).toISOString();

async function pending(token = SESSION, club = A, line = LINE, expires: string = future()) {
  await tdb.query(`insert into public.auth_session (club_id, token_hash, line_user_id, pending_display_name, pending_language, state, expires_at) values ($1, $2, $3, 'Nok on LINE', 'en', 'pending_profile', $4)`, [club, token, line, expires]);
}
async function invite(kind: 'tester' | 'owner', hash: string, extra: { bound?: string; expires?: string; used?: boolean } = {}) {
  const roles = kind === 'tester' ? ['player'] : ['owner', 'player'];
  await tdb.query(`insert into public.club_invite (club_id, token_hash, kind, roles, bound_line_user_id, expires_at, used_at, used_by_user, created_by_staff, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz - interval '2 hours')`,
    [A, hash, kind, roles, extra.bound ?? null, extra.expires ?? future(), extra.used ? new Date().toISOString() : null, extra.used ? '22222222-2222-4222-8222-222222222222' : null, STAFF, extra.expires ?? future()]);
}
const signUp = (over: Partial<{ token: string; name: string; phone: string; norm: string; lang: string; version: string; clang: string; inv: string | null; club: string }> = {}) =>
  db.withClubTx(ctx(over.club), async (tx) =>
    (await tx.query(`select app.sign_up_player($1, $2, $3, $4, $5, $6, $7, $8) as id`,
      [over.token ?? SESSION, over.name ?? 'Nok Sai', over.phone ?? '081 234 5678', over.norm ?? '66812345678', over.lang ?? 'th', over.version ?? 'v1', over.clang ?? 'th', over.inv ?? null])).rows[0]!.id as string);
const user = async () => (await tdb.query(`select * from public.app_user where line_user_id = $1`, [LINE])).rows[0];

beforeEach(async () => {
  tdb = await createTestDatabase();
  db = createDb({ connectionString: tdb.url, max: 1 });
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1, 'a', 'ก', 'A', $3), ($2, 'b', 'ข', 'B', 'live')`, [A, B, statusA]);
  await tdb.query(`insert into platform.platform_staff (id, auth_user_id, email, display_name, role) values ($1, $1, 'admin@booq.example', 'Ada', 'platform_admin')`, [STAFF]);
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('a Live club sign-up', () => {
  it('creates the person with the typed profile and the session’s LINE id and name, the player role and the consent', async () => {
    await pending();
    const id = await signUp();
    const u = await user();
    expect(u).toMatchObject({ id, club_id: A, line_user_id: LINE, display_name: 'Nok on LINE', full_name: 'Nok Sai', phone: '081 234 5678', phone_normalized: '66812345678', language: 'th', active: true, is_test: false, claim_state: null });
    expect((await tdb.query(`select role, is_test from public.app_user_role where user_id = $1`, [id])).rows).toEqual([{ role: 'player', is_test: false }]);
    expect((await tdb.query(`select notice_version, language, is_test from public.user_consent where user_id = $1`, [id])).rows).toEqual([{ notice_version: 'v1', language: 'th', is_test: false }]);
  });

  it('upgrades the session: the same cookie hash is now active for the new person, and no pending row is left', async () => {
    await pending();
    const id = await signUp();
    const s = (await tdb.query(`select state, user_id, pending_display_name, pending_language, is_test from public.auth_session where token_hash = $1`, [SESSION])).rows;
    expect(s).toEqual([{ state: 'active', user_id: id, pending_display_name: null, pending_language: null, is_test: false }]);
  });

  it('does not create a claim request: lane D’s service calls request_claim after', async () => {
    await pending();
    await signUp();
    expect((await tdb.query(`select count(*)::int as n from public.claim_request`)).rows[0].n).toBe(0);
  });

  it('a Live club ignores an invite hash for the test flag', async () => {
    await pending();
    await invite('tester', H('b'));
    await signUp({ inv: H('b') });
    expect((await user()).is_test).toBe(false);
  });
});

describe('a Draft or Testing club (D100)', () => {
  beforeAll(() => {
    statusA = 'testing';
  });
  afterAll(() => {
    statusA = 'live';
  });

  it('a tester invite makes a test account: the person, role, consent and session are all test rows', async () => {
    await pending();
    await invite('tester', H('b'));
    const id = await signUp({ inv: H('b') });
    expect((await user()).is_test).toBe(true);
    for (const t of ['app_user_role', 'user_consent', 'auth_session']) {
      expect((await tdb.query(`select bool_and(is_test) as t from public.${t} where user_id = $1`, [id])).rows[0].t, t).toBe(true);
    }
  });

  it('an owner invite makes a real person, not a test account', async () => {
    await pending();
    await invite('owner', H('c'));
    await signUp({ inv: H('c') });
    expect((await user()).is_test).toBe(false);
  });

  it('is refused with no invite, an unknown, used, expired or other-person-bound invite', async () => {
    await pending();
    await invite('tester', H('d'), { used: true });
    await invite('tester', H('e'), { expires: new Date(Date.now() - 1000).toISOString() });
    await invite('owner', H('f'), { bound: 'U' + 'z'.repeat(32) });
    for (const inv of [null, H('9'), H('d'), H('e'), H('f')]) {
      await expect(signUp({ inv }), String(inv)).rejects.toThrow(/sign_up:not_a_tester/);
    }
    expect(await user()).toBeUndefined();
  });
});

describe('refusals leave nothing behind', () => {
  it('an unknown session is refused', async () => {
    await expect(signUp({ token: H('1') })).rejects.toThrow(/sign_up:no_pending_session/);
  });

  it('an expired session', async () => {
    await tdb.query(`insert into public.auth_session (club_id, token_hash, line_user_id, state, expires_at, created_at) values ($1, $2, $3, 'pending_profile', now() + interval '1 second', now() - interval '1 hour')`, [A, H('2'), LINE]);
    await tdb.query(`select pg_sleep(1.2)`);
    await expect(signUp({ token: H('2') })).rejects.toThrow(/sign_up:no_pending_session/);
  });

  it('a session of another club, a revoked one, or one that is already active', async () => {
    await pending(H('3'), B);
    await expect(signUp({ token: H('3') })).rejects.toThrow(/sign_up:no_pending_session/);
    await tdb.query(`insert into public.auth_session (club_id, token_hash, line_user_id, state, expires_at, revoked_at) values ($1, $2, $3, 'revoked', $4, now())`, [A, H('4'), LINE, future()]);
    await expect(signUp({ token: H('4') })).rejects.toThrow(/sign_up:no_pending_session/);
  });

  it('a bad profile changes nothing: no person, no consent, the session stays pending', async () => {
    await pending();
    for (const bad of [{ name: '   ' }, { norm: '12' }, { lang: 'fr' }, { clang: 'fr' }, { version: '' }, { phone: '081' , norm: '81'}]) {
      await expect(signUp(bad), JSON.stringify(bad)).rejects.toThrow();
    }
    expect(await user()).toBeUndefined();
    expect((await tdb.query(`select count(*)::int as n from public.user_consent`)).rows[0].n).toBe(0);
    expect((await tdb.query(`select state from public.auth_session where token_hash = $1`, [SESSION])).rows[0].state).toBe('pending_profile');
  });

  it('a LINE id that already has a person is refused and the session stays pending', async () => {
    await pending();
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into public.app_user (club_id, id, line_user_id, display_name) values ($1, '11111111-1111-4111-8111-111111111111', $2, 'Existing')`, [A, LINE]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1, '11111111-1111-4111-8111-111111111111', 'player')`, [A]);
      await c.query('commit');
    } finally {
      c.release();
    }
    await expect(signUp()).rejects.toThrow(/sign_up:already_registered/);
    expect((await tdb.query(`select state from public.auth_session where token_hash = $1`, [SESSION])).rows[0].state).toBe('pending_profile');
  });
});

describe('who may call it', () => {
  it('booq_app only, and not without a club in the context', async () => {
    for (const role of ['booq_worker', 'booq_platform', 'booq_audit', 'booq_anonymiser', 'booq_purge']) {
      expect((await tdb.query('select has_function_privilege($1, $2, $3) as ok', [role, 'app.sign_up_player(text, text, text, text, text, text, text, text)', 'execute'])).rows[0].ok, role).toBe(false);
    }
    expect((await tdb.query(`select has_function_privilege('booq_app', 'app.sign_up_player(text, text, text, text, text, text, text, text)', 'execute') as ok`)).rows[0].ok).toBe(true);
  });
});
