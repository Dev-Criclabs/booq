import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlatformDb, type PlatformDb } from './platform-tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F06-T26 / migration 0517: the 'product' template handler (PKG-02-AC1; D166). Hunter gets its two court bundles and the
// two group 8-session packs at the PRD prices, copied from the template; no single sessions and no solo packs.
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOCALES = join(__dirname, '..', '..', '..', 'locales');

let tdb: TestDatabase;
let pdb: PlatformDb;
let admin: string;
const tpl = async (key: string) => (await tdb.query(`select id from platform.template where key = $1`, [key])).rows[0].id as string;
const apply = async (key: string, club = CLUB) =>
  pdb.withPlatformTx({ staffId: admin, staffLabel: 'Staff', clubId: club }, async (tx) => (await tx.query(`select app.apply_template($1) as r`, [await tpl(key)])).rows[0]?.r);
const products = async (club = CLUB) =>
  (await tdb.query(`select p.name_en, p.name_th, p.credit_type, p.credits, p.validity_months, p.price_satang, g.name_en as grp, p.coach_tier_id, p.active
                      from public.package_product p left join public.price_group g on g.club_id = p.club_id and g.id = p.price_group_id
                     where p.club_id = $1 order by p.credit_type, p.credits, g.name_en`, [club])).rows;

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

describe('Hunter’s products from the Tennis template (PKG-02-AC1, D166)', () => {
  it('two court bundles and two group 8-session packs at the PRD prices; no singles, no solo packs; nothing pending', async () => {
    const r = await apply('tennis');
    expect(r.pending).toEqual([]);
    expect(await products()).toEqual([
      { name_en: '10 hour bundle', name_th: 'แพ็กเกจ 10 ชั่วโมง', credit_type: 'court_hour', credits: 10, validity_months: 3, price_satang: 450000, grp: null, coach_tier_id: null, active: true },
      { name_en: '20 hour bundle', name_th: 'แพ็กเกจ 20 ชั่วโมง', credit_type: 'court_hour', credits: 20, validity_months: 5, price_satang: 800000, grp: null, coach_tier_id: null, active: true },
      { name_en: 'Group 8 session pack', name_th: 'แพ็กคลาสกลุ่ม 8 ครั้ง', credit_type: 'group_session', credits: 8, validity_months: 3, price_satang: 400000, grp: 'Adult', coach_tier_id: null, active: true },
      { name_en: 'Group 8 session pack', name_th: 'แพ็กคลาสกลุ่ม 8 ครั้ง', credit_type: 'group_session', credits: 8, validity_months: 3, price_satang: 320000, grp: 'Student', coach_tier_id: null, active: true },
    ]);
    expect((await tdb.query(`select count(*)::int as n from public.package_product where club_id = $1 and credit_type = 'solo_class'`, [CLUB])).rows[0].n).toBe(0);
  });
  it('the names are the writers’ text of the named key with its variable filled, in both languages', async () => {
    const en = JSON.parse(readFileSync(join(LOCALES, 'en.json'), 'utf8')) as Record<string, string>;
    const th = JSON.parse(readFileSync(join(LOCALES, 'th.json'), 'utf8')) as Record<string, string>;
    const items = (await tdb.query(`select i.key, i.value from platform.template_item i join platform.template t on t.id = i.template_id
                                     where t.key = 'tennis' and i.kind = 'product' and i.value ? 'name_key' order by i.key`)).rows;
    expect(items.map((i) => i.key)).toEqual(['bundle_10h', 'bundle_20h', 'group_pack8_adult', 'group_pack8_student']);
    for (const { value: v } of items) {
      const vars = { hours: String(v.quantity), sessions: String(v.quantity) };
      const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, k: keyof typeof vars) => vars[k]);
      expect(v.name_en, v.name_key).toBe(fill(en[v.name_key]!));
      expect(v.name_th, v.name_key).toBe(fill(th[v.name_key]!));
    }
  });
  it('solo packs are a reminder only: done once every coach tier has one; a club with no tier has nothing to do; no status gate', async () => {
    await apply('tennis');
    const done = async () => (await tdb.query(`select app.solo_packs_done($1) as ok`, [CLUB])).rows[0].ok as boolean;
    expect((await tdb.query(`select count(*)::int as n from app.setup_steps where step_key like '%solo%'`)).rows[0].n).toBe(0);
    expect(await done()).toBe(true);
    const tier = (await tdb.query(`insert into public.coach_tier (club_id, name_th, name_en) values ($1,'ระดับ 1','Tier 1') returning id`, [CLUB])).rows[0].id;
    expect(await done()).toBe(false);
    const adult = (await tdb.query(`select id from public.price_group where club_id = $1 and name_en = 'Adult'`, [CLUB])).rows[0].id;
    await tdb.query(`insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_group_id, coach_tier_id, price_satang)
                     values ($1,'แพ็ก','Pack','solo_class',8,3,$2,$3,null)`, [CLUB, adult, tier]);
    expect(await done()).toBe(true);
  });
  it('another club is untouched, Blank copies nothing, and an unknown product type stops the apply', async () => {
    await apply('tennis');
    await apply('blank', OTHER);
    expect(await products(OTHER)).toEqual([]);
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('app.club_id', $1, true)`, [OTHER]);
      await expect(c.query(`select app.template_product($1, 'x', '{"type":"voucher","quantity":5}')`, [OTHER])).rejects.toThrow(/unknown_type/);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
  it('a club that applied Tennis before this migration gets the products from the catch-up, once', async () => {
    await apply('tennis');
    await tdb.query(`delete from public.club_template_copy where club_id = $1 and kind = 'product'`, [CLUB]);
    await tdb.query(`delete from public.audit_entry where record_type = 'package_product'`).catch(() => undefined);
    const before = (await products()).length;
    expect(before).toBe(4);
    // the catch-up copies only items not yet recorded as copied: with the copies forgotten it would add again,
    // so a club is caught up exactly once by the copy record
    await tdb.query(`insert into public.club_template_copy (club_id, kind, key) select $1, 'product', i.key from platform.template_item i join platform.template t on t.id = i.template_id where t.key = 'tennis' and i.kind = 'product'`, [CLUB]);
    expect((await tdb.query(`select app.catch_up_template_handler('product') as n`)).rows[0].n).toBe(0);
    expect(await products()).toHaveLength(4);
  });
});
