import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { settingsRoutes } from '@booq/domain';
import { createWebTable } from '../../server/context';

// The owner's settings routes, mounted in the web table (F01-T08; PLAT-05; ROLE-01-AC8; D115). The mount is one line in mounts.ts.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const ACC = '55555555-5555-4555-8555-555555555555';
const OWNER_B = '77777777-7777-4777-8777-777777777777';
const deps = { hasFeature: async () => true };

let tdb: TestDatabase;
let db: Db;
const sess = (userId: string, roles: string[], clubId = A) => ({ clubId, userId, roles: roles as never });
const table = () => createWebTable({ db, verifier: { verifyIdToken: async () => ({ ok: false as const, code: 'offline' as const }) }, now: () => new Date('2026-10-31T00:00:00Z'), config: { sessionSeconds: 60, maxBodyBytes: 1000, importLimits: null } }).table;
const run = (m: string, p: string, session: ReturnType<typeof sess> | null, input: Record<string, unknown> = {}) =>
  table().find((r) => r.def.method === m && r.def.path === p)!.handle({ session, input }, deps);
const owner = sess(OWNER, ['owner', 'player']);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, payment_option) values ($1,'a','ก','A','beam'), ($2,'b','ข','B','beam')`, [A, B]);
  for (const [club, u, roles] of [[A, PLAYER, ['player']], [A, DESK, ['front_desk', 'player']], [A, OWNER, ['owner', 'player']], [A, ACC, ['accountant', 'player']], [B, OWNER_B, ['owner', 'player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id, full_name) values ($1,$2,$3,$3)', [club, u, 'L' + u.slice(0, 2)]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('settings routes are mounted', () => {
  it('the web table holds GET /settings and PUT /settings/:key, from the one mount line', () => {
    const all = table().map((r) => `${r.def.method} ${r.def.path} ${r.def.permission}`);
    expect(all).toContain('GET /settings settings.business.read');
    expect(all).toContain('PUT /settings/:key settings.write');
    expect(Object.keys(settingsRoutes(db))).toEqual(['list', 'put']);
  });
});

describe('who reads and writes', () => {
  it('the owner reads every setting and writes one; the value is checked and nothing has a default', async () => {
    const before = (await run('GET', '/settings', owner)) as { ok: boolean; body: Array<{ key: string; unset: boolean; value: unknown }> };
    expect(before.ok).toBe(true);
    expect(before.body.find((s) => s.key === 'hold_minutes')).toMatchObject({ unset: true, value: null });
    expect(await run('PUT', '/settings/:key', owner, { key: 'hold_minutes', value: 15 })).toMatchObject({ ok: true, body: { key: 'hold_minutes', value: 15 } });
    expect(await run('PUT', '/settings/:key', owner, { key: 'hold_minutes', value: 12 })).toMatchObject({ ok: false, status: 400, code: 'invalid_value' });
    expect(await run('PUT', '/settings/:key', owner, { key: 'made_up', value: 1 })).toMatchObject({ ok: false, status: 404, code: 'unknown_setting' });
    expect(((await run('GET', '/settings', owner)) as { body: Array<{ key: string; value: unknown }> }).body.find((s) => s.key === 'hold_minutes')?.value).toBe(15);
  });
  it('the accountant reads the business settings only, and cannot write', async () => {
    await run('PUT', '/settings/:key', owner, { key: 'hold_minutes', value: 15 });
    await run('PUT', '/settings/:key', owner, { key: 'vat_enabled', value: true });
    const r = (await run('GET', '/settings', sess(ACC, ['accountant', 'player']))) as { ok: boolean; body: Array<{ key: string; value: unknown }> };
    expect(r.ok).toBe(true);
    expect(r.body.map((s) => s.key)).toEqual(['vat_enabled']);
    expect(await run('PUT', '/settings/:key', sess(ACC, ['accountant', 'player']), { key: 'vat_enabled', value: false })).toMatchObject({ ok: false, status: 403 });
  });
  it('front desk, a player and a guest are refused (the permission matrix gives them no settings route)', async () => {
    for (const s of [sess(DESK, ['front_desk', 'player']), sess(PLAYER, ['player'])]) {
      expect(await run('GET', '/settings', s)).toMatchObject({ ok: false, status: 403 });
      expect(await run('PUT', '/settings/:key', s, { key: 'hold_minutes', value: 15 })).toMatchObject({ ok: false, status: 403 });
    }
    expect(await run('GET', '/settings', null)).toMatchObject({ ok: false, status: 401 });
    expect((await tdb.query(`select count(*)::int as n from public.club_setting`)).rows[0].n).toBe(0);
  });
  it('another club sees and changes only its own settings', async () => {
    await run('PUT', '/settings/:key', owner, { key: 'hold_minutes', value: 20 });
    const ownerB = sess(OWNER_B, ['owner', 'player'], B);
    expect(((await run('GET', '/settings', ownerB)) as { body: Array<{ key: string; unset: boolean }> }).body.find((s) => s.key === 'hold_minutes')?.unset).toBe(true);
    await run('PUT', '/settings/:key', ownerB, { key: 'hold_minutes', value: 10 });
    expect((await tdb.query(`select club_id, value from public.club_setting where key = 'hold_minutes' order by value`)).rows).toEqual([{ club_id: B, value: 10 }, { club_id: A, value: 20 }]);
  });
});
