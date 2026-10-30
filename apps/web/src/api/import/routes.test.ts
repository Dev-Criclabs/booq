import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { createImportService, normalizePhone } from '@booq/domain';
import { importRoutes } from './routes';

// F01-T31 import routes (PLAT-06-AC1 to AC8; design 5 and 7.4): owner only, thin handlers over the service.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const OWNER = '11111111-1111-4111-8111-111111111111';
const DESK = '22222222-2222-4222-8222-222222222222';
const GOOD = 'full_name,phone\nSomchai Jaidee,0812345678\n';
const deps = { hasFeature: async () => true };

let tdb: TestDatabase;
let db: Db;
const session = (userId: string, roles: string[]) => ({ clubId: A, userId, roles: roles as never });
const find = (routes: ReturnType<typeof importRoutes>, method: string, path: string) => routes.find((r) => r.def.method === method && r.def.path === path)!;

beforeEach(async () => {
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
const routes = (limits: { maxRows: number; stagingHours: number } | null = { maxRows: 100, stagingHours: 24 }) =>
  importRoutes({ db, limits, service: (l) => createImportService({ limits: l, today: () => '2026-10-30', normalizePhone }) });

describe('import routes', () => {
  it('every route declares import.run (owner only) and no club id travels in the input', () => {
    const r = routes();
    expect(r.map((x) => `${x.def.method} ${x.def.path}`).sort()).toEqual(['DELETE /imports/:id', 'GET /imports/:id', 'POST /imports', 'POST /imports/:id/confirm']);
    for (const x of r) expect(x.def.permission).toBe('import.run');
  });

  it('refuses a guest, a front desk and any role but the owner before the handler runs (PLAT-06-AC8)', async () => {
    const post = find(routes(), 'POST', '/imports');
    expect(await post.handle({ session: null, input: {} }, deps)).toMatchObject({ ok: false, status: 401 });
    expect(await post.handle({ session: session(DESK, ['front_desk', 'player']), input: { kind: 'players', fileName: 'p.csv', content: GOOD } }, deps)).toMatchObject({ ok: false, status: 403, code: 'forbidden' });
    expect((await tdb.query('select count(*)::int n from public.import_job')).rows[0].n).toBe(0);
  });

  it('upload, read, confirm: the owner imports players', async () => {
    const r = routes();
    const s = session(OWNER, ['owner', 'player']);
    const up = await find(r, 'POST', '/imports').handle({ session: s, input: { kind: 'players', fileName: 'p.csv', content: GOOD } }, deps);
    expect(up).toMatchObject({ ok: true, body: { status: 'validated', rowsRead: 1 } });
    const id = (up as { body: { id: string } }).body.id;
    expect(await find(r, 'GET', '/imports/:id').handle({ session: s, input: { id } }, deps)).toMatchObject({ ok: true, body: { id, status: 'validated' } });
    expect(await find(r, 'POST', '/imports/:id/confirm').handle({ session: s, input: { id } }, deps)).toMatchObject({ ok: true, body: { status: 'confirmed', rowsSaved: 1 } });
    expect(await find(r, 'POST', '/imports/:id/confirm').handle({ session: s, input: { id } }, deps)).toMatchObject({ ok: false, status: 409, code: 'not_confirmable' });
  });

  it('a file with an error answers 200 with the error report and saves nothing', async () => {
    const s = session(OWNER, ['owner', 'player']);
    const up = await find(routes(), 'POST', '/imports').handle({ session: s, input: { kind: 'players', fileName: 'p.csv', content: 'full_name,phone\n,0812345678\n' } }, deps);
    expect(up).toMatchObject({ ok: true, body: { status: 'failed', errors: [{ rowNo: 2, codes: ['name_missing'] }] } });
    expect((await tdb.query('select count(*)::int n from public.app_user where line_user_id is null')).rows[0].n).toBe(0);
  });

  it('typed errors map to statuses, never text', async () => {
    const r = routes();
    const s = session(OWNER, ['owner', 'player']);
    const missing = '99999999-9999-4999-8999-999999999999';
    expect(await find(r, 'GET', '/imports/:id').handle({ session: s, input: { id: missing } }, deps)).toMatchObject({ ok: false, status: 404, code: 'not_found' });
    expect(await find(r, 'POST', '/imports').handle({ session: s, input: { kind: 'balances', fileName: 'b.csv', content: GOOD } }, deps)).toMatchObject({ ok: false, status: 400, code: 'kind_not_available' });
    expect(await find(r, 'POST', '/imports').handle({ session: s, input: { kind: 'players' } }, deps)).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
    expect(await find(r, 'GET', '/imports/:id').handle({ session: s, input: { id: 'not-a-uuid' } }, deps)).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
  });

  it('with no limits configured the import is refused: no value is invented', async () => {
    const s = session(OWNER, ['owner', 'player']);
    expect(await find(routes(null), 'POST', '/imports').handle({ session: s, input: { kind: 'players', fileName: 'p.csv', content: GOOD } }, deps)).toMatchObject({ ok: false, status: 503, code: 'import_not_configured' });
  });

  it('cancel removes the staging', async () => {
    const r = routes();
    const s = session(OWNER, ['owner', 'player']);
    const up = (await find(r, 'POST', '/imports').handle({ session: s, input: { kind: 'players', fileName: 'p.csv', content: GOOD } }, deps)) as { body: { id: string } };
    expect(await find(r, 'DELETE', '/imports/:id').handle({ session: s, input: { id: up.body.id } }, deps)).toMatchObject({ ok: true, body: { status: 'cancelled' } });
    expect((await tdb.query('select count(*)::int n from public.import_row')).rows[0].n).toBe(0);
  });
});
