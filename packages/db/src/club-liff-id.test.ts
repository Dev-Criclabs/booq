import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F10 / migration 0612: app.club_liff_id, the club's LIFF id for the message buttons (F10 design 5.6; D6, CC-1).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
let tdb: TestDatabase;
let wk: Db;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.line_connection (club_id, liff_id) values ($1, '2012300015-WIi1jtLB')`, [A]);
  wk = createDb({ connectionString: tdb.url, max: 1, role: 'booq_worker' });
});
afterEach(async () => {
  await wk?.end();
  await tdb?.close();
});
const liff = (club: string) => wk.withClubTx({ clubId: club, userId: null, roles: [] as never, source: 'job' as const },
  async (tx) => (await tx.query<{ l: string | null }>('select app.club_liff_id() as l')).rows[0]!.l);

describe('club_liff_id', () => {
  it('gives the LIFF id of the club in the context only, or null when it has none', async () => {
    expect(await liff(A)).toBe('2012300015-WIi1jtLB');
    expect(await liff(B)).toBeNull();
  });

  it('the worker reads nothing else of line_connection; only the worker runs it', async () => {
    await expect(wk.withClubTx({ clubId: A, userId: null, roles: [] as never, source: 'job' as const }, (tx) => tx.query('select * from public.line_connection')))
      .rejects.toThrow(/permission denied/);
    const r = await tdb.query(`select has_function_privilege('booq_app', 'app.club_liff_id()', 'execute') as app, has_function_privilege('booq_platform', 'app.club_liff_id()', 'execute') as plat`);
    expect(r.rows[0]).toEqual({ app: false, plat: false });
  });
});
