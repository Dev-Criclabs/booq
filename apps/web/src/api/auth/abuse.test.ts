import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { createLineVerifier, serveRoutes } from '@booq/auth';
import { FakeClock, FakeLine, type ClubLineChannel } from '../../../../../tests/fakes';
import { createWebTable } from '../../server/context';

// F02-T24 cross-club and abuse tests (LINE-01-AC4, AC14; CC-1, CC-2). Through HTTP, with the real database
// functions and QA's fake LINE. If the audience check were wrong, the first group fails.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const channels: ClubLineChannel[] = [
  { clubId: A, channelAccessToken: 'tokA', loginChannelId: 'loginA', liffId: 'liffA' },
  { clubId: B, channelAccessToken: 'tokB', loginChannelId: 'loginB', liffId: 'liffB' },
];
const clock = new FakeClock();
const line = new FakeLine({ clock, channels, users: ['UPERSON', 'UOTHER'].map((id) => ({ lineUserId: id, displayName: id, lineAppLanguage: 'en' as const, friendOf: {} })) });

let tdb: TestDatabase;
let db: Db;
let server: { url: string; close(): Promise<void> };
let handle: ReturnType<typeof serveRoutes>;
const PROFILE = { fullName: 'Somchai Jaidee', phone: '081-234-5678', consent: true, noticeVersion: 'v1', language: 'th' };

const call = async (method: string, path: string, init: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) => {
  const segs = path.replace(/^\/api\/c\//, '').split('/');
  const slug = segs.shift()!;
  const res = await handle(
    new Request(`https://app.example${path}`, {
      method,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      headers: { ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.headers ?? {}) },
    }),
    { params: Promise.resolve({ slug, path: segs }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, setCookie: res.headers.get('set-cookie'), retryAfter: res.headers.get('retry-after') };
};
const signIn = (slug: string, club: string, lineId = 'UPERSON') => call('POST', `/api/c/${slug}/auth/session`, { body: { idToken: line.issueIdToken(lineId, club) } });
const cookieOf = (r: { setCookie: string | null }) => r.setCookie!.split(';')[0]!;
const sessions = async () => (await tdb.query('select club_id, state from public.auth_session order by created_at')).rows;

beforeEach(async () => {
  tdb = await createTestDatabase();
  server = await line.serve();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.line_connection (club_id, login_channel_id, liff_id) values ($1,'loginA','liffA'), ($2,'loginB','liffB')`, [A, B]);
  db = createDb({ connectionString: tdb.url, max: 3 });
  handle = serveRoutes(() =>
    createWebTable({
      db,
      verifier: createLineVerifier({ baseUrl: server.url, now: () => clock.now() }),
      now: () => new Date(),
      config: { sessionSeconds: 3600, maxBodyBytes: 100_000, importLimits: null, signInRateLimit: { limit: 3, windowSeconds: 60 } },
    }),
  );
});
afterEach(async () => {
  await db.end();
  await server.close();
  await tdb.close();
});

describe('a token for club A at club B (LINE-01-AC4, CC-2)', () => {
  it('is refused and creates nothing, at either club', async () => {
    expect(await call('POST', '/api/c/b/auth/session', { body: { idToken: line.issueIdToken('UPERSON', A) } })).toMatchObject({ status: 401, body: { code: 'invalid_token' }, setCookie: null });
    expect(await call('POST', '/api/c/a/auth/session', { body: { idToken: line.issueIdToken('UPERSON', B) } })).toMatchObject({ status: 401, body: { code: 'invalid_token' } });
    expect(await sessions()).toEqual([]);
  });
});

describe('the same person at two clubs (LINE-01-AC14, CC-1)', () => {
  it('has two records and two consents; neither session opens the other club', async () => {
    const a = await signIn('a', A);
    const b = await signIn('b', B);
    await call('POST', '/api/c/a/auth/profile', { body: PROFILE, cookie: cookieOf(a) });
    await call('POST', '/api/c/b/auth/profile', { body: { ...PROFILE, fullName: 'Somchai At Club B' }, cookie: cookieOf(b) });
    const users = (await tdb.query(`select club_id, full_name from public.app_user where line_user_id = 'UPERSON' order by club_id`)).rows;
    expect(users).toHaveLength(2);
    expect(new Set(users.map((u) => u.club_id))).toEqual(new Set([A, B]));
    expect((await tdb.query('select count(*)::int n from public.user_consent')).rows[0].n).toBe(2);
    expect(await call('GET', '/api/c/b/me/data-requests', { cookie: cookieOf(a) })).toMatchObject({ status: 404 });
    expect(await call('GET', '/api/c/a/me/data-requests', { cookie: cookieOf(b) })).toMatchObject({ status: 404 });
    expect(await call('GET', '/api/c/a/me/profile', { cookie: cookieOf(a) })).toMatchObject({ status: 200, body: { fullName: 'Somchai Jaidee' } });
    expect(await call('GET', '/api/c/b/me/profile', { cookie: cookieOf(b) })).toMatchObject({ status: 200, body: { fullName: 'Somchai At Club B' } });
  });
  it('a forged club prefix on a token does not reach the other club’s data', async () => {
    const a = await signIn('a', A);
    await call('POST', '/api/c/a/auth/profile', { body: PROFILE, cookie: cookieOf(a) });
    const token = cookieOf(a).split('=')[1]!;
    const forged = `__Host-booq_session=${B.replace(/-/g, '')}_${token.slice(token.indexOf('_') + 1)}`;
    expect(await call('GET', '/api/c/b/me/profile', { cookie: forged })).toMatchObject({ status: 401 });
  });
});

describe('pending-session abuse', () => {
  it('a pending session reaches no person route and no staff route, and does not become a player without consent', async () => {
    const p = await signIn('a', A, 'UOTHER');
    const cookie = cookieOf(p);
    for (const [m, path] of [['GET', '/api/c/a/me/profile'], ['GET', '/api/c/a/me/data-requests'], ['GET', '/api/c/a/claims'], ['GET', '/api/c/a/data-requests']] as const) {
      expect((await call(m, path, { cookie })).status, path).toBe(401);
    }
    expect(await call('POST', '/api/c/a/auth/profile', { body: { ...PROFILE, consent: false }, cookie })).toMatchObject({ status: 400, body: { code: 'consent_required' } });
    expect((await tdb.query(`select count(*)::int n from public.app_user where line_user_id = 'UOTHER'`)).rows[0].n).toBe(0);
  });
  it('a profile cannot be completed twice, nor by someone replaying the cookie after logout', async () => {
    const cookie = cookieOf(await signIn('a', A));
    expect(await call('POST', '/api/c/a/auth/profile', { body: PROFILE, cookie })).toMatchObject({ status: 200 });
    expect(await call('POST', '/api/c/a/auth/profile', { body: PROFILE, cookie })).toMatchObject({ status: 409, body: { code: 'not_pending' } });
    await call('POST', '/api/c/a/auth/logout', { body: {}, cookie });
    expect(await call('POST', '/api/c/a/auth/profile', { body: PROFILE, cookie })).toMatchObject({ status: 401 });
    expect((await tdb.query(`select count(*)::int n from public.app_user where line_user_id = 'UPERSON'`)).rows[0].n).toBe(1);
  });
});

describe('rate limit on sign-in (value from config)', () => {
  it('the attempt after the limit is 429 with Retry-After, and no session is made for it', async () => {
    const ip = { 'x-real-ip': '203.0.113.7' };
    const body = { idToken: line.issueIdToken('UPERSON', A) };
    for (let i = 0; i < 3; i += 1) expect((await call('POST', '/api/c/a/auth/session', { body, headers: ip })).status).toBe(200);
    const blocked = await call('POST', '/api/c/a/auth/session', { body, headers: ip });
    expect(blocked).toMatchObject({ status: 429, body: { code: 'rate_limited' }, retryAfter: '60' });
    expect(await sessions()).toHaveLength(3);
    expect((await call('POST', '/api/c/a/auth/session', { body, headers: { 'x-real-ip': '203.0.113.8' } })).status).toBe(200);
  });
});
