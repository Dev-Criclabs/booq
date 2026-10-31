import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlatformDb, type PlatformDb } from './platform-tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F04-T06 / migration 0310: template handlers for price groups, court prices, coach tiers and add-ons
// (R3-AC7, PLAT-05-AC7, AC12). Values are the PRD's; nothing is invented.
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

let tdb: TestDatabase;
let pdb: PlatformDb;
let admin: string;

const tpl = async (key: string) => (await tdb.query(`select id from platform.template where key = $1`, [key])).rows[0].id as string;
const apply = async (key: string, club = CLUB) =>
  pdb.withPlatformTx({ staffId: admin, staffLabel: 'Staff', clubId: club }, async (tx) => (await tx.query(`select app.apply_template($1) as r`, [await tpl(key)])).rows[0]?.r);
const item = async (kind: string, key: string) =>
  (await tdb.query(`select i.value from platform.template_item i join platform.template t on t.id = i.template_id where t.key = 'tennis' and i.kind = $1 and i.key = $2`, [kind, key])).rows[0]?.value;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1, 'a', 'ก', 'A'), ($2, 'b', 'ข', 'B')`, [CLUB, OTHER]);
  admin = (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ('99999999-0000-4000-8000-000000000001', 'admin@booq.example', 'Ada Admin', 'platform_admin') returning id`)).rows[0].id;
  pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await pdb.end();
  await tdb.close();
});

describe('Tennis carries Hunter’s price data (R3-AC7, PLAT-05-AC12)', () => {
  it('the balls add-on names equal the PRD strings and the price is empty (TBD in the PRD)', async () => {
    const v = await item('add_on', 'balls');
    expect(v.name_en).toBe('Balls (Set of 3 balls)');
    expect(v.name_th).toBe('ลูกเทนนิส (ชุด 3 ลูก)');
    expect(v.price_satang).toBeNull();
  });

  it('applying copies the Adult and Student groups, one 50000 satang court rule for each, and the balls add-on', async () => {
    const r = await apply('tennis');
    expect(r.pending).toEqual([]);                        // products load too since F06 0517 (template-products.test.ts)
    const g = (await tdb.query(`select name_en, rule from public.price_group where club_id = $1 order by position`, [CLUB])).rows;
    expect(g).toEqual([{ name_en: 'Adult', rule: { min_age: 18 } }, { name_en: 'Student', rule: { max_age: 17 } }]);
    const rules = (await tdb.query(`select g.name_en, r.day_type, r.peak, r.price_satang from public.court_price_rule r join public.price_group g on g.club_id = r.club_id and g.id = r.price_group_id where r.club_id = $1 order by g.position`, [CLUB])).rows;
    expect(rules).toEqual([{ name_en: 'Adult', day_type: 'any', peak: 'any', price_satang: 50000 }, { name_en: 'Student', day_type: 'any', peak: 'any', price_satang: 50000 }]);
    const a = (await tdb.query(`select name_en, name_th, price_satang, active from public.add_on where club_id = $1`, [CLUB])).rows;
    expect(a).toEqual([{ name_en: 'Balls (Set of 3 balls)', name_th: 'ลูกเทนนิส (ชุด 3 ลูก)', price_satang: null, active: true }]);
  });

  it('no coach tier is seeded: the PRD gives tier names only as examples', async () => {
    await apply('tennis');
    expect((await tdb.query(`select count(*)::int as n from public.coach_tier where club_id = $1`, [CLUB])).rows[0].n).toBe(0);
  });

  it('another club is untouched, and Blank copies nothing', async () => {
    await apply('tennis');
    await apply('blank', OTHER);
    for (const t of ['price_group', 'court_price_rule', 'add_on'])
      expect((await tdb.query(`select count(*)::int as n from public.${t} where club_id = $1`, [OTHER])).rows[0].n, t).toBe(0);
  });

  it('a later template edit leaves the club unchanged', async () => {
    await apply('tennis');
    await tdb.query(`update platform.template_item set value = '{"price_satang": 99900}' where kind = 'price' and key = 'court_hour'`);
    expect((await tdb.query(`select distinct price_satang from public.court_price_rule where club_id = $1`, [CLUB])).rows).toEqual([{ price_satang: 50000 }]);
  });
});

describe('the handlers refuse a malformed item instead of dropping it', () => {
  it('a court price with no groups to attach to stops the apply and rolls it back', async () => {
    await tdb.query(`delete from platform.template_item where kind = 'age_band'`);
    await expect(apply('tennis')).rejects.toThrow(/template:price:no_groups/);
    expect((await tdb.query(`select count(*)::int as n from public.club_setting where club_id = $1`, [CLUB])).rows[0].n).toBe(0);
  });
});
