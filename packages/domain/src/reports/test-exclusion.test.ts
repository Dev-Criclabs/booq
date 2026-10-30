import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../db/src/tx';
import { createTestDatabase, type TestDatabase } from '../../../db/src/testing/harness';
import { reportModules } from './registry';

// F01-T29 CI harness (PLAT-07-AC7; D33): every registered report, run for a club that holds test rows in each
// table the report reads, returns zero. A report that reads a test table with no seeder here fails, so the author
// of the next report adds the seeder in the same change.
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const USER = '11111111-1111-4111-8111-111111111111';

type Seeder = (q: (sql: string, p?: unknown[]) => Promise<unknown>) => Promise<void>;
const SEEDERS: Record<string, Seeder> = {
  // app_user is flagged only for an account made through a tester invite (D100), so the flag is set by hand.
  app_user: async (q) => {
    await q(
      `with u as (insert into public.app_user (club_id, id, line_user_id, display_name, is_test) values ($1, $2, 'Utest', 'Test Tester', true) returning club_id, id)
       insert into public.app_user_role (club_id, user_id, role) select club_id, id, 'player' from u`,
      [CLUB, USER],
    );
  },
};

let tdb: TestDatabase;
let db: Db;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1, 'a', 'ก', 'A', 'testing')`, [CLUB]);
  db = createDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('test rows are never counted (PLAT-07-AC7, D33)', () => {
  it('every table a report reads is registered in app.test_tables', async () => {
    const reg = new Set((await tdb.query(`select table_name from app.test_tables`)).rows.map((r) => r.table_name as string));
    for (const m of reportModules()) for (const t of m.reads) expect(reg.has(t), `${m.name} reads ${t}`).toBe(true);
  });

  it('at least one report is registered', () => {
    expect(reportModules().length).toBeGreaterThan(0);
  });

  for (const m of reportModules()) {
    it(`${m.name} returns zero over seeded test rows`, async () => {
      for (const t of m.reads) {
        const seed = SEEDERS[t];
        expect(seed, `${m.name} reads ${t}: add a seeder for it in test-exclusion.test.ts`).toBeDefined();
        await seed!((sql, p) => tdb.query(sql, p));
      }
      const n = await db.withClubTx({ clubId: CLUB, userId: null, roles: ['owner'], source: 'job', actorLabel: 'report_harness' }, (tx) => m.run(tx));
      expect(n).toBe(0);
    });
  }

  it('the harness can fail: a report that forgets the helper counts the test row', async () => {
    await SEEDERS.app_user!((s, p) => tdb.query(s, p));
    const bad = { run: async (tx: { query(s: string): Promise<{ rows: unknown[] }> }) => (await tx.query('select id from public.app_user')).rows.length };
    const n = await db.withClubTx({ clubId: CLUB, userId: null, roles: ['owner'], source: 'job', actorLabel: 'report_harness' }, (tx) => bad.run(tx));
    expect(n).toBe(1);
  });
});
