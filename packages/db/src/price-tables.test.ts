import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectRegistry } from './registry';
import { checkTableClasses } from './registry/check';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F04-T01 / migration 0301: the price tables (R1, R2-AC3, R3-AC1, CC-1).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER = '11111111-1111-4111-8111-111111111111';
const PLAYER = '22222222-2222-4222-8222-222222222222';
const ADULT = '00000000-0000-4000-8000-0000000000a1';
const STUDENT = '00000000-0000-4000-8000-0000000000a2';
const OTHER = '00000000-0000-4000-8000-0000000000b1';
const TIER = '00000000-0000-4000-8000-0000000000c1';

let tdb: TestDatabase;
let web: Db;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A'), ($2,'b','ข','B')`, [A, B]);
  await tdb.query(`insert into public.price_group (club_id, id, name_th, name_en, rule) values
    ($1,$3,'ผู้ใหญ่','Adult','{"min_age":18}'), ($1,$4,'นักเรียน','Student','{"max_age":17}'), ($2,$5,'ผู้ใหญ่','Adult','{"min_age":18}')`, [A, B, ADULT, STUDENT, OTHER]);
  for (const [u, roles] of [[OWNER, ['owner', 'player']], [PLAYER, ['player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [A, u, 'L' + u.slice(0, 2)]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [A, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  web = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});
const ctx = (user: string, roles: string[], club = A) => ({ clubId: club, userId: user, roles, source: 'admin' as const });

describe('price groups and court prices (R1)', () => {
  it('the age rule has a sensible shape', async () => {
    const add = (rule: string) => tdb.query(`insert into public.price_group (club_id, name_th, name_en, rule) values ($1,'x','x',$2)`, [A, rule]);
    await expect(add('{}')).rejects.toThrow(/rule_shape/);
    await expect(add('"adult"')).rejects.toThrow(/rule_shape/);
    await expect(add('{"min_age":30,"max_age":20}')).rejects.toThrow(/rule_shape/);
    await add('{"min_age":60}');
  });
  it('one rule per group, day type and peak; the amount is non-negative satang; the group must be this club’s', async () => {
    const rule = (group: string, day = 'any', peak = 'any', price = 50000) =>
      tdb.query(`insert into public.court_price_rule (club_id, price_group_id, day_type, peak, price_satang) values ($1,$2,$3,$4,$5)`, [A, group, day, peak, price]);
    await rule(ADULT);
    await expect(rule(ADULT)).rejects.toThrow(/court_price_rule_key/);
    await rule(ADULT, 'weekend');                        // another day type is another rule
    await expect(rule(STUDENT, 'any', 'any', -1)).rejects.toThrow(/check/i);
    await expect(rule(STUDENT, 'holiday')).rejects.toThrow(/day_type_values/);
    await expect(rule(OTHER)).rejects.toThrow(/foreign key/i);
    await rule(STUDENT, 'any', 'any', 0);                // free is a price
  });
});

describe('coach tiers and add-ons: null means not for sale (R2-AC3, R3-AC1)', () => {
  it('a tier price may be unset; a group has one price per tier', async () => {
    await tdb.query(`insert into public.coach_tier (club_id, id, name_th, name_en) values ($1,$2,'โค้ช','Coach'), ($1,gen_random_uuid(),'หัวหน้า','Head Coach')`, [A, TIER]);
    await tdb.query(`insert into public.coach_tier_price (club_id, tier_id, price_group_id, price_satang) values ($1,$2,$3,null), ($1,$2,$4,80000)`, [A, TIER, ADULT, STUDENT]);
    await expect(tdb.query(`insert into public.coach_tier_price (club_id, tier_id, price_group_id, price_satang) values ($1,$2,$3,1)`, [A, TIER, ADULT])).rejects.toThrow(/duplicate key/);
    await expect(tdb.query(`insert into public.coach_tier_price (club_id, tier_id, price_group_id, price_satang) values ($1,$2,$3,-5)`, [A, TIER, STUDENT])).rejects.toThrow();
    await expect(tdb.query(`insert into public.coach_tier_price (club_id, tier_id, price_group_id, price_satang) values ($1,$2,$3,1)`, [B, TIER, OTHER])).rejects.toThrow(/foreign key/i);
  });
  it('an add-on with no price is allowed and an add-on needs both names', async () => {
    await tdb.query(`insert into public.add_on (club_id, name_th, name_en) values ($1,'ลูกเทนนิส','Balls')`, [A]);
    await expect(tdb.query(`insert into public.add_on (club_id, name_th, name_en) values ($1,' ','Balls')`, [A])).rejects.toThrow(/check/i);
    expect((await tdb.query('select price_satang, active from public.add_on')).rows).toEqual([{ price_satang: null, active: true }]);
  });
});

describe('who reads and writes (CC-1)', () => {
  it('every person of the club reads the prices; only the owner writes; the other club sees none', async () => {
    const seen = await web.withClubTx(ctx(PLAYER, ['player']), (tx) => tx.query('select name_en from public.price_group order by name_en'));
    expect(seen.rows).toEqual([{ name_en: 'Adult' }, { name_en: 'Student' }]);
    await expect(web.withClubTx(ctx(PLAYER, ['player']), (tx) => tx.query(`insert into public.add_on (club_id, name_th, name_en) values ($1,'x','x')`, [A]))).rejects.toThrow(/row-level security/);
    await web.withClubTx(ctx(OWNER, ['owner', 'player']), (tx) => tx.query(`insert into public.add_on (club_id, name_th, name_en, price_satang) values ($1,'x','x',2000)`, [A]));
    expect((await web.withClubTx(ctx(OWNER, ['owner'], B), (tx) => tx.query('select name_en from public.price_group'))).rows).toEqual([{ name_en: 'Adult' }]);
    await expect(web.withClubTx(ctx(OWNER, ['owner'], B), (tx) => tx.query(`insert into public.add_on (club_id, name_th, name_en) values ($1,'x','x')`, [A]))).rejects.toThrow(/row-level security/);
  });
  it('a price change is audited with old and new values', async () => {
    await tdb.query(`insert into public.court_price_rule (club_id, id, price_group_id, price_satang) values ($1, '00000000-0000-4000-8000-0000000000e1', $2, 50000)`, [A, ADULT]);
    await web.withClubTx(ctx(OWNER, ['owner', 'player']), (tx) => tx.query(`update public.court_price_rule set price_satang = 55000`));
    const e = (await tdb.query(`select old_value, new_value from public.audit_entry where record_type = 'court_price_rule' and action = 'update'`)).rows;
    expect(e).toEqual([{ old_value: { price_satang: 50000 }, new_value: { price_satang: 55000 } }]);
  });
  it('is registered as setup data and passes the structure check', async () => {
    const reg = await collectRegistry();
    for (const t of ['price_group', 'court_price_rule', 'coach_tier', 'coach_tier_price', 'add_on']) expect(reg[`public.${t}`]?.class, t).toBe('S');
    expect((await checkTableClasses(tdb.pool, reg)).problems.filter((p) => p.table !== 'app.test_clock')).toEqual([]);
  });
});
