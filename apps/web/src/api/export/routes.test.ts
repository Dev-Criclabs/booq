import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { createExportService, createMemoryStorage } from '@booq/domain';
import { exportRoutes } from './routes';

// F01-T32 export routes (PLAT-06-AC12, AC17; D14): owner only; no delete route exists.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const OWNER = '11111111-1111-4111-8111-111111111111';
const DESK = '22222222-2222-4222-8222-222222222222';
const deps = { hasFeature: async () => true };
let tdb: TestDatabase;
let db: Db;
let queued: { task: string; payload: unknown }[] = [];
const session = (userId: string, roles: string[]) => ({ clubId: A, userId, roles: roles as never });
const routes = () => exportRoutes({ db, service: () => createExportService({ storage: createMemoryStorage(), linkSeconds: 3600 }), enqueue: async (task, payload) => void queued.push({ task, payload }) });
const find = (r: ReturnType<typeof routes>, method: string, path: string) => r.find((x) => x.def.method === method && x.def.path === path)!;

beforeEach(async () => {
  queued = [];
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A')`, [A]);
  for (const [id, line, roles] of [[OWNER, 'L1', ['owner', 'player']], [DESK, 'L2', ['front_desk', 'player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [A, id, line]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [A, id, r]);
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

describe('export routes', () => {
  it('declares export.run on every route and has no delete route of any kind (AC17)', () => {
    const r = routes();
    expect(r.map((x) => `${x.def.method} ${x.def.path}`).sort()).toEqual(['GET /exports/:id', 'POST /exports']);
    for (const x of r) expect(x.def.permission).toBe('export.run');
  });
  it('front desk and guests are refused before the handler runs', async () => {
    const post = find(routes(), 'POST', '/exports');
    expect(await post.handle({ session: null, input: { kind: 'club' } }, deps)).toMatchObject({ ok: false, status: 401 });
    expect(await post.handle({ session: session(DESK, ['front_desk', 'player']), input: { kind: 'club' } }, deps)).toMatchObject({ ok: false, status: 403 });
    expect(queued).toEqual([]);
  });
  it('the owner starts an export and the worker is told by ids only', async () => {
    const res = await find(routes(), 'POST', '/exports').handle({ session: session(OWNER, ['owner', 'player']), input: { kind: 'customers' } }, deps);
    expect(res).toMatchObject({ ok: true, body: { status: 'requested', kind: 'customers', link: null } });
    const id = (res as { body: { id: string } }).body.id;
    expect(queued).toEqual([{ task: 'club_export', payload: { clubId: A, exportId: id } }]);
  });
  it('rejects a kind it does not know', async () => {
    expect(await find(routes(), 'POST', '/exports').handle({ session: session(OWNER, ['owner', 'player']), input: { kind: 'everything' } }, deps)).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
    expect(await find(routes(), 'GET', '/exports/:id').handle({ session: session(OWNER, ['owner', 'player']), input: { id: 'nope' } }, deps)).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
  });
  it('an unknown export is not found', async () => {
    expect(await find(routes(), 'GET', '/exports/:id').handle({ session: session(OWNER, ['owner', 'player']), input: { id: '99999999-9999-4999-8999-999999999999' } }, deps)).toMatchObject({ ok: false, status: 404, code: 'not_found' });
  });
});
