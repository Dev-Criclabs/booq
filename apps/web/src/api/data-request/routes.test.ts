import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { createDataRequestService } from '@booq/domain';
import { dataRequestRoutes } from './routes';

// F01-T33 staff routes for data requests (PDPA-01-AC4, AC6, AC7).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const DESK = '22222222-2222-4222-8222-222222222222';
const P1 = '33333333-3333-4333-8333-333333333333';
const REQ = 'dddddddd-0000-4000-8000-000000000001';
const deps = { hasFeature: async () => true };
let tdb: TestDatabase;
let db: Db;
const session = (userId: string, roles: string[]) => ({ clubId: A, userId, roles: roles as never });
const routes = () => dataRequestRoutes({ db, service: () => createDataRequestService() });
const find = (method: string, path: string) => routes().find((r) => r.def.method === method && r.def.path === path)!;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A')`, [A]);
  for (const [id, line, roles] of [[DESK, 'L2', ['front_desk', 'player']], [P1, 'L3', ['player']]] as const) {
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
  await tdb.query(`insert into public.data_request (club_id, id, user_id, kind) values ($1,$2,$3,'copy')`, [A, REQ, P1]);
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('data request staff routes', () => {
  it('declare datarequest.handle on every route', () => {
    expect(routes().map((r) => `${r.def.method} ${r.def.path} ${r.def.permission}`).sort()).toEqual(['GET /data-requests datarequest.handle', 'POST /data-requests/:id/handle datarequest.handle']);
  });
  it('a player is refused before the handler runs', async () => {
    expect(await find('GET', '/data-requests').handle({ session: session(P1, ['player']), input: {} }, deps)).toMatchObject({ ok: false, status: 403 });
  });
  it('front desk lists and handles', async () => {
    const s = session(DESK, ['front_desk', 'player']);
    expect(await find('GET', '/data-requests').handle({ session: s, input: {} }, deps)).toMatchObject({ ok: true, body: [{ id: REQ, kind: 'copy', status: 'requested' }] });
    expect(await find('POST', '/data-requests/:id/handle').handle({ session: s, input: { id: REQ, action: 'done' } }, deps)).toMatchObject({ ok: true, body: { status: 'done', handledBy: DESK } });
    expect(await find('POST', '/data-requests/:id/handle').handle({ session: s, input: { id: REQ, action: 'start' } }, deps)).toMatchObject({ ok: false, status: 409, code: 'bad_transition' });
  });
  it('rejects a bad action or id', async () => {
    const s = session(DESK, ['front_desk', 'player']);
    expect(await find('POST', '/data-requests/:id/handle').handle({ session: s, input: { id: REQ, action: 'erase' } }, deps)).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
    expect(await find('POST', '/data-requests/:id/handle').handle({ session: s, input: { id: 'x', action: 'done' } }, deps)).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
  });
});
