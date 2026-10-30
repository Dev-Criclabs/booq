import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F01-T15: the accountant sees names, not contact details (D35; ROLE-AC2).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const ACC = '11111111-1111-4111-8111-111111111111';
const PLAYER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

let tdb: TestDatabase;
let db: Db;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A'), ($2,'b','ข','B')`, [A, B]);
  for (const [club, id, line, name, roles] of [
    [A, ACC, 'L1', 'Acc', ['accountant', 'player']],
    [A, PLAYER, 'L2', 'Pim', ['player']],
    [B, OTHER, 'L3', 'Other', ['player']],
  ] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id, display_name) values ($1,$2,$3,$4)', [club, id, line, name]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, id, r]);
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
const as = (roles: string[], user: string, club = A) => ({ clubId: club, userId: user, roles });

describe('app_user_names (D35)', () => {
  it('an accountant reads every name in the club through the view', async () => {
    const r = await db.withClubTx(as(['accountant', 'player'], ACC), (t) => t.query('select display_name from public.app_user_names order by display_name'));
    expect(r.rows.map((x) => x.display_name)).toEqual(['Acc', 'Pim']);
  });
  it('the same accountant cannot read other people from app_user, only their own row', async () => {
    const r = await db.withClubTx(as(['accountant', 'player'], ACC), (t) => t.query('select id from public.app_user'));
    expect(r.rows).toEqual([{ id: ACC }]);
  });
  it('the view exposes only club, id and the two names: no contact or identity column', async () => {
    const cols = (await tdb.query(`select column_name from information_schema.columns where table_name = 'app_user_names' order by ordinal_position`)).rows.map((x) => x.column_name);
    expect(cols).toEqual(['club_id', 'id', 'display_name', 'full_name']); // F02 (0101) appended full_name
  });
  it('owner and front desk read names too; a plain player or a coach reads none', async () => {
    for (const roles of [['owner', 'player'], ['front_desk', 'player']]) {
      expect((await db.withClubTx(as(roles, PLAYER), (t) => t.query('select 1 from public.app_user_names'))).rowCount, roles.join()).toBe(2);
    }
    for (const roles of [['player'], ['coach', 'player']]) {
      expect((await db.withClubTx(as(roles, PLAYER), (t) => t.query('select 1 from public.app_user_names'))).rowCount, roles.join()).toBe(0);
    }
  });
  it('is filtered by club and fails closed with no context', async () => {
    expect((await db.withClubTx(as(['accountant'], OTHER, B), (t) => t.query('select display_name from public.app_user_names'))).rows).toEqual([{ display_name: 'Other' }]); // only its own club
    const c = await tdb.pool.connect();
    try {
      await c.query('set role booq_app');
      expect((await c.query('select 1 from public.app_user_names')).rowCount).toBe(0);
    } finally {
      c.release();
    }
  });
  it('is not readable by the platform role or the worker', async () => {
    for (const role of ['booq_platform', 'booq_worker']) {
      expect((await tdb.query('select has_table_privilege($1, $2, $3) as ok', [role, 'public.app_user_names', 'select'])).rows[0].ok, role).toBe(false);
    }
  });
});
