import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { createClaimService } from '@booq/domain';
import { claimRoutes } from './routes';

// F01-T31b claim routes (PLAT-06-AC7; D105): front desk and owner only.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const DESK = '22222222-2222-4222-8222-222222222222';
const NEW1 = '33333333-3333-4333-8333-333333333333';
const IMPORTED = 'a1a1a1a1-0000-4000-8000-000000000001';
const deps = { hasFeature: async () => true };
let tdb: TestDatabase;
let db: Db;
let reqId: string;
const session = (userId: string, roles: string[]) => ({ clubId: A, userId, roles: roles as never });
const routes = () => claimRoutes({ db, service: () => createClaimService() });
const find = (method: string, path: string) => routes().find((r) => r.def.method === method && r.def.path === path)!;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A')`, [A]);
  for (const [id, line, roles] of [[DESK, 'L2', ['front_desk', 'player']], [NEW1, 'L3', ['player']]] as const) {
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
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, full_name, phone, phone_normalized, claim_state) values ($1,$2,'Somchai Imported','+66812345678','66812345678','unclaimed')`, [A, IMPORTED]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, IMPORTED]);
    await c.query('commit');
  } finally {
    c.release();
  }
  db = createDb({ connectionString: tdb.url, max: 2 });
  await db.withClubTx({ clubId: A, userId: NEW1, roles: ['player'], source: 'player_app' }, (tx) => tx.query(`select app.request_claim($1, 'Somchai J.', '0812345678', '66812345678')`, [NEW1]));
  reqId = (await tdb.query('select id from public.claim_request')).rows[0].id;
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('claim routes', () => {
  it('declare claim.handle on every route', () => {
    expect(routes().map((r) => `${r.def.method} ${r.def.path} ${r.def.permission}`).sort()).toEqual([
      'GET /claims claim.handle',
      'POST /claims/:id/confirm claim.handle',
      'POST /claims/:id/reject claim.handle',
    ]);
  });
  it('a player, including the claimant, is refused before the handler runs', async () => {
    const s = session(NEW1, ['player']);
    expect(await find('GET', '/claims').handle({ session: s, input: {} }, deps)).toMatchObject({ ok: false, status: 403 });
    expect(await find('POST', '/claims/:id/confirm').handle({ session: s, input: { id: reqId } }, deps)).toMatchObject({ ok: false, status: 403 });
  });
  it('front desk lists, then confirms; a second confirm is a 409', async () => {
    const s = session(DESK, ['front_desk', 'player']);
    expect(await find('GET', '/claims').handle({ session: s, input: {} }, deps)).toMatchObject({ ok: true, body: [{ id: reqId, importedFullName: 'Somchai Imported', typedFullName: 'Somchai J.' }] });
    expect(await find('POST', '/claims/:id/confirm').handle({ session: s, input: { id: reqId } }, deps)).toMatchObject({ ok: true, body: { status: 'confirmed' } });
    expect(await find('POST', '/claims/:id/confirm').handle({ session: s, input: { id: reqId } }, deps)).toMatchObject({ ok: false, status: 409, code: 'not_open' });
    expect((await tdb.query('select merged_into from public.app_user where id = $1', [IMPORTED])).rows[0].merged_into).toBe(NEW1);
  });
  it('reject leaves the record unclaimed; a bad id is a 400', async () => {
    const s = session(DESK, ['front_desk', 'player']);
    expect(await find('POST', '/claims/:id/reject').handle({ session: s, input: { id: reqId } }, deps)).toMatchObject({ ok: true, body: { status: 'rejected' } });
    expect((await tdb.query('select claim_state from public.app_user where id = $1', [IMPORTED])).rows[0].claim_state).toBe('unclaimed');
    expect(await find('POST', '/claims/:id/reject').handle({ session: s, input: { id: 'x' } }, deps)).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
  });
});
