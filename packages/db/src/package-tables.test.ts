import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectRegistry } from './registry';
import { checkTableClasses } from './registry/check';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F06-T01 / migration 0501: package_product, customer_package, package_extension, wallet_account
// (PKG-02-AC1, AC4, CC-1).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const PLAYER_B = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';
const ADULT = '00000000-0000-4000-8000-0000000000a1';
const TIER = '00000000-0000-4000-8000-0000000000c1';
const PRODUCT = '00000000-0000-4000-8000-0000000000d1';
const PRODUCT_B = '00000000-0000-4000-8000-0000000000d2';

let tdb: TestDatabase;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  for (const [club, u, roles] of [[A, PLAYER, ['player']], [A, OWNER, ['owner', 'player']], [B, PLAYER_B, ['player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [club, u, 'L' + u.slice(0, 2)]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  await tdb.query(`insert into public.price_group (club_id, id, name_th, name_en, rule) values ($1,$2,'ผู้ใหญ่','Adult','{"min_age":18}')`, [A, ADULT]);
  await tdb.query(`insert into public.coach_tier (club_id, id, name_th, name_en) values ($1,$2,'ระดับ 1','Tier 1')`, [A, TIER]);
  await tdb.query(
    `insert into public.package_product (club_id, id, name_th, name_en, credit_type, credits, validity_months, price_satang)
     values ($1,$3,'10 ชั่วโมง','10 hours','court_hour',10,3,450000), ($2,$4,'10 ชั่วโมง','10 hours','court_hour',10,3,450000)`,
    [A, B, PRODUCT, PRODUCT_B],
  );
});
afterEach(async () => {
  await tdb.close();
});

const product = (fields: Record<string, unknown>) => {
  const row = { club_id: A, name_th: 'แพ็ก', name_en: 'Pack', credit_type: 'court_hour', credits: 8, validity_months: 3, ...fields };
  const cols = Object.keys(row);
  return tdb.query(`insert into public.package_product (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) returning id`, Object.values(row));
};
const grant = (fields: Record<string, unknown> = {}) => {
  const row = {
    club_id: A, customer_id: PLAYER, product_id: PRODUCT, product_snapshot: '{"credit_type":"court_hour"}', credits_total: 10,
    purchased_at: '2027-01-04T17:30:00Z', expires_at: '2027-04-05T16:59:59.999Z', ...fields,
  };
  const cols = Object.keys(row);
  return tdb.query(`insert into public.customer_package (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) returning id`, Object.values(row));
};
async function pricedOrder(customer = PLAYER, club = A) {
  const o = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [club, customer])).rows[0].id as string;
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local session_replication_role = replica`);   // fixture: a priced order without lines
    await c.query(`update public.orders set price_group_snapshot='{}', subtotal_satang=450000, discount_satang=0, total_satang=450000, credit_value_satang=0, wallet_satang=0, money_satang=450000, quote_hash=repeat('a',64), priced_at=now() where id=$1`, [o]);
    await c.query('commit');
  } finally {
    c.release();
  }
  return o;
}

describe('package_product (PKG-02-AC1)', () => {
  it('holds credit type, credits, validity in months, price group, tier and a satang price; no price means not set', async () => {
    await expect(product({ credit_type: 'voucher' })).rejects.toThrow(/credit_type_values/);
    await expect(product({ credits: 0 })).rejects.toThrow(/check/i);
    await expect(product({ validity_months: 0 })).rejects.toThrow(/check/i);
    await expect(product({ price_satang: -1 })).rejects.toThrow(/check/i);
    await expect(product({ credit_type: 'solo_class', price_group_id: ADULT })).rejects.toThrow(/package_product_tier/);
    await expect(product({ credit_type: 'solo_class', coach_tier_id: TIER })).rejects.toThrow(/package_product_price_group/);
    await expect(product({ credit_type: 'group_session' })).rejects.toThrow(/package_product_price_group/);
    await expect(product({ coach_tier_id: TIER })).rejects.toThrow(/package_product_tier/);
    await product({ credit_type: 'solo_class', coach_tier_id: TIER, price_group_id: ADULT, price_satang: 560000 });
    await product({ credit_type: 'group_session', price_group_id: ADULT, price_satang: 400000 });
    await product({ price_satang: null });
    expect((await tdb.query(`select price_satang from public.package_product where id = $1`, [PRODUCT])).rows[0].price_satang).toBe(450000);
  });
  it('a price group or tier must be the same club’s', async () => {
    const otherTier = (await tdb.query(`insert into public.coach_tier (club_id, name_th, name_en) values ($1,'x','x') returning id`, [B])).rows[0].id;
    await expect(product({ credit_type: 'solo_class', coach_tier_id: otherTier, price_group_id: ADULT })).rejects.toThrow(/foreign key/i);
  });
  it('a package order line must name a product of the same club', async () => {
    const o = await pricedOrder();
    const line = (p: string) => tdb.query(
      `insert into public.order_line (club_id, order_id, position, kind, package_product_id, description_key, name_th, name_en, unit_price_satang, net_satang, money_satang)
       values ($1,$2,1,'package',$3,'package','แพ็ก','Pack',450000,450000,450000)`, [A, o, p]);
    await expect(line(PRODUCT_B)).rejects.toThrow(/order_line_package_product/);
    await expect(line('00000000-0000-4000-8000-0000000000ff')).rejects.toThrow(/order_line_package_product/);
    await line(PRODUCT);
  });
  it('product changes are audited (PKG-02-AC4)', async () => {
    await tdb.query(`update public.package_product set price_satang = 480000 where id = $1`, [PRODUCT]);
    const n = (await tdb.query(`select count(*)::int as n from public.audit_entry where record_type = 'package_product' and record_id = $1`, [PRODUCT])).rows[0].n;
    expect(n).toBeGreaterThanOrEqual(2);
  });
});

describe('customer_package (PKG-02-AC4)', () => {
  it('the purchase date is the Bangkok date of the purchase, not the UTC date', async () => {
    const id = (await grant()).rows[0].id;
    const r = (await tdb.query(`select to_char(purchase_date, 'YYYY-MM-DD') as d from public.customer_package where id = $1`, [id])).rows[0];
    expect(r.d).toBe('2027-01-05');          // 17:30 UTC on 4 Jan is 00:30 on 5 Jan in Bangkok
    const forged = (await grant({ purchase_date: '2020-01-01', order_id: await pricedOrder() })).rows[0].id;
    expect((await tdb.query(`select to_char(purchase_date, 'YYYY-MM-DD') as d from public.customer_package where id = $1`, [forged])).rows[0].d).toBe('2027-01-05');
  });
  it('credits_total and the snapshot cannot be updated; only the expiry can move; nothing is deleted', async () => {
    const id = (await grant()).rows[0].id;
    await expect(tdb.query(`update public.customer_package set credits_total = 20 where id = $1`, [id])).rejects.toThrow(/only its expiry/);
    await expect(tdb.query(`update public.customer_package set product_snapshot = '{}' where id = $1`, [id])).rejects.toThrow(/only its expiry/);
    await expect(tdb.query(`update public.customer_package set customer_id = $2 where id = $1`, [id, OWNER])).rejects.toThrow(/only its expiry/);
    await tdb.query(`update public.customer_package set expires_at = expires_at + interval '1 month' where id = $1`, [id]);
    await expect(tdb.query(`delete from public.customer_package where id = $1`, [id])).rejects.toThrow(/append-only/);
    await expect(tdb.query(`truncate public.customer_package cascade`)).rejects.toThrow(/append-only/);
  });
  it('a second grant row for the same order and product is refused', async () => {
    const o = await pricedOrder();
    await grant({ order_id: o });
    await expect(grant({ order_id: o })).rejects.toThrow(/customer_package_once_per_order/);
    await grant();                         // no order (an imported package): not limited by the rule
    await grant();
  });
  it('credits are whole and positive (zero only for a claim copy without an order, 0510); the expiry is after the purchase', async () => {
    await expect(grant({ credits_total: 0, order_id: await pricedOrder() })).rejects.toThrow(/credits_total_check/);
    await expect(grant({ credits_total: -1 })).rejects.toThrow(/credits_total_check/);
    await grant({ credits_total: 0 });
    await expect(grant({ expires_at: '2027-01-01T00:00:00Z' })).rejects.toThrow(/expiry_after_purchase/);
    await expect(grant({ product_snapshot: '[]' })).rejects.toThrow(/snapshot_shape/);
  });
  it('another club’s customer, product or order cannot be referenced', async () => {
    await expect(grant({ customer_id: PLAYER_B })).rejects.toThrow(/foreign key/i);
    await expect(grant({ product_id: PRODUCT_B })).rejects.toThrow(/foreign key/i);
    await expect(grant({ order_id: await pricedOrder(PLAYER_B, B) })).rejects.toThrow(/foreign key/i);
  });
});

describe('package_extension and wallet_account', () => {
  it('an owner extension needs staff and a reason, a pause needs its pause; the expiry moves later; append-only', async () => {
    const pkg = (await grant()).rows[0].id;
    const ext = (fields: Record<string, unknown>) => {
      const row = { club_id: A, package_id: pkg, old_expires_at: '2027-04-05T16:59:59.999Z', new_expires_at: '2027-05-05T16:59:59.999Z', ...fields };
      const cols = Object.keys(row);
      return tdb.query(`insert into public.package_extension (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) returning id`, Object.values(row));
    };
    await expect(ext({ kind: 'owner', staff_id: OWNER })).rejects.toThrow(/owner_shape/);
    await expect(ext({ kind: 'owner', staff_id: OWNER, reason: '  ' })).rejects.toThrow(/owner_shape/);
    await expect(ext({ kind: 'owner', reason: 'injury' })).rejects.toThrow(/owner_shape/);
    await expect(ext({ kind: 'pause' })).rejects.toThrow(/pause_shape/);
    await expect(ext({ kind: 'gift', staff_id: OWNER, reason: 'x' })).rejects.toThrow(/kind_values/);
    await expect(ext({ kind: 'owner', staff_id: OWNER, reason: 'injury', new_expires_at: '2027-04-01T00:00:00Z' })).rejects.toThrow(/package_extension_later/);
    const id = (await ext({ kind: 'owner', staff_id: OWNER, reason: 'injury' })).rows[0].id;
    const pause = (await tdb.query(`insert into public.club_pause (club_id, pause_reason, paused_by) values ($1,'rain',gen_random_uuid()) returning id`, [A])).rows[0].id;
    await ext({ kind: 'pause', pause_id: pause });
    await expect(tdb.query(`update public.package_extension set reason = 'x' where id = $1`, [id])).rejects.toThrow(/append-only/);
    await expect(tdb.query(`delete from public.package_extension where id = $1`, [id])).rejects.toThrow(/append-only/);
  });
  it('one wallet anchor per customer, with no balance column; the anchor never changes', async () => {
    await tdb.query(`insert into public.wallet_account (club_id, customer_id) values ($1,$2)`, [A, PLAYER]);
    await expect(tdb.query(`insert into public.wallet_account (club_id, customer_id) values ($1,$2)`, [A, PLAYER])).rejects.toThrow(/one_per_customer/);
    await expect(tdb.query(`insert into public.wallet_account (club_id, customer_id) values ($1,$2)`, [A, PLAYER_B])).rejects.toThrow(/foreign key/i);
    await expect(tdb.query(`update public.wallet_account set created_at = now()`)).rejects.toThrow(/append-only/);
    await expect(tdb.query(`delete from public.wallet_account`)).rejects.toThrow(/append-only/);
    for (const t of ['wallet_account', 'customer_package', 'package_product']) {
      const cols = (await tdb.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`, [t])).rows.map((r) => r.column_name as string);
      expect(cols.filter((c) => /balance|credits_left|status/.test(c)), t).toEqual([]);
    }
  });
});

describe('class, club scope and reach (CC-1)', () => {
  it('every table has its class, club columns, forced RLS and test flag registration', async () => {
    expect((await checkTableClasses(tdb.pool, await collectRegistry())).problems.filter((p) => p.table !== 'app.test_clock')).toEqual([]);
    const r = (await tdb.query(`select table_name from app.test_tables where table_name in ('package_extension','customer_package','wallet_account','payment','orders') order by delete_order`)).rows;
    expect(r.map((x) => x.table_name)).toEqual(['payment', 'package_extension', 'customer_package', 'wallet_account', 'orders']);
  });
  it('a package written while the club is Testing is a test row', async () => {
    await tdb.query(`update public.club set status = 'testing' where id = $1`, [A]);
    const id = (await grant()).rows[0].id;
    expect((await tdb.query(`select is_test from public.customer_package where id = $1`, [id])).rows[0].is_test).toBe(true);
  });
  it('another club’s package is not reachable through the tenant policy; BOOQ staff hold no privilege', async () => {
    await grant();
    await tdb.query(`insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, expires_at)
                     values ($1,$2,$3,'{}',10,'2027-01-04T17:30:00Z','2027-04-05T16:59:59.999Z')`, [B, PLAYER_B, PRODUCT_B]);
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      // Rolled back: the read policies and grants are F06-T11. Even an allow-all policy stays inside the club.
      await c.query('grant select on public.customer_package to booq_app');
      await c.query('create policy t01_probe on public.customer_package for select to booq_app using (true)');
      await c.query('set local role booq_app');
      await c.query(`select set_config('app.club_id', $1, true)`, [A]);
      const seen = (await c.query('select club_id from public.customer_package')).rows;
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((r) => r.club_id === A)).toBe(true);
    } finally {
      await c.query('rollback');
      c.release();
    }
    for (const t of ['package_product', 'customer_package', 'package_extension', 'wallet_account']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        expect((await tdb.query('select has_table_privilege($1, $2, $3) as ok', ['booq_platform', `public.${t}`, priv])).rows[0].ok, `platform ${t} ${priv}`).toBe(false);
      }
    }
  });
});
