import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectRegistry } from './registry';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F04-T05 / migration 0305: BOOQ staff and the price tables (D27, PLAT-02-AC1, PDPA-01-AC1).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const ADMIN = '77777777-7777-4777-8777-777777777771';
const SPEC = '77777777-7777-4777-8777-777777777772';
const ADULT = '00000000-0000-4000-8000-0000000000a1';
const ADULT_B = '00000000-0000-4000-8000-0000000000b1';

let tdb: TestDatabase;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','testing'), ($2,'b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.price_group (club_id, id, name_th, name_en, rule) values ($1,$3,'x','Adult','{"min_age":18}'), ($2,$4,'x','Adult','{"min_age":18}')`, [A, B, ADULT, ADULT_B]);
  await tdb.query(`insert into platform.platform_staff (id, auth_user_id, email, display_name, role) values ($1, gen_random_uuid(), 'a@b.test', 'Ann', 'platform_admin'), ($2, gen_random_uuid(), 's@b.test', 'Sam', 'onboarding_specialist')`, [ADMIN, SPEC]);
  await tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1,$2), ($1,$3)`, [SPEC, A, B]);
  await tdb.query(`insert into public.court_price_rule (club_id, price_group_id, price_satang) values ($1,$2,50000), ($3,$4,60000)`, [A, ADULT, B, ADULT_B]);
});
afterEach(async () => {
  await tdb.close();
});
async function asStaff<T>(staff: string, fn: (q: (sql: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>) => Promise<T>): Promise<T> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role booq_platform');
    await c.query(`select set_config('app.actor_platform_staff_id', $1, true), set_config('app.actor_label', 'BOOQ staff: x', true)`, [staff]);
    const out = await fn((sql, p) => c.query(sql, p));
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

describe('the support view of products and pricing (D27)', () => {
  it('staff read the prices of the clubs they may see', async () => {
    const r = await asStaff(SPEC, (q) => q('select price_satang from public.court_price_rule order by price_satang'));
    expect(r.rows).toEqual([{ price_satang: 50000 }, { price_satang: 60000 }]);
    await tdb.query('delete from platform.staff_assignment where club_id = $1', [B]);
    expect((await asStaff(SPEC, (q) => q('select price_satang from public.court_price_rule'))).rows).toEqual([{ price_satang: 50000 }]);
    expect((await asStaff('77777777-7777-4777-8777-777777777779', (q) => q('select 1 from public.court_price_rule'))).rowCount).toBe(0);
  });
  it('staff edit in Testing, not on a Live club without the owner’s window', async () => {
    expect((await asStaff(SPEC, (q) => q(`update public.court_price_rule set price_satang = 55000 where club_id = $1`, [A]))).rowCount).toBe(1);
    expect((await asStaff(SPEC, (q) => q(`update public.court_price_rule set price_satang = 1 where club_id = $1`, [B]))).rowCount).toBe(0);
    await tdb.query(`update public.club set allow_booq_changes_until = app.now() + interval '1 hour', allow_booq_changes_set_at = app.now() where id = $1`, [B]);
    expect((await asStaff(SPEC, (q) => q(`update public.court_price_rule set price_satang = 61000 where club_id = $1`, [B]))).rowCount).toBe(1);
  });
  it('the change is audited with the staff member', async () => {
    await asStaff(ADMIN, (q) => q(`update public.court_price_rule set price_satang = 56000 where club_id = $1`, [A]));
    const e = (await tdb.query(`select actor_type, actor_platform_staff_id, actor_label from public.audit_entry where record_type = 'court_price_rule' and action = 'update'`)).rows;
    expect(e).toEqual([{ actor_type: 'platform_staff', actor_platform_staff_id: ADMIN, actor_label: 'BOOQ staff: x' }]);
  });
});

describe('BOOQ staff are blind to F04 club data (PDPA-01-AC1)', () => {
  it('no privilege on orders, order lines, codes, redemptions, partners or birthday uses', async () => {
    const reg = await collectRegistry();
    const d = ['public.orders', 'public.order_line', 'public.promo_code', 'public.promo_redemption', 'public.partner', 'public.birthday_entitlement_use'];
    for (const t of d) {
      expect(reg[t]?.class, t).toBe('D');
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        expect((await tdb.query('select has_table_privilege($1, $2, $3) as ok', ['booq_platform', t, priv])).rows[0].ok, `${t} ${priv}`).toBe(false);
      }
    }
  });
});
