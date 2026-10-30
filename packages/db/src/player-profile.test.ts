import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F02-T01 / migration 0101 and F02-T02 / migration 0102 (AUTH-02-AC28, LINE-01-AC13, AC14, AUTH-02-AC3).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';
const HASH = 'a'.repeat(64);
const HASH2 = 'b'.repeat(64);

let tdb: TestDatabase;
let web: Db;
let worker: Db;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A'), ($2,'b','ข','B')`, [A, B]);
  web = createDb({ connectionString: tdb.url, max: 2 });
  worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await web.end();
  await worker.end();
  await tdb.close();
});
async function person(club: string, id: string, line: string | null, roles = ['player'], extra = '') {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [club, id, line]);
    for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, id, r]);
    if (extra) await c.query(extra, [club, id]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
const guest = (club = A) => ({ clubId: club, userId: null, roles: ['guest'], source: 'player_app' as const });
const as = (user: string, roles: string[], club = A) => ({ clubId: club, userId: user, roles, source: 'player_app' as const });

describe('player record (F02-T01)', () => {
  it('the same person at two clubs has two rows; the pair (club, LINE id) is unique', async () => {
    await person(A, P1, 'Uline1');
    await person(B, P2, 'Uline1');
    expect((await tdb.query(`select count(*)::int as n from public.app_user where line_user_id = 'Uline1'`)).rows[0].n).toBe(2);
    await expect(person(A, P2, 'Uline1')).rejects.toThrow(/app_user_line_unique/);
  });
  it('language, level, phone and date of birth are constrained', async () => {
    await person(A, P1, 'L1');
    const upd = (set: string) => tdb.query(`update public.app_user set ${set} where id = $1`, [P1]);
    await expect(upd(`language = 'de'`)).rejects.toThrow(/language_values/);
    await expect(upd(`level = 'pro'`)).rejects.toThrow(/level_values/);
    await expect(upd(`phone = '081-234-5678'`)).rejects.toThrow(/phone_pair/);
    await expect(upd(`phone = '081', phone_normalized = '081'`)).rejects.toThrow(/phone_digits/);
    await expect(upd(`full_name = '  '`)).rejects.toThrow(/full_name_not_blank/);
    await upd(`language = 'th', level = 'new', phone = '081-234-5678', phone_normalized = '0812345678', date_of_birth = null`);
  });
  it('a shared phone is allowed and flagged on both records, for owner and front desk only', async () => {
    const phone = `, phone = '081', phone_normalized = '0812345678'`;
    await person(A, P1, 'L1', ['player'], `update public.app_user set phone = '081-234-5678', phone_normalized = '0812345678' where club_id = $1 and id = $2`);
    await person(A, P2, 'L2', ['player'], `update public.app_user set phone = '0812345678', phone_normalized = '0812345678' where club_id = $1 and id = $2`);
    await person(A, OWNER, 'L3', ['owner', 'player']);
    void phone;
    const flags = await web.withClubTx(as(OWNER, ['owner', 'player']), (tx) => tx.query('select id, people_with_this_phone from public.duplicate_phone_flags order by id'));
    expect(flags.rows).toEqual([{ id: P1, people_with_this_phone: 2 }, { id: P2, people_with_this_phone: 2 }]);
    expect((await web.withClubTx(as(P1, ['player']), (tx) => tx.query('select 1 from public.duplicate_phone_flags'))).rowCount).toBe(0);
    expect((await web.withClubTx(as(OWNER, ['owner'], B), (tx) => tx.query('select 1 from public.duplicate_phone_flags'))).rowCount).toBe(0);
  });
  it('a person edits their own profile fields but not identity, activity or the test flag', async () => {
    await person(A, P1, 'L1');
    const me = as(P1, ['player']);
    const r = await web.withClubTx(me, (tx) => tx.query(`update public.app_user set full_name = 'Nok', language = 'en' where id = $1`, [P1]));
    expect(r.rowCount).toBe(1);
    for (const col of ["line_user_id = 'x'", 'is_test = true', "line_friend = true"]) {
      await expect(web.withClubTx(me, (tx) => tx.query(`update public.app_user set ${col} where id = $1`, [P1])), col).rejects.toThrow(/permission denied/);
    }
  });
  it('the profile values reach the audit log only in the pii columns', async () => {
    await person(A, P1, 'L1');
    await web.withClubTx(as(P1, ['player']), (tx) => tx.query(`update public.app_user set full_name = 'MARKER Somchai', phone = '0899', phone_normalized = '0899999999', date_of_birth = '1990-01-01' where id = $1`, [P1]));
    const e = (await tdb.query(`select * from public.audit_entry where record_type = 'app_user' and action = 'update'`)).rows[0];
    expect(JSON.stringify([e.old_value, e.new_value])).not.toMatch(/MARKER|0899|1990/);
    expect(e.pii_new).toMatchObject({ full_name: 'MARKER Somchai', date_of_birth: '1990-01-01' });
  });
  it('the friend state is recorded by a function that touches nothing else, in the context club only', async () => {
    await person(A, P1, 'Uline1');
    await person(B, P2, 'Uline1');
    await web.withClubTx(guest(A), (tx) => tx.query(`select app.set_line_friend('Uline1', true)`));
    const rows = (await tdb.query(`select club_id, line_friend, line_friend_checked_at is not null as checked from public.app_user order by club_id`)).rows;
    expect(rows.find((r) => r.club_id === A)).toMatchObject({ line_friend: true, checked: true });
    expect(rows.find((r) => r.club_id === B)).toMatchObject({ line_friend: null, checked: false });
    expect((await tdb.query(`select has_function_privilege('booq_worker', 'app.set_line_friend(text,boolean)', 'execute') as ok`)).rows[0].ok).toBe(false);
  });
  it('the accountant name view now carries full_name (F01-T15)', async () => {
    await person(A, P1, 'L1', ['accountant', 'player'], `update public.app_user set full_name = 'Nok' where club_id = $1 and id = $2`);
    const r = await web.withClubTx(as(P1, ['accountant', 'player']), (tx) => tx.query('select display_name, full_name from public.app_user_names'));
    expect(r.rows).toEqual([{ display_name: null, full_name: 'Nok' }]);
  });
});

describe('sessions (F02-T02)', () => {
  const create = (club = A, hash = HASH, state = 'pending_profile', user: string | null = null, line = 'Uline1', mins = 30) =>
    web.withClubTx(guest(club), (tx) => tx.query(`select app.create_session($1,$2,$3,$4,'Nok','th', app.now() + ($5 || ' minutes')::interval) as id`, [hash, state, user, line, String(mins)]));
  const touch = (hash = HASH, club = A) => web.withClubTx(guest(club), (tx) => tx.query('select * from app.touch_session($1)', [hash]));

  it('the table never holds a token: only a sha-256 hex string is accepted', async () => {
    await expect(create(A, 'rawcookiecontents-xyz')).rejects.toThrow(/token_is_hash/);
    await expect(create(A, 'Z'.repeat(64))).rejects.toThrow(/token_is_hash/);
    await create();
    const dump = JSON.stringify((await tdb.query('select * from public.auth_session')).rows);
    expect(dump).toContain(HASH);
  });
  it('a pending sign-up holds the LINE id, name and language and expires in 30 minutes', async () => {
    await create();
    const t = await touch();
    expect(t.rows[0]).toMatchObject({ state: 'pending_profile', user_id: null, line_user_id: 'Uline1', pending_display_name: 'Nok', pending_language: 'th' });
    await tdb.setNow(new Date(Date.now() + 31 * 60_000));
    expect((await touch()).rows).toEqual([]);
  });
  it('an expired pending row is purged by the housekeeping function, per club', async () => {
    await create(A, HASH);
    await create(B, HASH2);
    await tdb.setNow(new Date(Date.now() + 31 * 60_000));
    const n = await worker.withClubTx({ clubId: A, userId: null, roles: [], source: 'job' }, (tx) => tx.query('select app.purge_expired_sessions() as n'));
    expect(n.rows[0]!.n).toBe(1);
    expect((await tdb.query('select club_id from public.auth_session')).rows).toEqual([{ club_id: B }]);
  });
  it('an active session needs an active person of this club with that LINE id', async () => {
    await person(A, P1, 'Uline1');
    await expect(create(A, HASH, 'active', P1, 'someone-else')).rejects.toThrow(/no active person/);
    await expect(create(B, HASH, 'active', P1, 'Uline1')).rejects.toThrow(/no active person/);
    await create(A, HASH, 'active', P1, 'Uline1', 600);
    expect((await touch()).rows[0]).toMatchObject({ state: 'active', user_id: P1 });
  });
  it('a revoked session is refused at once; sign out revokes; another club never sees it', async () => {
    await person(A, P1, 'Uline1');
    await create(A, HASH, 'active', P1, 'Uline1', 600);
    expect((await touch(HASH, B)).rows).toEqual([]);
    expect((await touch()).rows).toHaveLength(1);
    await web.withClubTx(guest(), (tx) => tx.query('select app.revoke_session($1)', [HASH]));
    expect((await touch()).rows).toEqual([]);
  });
  it('deactivating a person ends every session of theirs in the same transaction', async () => {
    await person(A, P1, 'Uline1');
    await person(A, OWNER, 'L9', ['owner', 'player']);
    await create(A, HASH, 'active', P1, 'Uline1', 600);
    await create(A, HASH2, 'active', P1, 'Uline1', 600);
    await web.withClubTx(as(OWNER, ['owner', 'player']), (tx) => tx.query(`update public.app_user set active = false where id = $1`, [P1]));
    expect((await touch(HASH)).rows).toEqual([]);
    expect((await touch(HASH2)).rows).toEqual([]);
    expect((await tdb.query(`select count(*)::int as n from public.auth_session where state = 'revoked'`)).rows[0].n).toBe(2);
  });
  it('the expiry must be in the future and the state one of the two', async () => {
    await expect(create(A, HASH, 'pending_profile', null, 'L', -5)).rejects.toThrow(/in the future/);
    await expect(create(A, HASH, 'revoked')).rejects.toThrow(/state must be/);
  });
  it('the app roles have no table privilege on sessions; only the functions; the worker may only purge', async () => {
    for (const role of ['booq_app', 'booq_worker', 'booq_platform']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        expect((await tdb.query('select has_table_privilege($1, $2, $3) as ok', [role, 'public.auth_session', priv])).rows[0].ok, `${role} ${priv}`).toBe(false);
      }
    }
    const can = async (role: string, fn: string) => (await tdb.query('select has_function_privilege($1, $2, $3) as ok', [role, fn, 'execute'])).rows[0].ok;
    expect(await can('booq_worker', 'app.touch_session(text)')).toBe(false);
    expect(await can('booq_app', 'app.purge_expired_sessions()')).toBe(false);
    expect(await can('booq_platform', 'app.touch_session(text)')).toBe(false);
  });
  it('a test account’s session goes with it at Go live (D100)', async () => {
    await tdb.query(`update public.club set status = 'testing' where id = $1`, [A]);
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id, is_test) values ($1,$2,$3,true)', [A, P1, 'Utest']);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, P1]);
      await c.query('commit');
    } finally {
      c.release();
    }
    await create(A, HASH, 'active', P1, 'Utest', 600);
    expect((await tdb.query('select is_test from public.auth_session')).rows).toEqual([{ is_test: true }]);
  });
});
