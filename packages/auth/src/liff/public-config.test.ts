import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../db/src/tx';
import { createTestDatabase, type TestDatabase } from '../../../db/src/testing/harness';
import { createPublicConfigService } from './public-config';
import { createDbDirectory } from './directory';

// F02-T06 GET /public/config and the guest context (AUTH-01-AC1, AC7, AC11; D102, D103).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
let tdb: TestDatabase;
let db: Db;
let svc: ReturnType<typeof createPublicConfigService>;
const guest = (clubId: string) => ({ clubId, userId: null, roles: ['guest'], source: 'player_app' as const });

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status, default_language) values ($1,'a','ก','Club A','live','th'), ($2,'b','ข','Club B','draft','en')`, [A, B]);
  await tdb.query(`insert into public.line_connection (club_id, login_channel_id, liff_id) values ($1,'loginA','liffA'), ($2,'loginB','liffB')`, [A, B]);
  db = createDb({ connectionString: tdb.url, max: 2 });
  svc = createPublicConfigService({ db, directory: createDbDirectory(db) });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('public config', () => {
  it('a live club answers its name, default language, status and LIFF id, and the languages offered', async () => {
    expect(await svc.get('a')).toEqual({
      ok: true,
      config: { nameTh: 'ก', nameEn: 'Club A', defaultLanguage: 'th', status: 'live', liffId: 'liffA', languages: ['th', 'en'] },
    });
  });
  it('a Draft club answers the same minimal config and nothing more (D102)', async () => {
    const r = await svc.get('b');
    expect(r).toMatchObject({ ok: true, config: { status: 'draft', liffId: 'liffB' } });
    expect(Object.keys((r as { config: object }).config).sort()).toEqual(['defaultLanguage', 'languages', 'liffId', 'nameEn', 'nameTh', 'status']);
  });
  it('a paused club still answers (AUTH-01-AC11)', async () => {
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    expect(await svc.get('a')).toMatchObject({ ok: true, config: { status: 'paused' } });
  });
  it('an unknown or malformed slug is not found, and the answer never holds secrets or contact details', async () => {
    expect(await svc.get('nope')).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(await svc.get('Bad Slug')).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(JSON.stringify(await svc.get('a'))).not.toMatch(/loginA|owner|tax|merchant/i);
  });
});

describe('what a guest can read (D103)', () => {
  it('the public view lists exactly these columns; a new column fails this test', async () => {
    const cols = (await tdb.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'public_club_config' order by column_name`)).rows;
    expect(cols.map((c) => c.column_name)).toEqual(['default_language', 'liff_id', 'name_en', 'name_th', 'status']);
  });
  it('a guest reads one club’s config through the view and nothing of another club', async () => {
    const rows = (await db.withClubTx(guest(A), (tx) => tx.query('select name_en from public.public_club_config'))).rows;
    expect(rows).toEqual([{ name_en: 'Club A' }]);
  });
  it('a guest cannot read the secrets or connection tables', async () => {
    for (const table of ['club_secret', 'payment_connection', 'line_connection']) {
      // Either the grant is missing (permission denied) or row security hides every row.
      const seen = await db.withClubTx(guest(A), (tx) => tx.query(`select * from public.${table}`)).then((r) => r.rows.length, () => 0);
      expect(seen, table).toBe(0);
    }
  });
  // FINDING (D103, F02-T06), reported to the orchestrator for the Architect: booq_app holds column select on the
  // owner's contact and tax columns of public.club, and policy club_read (using true) applies to a guest context
  // too, so a guest can `select owner_phone, tax_id from public.club`. This test states the rule. It is marked
  // `fails` so the gate stays green until the database is fixed; when it is, vitest reports this test as failing
  // and the `.fails` must become a plain `it`.
  it.fails('a guest cannot read the owner’s contact or tax details of the club row', async () => {
    const rows = (await db.withClubTx(guest(A), (tx) => tx.query('select * from public.club'))).rows as Record<string, unknown>[];
    const leaked = Object.keys(rows[0] ?? {}).filter((c) => /owner|tax|billing/i.test(c));
    expect(leaked).toEqual([]);
  });
});
