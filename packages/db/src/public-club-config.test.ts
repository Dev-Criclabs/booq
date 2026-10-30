import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F02 sign-in, D102 and D103 / migration 0024: public.public_club_config, the minimal sign-in config a guest reads.
// Named columns only; the club in the context only; shown in every status so liff.init can run in Draft and Testing.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
let tdb: TestDatabase;
let db: Db;

const config = (club: string, roles: string[] = ['guest']) =>
  db.withClubTx({ clubId: club, userId: null, roles: roles as never, source: 'player_app' }, async (tx) => (await tx.query('select * from public.public_club_config')).rows);

beforeEach(async () => {
  tdb = await createTestDatabase();
  db = createDb({ connectionString: tdb.url, max: 1 });
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status, default_language, tax_id, registered_address, owner_phone) values ($1, 'a', 'ฮันเตอร์', 'Hunter', 'testing', 'th', '0135569018041', 'secret street', '0812345678'), ($2, 'b', 'ข', 'B', 'live', 'en', null, null, null)`, [A, B]);
  await tdb.query(`insert into public.line_connection (club_id, login_channel_id, liff_id, messaging_channel_id, oa_basic_id) values ($1, '1650000001', '1650000001-AbCdEfGh', 'msg-1', '@hunter')`, [A]);
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('public_club_config', () => {
  it('shows the context club’s name, language, status and LIFF id, even while the club is in Testing', async () => {
    expect(await config(A)).toEqual([{ name_th: 'ฮันเตอร์', name_en: 'Hunter', default_language: 'th', status: 'testing', liff_id: '1650000001-AbCdEfGh' }]);
  });

  it('is one row for the context club only, and liff_id is empty when no LINE connection exists', async () => {
    expect(await config(B)).toEqual([{ name_th: 'ข', name_en: 'B', default_language: 'en', status: 'live', liff_id: null }]);
  });

  it('has no column for owner, tax, billing, channel ids, secrets or the club id (D103)', async () => {
    const cols = (await tdb.query(`select column_name from information_schema.columns where table_name = 'public_club_config' order by ordinal_position`)).rows.map((x) => x.column_name);
    expect(cols).toEqual(['name_th', 'name_en', 'default_language', 'status', 'liff_id']);
  });

  it('a request with no club in the context sees nothing, and the view is granted to the app roles only', async () => {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role booq_app');
      expect((await c.query('select * from public.public_club_config')).rowCount).toBe(0);
      await c.query('rollback');
    } finally {
      c.release();
    }
    for (const role of ['booq_platform', 'booq_audit', 'booq_anonymiser', 'booq_purge']) {
      expect((await tdb.query(`select has_table_privilege($1, 'public.public_club_config', 'select') as ok`, [role])).rows[0].ok, role).toBe(false);
    }
  });
});
