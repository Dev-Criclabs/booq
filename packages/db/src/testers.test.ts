import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createPlatformDb, type PlatformDb } from './platform-tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F01-T28 / migration 0040: testers, tester invites and the sign-in gate for F02
// (PLAT-07-AC5, AC6; PLAT-01-AC5, AC11; D100, D102; SR-01).
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LIVE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER_USER = '11111111-1111-4111-8111-111111111111';
const TESTER_USER = '22222222-2222-4222-8222-222222222222';
const PLAYER_USER = '33333333-3333-4333-8333-333333333333';
const OWNER_LINE = 'U00000000000000000000000000000001';
const TESTER_LINE = 'U00000000000000000000000000000002';
const PLAYER_LINE = 'U00000000000000000000000000000003';
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

let tdb: TestDatabase;
let db: Db;
let pdb: PlatformDb;
let admin: string;
let spec: string;
let loner: string;

async function staff(email: string, role: string, auth: string, name: string): Promise<string> {
  return (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1, $2, $3, $4) returning id`, [auth, email, name, role])).rows[0].id;
}
const as = (staffId: string, club = CLUB) => ({ staffId, staffLabel: 'Staff', clubId: club });
const createInvite = (who: string, hash = H1, club = CLUB) =>
  pdb.withPlatformTx(as(who, club), async (tx) => (await tx.query(`select platform.create_tester_invite($1, $2) as id`, [club, hash])).rows[0]?.id as string);
const list = (who: string, club = CLUB) =>
  pdb.withPlatformTx(as(who, club), async (tx) => (await tx.query(`select platform.club_testers($1) as r`, [club])).rows[0]?.r);
const remove = (who: string, tester: string, club = CLUB) =>
  pdb.withPlatformTx(as(who, club), (tx) => tx.query(`select platform.remove_tester($1, $2)`, [club, tester]));
const gate = (line: string, hash: string | null = null, club = CLUB) =>
  db.withClubTx({ clubId: club, userId: null, roles: ['guest'] }, async (tx) => (await tx.query(`select app.sign_in_gate($1, $2) as g`, [line, hash])).rows[0]?.g as string);

/** What F02 does at a tester's first sign in: the person row (flagged as a test account), then the invite is redeemed. */
async function join(hash: string, line = TESTER_LINE, user = TESTER_USER, test = true) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('insert into public.app_user (club_id, id, line_user_id, display_name, is_test) values ($1,$2,$3,$4,$5) on conflict do nothing', [CLUB, user, line, 'Pat Tester', test]);
    await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3) on conflict do nothing', [CLUB, user, 'player']);
    await c.query('commit');
  } finally {
    c.release();
  }
  return db.withClubTx({ clubId: CLUB, userId: user, roles: [], source: 'player_app' }, async (tx) =>
    (await tx.query(`select * from app.redeem_invite($1, $2, $3)`, [hash, line, user])).rows);
}
async function makeOwner() {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('insert into public.app_user (club_id, id, line_user_id, display_name) values ($1,$2,$3,$4)', [CLUB, OWNER_USER, OWNER_LINE, 'Nok']);
    for (const r of ['owner', 'player']) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [CLUB, OWNER_USER, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1, 'a', 'ก', 'A', 'testing'), ($2, 'b', 'ข', 'B', 'live')`, [CLUB, LIVE]);
  admin = await staff('admin@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000001', 'Ada Admin');
  spec = await staff('spec@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000002', 'Sam Specialist');
  loner = await staff('loner@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000003', 'Lee Loner');
  await tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1, $2)`, [spec, CLUB]);
  db = createDb({ connectionString: tdb.url, max: 1 });
  pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await db.end();
  await pdb.end();
  await tdb.close();
});

describe('tester invites (PLAT-07-AC5, SR-01, D102)', () => {
  it('an admin or assigned specialist creates one: kind tester, the player role only, long lived, not bound to a person', async () => {
    await tdb.setNow('2026-12-01T03:00:00Z');
    const id = await createInvite(spec);
    const r = (await tdb.query(`select kind, roles, bound_line_user_id, created_by_staff, token_hash, expires_at from public.club_invite where id = $1`, [id])).rows[0];
    expect(r).toMatchObject({ kind: 'tester', roles: ['player'], bound_line_user_id: null, created_by_staff: spec, token_hash: H1 });
    const ttl = Number((await tdb.query(`select value from platform.config where key = 'tester_invite_ttl_hours'`)).rows[0].value);
    expect(ttl).toBeGreaterThan(Number((await tdb.query(`select value from platform.config where key = 'invite_ttl_hours'`)).rows[0].value)); // longer than an owner invite
    expect(new Date(r.expires_at).getTime()).toBe(new Date('2026-12-01T03:00:00Z').getTime() + ttl * 3600_000);
    await createInvite(admin, H2);
  });

  it('refuses an unassigned specialist (not found), a bad token hash, and a Live club', async () => {
    await expect(createInvite(loner)).rejects.toThrow(/tester:not_found/);
    await expect(createInvite(spec, 'short')).rejects.toThrow(/tester:token_hash/);
    await expect(createInvite(admin, H1, LIVE)).rejects.toThrow(/tester:not_a_start/);
    expect((await tdb.query(`select count(*)::int as n from public.club_invite`)).rows[0].n).toBe(0);
  });

  it('a BOOQ tester joins as an ordinary player: the player role only, listed as a BOOQ tester, a flagged test account; no BOOQ credential', async () => {
    await createInvite(spec);
    const out = await join(H1);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'tester', roles: ['player'] });
    expect((await tdb.query(`select role from public.app_user_role where user_id = $1`, [TESTER_USER])).rows).toEqual([{ role: 'player' }]);
    expect((await tdb.query(`select kind, is_test, removed_at from public.club_tester where user_id = $1`, [TESTER_USER])).rows).toEqual([{ kind: 'boq_tester', is_test: true, removed_at: null }]);
    expect((await tdb.query(`select count(*)::int as n from platform.platform_staff`)).rows[0].n).toBe(3); // joining created no BOOQ account
  });

  it('the platform has no other way to hand out a role: staff and coach invites cannot be created by it', async () => {
    await expect(pdb.withPlatformTx(as(admin), (tx) => tx.query(`insert into public.club_invite (club_id, token_hash, kind, roles, created_by_staff, expires_at) values ($1, 'x', 'staff', '{front_desk,player}', $2, now() + interval '1 day')`, [CLUB, admin]))).rejects.toThrow(/permission denied/i);
    await expect(tdb.query(`insert into public.club_invite (club_id, token_hash, kind, roles, created_by_staff, expires_at) values ($1, 'x', 'staff', '{front_desk,player}', $2, now() + interval '1 day')`, [CLUB, admin])).rejects.toThrow(/club_invite_platform_kinds|check/i);
    await expect(tdb.query(`insert into public.club_invite (club_id, token_hash, kind, roles, created_by_staff, expires_at) values ($1, 'y', 'tester', '{owner,player}', $2, now() + interval '1 day')`, [CLUB, admin])).rejects.toThrow(/club_invite_roles_for_kind|check/i);
  });
});

describe('the testers the platform sees (PLAT-07-AC6)', () => {
  it('lists BOOQ testers masked: when they joined, their LINE name, nothing about what they did; owners are not listed', async () => {
    await makeOwner();
    await createInvite(spec);
    await join(H1);
    const r = await list(spec);
    expect(r).toEqual({ testers: [{ id: expect.any(String), added_at: expect.any(String), removed_at: null, display_name: 'Pat Tester' }], pending_invites: 0 });
    await createInvite(spec, H2);
    expect((await list(admin)).pending_invites).toBe(1);
    expect(await list(loner)).toBeNull();
  });

  it('removing a tester ends their access; the account stays', async () => {
    await createInvite(spec);
    await join(H1);
    const id = (await list(spec)).testers[0].id;
    expect(await gate(TESTER_LINE)).toBe('open');
    await remove(spec, id);
    expect(await gate(TESTER_LINE)).toBe('not_a_tester');
    expect((await list(spec)).testers[0].removed_at).not.toBeNull();
    expect((await tdb.query(`select active from public.app_user where id = $1`, [TESTER_USER])).rows).toEqual([{ active: true }]);
    await expect(remove(spec, id)).rejects.toThrow(/tester:not_found/);
    await expect(remove(loner, id)).rejects.toThrow(/tester:not_found/);
  });

  it('every change is in P6: the invite, the join and the removal', async () => {
    await createInvite(spec);
    await join(H1);
    await remove(spec, (await list(spec)).testers[0].id);
    const a = (await tdb.query(`select action, staff_name_at_time as n from platform.audit_log where action like 'club.tester%' order by occurred_at, id`)).rows;
    expect(a.map((x) => x.action)).toEqual(['club.tester_invite_created', 'club.tester_added', 'club.tester_removed']);
    expect(a[0]?.n).toBe('Sam Specialist');
    expect(JSON.stringify((await tdb.query(`select detail from platform.audit_log`)).rows)).not.toContain(H1);
  });
});

describe('the sign-in gate (PLAT-01-AC5, AC11; D102)', () => {
  it('Live and Paused admit everyone; an inactive account is refused anywhere', async () => {
    expect(await gate(PLAYER_LINE, null, LIVE)).toBe('open');
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [LIVE]);
    expect(await gate(PLAYER_LINE, null, LIVE)).toBe('open');
    await tdb.query(`insert into public.app_user (club_id, id, line_user_id, active) values ($1, $2, $3, false)`, [LIVE, PLAYER_USER, PLAYER_LINE]);
    await tdb.query(`insert into public.app_user_role (club_id, user_id, role) values ($1, $2, 'player')`, [LIVE, PLAYER_USER]);
    expect(await gate(PLAYER_LINE, null, LIVE)).toBe('account_inactive');
  });

  it('Draft and Testing refuse a stranger and an ordinary player: shown as not found', async () => {
    expect(await gate(PLAYER_LINE)).toBe('not_a_tester');
    await tdb.query(`update public.club set status = 'draft' where id = $1`, [CLUB]);
    expect(await gate(PLAYER_LINE)).toBe('not_a_tester');
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [CLUB, PLAYER_USER, PLAYER_LINE]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [CLUB, PLAYER_USER]);
      await c.query('commit');
    } finally {
      c.release();
    }
    expect(await gate(PLAYER_LINE)).toBe('not_a_tester');
  });

  it('the owner passes on every visit, also after the invite was used and in a Draft club', async () => {
    await makeOwner();
    await tdb.query(`update public.club set status = 'draft' where id = $1`, [CLUB]);
    await tdb.query(`insert into public.club_invite (club_id, token_hash, kind, roles, bound_line_user_id, created_by_staff, expires_at, used_at, used_by_user) values ($1,$2,'owner','{owner,player}',$3,$4, now() + interval '1 day', now(), $5)`, [CLUB, H1, OWNER_LINE, admin, OWNER_USER]);
    expect(await gate(OWNER_LINE)).toBe('open');
    expect(await gate(OWNER_LINE)).toBe('open');
  });

  it('a new person with a valid tester or owner invite passes; an expired, used, other-club or unbound-to-them one does not', async () => {
    await createInvite(spec);
    expect(await gate(TESTER_LINE, H1)).toBe('open');
    expect(await gate(TESTER_LINE, H2)).toBe('not_a_tester');                  // unknown link
    expect(await gate(TESTER_LINE, null)).toBe('not_a_tester');
    await join(H1);
    await tdb.query(`delete from public.club_tester`);                         // the link is used and the person is no tester
    expect(await gate('U0000000000000000000000000000000f', H1)).toBe('not_a_tester'); // used: single use
    await tdb.setNow('2099-01-01T00:00:00Z');
    await createInvite(admin, H2);
    await tdb.advance('3000 hours');
    expect(await gate('U0000000000000000000000000000000e', H2)).toBe('not_a_tester'); // expired
    // an owner link is for the one LINE id it is bound to
    await tdb.query(`insert into public.club_invite (club_id, token_hash, kind, roles, bound_line_user_id, created_by_staff, expires_at) values ($1,$2,'owner','{owner,player}',$3,$4, app.now() + interval '1 day')`, [CLUB, 'c'.repeat(64), OWNER_LINE, admin]);
    expect(await gate(OWNER_LINE, 'c'.repeat(64))).toBe('open');
    expect(await gate(PLAYER_LINE, 'c'.repeat(64))).toBe('not_a_tester');
  });

  it('an owner link that nobody has used yet admits any new person; once used it admits nobody else (D151)', async () => {
    await tdb.query(`insert into public.club_invite (club_id, token_hash, kind, roles, created_by_staff, expires_at) values ($1,$2,'owner','{owner,player}',$3, app.now() + interval '1 day')`, [CLUB, 'e'.repeat(64), admin]);
    expect(await gate(PLAYER_LINE, 'e'.repeat(64))).toBe('open');
    expect(await gate(OWNER_LINE, 'e'.repeat(64))).toBe('open');
    await makeOwner();
    const c = await tdb.pool.connect();                       // the redemption, as F02 does it: in the club's context
    try {
      await c.query('begin');
      await c.query(`select set_config('app.club_id', $1, true), set_config('app.source', 'player_app', true)`, [CLUB]);
      await c.query(`update public.club_invite set used_at = app.now(), used_by_user = $1, bound_line_user_id = $2 where token_hash = $3`, [OWNER_USER, OWNER_LINE, 'e'.repeat(64)]);
      await c.query('commit');
    } finally {
      c.release();
    }
    expect(await gate(PLAYER_LINE, 'e'.repeat(64))).toBe('not_a_tester');
  });

  it('a tester returns on later visits with no invite: the long-lived link is not needed again', async () => {
    await createInvite(spec);
    await join(H1);
    expect(await gate(TESTER_LINE)).toBe('open');
    await tdb.setNow('2099-06-01T00:00:00Z');
    expect(await gate(TESTER_LINE)).toBe('open');
  });

  it('an unknown club or no context is not available, and the gate takes no club argument', async () => {
    await expect(db.withClubTx({ clubId: 'aaaaaaaa-0000-4000-8000-0000000000ff', userId: null, roles: ['guest'] }, (tx) => tx.query(`select app.sign_in_gate('U1', null) as g`))
      .then((r) => r.rows[0]?.g)).resolves.toBe('club_not_available');
    expect((await tdb.query(`select app.sign_in_gate('U1', null) as g`)).rows[0].g).toBe('club_not_available');
    const a = await tdb.query(`select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'sign_in_gate'`);
    expect(a.rows).toEqual([{ args: 'p_line_user_id text, p_invite_hash text' }]);
  });
});
