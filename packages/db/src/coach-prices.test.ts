import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F07-T11 / migration 0811: app.coach_prices() (COACH-02-AC1 to AC4, AC7; D120, D156).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const NOPRICE = 'e1e1e1e1-0000-4000-8000-000000000008';
const HIDDEN = 'e3e3e3e3-0000-4000-8000-000000000006';
const BCOACH = 'e2e2e2e2-0000-4000-8000-000000000007';
const ADULT = '55555555-5555-4555-8555-555555555551';
const KID = '55555555-5555-4555-8555-555555555552';
const TIER = '66666666-6666-4666-8666-666666666661';
const GADULT = '77777777-7777-4777-8777-777777777771';
const GSTUDENT = '77777777-7777-4777-8777-777777777772';
let tdb: TestDatabase;
let db: Db;

const as = (userId: string | null, club = A) => ({ clubId: club, userId, roles: (userId ? ['player'] : ['guest']) as never, source: 'player_app' as const });
const prices = async (userId: string | null) => {
  const rows = await db.withClubTx(as(userId), async (tx) => (await tx.query(`select * from app.coach_prices()`)).rows as { coach_id: string; price_satang: number | null }[]);
  return Object.fromEntries(rows.map((r) => [r.coach_id, r.price_satang]));
};

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, display_name, date_of_birth) values ($1,$2,'La','Adult','1990-05-05'), ($1,$3,'Lk','Kid','2012-05-05')`, [A, ADULT, KID]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player'), ($1,$3,'player')`, [A, ADULT, KID]);
    await c.query('commit');
  } finally {
    c.release();
  }
  await tdb.query(`insert into public.price_group (club_id, id, name_th, name_en, rule, position) values
    ($1,$2,'ผู้ใหญ่','Adult','{"min_age":18}',0), ($1,$3,'นักเรียน','Student','{"min_age":0,"max_age":17}',1)`, [A, GADULT, GSTUDENT]);
  await tdb.query(`insert into public.coach_tier (club_id, id, name_th, name_en) values ($1,$2,'ท','Tier')`, [A, TIER]);
  await tdb.query(`insert into public.coach_tier_price (club_id, tier_id, price_group_id, price_satang) values ($1,$2,$3,100000), ($1,$2,$4,60000)`, [A, TIER, GADULT, GSTUDENT]);
  for (const id of [COACH, NOPRICE, HIDDEN]) await tdb.seedCoach(A, id);
  await tdb.seedCoach(B, BCOACH);
  await tdb.query(`update public.coach set tier_id = $1 where id = $2`, [TIER, COACH]);
  await tdb.query(`update public.coach set published = true, profile_consent_at = app.now(), profile_consent_by = $2 where id = any($1) and club_id = $3`, [[COACH, NOPRICE], ADULT, A]);
  await tdb.query(`update public.coach set published = true, profile_consent_at = app.now(), profile_consent_by = id where id = $1`, [BCOACH]);
  db = createDb({ connectionString: tdb.url, max: 4 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('app.coach_prices', () => {
  it('gives the tier price of the caller group; a coach with no tier has no price (AC1, AC4)', async () => {
    expect(await prices(ADULT)).toEqual({ [COACH]: 100000, [NOPRICE]: null });
    expect(await prices(KID)).toEqual({ [COACH]: 60000, [NOPRICE]: null });
  });
  it("an override beats the tier price for that group only (AC3)", async () => {
    await tdb.query(`insert into public.coach_price_override (club_id, coach_id, price_group_id, price_satang) values ($1,$2,$3,150000)`, [A, COACH, GADULT]);
    expect(await prices(ADULT)).toMatchObject({ [COACH]: 150000 });
    expect(await prices(KID)).toMatchObject({ [COACH]: 60000 });
  });
  it('a guest reads the group with no upper age (D12)', async () => {
    expect(await prices(null)).toMatchObject({ [COACH]: 100000 });
  });
  it('a tier price left unset gives null', async () => {
    await tdb.query(`update public.coach_tier_price set price_satang = null where price_group_id = $1`, [GADULT]);
    expect(await prices(ADULT)).toMatchObject({ [COACH]: null });
  });
  it('lists only active published coaches of the club', async () => {
    await tdb.query(`update public.coach set active = false where id = $1`, [NOPRICE]);
    expect(Object.keys(await prices(ADULT))).toEqual([COACH]);
  });
  it('the override table shows a player no rows', async () => {
    await tdb.query(`insert into public.coach_price_override (club_id, coach_id, price_group_id, price_satang) values ($1,$2,$3,150000)`, [A, COACH, GADULT]);
    const r = await db.withClubTx(as(ADULT), (tx) => tx.query(`select * from public.coach_price_override`));
    expect(r.rowCount).toBe(0);
  });
});
