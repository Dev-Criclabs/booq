import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../db/src/tx';
import { createTestDatabase, type TestDatabase } from '../../../db/src/testing/harness';
import { isoWeekday, listActiveResources, openingHoursFor, resourceBookable } from './resources';

// F03-T04: opening hours and resource reader (BOOK-01-AC3, AC9). Real Postgres.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const USER = '11111111-2222-4333-8444-555555555555';
const LOC_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const LOC_B = 'bbbbbbbb-0000-4000-8000-000000000001';
const C1 = 'c1c1c1c1-0000-4000-8000-000000000001';
const C2 = 'c2c2c2c2-0000-4000-8000-000000000002';
const CB = 'cbcbcbcb-0000-4000-8000-000000000003';

let tdb: TestDatabase;
let db: Db;
const ctx = (clubId: string) => ({ clubId, userId: USER, roles: ['player'], requestId: 'r1' });

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'club-a','ก','A'), ($2,'club-b','ข','B')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main'), ($3,$4,'Main')`, [A, LOC_A, B, LOC_B]);
  await tdb.query(
    `insert into public.resource (club_id, id, location_id, name, sport, active) values
     ($1,$2,$3,'1','tennis',true), ($1,$4,$3,'2','tennis',false), ($5,$6,$7,'1','tennis',true)`,
    [A, C1, LOC_A, C2, B, CB, LOC_B],
  );
  // Club A: Monday to Saturday 06:00 to 24:00, Sunday 08:00 to 20:00. Club B: Monday 10:00 to 12:00.
  for (let d = 1; d <= 6; d += 1) {
    await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [A, d]);
  }
  await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,7,'08:00','20:00'), ($2,1,'10:00','12:00')`, [A, B]);
  db = createDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('isoWeekday', () => {
  it('1 is Monday and 7 is Sunday, by the Bangkok date given', () => {
    expect(isoWeekday('2026-11-02')).toBe(1);
    expect(isoWeekday('2026-11-08')).toBe(7);
  });
});

describe('openingHoursFor (BOOK-01-AC3)', () => {
  it('hours differ by weekday and 24:00 reads as 24:00', async () => {
    const mon = await db.withClubTx(ctx(A), (tx) => openingHoursFor(tx, '2026-11-02'));
    const sun = await db.withClubTx(ctx(A), (tx) => openingHoursFor(tx, '2026-11-08'));
    expect(mon).toEqual({ open: '06:00', close: '24:00' });
    expect(sun).toEqual({ open: '08:00', close: '20:00' });
  });

  it('a weekday without a row is closed (null)', async () => {
    await tdb.query(`delete from public.opening_hours where club_id = $1 and weekday = 3`, [A]);
    expect(await db.withClubTx(ctx(A), (tx) => openingHoursFor(tx, '2026-11-04'))).toBeNull();
  });

  it("another club's hours are never read (CC-1)", async () => {
    expect(await db.withClubTx(ctx(B), (tx) => openingHoursFor(tx, '2026-11-02'))).toEqual({ open: '10:00', close: '12:00' });
    expect(await db.withClubTx(ctx(B), (tx) => openingHoursFor(tx, '2026-11-03'))).toBeNull();
  });
});

describe('resources (BOOK-01-AC9)', () => {
  it('an inactive court is not offered', async () => {
    const list = await db.withClubTx(ctx(A), (tx) => listActiveResources(tx));
    expect(list.map((r) => r.id)).toEqual([C1]);
  });

  it('requests for an inactive court are refused', async () => {
    expect(await db.withClubTx(ctx(A), (tx) => resourceBookable(tx, C2))).toEqual({ ok: false, code: 'resource_inactive' });
    expect(await db.withClubTx(ctx(A), (tx) => resourceBookable(tx, C1))).toEqual({ ok: true });
  });

  it("another club's court and an unknown id are refused the same way", async () => {
    expect(await db.withClubTx(ctx(A), (tx) => resourceBookable(tx, CB))).toEqual({ ok: false, code: 'resource_inactive' });
    expect(await db.withClubTx(ctx(A), (tx) => resourceBookable(tx, 'deadbeef-0000-4000-8000-000000000000'))).toEqual({
      ok: false,
      code: 'resource_inactive',
    });
  });
});
