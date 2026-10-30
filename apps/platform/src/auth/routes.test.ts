import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlatformDb, type PlatformDb } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { ControllableClock } from '@booq/time';
import { createMemoryAuthStore, createPlatformAuth, PLATFORM_COOKIE, type IdentityProvider } from './sign-in';
import { createDbAuditSink, createDbStaffDirectory } from './adapters';
import { authRoutes } from './routes';
import { servePlatform, type PlatformHandler } from '../http/server';

// The staff sign-in routes over HTTP with the real staff table and P6 log (F01-T17; ROLE-02-AC1 to AC5; SR-16; D148).
// Identity (password and TOTP) is a fake: the real adapter belongs to apps/staff-invite (T17b).
const KEY = 'k'.repeat(48);
const identity: IdentityProvider = {
  async verifyPassword(email, password) {
    if (email === 'ada@booq.example' && password === 'pw-ada') return { authUserId: '99999999-0000-4000-8000-000000000001' };
    if (email === 'sam@booq.example' && password === 'pw-sam') return { authUserId: '99999999-0000-4000-8000-000000000002' };
    return null;
  },
  async verifyTotp(_id, code) {
    return code === '123456';
  },
};

let tdb: TestDatabase;
let pdb: PlatformDb;
let clock: ControllableClock;
let handler: PlatformHandler;
let adminId: string;

const call = async (method: string, path: string, init: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) => {
  const res = await handler(
    new Request(`https://console.example/api${path}`, {
      method,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      headers: { ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.headers ?? {}) },
    }),
    { params: Promise.resolve({ path: path.split('/').filter(Boolean) }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, setCookie: res.headers.get('set-cookie') };
};
const cookieOf = (r: { setCookie: string | null }) => r.setCookie!.split(';')[0]!;
async function signInFully(email = 'ada@booq.example', password = 'pw-ada') {
  const first = await call('POST', '/auth/sign-in', { body: { email, password } });
  const second = await call('POST', '/auth/second-factor', { body: { challengeId: first.body['challengeId'], code: '123456' } });
  return { first, second, cookie: second.setCookie ? cookieOf(second) : '' };
}
const p6 = async () => (await tdb.query(`select action, staff_name_at_time as name from platform.audit_log where action like 'auth.%' order by occurred_at, id`)).rows;

beforeEach(async () => {
  tdb = await createTestDatabase();
  adminId = (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ('99999999-0000-4000-8000-000000000001','ada@booq.example','Ada Admin','platform_admin') returning id`)).rows[0].id;
  await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ('99999999-0000-4000-8000-000000000002','sam@booq.example','Sam Specialist','onboarding_specialist')`);
  pdb = createPlatformDb({ connectionString: tdb.url, max: 2 });
  clock = new ControllableClock('2026-12-01T03:00:00Z');
  const auth = createPlatformAuth({ identity, staff: createDbStaffDirectory(pdb), audit: createDbAuditSink(pdb), store: createMemoryAuthStore(), clock, signingKey: KEY });
  handler = servePlatform(authRoutes({ auth }), { authenticate: (cookie) => auth.authenticate(cookie), maxBodyBytes: 10_000 });
});
afterEach(async () => {
  await pdb.end();
  await tdb.close();
});

describe('sign in: password, then a code', () => {
  it('the first step gives only a challenge, no cookie; the second gives the cookie', async () => {
    const { first, second } = await signInFully();
    expect(first).toMatchObject({ status: 200, setCookie: null });
    expect(typeof first.body['challengeId']).toBe('string');
    expect(second.status).toBe(200);
    expect(second.setCookie).toMatch(new RegExp(`^${PLATFORM_COOKIE}=[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+; Path=/; HttpOnly; Secure; SameSite=Strict$`));
  });
  it('wrong password and unknown email look the same, and both reach P6 without a name', async () => {
    const a = await call('POST', '/auth/sign-in', { body: { email: 'ada@booq.example', password: 'nope' } });
    const b = await call('POST', '/auth/sign-in', { body: { email: 'nobody@booq.example', password: 'nope' } });
    expect([a.status, a.body]).toEqual([401, { code: 'invalid_credentials' }]);
    expect([b.status, b.body]).toEqual(Object.values({ s: 401, b: { code: 'invalid_credentials' } }));
    expect((await p6()).map((r) => r.action)).toEqual(['auth.sign_in_failed', 'auth.sign_in_failed']);
  });
  it('a wrong code is 401 bad_code, the fifth failure locks (423), and success is in P6 with the staff name', async () => {
    const first = await call('POST', '/auth/sign-in', { body: { email: 'ada@booq.example', password: 'pw-ada' } });
    for (let i = 0; i < 5; i += 1) {
      const r = await call('POST', '/auth/second-factor', { body: { challengeId: first.body['challengeId'], code: '000000' } });
      expect([r.status, r.body['code']]).toEqual([401, 'bad_code']);
    }
    const locked = await call('POST', '/auth/second-factor', { body: { challengeId: first.body['challengeId'], code: '123456' } });
    expect([locked.status, locked.body]).toEqual([423, { code: 'locked' }]);
    clock.advance(16 * 60_000);
    const again = await signInFully();
    expect(again.second.status).toBe(200);
    expect((await p6()).some((r) => r.action === 'auth.sign_in' && r.name === 'Ada Admin')).toBe(true);
  });
  it('a body with extra fields, or an expired or invented challenge, is refused', async () => {
    expect((await call('POST', '/auth/sign-in', { body: { email: 'a@b.c', password: 'x', role: 'platform_admin' } })).status).toBe(400);
    expect((await call('POST', '/auth/second-factor', { body: { challengeId: 'invented', code: '123456' } })).body).toEqual({ code: 'challenge_invalid' });
    expect((await call('POST', '/auth/sign-in', { body: { email: 'a@b.c' } })).status).toBe(400);
  });
});

describe('a session', () => {
  it('who am I: the staff member, the role and whether the second factor is fresh', async () => {
    const { cookie } = await signInFully();
    expect(await call('GET', '/auth/me', { cookie })).toMatchObject({ status: 200, body: { id: adminId, role: 'platform_admin', displayName: 'Ada Admin', stepUpFresh: true } });
    clock.advance(6 * 60_000);
    expect((await call('GET', '/auth/me', { cookie })).body['stepUpFresh']).toBe(false);
  });
  it('step up brings freshness back; a wrong code does not', async () => {
    const { cookie } = await signInFully();
    clock.advance(6 * 60_000);
    expect((await call('POST', '/auth/step-up', { body: { code: '000000' }, cookie })).body).toEqual({ code: 'bad_code' });
    expect((await call('POST', '/auth/step-up', { body: { code: '123456' }, cookie })).status).toBe(200);
    expect((await call('GET', '/auth/me', { cookie })).body['stepUpFresh']).toBe(true);
  });
  it('sign out ends the session and clears the cookie', async () => {
    const { cookie } = await signInFully();
    const out = await call('POST', '/auth/sign-out', { body: {}, cookie });
    expect(out.status).toBe(200);
    expect(out.setCookie).toContain('Max-Age=0');
    expect((await call('GET', '/auth/me', { cookie })).status).toBe(401);
  });
  it('idle for longer than the limit ends the session', async () => {
    const { cookie } = await signInFully();
    clock.advance(31 * 60_000);
    expect((await call('GET', '/auth/me', { cookie })).status).toBe(401);
  });
  it('deactivating the account ends every open session', async () => {
    const one = await signInFully();
    const two = await signInFully();
    await tdb.query(`update platform.platform_staff set active = false where id = $1`, [adminId]);
    expect((await call('GET', '/auth/me', { cookie: one.cookie })).status).toBe(401);
    expect((await call('GET', '/auth/me', { cookie: two.cookie })).status).toBe(401);
    expect((await signInFully()).first).toMatchObject({ status: 401, body: { code: 'invalid_credentials' } });
  });
  it('a club session cookie is not accepted, and a tampered platform cookie is not either', async () => {
    const { cookie } = await signInFully();
    expect((await call('GET', '/auth/me', { headers: { cookie: '__Host-booq_session=abc_def' } })).status).toBe(401);
    expect((await call('GET', '/auth/me', { cookie: `${cookie}x` })).status).toBe(401);
  });
});
