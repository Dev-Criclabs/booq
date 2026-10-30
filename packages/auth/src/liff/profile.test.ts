import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../db/src/tx';
import { createTestDatabase, type TestDatabase } from '../../../db/src/testing/harness';
import { FakeClock, FakeLine, type ClubLineChannel } from '../../../../tests/fakes';
import { createClaimService } from '../../../domain/src/claim';
import { createSignInService } from './session';
import { createProfileService } from './profile';
import { createDbDirectory } from './directory';
import { createLineVerifier } from './verify';

// F02-T09 POST /auth/profile (AUTH-02-AC1 to AC8, AC28, AC30; D11, D100, D105). Real Postgres and the real database functions.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const OWNER = '11111111-1111-4111-8111-111111111111';
const EXISTING = '33333333-3333-4333-8333-333333333333';
const IMPORTED = 'a1a1a1a1-0000-4000-8000-000000000001';
const INVITE = 'b'.repeat(64);

const channels: ClubLineChannel[] = [{ clubId: A, channelAccessToken: 'tokA', loginChannelId: 'loginA', liffId: 'liffA' }];
const clock = new FakeClock();
const line = new FakeLine({
  clock,
  channels,
  users: ['UNEW', 'UEXISTING', 'UTESTER', 'UOWNER'].map((id) => ({ lineUserId: id, displayName: `Name ${id}`, lineAppLanguage: 'en' as const, friendOf: {} })),
});

let tdb: TestDatabase;
let db: Db;
let server: { url: string; close(): Promise<void> };
let signIn: ReturnType<typeof createSignInService>;
let profile: ReturnType<typeof createProfileService>;

const GOOD = { fullName: 'Somchai Jaidee', phone: '081-234-5678', consent: true, noticeVersion: 'v1', language: 'th' };
const pending = async (lineId = 'UNEW', inviteHash?: string) => {
  const r = await signIn.signIn({ slug: 'a', idToken: line.issueIdToken(lineId, A), ...(inviteHash ? { inviteHash } : {}) });
  if (!r.ok) throw new Error(`sign in failed: ${r.code}`);
  return r.setCookie.split(';')[0]!;
};
const complete = (cookieHeader: string | undefined, body: unknown, inviteHash?: string) => profile.complete({ slug: 'a', cookieHeader, body, ...(inviteHash ? { inviteHash } : {}) });
const players = async () => (await tdb.query(`select id, line_user_id, display_name, full_name, phone, phone_normalized, language, is_test, active from public.app_user where line_user_id = 'UNEW' or line_user_id = 'UTESTER'`)).rows;
const counts = async () => ({
  users: (await tdb.query(`select count(*)::int n from public.app_user where claim_state is null`)).rows[0].n as number,
  consents: (await tdb.query(`select count(*)::int n from public.user_consent`)).rows[0].n as number,
});

beforeEach(async () => {
  tdb = await createTestDatabase();
  server = await line.serve();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  await tdb.query(`insert into public.line_connection (club_id, login_channel_id, liff_id) values ($1,'loginA','liffA')`, [A]);
  for (const [id, lineId, roles] of [[OWNER, 'UOWNER', ['owner', 'player']], [EXISTING, 'UEXISTING', ['player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [A, id, lineId]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [A, id, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  db = createDb({ connectionString: tdb.url, max: 2 });
  const directory = createDbDirectory(db);
  signIn = createSignInService({ db, verifier: createLineVerifier({ baseUrl: server.url, now: () => clock.now() }), directory, now: () => new Date(), sessionSeconds: 3600 });
  const claims = createClaimService();
  profile = createProfileService({ db, directory, signIn, requestClaim: (tx, input) => claims.requestFromProfile(tx, input) });
});
afterEach(async () => {
  await db.end();
  await server.close();
  await tdb.close();
});

describe('a new player completes the profile (AUTH-02-AC1, AC2, AC4)', () => {
  it('creates the player, the Player role and the consent in one go, and the same cookie is now active', async () => {
    const cookie = await pending();
    expect(await complete(cookie, GOOD)).toEqual({ ok: true, state: 'active' });
    const [p] = await players();
    expect(p).toMatchObject({ line_user_id: 'UNEW', full_name: 'Somchai Jaidee', phone: '081-234-5678', phone_normalized: '66812345678', language: 'th', is_test: false, active: true });
    expect(p.display_name).toBe('Name UNEW'); // as given by LINE, not used as the full name (LINE-01-AC12)
    expect((await tdb.query(`select role from public.app_user_role where user_id = $1`, [p.id])).rows).toEqual([{ role: 'player' }]);
    expect((await tdb.query(`select notice_version, language from public.user_consent where user_id = $1`, [p.id])).rows).toEqual([{ notice_version: 'v1', language: 'th' }]);
    expect(await signIn.authenticate({ slug: 'a', cookieHeader: cookie })).toMatchObject({ ok: true, state: 'active', userId: p.id, roles: ['player'] });
  });

  it('is audited: the new player and their role; the consent is its own append-only record (AUTH-02-AC4)', async () => {
    await complete(await pending(), GOOD);
    const types = (await tdb.query(`select distinct record_type from public.audit_entry order by record_type`)).rows.map((r) => r.record_type);
    expect(types).toEqual(expect.arrayContaining(['app_user', 'app_user_role']));
  });
});

describe('what is refused creates nothing (AUTH-02-AC2, AC3)', () => {
  it.each([[undefined], [false], ['true'], [1], [null]])('consent %j', async (consent) => {
    const cookie = await pending();
    const before = await counts();
    expect(await complete(cookie, { ...GOOD, consent })).toEqual({ ok: false, status: 400, code: 'consent_required' });
    expect(await counts()).toEqual(before);
    expect(await signIn.authenticate({ slug: 'a', cookieHeader: cookie })).toMatchObject({ ok: true, state: 'pending_profile' });
  });
  it('name and phone problems come back as codes per field', async () => {
    const r = await complete(await pending(), { ...GOOD, fullName: '  ', phone: '12345' });
    expect(r).toEqual({ ok: false, status: 400, code: 'invalid', fields: { fullName: 'name_missing', phone: 'phone_invalid' } });
    expect((await counts()).users).toBe(2);
  });
  it('only the profile fields are accepted: anything else, such as roles, is refused', async () => {
    const cookie = await pending();
    for (const extra of [{ roles: ['owner'] }, { clubId: A }, { userId: EXISTING }, { isTest: true }]) {
      expect(await complete(cookie, { ...GOOD, ...extra })).toEqual({ ok: false, status: 400, code: 'bad_input' });
    }
    expect(await complete(cookie, 'nope')).toEqual({ ok: false, status: 400, code: 'bad_input' });
    expect((await counts()).users).toBe(2);
  });
  it('a bad language or notice version is refused', async () => {
    const cookie = await pending();
    expect(await complete(cookie, { ...GOOD, language: 'fr' })).toMatchObject({ ok: false, code: 'bad_input' });
    expect(await complete(cookie, { ...GOOD, noticeVersion: '' })).toMatchObject({ ok: false, code: 'bad_input' });
  });
  it('no cookie, a cookie of another club, or an active session never reach this step', async () => {
    expect(await complete(undefined, GOOD)).toEqual({ ok: false, status: 401, code: 'unauthenticated' });
    const existing = await pending('UEXISTING');
    expect(await complete(existing, GOOD)).toEqual({ ok: false, status: 409, code: 'not_pending' });
    expect((await counts()).users).toBe(2);
  });
  it('a second submit after success is refused and changes nothing', async () => {
    const cookie = await pending();
    await complete(cookie, GOOD);
    expect(await complete(cookie, { ...GOOD, fullName: 'Someone Else' })).toEqual({ ok: false, status: 409, code: 'not_pending' });
    expect((await players())[0]!.full_name).toBe('Somchai Jaidee');
  });
});

describe('a shared phone is allowed and flagged (AUTH-02-AC28; D11)', () => {
  it('both players appear in the staff flag view', async () => {
    await tdb.query(`update public.app_user set phone = '0812345678', phone_normalized = '66812345678' where id = $1`, [EXISTING]);
    expect(await complete(await pending(), GOOD)).toMatchObject({ ok: true });
    const rows = (await tdb.query(`select count(*)::int n from (select phone_normalized from public.app_user where phone_normalized = '66812345678') x`)).rows[0].n;
    expect(rows).toBe(2);
    const flagged = await db.withClubTx({ clubId: A, userId: OWNER, roles: ['owner', 'player'], source: 'admin' }, (tx) => tx.query('select people_with_this_phone from public.duplicate_phone_flags'));
    expect(flagged.rows.map((r) => r.people_with_this_phone)).toEqual([2, 2]);
  });
});

describe('a phone that matches one imported record makes a claim and tells nobody (D105, AUTH-02-AC30)', () => {
  const importOne = async (phoneNormalized = '66812345678') => {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into public.app_user (club_id, id, full_name, phone, phone_normalized, claim_state) values ($1,$2,'Somchai Imported','+66812345678',$3,'unclaimed')`, [A, IMPORTED, phoneNormalized]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, IMPORTED]);
      await c.query('commit');
    } finally {
      c.release();
    }
  };
  it('the answer is the same with a match and without one', async () => {
    await importOne();
    const withMatch = await complete(await pending(), GOOD);
    const without = await complete(await pending('UTESTER'), { ...GOOD, phone: '0899999999' });
    expect(withMatch).toEqual({ ok: true, state: 'active' });
    expect(without).toEqual(withMatch);
  });
  it('a new player typing the imported phone gets a claim request and sees nothing of the record', async () => {
    await importOne();
    const cookie = await pending();
    expect(await complete(cookie, GOOD)).toEqual({ ok: true, state: 'active' });
    const claims = (await tdb.query(`select imported_user_id, typed_full_name, typed_phone, status from public.claim_request`)).rows;
    expect(claims).toEqual([{ imported_user_id: IMPORTED, typed_full_name: 'Somchai Jaidee', typed_phone: '081-234-5678', status: 'open' }]);
    const me = (await players())[0]!;
    expect(me.full_name).toBe('Somchai Jaidee'); // not the imported name
    const seen = await db.withClubTx({ clubId: A, userId: me.id, roles: ['player'], source: 'player_app' }, (tx) => tx.query('select id from public.app_user'));
    expect(seen.rows.map((r) => r.id)).toEqual([me.id]);
  });
  it('no match makes no claim', async () => {
    await importOne('66800000000');
    await complete(await pending(), GOOD);
    expect((await tdb.query('select count(*)::int n from public.claim_request')).rows[0].n).toBe(0);
  });
});

describe('invites and the tester flag (D100, SR-01)', () => {
  const makeInvite = (kind: 'tester' | 'owner', extra = '') =>
    tdb.query(`insert into public.club_invite (club_id, token_hash, kind, roles, created_by_user, expires_at${extra ? ', bound_line_user_id' : ''}) values ($1,$2,$3,$4,$5, now() + interval '1 day'${extra ? ', $6' : ''})`, [
      A,
      INVITE,
      kind,
      kind === 'tester' ? ['player'] : ['owner', 'player'],
      OWNER,
      ...(extra ? [extra] : []),
    ]);
  it('a tester signing up in a Testing club through a tester invite is a test account and is listed as a tester', async () => {
    await tdb.query(`update public.club set status = 'testing' where id = $1`, [A]);
    await makeInvite('tester');
    const cookie = await pending('UTESTER', INVITE);
    expect(await complete(cookie, GOOD, INVITE)).toEqual({ ok: true, state: 'active' });
    const [p] = await players();
    expect(p).toMatchObject({ line_user_id: 'UTESTER', is_test: true });
    expect((await tdb.query(`select count(*)::int n from public.club_tester where user_id = $1`, [p.id])).rows[0].n).toBe(1);
    expect((await tdb.query(`select used_by_user from public.club_invite`)).rows[0].used_by_user).toBe(p.id);
  });
  it('on a Live club no invite is needed and the account is not a test account', async () => {
    await complete(await pending(), GOOD);
    expect((await players())[0]!.is_test).toBe(false);
  });
  it('a bad invite on a Live club refuses the sign-up and rolls everything back', async () => {
    const cookie = await pending();
    expect(await complete(cookie, GOOD, 'c'.repeat(64))).toEqual({ ok: false, status: 400, code: 'invite_invalid' });
    expect(await players()).toEqual([]);
    expect(await signIn.authenticate({ slug: 'a', cookieHeader: cookie })).toMatchObject({ ok: true, state: 'pending_profile' });
  });
});
