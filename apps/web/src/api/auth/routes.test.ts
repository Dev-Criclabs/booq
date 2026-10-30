import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { serveRoutes } from '@booq/auth';
import { FakeClock, FakeLine, type ClubLineChannel } from '../../../../../tests/fakes';
import { createWebTable } from '../../server/context';
import { createLineVerifier } from '@booq/auth';

// The sign-in, profile, logout and config routes end to end through serveRoutes (Request in, Response out),
// with the real database functions and QA's fake LINE (F02-T05 to T12; LINE-01-AC13; AUTH-01-AC13).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const channels: ClubLineChannel[] = [{ clubId: A, channelAccessToken: 'tokA', loginChannelId: 'loginA', liffId: 'liffA' }];
const clock = new FakeClock();
const line = new FakeLine({ clock, channels, users: [{ lineUserId: 'UNEW', displayName: 'Name UNEW', lineAppLanguage: 'en', friendOf: {} }] });

let tdb: TestDatabase;
let db: Db;
let server: { url: string; close(): Promise<void> };
let handle: ReturnType<typeof serveRoutes>;

const call = async (method: string, path: string, init: { body?: unknown; cookie?: string } = {}) => {
  const [p] = path.split('?');
  const segs = p!.replace(/^\/api\/c\//, '').split('/');
  const slug = segs.shift()!;
  const res = await handle(
    new Request(`https://app.example${path}`, {
      method,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      headers: { ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...(init.cookie ? { cookie: init.cookie } : {}) },
    }),
    { params: Promise.resolve({ slug, path: segs }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, setCookie: res.headers.get('set-cookie') };
};
const token = () => line.issueIdToken('UNEW', A);
const PROFILE = { fullName: 'Somchai Jaidee', phone: '081-234-5678', consent: true, noticeVersion: 'v1', language: 'th' };

beforeEach(async () => {
  tdb = await createTestDatabase();
  server = await line.serve();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status, default_language) values ($1,'hunter','ก','Hunter','live','th')`, [A]);
  await tdb.query(`insert into public.line_connection (club_id, login_channel_id, liff_id) values ($1,'loginA','liffA')`, [A]);
  db = createDb({ connectionString: tdb.url, max: 3 });
  handle = serveRoutes(() =>
    createWebTable({
      db,
      verifier: createLineVerifier({ baseUrl: server.url, now: () => clock.now() }),
      now: () => new Date(),
      config: { sessionSeconds: 3600, maxBodyBytes: 100_000, importLimits: null },
    }),
  );
});
afterEach(async () => {
  await db.end();
  await server.close();
  await tdb.close();
});

describe('the sign-in journey over HTTP', () => {
  it('config, sign in, profile, an active session, logout', async () => {
    const config = await call('GET', '/api/c/hunter/public/config');
    expect(config).toMatchObject({ status: 200, body: { nameEn: 'Hunter', liffId: 'liffA', status: 'live' } });

    const signIn = await call('POST', '/api/c/hunter/auth/session', { body: { idToken: token() } });
    expect(signIn).toMatchObject({ status: 200, body: { state: 'pending_profile' } });
    expect(signIn.setCookie).toMatch(/^__Host-booq_session=[0-9a-f]{32}_/);
    expect(signIn.setCookie).toContain('HttpOnly');
    expect(signIn.setCookie).toContain('Secure');
    const cookie = signIn.setCookie!.split(';')[0]!;

    expect(await call('GET', '/api/c/hunter/me/data-requests', { cookie })).toMatchObject({ status: 401 }); // pending is not a person yet
    const profile = await call('POST', '/api/c/hunter/auth/profile', { body: PROFILE, cookie });
    expect(profile).toMatchObject({ status: 200, body: { state: 'active' } });

    expect(await call('GET', '/api/c/hunter/me/data-requests', { cookie })).toMatchObject({ status: 200, body: [] });

    const out = await call('POST', '/api/c/hunter/auth/logout', { body: {}, cookie });
    expect(out.status).toBe(200);
    expect(out.setCookie).toContain('Max-Age=0');
    expect(await call('POST', '/api/c/hunter/auth/profile', { body: PROFILE, cookie })).toMatchObject({ status: 401 });
  });

  it('a profile without consent is 400 consent_required; extra fields are 400 bad_input; field errors come back as codes', async () => {
    const cookie = (await call('POST', '/api/c/hunter/auth/session', { body: { idToken: token() } })).setCookie!.split(';')[0]!;
    expect(await call('POST', '/api/c/hunter/auth/profile', { body: { ...PROFILE, consent: false }, cookie })).toMatchObject({ status: 400, body: { code: 'consent_required' } });
    expect(await call('POST', '/api/c/hunter/auth/profile', { body: { ...PROFILE, roles: ['owner'] }, cookie })).toMatchObject({ status: 400, body: { code: 'bad_input' } });
    expect(await call('POST', '/api/c/hunter/auth/profile', { body: { ...PROFILE, fullName: ' ', phone: 'x' }, cookie })).toMatchObject({
      status: 400,
      body: { code: 'invalid', fields: { fullName: 'name_missing', phone: 'phone_invalid' } },
    });
    expect((await tdb.query(`select count(*)::int n from public.app_user where line_user_id = 'UNEW'`)).rows[0].n).toBe(0);
  });

  it('a bad token is 401 and sets no cookie; the token is not echoed; an unknown club is 404', async () => {
    const bad = await call('POST', '/api/c/hunter/auth/session', { body: { idToken: 'garbage-token-value' } });
    expect(bad).toMatchObject({ status: 401, body: { code: 'invalid_token' }, setCookie: null });
    expect(JSON.stringify(bad.body)).not.toContain('garbage');
    expect(await call('POST', '/api/c/nope/auth/session', { body: { idToken: token() } })).toMatchObject({ status: 404 });
    expect(await call('GET', '/api/c/nope/public/config')).toMatchObject({ status: 404 });
  });

  it('the session body takes only idToken and invite', async () => {
    expect(await call('POST', '/api/c/hunter/auth/session', { body: { idToken: token(), roles: ['owner'] } })).toMatchObject({ status: 400, body: { code: 'bad_input' } });
    expect(await call('POST', '/api/c/hunter/auth/session', { body: {} })).toMatchObject({ status: 400 });
  });

  it('the cookie of one club does not work at another club’s address', async () => {
    await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ('9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d','other','ข','Other','live')`);
    await tdb.query(`insert into public.line_connection (club_id, login_channel_id, liff_id) values ('9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d','loginB','liffB')`);
    const cookie = (await call('POST', '/api/c/hunter/auth/session', { body: { idToken: token() } })).setCookie!.split(';')[0]!;
    expect(await call('GET', '/api/c/other/me/data-requests', { cookie })).toMatchObject({ status: 404 });
  });

  it('guests cannot reach the club routes: import, claims and data requests need a role', async () => {
    for (const [m, p] of [['POST', '/api/c/hunter/imports'], ['GET', '/api/c/hunter/claims'], ['GET', '/api/c/hunter/data-requests'], ['GET', '/api/c/hunter/me/data-requests']] as const) {
      const r = await call(m, p, m === 'POST' ? { body: {} } : {});
      expect(r.status, `${m} ${p}`).toBe(401);
    }
  });
});
