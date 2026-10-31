import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// Migration 0519: the saving on C9 (D173; PKG-02-AC9). saving = credits x the matching single price - the package price;
// no saving when that single price is unset or differs by day type, time or class.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const ADULT = 'a1a1a1a1-0000-4000-8000-000000000001';
const STUDENT = 'a1a1a1a1-0000-4000-8000-000000000002';
const TIER = 'b1b1b1b1-0000-4000-8000-000000000001';

let tdb: TestDatabase;
let web: Db;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  await tdb.query(`insert into public.price_group (club_id, id, name_th, name_en, rule, position) values
                   ($1,$2,'ผู้ใหญ่','Adult','{"min_age": 18}',0), ($1,$3,'นักเรียน','Student','{"max_age": 17}',1)`, [A, ADULT, STUDENT]);
  await tdb.query(`insert into public.coach_tier (club_id, id, name_th, name_en) values ($1,$2,'ท','Tier')`, [A, TIER]);
  web = createDb({ connectionString: tdb.url, max: 2 });
  await tdb.setNow('2027-01-05T03:00:00Z');
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});

const court = (group: string, price: number, dayType = 'any', peak = 'any') =>
  tdb.query(`insert into public.court_price_rule (club_id, price_group_id, day_type, peak, price_satang) values ($1,$2,$3,$4,$5)`, [A, group, dayType, peak, price]);
const tierPrice = (group: string, price: number | null) =>
  tdb.query(`insert into public.coach_tier_price (club_id, tier_id, price_group_id, price_satang) values ($1,$2,$3,$4)`, [A, TIER, group, price]);
async function groupClass(audience: 'adult' | 'student', dropIn: number | null, active = true, endedOn: string | null = null) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');   // fixture: no coach, court or creator rows needed
    await c.query(`insert into public.class_template (club_id, name_th, name_en, audience, coach_id, resource_id, weekday, start_time, min_players, max_players,
                                                      drop_in_price_satang, active, ended_on, created_by)
                   values ($1,'ก','G',$2,gen_random_uuid(),gen_random_uuid(),1,'18:00',4,6,$3,$4,$5,gen_random_uuid())`, [A, audience, dropIn, active, endedOn]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
const product = (creditType: string, credits: number, price: number, group: string | null = null, tier: string | null = null) =>
  tdb.query(`insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_satang, price_group_id, coach_tier_id)
             values ($1,'p','p',$2,$3,3,$4,$5,$6) returning id`, [A, creditType, credits, price, group, tier]).then((r) => r.rows[0].id as string);
const saving = async (id: string): Promise<number | null> =>
  web.withClubTx({ clubId: A, userId: null, roles: ['guest'] }, async (tx) => {
    const r = (await tx.query<{ saving_satang: number | null }>(`select saving_satang from public.public_package_product where id = $1`, [id])).rows[0];
    expect(r).toBeDefined();
    return r!.saving_satang;
  });

describe('court bundles (D173)', () => {
  it('10 x 500 - 4,500 = 500 baht when every group pays one court price; a bundle with no group takes the shared price', async () => {
    await court(ADULT, 50000);
    await court(STUDENT, 50000);
    expect(await saving(await product('court_hour', 10, 450000))).toBe(50000);
    expect(await saving(await product('court_hour', 20, 800000, ADULT))).toBe(200000);
  });
  it('a group bundle uses its own group; a no-group bundle has none when the groups differ', async () => {
    await court(ADULT, 50000);
    await court(STUDENT, 40000);
    expect(await saving(await product('court_hour', 10, 350000, STUDENT))).toBe(50000);
    expect(await saving(await product('court_hour', 10, 300000))).toBeNull();
  });
  it('a price that differs by day type is no saving; an equal weekday and weekend price is one', async () => {
    await court(ADULT, 50000, 'weekday');
    await court(ADULT, 60000, 'weekend');
    expect(await saving(await product('court_hour', 10, 450000, ADULT))).toBeNull();
    await court(STUDENT, 40000, 'weekday');
    await court(STUDENT, 40000, 'weekend');
    expect(await saving(await product('court_hour', 10, 350000, STUDENT))).toBe(50000);
  });
  it('an unset price is no saving: no rule at all, or a weekday rule with no weekend one', async () => {
    expect(await saving(await product('court_hour', 10, 450000, ADULT))).toBeNull();
    await court(ADULT, 50000, 'weekday');
    expect(await saving(await product('court_hour', 10, 450000, ADULT))).toBeNull();
  });
  it('a package that costs the same or more than singles shows no saving', async () => {
    await court(ADULT, 50000);
    expect(await saving(await product('court_hour', 10, 500000, ADULT))).toBeNull();
    expect(await saving(await product('court_hour', 10, 600000, ADULT))).toBeNull();
  });
});

describe('solo packs (D173)', () => {
  it('8 x the tier price for the group - the pack price; an unset tier price is no saving', async () => {
    await tierPrice(ADULT, 80000);
    await tierPrice(STUDENT, null);
    expect(await saving(await product('solo_class', 8, 560000, ADULT, TIER))).toBe(80000);
    expect(await saving(await product('solo_class', 8, 480000, STUDENT, TIER))).toBeNull();
  });
});

describe('group packs (D173)', () => {
  it('8 x the drop-in price of the group’s classes - the pack price', async () => {
    await groupClass('adult', 60000);
    await groupClass('adult', 60000);
    await groupClass('student', 50000);
    expect(await saving(await product('group_session', 8, 400000, ADULT))).toBe(80000);
    expect(await saving(await product('group_session', 8, 320000, STUDENT))).toBe(80000);
  });
  it('drop-in prices that differ by class, or an unset one, are no saving; ended and inactive classes do not count', async () => {
    await groupClass('adult', 60000);
    await groupClass('adult', 70000, false);
    await groupClass('adult', 90000, true, '2026-12-31');
    expect(await saving(await product('group_session', 8, 400000, ADULT))).toBe(80000);
    await groupClass('adult', 65000);
    expect(await saving(await product('group_session', 8, 400000, ADULT))).toBeNull();
    await groupClass('student', null);
    expect(await saving(await product('group_session', 8, 320000, STUDENT))).toBeNull();
  });
  it('no class for the group is no saving', async () => {
    expect(await saving(await product('group_session', 8, 400000, ADULT))).toBeNull();
  });
});

describe('access', () => {
  it('the app may run the single price function (the view calls it); the platform may not', async () => {
    const r = await tdb.query(`select has_function_privilege('booq_app', 'app.package_single_price(text, uuid, uuid)', 'execute') as a,
                                      has_function_privilege('booq_platform', 'app.package_single_price(text, uuid, uuid)', 'execute') as p`);
    expect(r.rows[0]).toEqual({ a: true, p: false });
  });
});
