import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { hashInviteToken } from '@booq/auth';
import { staffRoutes } from './routes';

// F01-T14 staff routes (ROLE-01-AC1, AC5, AC6; design 5.1): owner only, audited, typed refusals.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const OWNER = '11111111-1111-4111-8111-111111111111';
const DESK = '22222222-2222-4222-8222-222222222222';
const PLAYER = '44444444-4444-4444-8444-444444444444';
const deps = { hasFeature: async () => true };
let tdb: TestDatabase;
let db: Db;
const sess = (userId: string, roles: string[]) => ({ clubId: A, userId, roles: roles as never });
const owner = sess(OWNER, ['owner', 'player']);
const routes = () => staffRoutes({ db });
const find = (m: string, p: string) => routes().find((r) => r.def.method === m && r.def.path === p)!;
const run = (m: string, p: string, session: ReturnType<typeof sess> | null, input: unknown = {}) =>
  find(m, p).handle({ session, input, body: Object.fromEntries(Object.entries(input as object).filter(([k]) => k !== 'userId')) }, deps);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  for (const [id, line, roles] of [[OWNER, 'L1', ['owner', 'player']], [DESK, 'L2', ['front_desk', 'player']], [PLAYER, 'L4', ['player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into public.app_user (club_id, id, line_user_id, display_name) values ($1,$2,$3,$3)`, [A, id, line]);
      for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [A, id, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  await tdb.query(`insert into platform.config (key, value) values ('staff_invite_ttl_hours', '72')`);
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('staff routes', () => {
  it('declare staff.manage or roles.assign on every route, owner only', () => {
    expect(routes().map((r) => `${r.def.method} ${r.def.path} ${r.def.permission}`).sort()).toEqual([
      'GET /staff staff.manage',
      'GET /staff/invites staff.manage',
      'POST /staff/:userId/deactivate staff.manage',
      'POST /staff/invites staff.manage',
      'POST /staff/invites/:id/cancel staff.manage',
      'PUT /staff/:userId/roles roles.assign',
    ]);
  });

  it('a guest gets 401 and every other role 403 before anything runs', async () => {
    expect(await run('GET', '/staff', null)).toMatchObject({ ok: false, status: 401 });
    for (const s of [sess(DESK, ['front_desk', 'player']), sess(PLAYER, ['player']), sess(DESK, ['accountant', 'player']), sess(DESK, ['coach', 'player'])]) {
      for (const r of routes()) expect(await r.handle({ session: s, input: {} }, deps), `${r.def.method} ${r.def.path}`).toMatchObject({ ok: false, status: 403 });
    }
  });

  it('GET /staff lists staff with roles; a plain player is not staff', async () => {
    const r = await run('GET', '/staff', owner);
    expect(r).toMatchObject({ ok: true });
    const ids = (r as { body: Array<{ id: string }> }).body.map((x) => x.id).sort();
    expect(ids).toEqual([DESK, OWNER].sort());
  });

  it('PUT /staff/:userId/roles sets the roles; an unknown role is 400, an owner 409, a stranger 404, a bad id 400', async () => {
    expect(await run('PUT', '/staff/:userId/roles', owner, { userId: PLAYER, roles: ['accountant', 'player'] })).toMatchObject({ ok: true, body: { old: ['player'], new: ['accountant', 'player'], changed: true } });
    expect(await run('PUT', '/staff/:userId/roles', owner, { userId: PLAYER, roles: ['owner', 'player'] })).toMatchObject({ ok: false, status: 400, code: 'invalid_roles' });
    expect(await run('PUT', '/staff/:userId/roles', owner, { userId: OWNER, roles: ['player'] })).toMatchObject({ ok: false, status: 409, code: 'owner_fixed' });
    expect(await run('PUT', '/staff/:userId/roles', owner, { userId: 'aaaaaaaa-0000-4000-8000-0000000000ff', roles: ['player'] })).toMatchObject({ ok: false, status: 404, code: 'not_found' });
    expect(await run('PUT', '/staff/:userId/roles', owner, { userId: 'nope', roles: ['player'] })).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
    expect(await run('PUT', '/staff/:userId/roles', owner, { userId: PLAYER, roles: 'player' })).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
    expect(await run('PUT', '/staff/:userId/roles', owner, { userId: PLAYER, roles: ['player'], extra: 1 })).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
  });

  it('POST /staff/invites returns the token once; only its hash is stored', async () => {
    const r = await run('POST', '/staff/invites', owner, { kind: 'staff', roles: ['front_desk'] });
    expect(r).toMatchObject({ ok: true, body: { id: expect.any(String), token: expect.any(String) } });
    const { token, id } = (r as { body: { token: string; id: string } }).body;
    expect((await tdb.query(`select token_hash from public.club_invite where id = $1`, [id])).rows[0].token_hash).toBe(hashInviteToken(token));
    expect(JSON.stringify((await run('GET', '/staff/invites', owner)))).not.toContain(token);
    expect(await run('POST', '/staff/invites', owner, { kind: 'owner' })).toMatchObject({ ok: false, status: 400, code: 'invalid_invite' });
    expect(await run('POST', '/staff/invites', owner, { kind: 'coach', roles: ['coach'], extra: 1 })).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
  });

  it('POST /staff/invites/:id/cancel ends a pending staff invite so it leaves the list and cannot be redeemed; a used, repeated, unknown or bad id is refused', async () => {
    const { id } = ((await run('POST', '/staff/invites', owner, { kind: 'staff', roles: ['front_desk'] })) as { body: { id: string } }).body;
    expect(((await run('GET', '/staff/invites', owner)) as { body: unknown[] }).body).toHaveLength(1);
    expect(await run('POST', '/staff/invites/:id/cancel', owner, { id })).toMatchObject({ ok: true });
    expect(((await run('GET', '/staff/invites', owner)) as { body: unknown[] }).body).toHaveLength(0);
    expect((await tdb.query(`select expires_at <= app.now() as gone from public.club_invite where id = $1`, [id])).rows[0].gone).toBe(true);
    expect(await run('POST', '/staff/invites/:id/cancel', owner, { id })).toMatchObject({ ok: false, status: 404 });
    expect(await run('POST', '/staff/invites/:id/cancel', owner, { id: 'nope' })).toMatchObject({ ok: false, status: 400 });
    const used = ((await run('POST', '/staff/invites', owner, { kind: 'coach' })) as { body: { id: string } }).body.id;
    await tdb.query(`update public.club_invite set used_at = app.now(), used_by_user = $2 where id = $1`, [used, DESK]);
    expect(await run('POST', '/staff/invites/:id/cancel', owner, { id: used })).toMatchObject({ ok: false, status: 404 });
    expect((await tdb.query(`select count(*)::int as n from public.audit_entry where action = 'invite.cancelled'`)).rows[0].n).toBe(1);
  });

  it('an Owner cannot be invited or assigned here: the owner role comes only from the platform owner invite', async () => {
    expect(await run('POST', '/staff/invites', owner, { kind: 'staff', roles: ['owner'] })).toMatchObject({ ok: false, status: 400, code: 'invalid_invite' });
    expect(await run('PUT', '/staff/:userId/roles', owner, { userId: DESK, roles: ['owner', 'player'] })).toMatchObject({ ok: false });
  });

  it('with no invite life configured the route answers 503 not_configured', async () => {
    await tdb.query(`delete from platform.config where key = 'staff_invite_ttl_hours'`);
    expect(await run('POST', '/staff/invites', owner, { kind: 'coach' })).toMatchObject({ ok: false, status: 503, code: 'not_configured' });
  });

  it('POST /staff/:userId/deactivate: owner only, never yourself', async () => {
    expect(await run('POST', '/staff/:userId/deactivate', owner, { userId: DESK })).toMatchObject({ ok: true });
    expect(await run('POST', '/staff/:userId/deactivate', owner, { userId: DESK })).toMatchObject({ ok: false, status: 404 });
    expect(await run('POST', '/staff/:userId/deactivate', owner, { userId: OWNER })).toMatchObject({ ok: false, status: 409, code: 'self' });
  });
});
