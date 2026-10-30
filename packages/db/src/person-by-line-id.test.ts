import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F02 sign-in, lane D request / migration 0023: app.person_by_line_id(line id) for the club in context.
// A row only for an ordinary person (claim_state null); never for an import or a merged duplicate.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const LINE = 'U' + 'a'.repeat(32);
let tdb: TestDatabase;
let db: Db;

const find = (club: string, line: string) =>
  db.withClubTx({ clubId: club, userId: null, roles: [], source: 'player_app' }, async (tx) => (await tx.query(`select * from app.person_by_line_id($1)`, [line])).rows);

beforeEach(async () => {
  tdb = await createTestDatabase();
  db = createDb({ connectionString: tdb.url, max: 1 });
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1, 'a', 'ก', 'A'), ($2, 'b', 'ข', 'B')`, [A, B]);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (id, club_id, line_user_id, display_name) values ($1, $2, $3, 'Nok')`, [U1, A, LINE]);
    await c.query(`insert into public.app_user (id, club_id, line_user_id, display_name, active) values ($1, $2, $3, 'Off', false)`, [U2, A, 'U' + 'b'.repeat(32)]);
    await c.query(`insert into public.app_user (id, club_id, line_user_id, display_name, claim_state, merged_into) values ($1, $2, $3, 'Gone', 'merged', $4)`, [U3, A, 'U' + 'c'.repeat(32), U1]);
    for (const u of [U1, U2, U3]) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1, $2, 'player')`, [A, u]);
    await c.query('commit');
  } finally {
    c.release();
  }
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('app.person_by_line_id', () => {
  it('returns id, active and claim_state for an ordinary person', async () => {
    expect(await find(A, LINE)).toEqual([{ id: U1, active: true, claim_state: null }]);
  });

  it('an inactive person is still returned, so sign-in can say the account is inactive', async () => {
    expect(await find(A, 'U' + 'b'.repeat(32))).toEqual([{ id: U2, active: false, claim_state: null }]);
  });

  it('nothing for a merged person, an unknown id, or another club’s person', async () => {
    expect(await find(A, 'U' + 'c'.repeat(32))).toEqual([]);
    expect(await find(A, 'U' + 'd'.repeat(32))).toEqual([]);
    expect(await find(B, LINE)).toEqual([]);
  });

  it('nothing for an anonymised person, whose LINE id is replaced', async () => {
    await tdb.query(`update public.app_user set line_user_id = 'erased:' || id, active = false where id = $1`, [U1]);
    expect(await find(A, LINE)).toEqual([]);
  });

  it('is refused without a club in the context and to every role but booq_app', async () => {
    for (const role of ['booq_worker', 'booq_platform', 'booq_audit', 'booq_anonymiser', 'booq_purge']) {
      expect((await tdb.query('select has_function_privilege($1, $2, $3) as ok', [role, 'app.person_by_line_id(text)', 'execute'])).rows[0].ok, role).toBe(false);
    }
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role booq_app');
      await expect(c.query(`select * from app.person_by_line_id('${LINE}')`)).resolves.toMatchObject({ rows: [] });
      await c.query('rollback');
    } finally {
      c.release();
    }
  });
});
