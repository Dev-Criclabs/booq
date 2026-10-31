import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { createMemoryStorage } from '@booq/domain';
import { createWebTable, type ExportRuntime } from '../../server/context';

// The export routes in the web table (F01-T25; PLAT-06-AC11, AC12, AC17): mounted for the owner, 503 until the storage and the queue are
// given, and never a request left behind that nothing builds. The route logic itself is in routes.test.ts.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const OWNER = '11111111-1111-4111-8111-111111111111';
const DESK = '22222222-2222-4222-8222-222222222222';
const deps = { hasFeature: async () => true };
let tdb: TestDatabase;
let db: Db;
let queued: Array<{ task: string; payload: unknown }>;
const sess = (userId: string, roles: string[]) => ({ clubId: A, userId, roles: roles as never });
const exportsRuntime = (): ExportRuntime => ({ storage: createMemoryStorage(), linkSeconds: 3600, enqueue: async (task, payload) => void queued.push({ task, payload }) });
const table = (exports: ExportRuntime | null) =>
  createWebTable({ db, verifier: { verifyIdToken: async () => ({ ok: false as const, code: 'offline' as const }) }, now: () => new Date('2026-12-07T03:00:00Z'), config: { sessionSeconds: 60, maxBodyBytes: 1000, importLimits: null, exports } }).table;
const run = (t: ReturnType<typeof table>, m: string, p: string, session: ReturnType<typeof sess> | null, input: Record<string, unknown> = {}) =>
  t.find((r) => r.def.method === m && r.def.path === p)!.handle({ session, input }, deps);
const rows = async () => (await tdb.query(`select count(*)::int as n from public.data_export`)).rows[0].n as number;

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

describe('export routes are mounted', () => {
  it('the web table holds both routes with the owner permission, and no delete route (PLAT-06-AC17)', () => {
    const all = table(null).map((r) => `${r.def.method} ${r.def.path} ${r.def.permission}`);
    expect(all).toContain('POST /exports export.run');
    expect(all).toContain('GET /exports/:id export.run');
    expect(all.filter((r) => /exports/.test(r) && r.startsWith('DELETE'))).toEqual([]);
  });

  it('without storage and a queue both routes answer 503 export_not_configured and nothing is written', async () => {
    const t = table(null);
    expect(await run(t, 'POST', '/exports', sess(OWNER, ['owner', 'player']), { kind: 'club' })).toMatchObject({ ok: false, status: 503, code: 'export_not_configured' });
    expect(await run(t, 'GET', '/exports/:id', sess(OWNER, ['owner', 'player']), { id: '99999999-9999-4999-8999-999999999999' })).toMatchObject({ ok: false, status: 503 });
    expect(await rows()).toBe(0);
    expect(queued).toEqual([]);
  });

  it('with them, the owner starts an export, the worker job is added with ids only, and front desk and guests are refused', async () => {
    const t = table(exportsRuntime());
    const started = (await run(t, 'POST', '/exports', sess(OWNER, ['owner', 'player']), { kind: 'club' })) as { ok: boolean; body: { id: string; status: string; link: string | null } };
    expect(started).toMatchObject({ ok: true, body: { status: 'requested', link: null } });
    expect(queued).toEqual([{ task: 'club_export', payload: { clubId: A, exportId: started.body.id } }]);
    expect(await run(t, 'GET', '/exports/:id', sess(OWNER, ['owner', 'player']), { id: started.body.id })).toMatchObject({ ok: true, body: { id: started.body.id, status: 'requested' } });
    expect(await run(t, 'POST', '/exports', sess(DESK, ['front_desk', 'player']), { kind: 'club' })).toMatchObject({ ok: false, status: 403 });
    expect(await run(t, 'POST', '/exports', null, { kind: 'club' })).toMatchObject({ ok: false, status: 401 });
    expect(await rows()).toBe(1);
  });
});
