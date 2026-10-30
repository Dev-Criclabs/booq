import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F01-T14 / migration 0050: roles and staff (ROLE-01-AC1, AC5, AC6, AC7; design 5.1). The owner assigns roles, creates
// staff and coach invites and deactivates people; everything goes through definer functions that check the owner role
// from the context, never from an argument.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER = '11111111-1111-4111-8111-111111111111';
const OWNER2 = '12121212-1212-4212-8212-121212121212';
const DESK = '22222222-2222-4222-8222-222222222222';
const COACH = '33333333-3333-4333-8333-333333333333';
const PLAYER = '44444444-4444-4444-8444-444444444444';
const OTHER_B = '55555555-5555-4555-8555-555555555555';
const HASH = 'c'.repeat(64);

let tdb: TestDatabase;
let db: Db;

async function person(club: string, id: string, line: string, roles: string[]) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, display_name) values ($1,$2,$3,$4)`, [club, id, line, `Name ${line}`]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [club, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
const as = (userId: string, roles: string[], club = A) => ({ clubId: club, userId, roles: roles as never, source: 'admin' as const });
const owner = as(OWNER, ['owner', 'player']);
const desk = as(DESK, ['front_desk', 'player']);
const call = <T = unknown>(ctx: ReturnType<typeof as>, sql: string, params: unknown[] = []) =>
  db.withClubTx(ctx, async (tx) => (await tx.query(sql, params)).rows[0] as T);
const rolesOf = async (id: string) => (await tdb.query(`select role from public.app_user_role where user_id = $1 order by role`, [id])).rows.map((r) => r.role);
const notes = async (action: string) => (await tdb.query(`select record_id, new_value as detail, actor_type from public.audit_entry where action = $1 order by occurred_at, id`, [action])).rows;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await person(A, OWNER, 'L1', ['owner', 'player']);
  await person(A, OWNER2, 'L5', ['owner', 'player']);
  await person(A, DESK, 'L2', ['front_desk', 'player']);
  await person(A, COACH, 'L3', ['coach', 'player']);
  await person(A, PLAYER, 'L4', ['player']);
  await person(B, OTHER_B, 'L6', ['front_desk', 'player']);
  await tdb.query(`insert into platform.config (key, value) values ('staff_invite_ttl_hours', '72')`);
  db = createDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('assigning roles (ROLE-01-AC1, AC5, AC7)', () => {
  it('the owner sets a person\'s roles; the old and new set are written to the club audit log', async () => {
    const r = await call<{ r: unknown }>(owner, `select app.set_user_roles($1, array['front_desk','accountant','player']) as r`, [PLAYER]);
    expect(r.r).toEqual({ old: ['player'], new: ['accountant', 'front_desk', 'player'], changed: true });
    expect(await rolesOf(PLAYER)).toEqual(['accountant', 'front_desk', 'player']);
    expect(await notes('roles.changed')).toEqual([{ record_id: PLAYER, detail: { old: ['player'], new: ['accountant', 'front_desk', 'player'] }, actor_type: 'club_user' }]);
  });

  it('a coach who also plays keeps one record with both roles, and the set can shrink back (ROLE-01-AC1)', async () => {
    expect(await rolesOf(COACH)).toEqual(['coach', 'player']);
    expect((await tdb.query(`select count(*)::int as n from public.app_user where id = $1`, [COACH])).rows[0].n).toBe(1);
    await call(owner, `select app.set_user_roles($1, array['player'])`, [COACH]);
    expect(await rolesOf(COACH)).toEqual(['player']);
  });

  it('the same set changes nothing and writes no note', async () => {
    const r = await call<{ r: { changed: boolean } }>(owner, `select app.set_user_roles($1, array['player','coach']) as r`, [COACH]);
    expect(r.r.changed).toBe(false);
    expect(await notes('roles.changed')).toEqual([]);
  });

  it('only the owner: front desk, accountant, coach and player are refused', async () => {
    for (const who of [desk, as(COACH, ['coach', 'player']), as(PLAYER, ['player']), as(DESK, ['accountant', 'player'])]) {
      await expect(call(who, `select app.set_user_roles($1, array['front_desk','player'])`, [PLAYER])).rejects.toThrow(/staff:forbidden/);
    }
    expect(await rolesOf(PLAYER)).toEqual(['player']);
  });

  it('the set must hold only player, coach, front_desk and accountant, and must keep player (D115); owner is not assignable here', async () => {
    for (const bad of ["array['coach']", "array['owner','player']", "array['superuser','player']", 'array[]::text[]', "array['coach','coach','player']"]) {
      await expect(call(owner, `select app.set_user_roles($1, ${bad})`, [PLAYER]), bad).rejects.toThrow(/staff:invalid_roles/);
    }
    await expect(call(owner, `select app.set_user_roles($1, null)`, [PLAYER])).rejects.toThrow(/staff:invalid_roles/);
  });

  it('an owner\'s roles are not changed here, and a person of another club or an unknown person is not found', async () => {
    await expect(call(owner, `select app.set_user_roles($1, array['player'])`, [OWNER2])).rejects.toThrow(/staff:owner_fixed/);
    await expect(call(owner, `select app.set_user_roles($1, array['player'])`, [OTHER_B])).rejects.toThrow(/staff:not_found/);
    await expect(call(owner, `select app.set_user_roles($1, array['player'])`, ['aaaaaaaa-0000-4000-8000-0000000000ff'])).rejects.toThrow(/staff:not_found/);
    expect(await rolesOf(OTHER_B)).toEqual(['front_desk', 'player']);
  });

  it('a deactivated person is not found', async () => {
    await tdb.query(`update public.app_user set active = false where id = $1`, [PLAYER]);
    await expect(call(owner, `select app.set_user_roles($1, array['coach','player'])`, [PLAYER])).rejects.toThrow(/staff:not_found/);
  });

  it('a BOOQ account never receives a club role: platform staff are not people of a club (ROLE-01-AC6)', async () => {
    await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ('99999999-0000-4000-8000-000000000001','a@booq.example','Ada','platform_admin')`);
    const id = (await tdb.query(`select id from platform.platform_staff`)).rows[0].id;
    await expect(call(owner, `select app.set_user_roles($1, array['front_desk','player'])`, [id])).rejects.toThrow(/staff:not_found/);
    expect((await tdb.query(`select count(*)::int as n from public.app_user_role where user_id = $1`, [id])).rows[0].n).toBe(0);
    // and there is no column or role value that would let a platform role live in a club role set
    await expect(tdb.query(`insert into public.app_user_role (club_id, user_id, role) values ($1, $2, 'platform_admin')`, [A, OWNER])).rejects.toThrow();
  });
});

describe('staff and coach invites (design 5.1)', () => {
  const invite = (ctx: ReturnType<typeof as>, kind: string, roles: string, hash = HASH) =>
    call<{ id: string }>(ctx, `select app.create_staff_invite($1, ${roles}, $2) as id`, [kind, hash]);

  it('the owner makes one: it adds the player role, expires after the configured life, and is bound to nobody', async () => {
    await tdb.setNow('2026-12-01T03:00:00Z');
    await invite(owner, 'staff', "array['front_desk']");
    const row = (await tdb.query(`select kind, roles, bound_line_user_id, created_by_user, created_by_staff, expires_at, token_hash from public.club_invite where club_id = $1`, [A])).rows[0];
    expect(row).toMatchObject({ kind: 'staff', roles: ['front_desk', 'player'], bound_line_user_id: null, created_by_user: OWNER, created_by_staff: null, token_hash: HASH });
    expect(new Date(row.expires_at).toISOString()).toBe('2026-12-04T03:00:00.000Z');
  });

  it('a coach invite gives coach and player; a staff invite may carry front desk, accountant or both', async () => {
    await invite(owner, 'coach', 'array[]::text[]', 'd'.repeat(64));
    await invite(owner, 'staff', "array['front_desk','accountant']", 'e'.repeat(64));
    expect((await tdb.query(`select kind, roles from public.club_invite order by kind`)).rows).toEqual([
      { kind: 'coach', roles: ['coach', 'player'] },
      { kind: 'staff', roles: ['accountant', 'front_desk', 'player'] },
    ]);
  });

  it('refuses another kind, a staff invite with no staff role or an owner role, a bad hash, and a non-owner', async () => {
    await expect(invite(owner, 'owner', "array['owner']")).rejects.toThrow(/staff:invalid_invite/);
    await expect(invite(owner, 'tester', 'array[]::text[]')).rejects.toThrow(/staff:invalid_invite/);
    await expect(invite(owner, 'staff', 'array[]::text[]')).rejects.toThrow(/staff:invalid_invite/);
    await expect(invite(owner, 'staff', "array['owner']")).rejects.toThrow(/staff:invalid_invite/);
    await expect(invite(owner, 'staff', "array['front_desk']", 'short')).rejects.toThrow(/staff:invalid_invite/);
    await expect(invite(desk, 'staff', "array['front_desk']")).rejects.toThrow(/staff:forbidden/);
    expect((await tdb.query(`select count(*)::int as n from public.club_invite`)).rows[0].n).toBe(0);
  });

  it('with no invite life configured by BOOQ, no invite is made (nothing is invented)', async () => {
    await tdb.query(`delete from platform.config where key = 'staff_invite_ttl_hours'`);
    await expect(invite(owner, 'staff', "array['front_desk']")).rejects.toThrow(/staff:not_configured/);
  });

  it('the list shows open invites without the token hash', async () => {
    await invite(owner, 'staff', "array['front_desk']");
    const r = await call<{ r: Array<Record<string, unknown>> }>(owner, `select app.list_staff_invites() as r`);
    expect(r.r).toHaveLength(1);
    expect(Object.keys(r.r[0]!).sort()).toEqual(['created_at', 'expires_at', 'id', 'kind', 'roles']);
    expect((await call<{ r: unknown[] }>(owner, `select app.list_staff_invites() as r`, [])).r).toHaveLength(1);
    await expect(call(desk, `select app.list_staff_invites()`)).rejects.toThrow(/staff:forbidden/);
  });
});

describe('deactivating a person', () => {
  it('the owner deactivates a staff member: inactive, sessions revoked, a note in the club audit log', async () => {
    await tdb.query(`insert into public.auth_session (club_id, token_hash, user_id, line_user_id, state, expires_at) values ($1, repeat('a', 64), $2, 'L2', 'active', app.now() + interval '1 day')`, [A, DESK]);
    await call(owner, `select app.deactivate_user($1)`, [DESK]);
    expect((await tdb.query(`select active from public.app_user where id = $1`, [DESK])).rows[0].active).toBe(false);
    expect((await tdb.query(`select revoked_at is not null as r from public.auth_session where user_id = $1`, [DESK])).rows[0].r).toBe(true);
    expect((await notes('user.deactivated')).map((n) => n.record_id)).toEqual([DESK]);
  });

  it('refuses yourself, an owner, a person of another club, a non-owner caller; a second call says not found', async () => {
    await expect(call(owner, `select app.deactivate_user($1)`, [OWNER])).rejects.toThrow(/staff:self/);
    await expect(call(owner, `select app.deactivate_user($1)`, [OWNER2])).rejects.toThrow(/staff:owner_fixed/);
    await expect(call(owner, `select app.deactivate_user($1)`, [OTHER_B])).rejects.toThrow(/staff:not_found/);
    await expect(call(desk, `select app.deactivate_user($1)`, [PLAYER])).rejects.toThrow(/staff:forbidden/);
    await call(owner, `select app.deactivate_user($1)`, [COACH]);
    await expect(call(owner, `select app.deactivate_user($1)`, [COACH])).rejects.toThrow(/staff:not_found/);
  });
});

describe('the staff list', () => {
  it('shows each person once with all roles, only for the owner, only this club', async () => {
    const r = await call<{ r: Array<{ id: string; roles: string[]; active: boolean }> }>(owner, `select app.list_staff() as r`);
    const byId = Object.fromEntries(r.r.map((x) => [x.id, x]));
    expect(Object.keys(byId).sort()).toEqual([COACH, DESK, OWNER, OWNER2].sort());   // a player with no staff role is not staff
    expect(byId[COACH]?.roles).toEqual(['coach', 'player']);
    expect(Object.keys(r.r[0]!).sort()).toEqual(['active', 'display_name', 'id', 'roles']);
    await expect(call(desk, `select app.list_staff()`)).rejects.toThrow(/staff:forbidden/);
  });

  it('includes deactivated staff with active false, so the owner can see who was removed', async () => {
    await call(owner, `select app.deactivate_user($1)`, [DESK]);
    const r = await call<{ r: Array<{ id: string; active: boolean }> }>(owner, `select app.list_staff() as r`);
    expect(r.r.find((x) => x.id === DESK)?.active).toBe(false);
  });
});
