import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../db/src/tx';
import { createTestDatabase, type TestDatabase } from '../../../db/src/testing/harness';
import { FakeClock, FakeLine, type ClubLineChannel } from '../../../../tests/fakes';
import { createSignInService } from './session';
import { createDbDirectory } from './directory';
import { createFakeLineVerifier, createLineVerifier } from './verify';
import { createRedactingLogger } from './log-redaction';
import { hashToken, parseSessionCookie, SESSION_COOKIE } from './cookie';

// F02-T07 POST /auth/session (LINE-01-AC1 to AC5, AC10, AC11, AC13; AUTH-01-AC13 to AC15). Real Postgres, QA's fake LINE.
// The directory is the real one over app.club_sign_in_target and app.person_by_line_id (migrations 0022, 0023).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER = '11111111-1111-4111-8111-111111111111';
const PLAYER = '33333333-3333-4333-8333-333333333333';
const GONE = '55555555-5555-4555-8555-555555555555';
const TESTER = '66666666-6666-4666-8666-666666666666';

const channels: ClubLineChannel[] = [
  { clubId: A, channelAccessToken: 'tokA', loginChannelId: 'loginA', liffId: 'liffA' },
  { clubId: B, channelAccessToken: 'tokB', loginChannelId: 'loginB', liffId: 'liffB' },
];
const clock = new FakeClock();
const line = new FakeLine({
  clock,
  channels,
  users: ['UOWNER', 'UPLAYER', 'UGONE', 'UTESTER', 'UNEW'].map((id) => ({ lineUserId: id, displayName: `Name ${id}`, lineAppLanguage: 'en' as const, friendOf: {} })),
});

let tdb: TestDatabase;
let db: Db;
let server: { url: string; close(): Promise<void> };
let logs: string[];
let svc: ReturnType<typeof createSignInService>;

const sessions = async () => (await tdb.query('select state, user_id, line_user_id, token_hash from public.auth_session order by created_at')).rows;
const signIn = (slug: string, idToken: string, extra: { inviteHash?: string } = {}) => svc.signIn({ slug, idToken, ...extra });
const tokenFor = (lineId: string, club = A) => line.issueIdToken(lineId, club);

beforeEach(async () => {
  logs = [];
  tdb = await createTestDatabase();
  server = await line.serve();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.line_connection (club_id, login_channel_id, liff_id) values ($1,'loginA','liffA'), ($2,'loginB','liffB')`, [A, B]);
  for (const [club, id, lineId, roles, active] of [
    [A, OWNER, 'UOWNER', ['owner', 'player'], true], [A, PLAYER, 'UPLAYER', ['player'], true], [A, GONE, 'UGONE', ['player'], false], [A, TESTER, 'UTESTER', ['player'], true],
  ] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id, active) values ($1,$2,$3,$4)', [club, id, lineId, active]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, id, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  db = createDb({ connectionString: tdb.url, max: 2 });
  svc = createSignInService({
    db,
    verifier: createLineVerifier({ baseUrl: server.url, now: () => clock.now() }),
    directory: createDbDirectory(db),
    now: () => new Date(),
    sessionSeconds: 3600,
    logger: createRedactingLogger((l) => logs.push(l)),
  });
});
afterEach(async () => {
  await db.end();
  await server.close();
  await tdb.close();
});

describe('an existing player signs in (LINE-01-AC1, AC3, AC10)', () => {
  it('gets an active session and a cookie; the database holds only the token hash', async () => {
    const idToken = tokenFor('UPLAYER');
    const r = await signIn('a', idToken);
    expect(r).toMatchObject({ ok: true, state: 'active', clubId: A });
    if (!r.ok) throw new Error('unreachable');
    const token = parseSessionCookie(r.setCookie.split(';')[0]!)!;
    expect(r.setCookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect(await sessions()).toEqual([{ state: 'active', user_id: PLAYER, line_user_id: 'UPLAYER', token_hash: hashToken(token) }]);
  });

  it('never stores or logs the ID token (AC13)', async () => {
    const idToken = tokenFor('UPLAYER');
    await signIn('a', idToken);
    await signIn('a', 'garbage-' + idToken);
    expect(JSON.stringify(await sessions())).not.toContain(idToken);
    expect(JSON.stringify((await tdb.query('select * from public.audit_entry')).rows)).not.toContain(idToken);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join('\n')).not.toContain(idToken);
  });

  it('a deactivated player gets account_inactive and no session', async () => {
    expect(await signIn('a', tokenFor('UGONE'))).toEqual({ ok: false, status: 403, code: 'account_inactive' });
    expect(await sessions()).toEqual([]);
  });
});

describe('refusals create nothing (LINE-01-AC4, AC11; CC-2)', () => {
  it("club A's token at club B is refused", async () => {
    expect(await signIn('b', tokenFor('UPLAYER', A))).toEqual({ ok: false, status: 401, code: 'invalid_token' });
    expect(await sessions()).toEqual([]);
  });
  it('an expired or bad token is refused', async () => {
    expect(await signIn('a', 'not-a-token')).toEqual({ ok: false, status: 401, code: 'invalid_token' });
  });
  it('LINE unreachable answers offline and creates nothing', async () => {
    const offline = createSignInService({ db, verifier: createFakeLineVerifier('unreachable'), directory: createDbDirectory(db), now: () => new Date(), sessionSeconds: 3600 });
    expect(await offline.signIn({ slug: 'a', idToken: 'x' })).toEqual({ ok: false, status: 503, code: 'offline' });
    expect(await sessions()).toEqual([]);
  });
  it('an unknown club is 404, and so is a bad body', async () => {
    expect(await signIn('nope', tokenFor('UPLAYER'))).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(await svc.signIn({ slug: 'a', idToken: '' })).toEqual({ ok: false, status: 400, code: 'bad_input' });
  });
});

describe('a new LINE user (design 4.3)', () => {
  it('gets a pending session; no player record exists yet', async () => {
    const r = await signIn('a', tokenFor('UNEW'));
    expect(r).toMatchObject({ ok: true, state: 'pending_profile', clubId: A });
    expect(await sessions()).toMatchObject([{ state: 'pending_profile', user_id: null, line_user_id: 'UNEW' }]);
    expect((await tdb.query(`select count(*)::int n from public.app_user where line_user_id = 'UNEW'`)).rows[0].n).toBe(0);
  });
});

describe('the status gate (AUTH-01-AC15; D102)', () => {
  it('Draft: the owner passes on every visit, a stranger gets not found', async () => {
    await tdb.query(`update public.club set status = 'draft' where id = $1`, [A]);
    expect(await signIn('a', tokenFor('UOWNER'))).toMatchObject({ ok: true, state: 'active' });
    expect(await signIn('a', tokenFor('UOWNER'))).toMatchObject({ ok: true, state: 'active' });
    expect(await signIn('a', tokenFor('UPLAYER'))).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(await signIn('a', tokenFor('UNEW'))).toEqual({ ok: false, status: 404, code: 'not_found' });
  });
  it('Testing: a listed tester passes', async () => {
    await tdb.query(`update public.club set status = 'testing' where id = $1`, [A]);
    expect(await signIn('a', tokenFor('UTESTER'))).toEqual({ ok: false, status: 404, code: 'not_found' });
    await tdb.query(`insert into public.club_tester (club_id, user_id, kind) values ($1,$2,'boq_tester')`, [A, TESTER]);
    expect(await signIn('a', tokenFor('UTESTER'))).toMatchObject({ ok: true, state: 'active' });
  });
  it('Paused still signs in (AUTH-01-AC11)', async () => {
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    expect(await signIn('a', tokenFor('UPLAYER'))).toMatchObject({ ok: true });
  });
});

describe('later requests (AUTH-01-AC13, AC14; LINE-01-AC10)', () => {
  const login = async (lineId = 'UOWNER') => {
    const r = await signIn('a', tokenFor(lineId));
    if (!r.ok) throw new Error('sign in failed');
    return r.setCookie.split(';')[0]!;
  };
  it('the cookie authenticates at its own club, with roles read now', async () => {
    const cookie = await login('UTESTER');
    expect(await svc.authenticate({ slug: 'a', cookieHeader: cookie })).toMatchObject({ ok: true, state: 'active', userId: TESTER, clubId: A, roles: ['player'] });
    await tdb.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'front_desk')`, [A, TESTER]);
    expect(await svc.authenticate({ slug: 'a', cookieHeader: cookie })).toMatchObject({ ok: true, roles: ['front_desk', 'player'] });
    await tdb.query(`delete from public.app_user_role where user_id = $1 and role = 'front_desk'`, [TESTER]);
    expect(await svc.authenticate({ slug: 'a', cookieHeader: cookie })).toMatchObject({ ok: true, roles: ['player'] });
  });
  it('the same cookie at another club, with no cookie, or after deactivation, is refused', async () => {
    const cookie = await login('UPLAYER');
    expect(await svc.authenticate({ slug: 'b', cookieHeader: cookie })).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(await svc.authenticate({ slug: 'a', cookieHeader: undefined })).toEqual({ ok: false, status: 401, code: 'unauthenticated' });
    await tdb.query(`update public.app_user set active = false where id = $1`, [PLAYER]);
    expect(await svc.authenticate({ slug: 'a', cookieHeader: cookie })).toEqual({ ok: false, status: 401, code: 'unauthenticated' });
  });
});
