import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { addOnRoutes } from './routes';

// C10 add-ons (F04 R3-AC1, AC4): active and priced only; a signed in person reads them.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const P = '22222222-2222-4222-8222-222222222222';
const deps = { hasFeature: async () => true };
let tdb: TestDatabase;
let db: Db;
const get = (session: { clubId: string; userId: string; roles: ('player')[] } | null) => addOnRoutes({ db })[0]!.handle({ session, input: {} }, deps) as Promise<{ ok: boolean; status: number; body?: any }>;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,'L')`, [A, P]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, P]);
    await c.query('commit');
  } finally {
    c.release();
  }
  await tdb.query(`insert into public.add_on (club_id, name_th, name_en, price_satang, active, position) values ($1,'ลูก','Balls',10000,true,1), ($1,'ผ้า','Towel',null,true,2), ($1,'น้ำ','Water',2000,false,3), ($1,'ไม้','Racket',30000,true,0), ($2,'x','Other club',100,true,0)`, [A, B]);
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('GET /add-ons', () => {
  it('lists the active add-ons that have a price, in order, for this club only', async () => {
    const r = await get({ clubId: A, userId: P, roles: ['player'] });
    expect(r.ok).toBe(true);
    expect(r.body.map((x: { nameEn: string }) => x.nameEn)).toEqual(['Racket', 'Balls']);
    expect(r.body[0]).toEqual({ id: expect.any(String), nameTh: 'ไม้', nameEn: 'Racket', priceSatang: 30000 });
  });
  it('a guest signs in first', async () => {
    expect(await get(null)).toMatchObject({ ok: false, status: 401 });
  });
});
