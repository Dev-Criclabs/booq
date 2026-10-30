import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectRegistry } from './registry';
import { checkTableClasses } from './registry/check';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F04-T02 / migration 0302 and F04-T03 / migration 0303 (PROMO-01-AC1, AC7, R5-AC3, R4-AC4,
// R7-AC1, AC2; D23, D40, D66, D70, D111).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER = '11111111-1111-4111-8111-111111111111';
const PLAYER = '22222222-2222-4222-8222-222222222222';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const ADDON = '00000000-0000-4000-8000-0000000000d1';
const at = (h: number) => new Date(Date.UTC(2026, 11, 29, h - 7)).toISOString();

let tdb: TestDatabase;
let web: Db;
let seq = 0;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,'00000000-0000-4000-8000-0000000000a1','M')`, [A]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,'00000000-0000-4000-8000-0000000000a1','1','tennis')`, [A, C1]);
  await tdb.query(`insert into public.add_on (club_id, id, name_th, name_en, price_satang) values ($1,$2,'ลูก','Balls',10000)`, [A, ADDON]);
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

async function order(club = A) {
  return (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [club, club === A ? PLAYER : null])).rows[0].id as string;
}
async function booking(orderId: string, hour = 10) {
  seq += 1;
  return (await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, status, source, created_by, confirmed_at) values ($1,$2,'court',$3,$4,$5,'confirmed','online',$6,now()) returning id`,
    [A, orderId, C1, at(hour), at(hour + 1), PLAYER],
  )).rows[0].id as string;
}
const line = (o: string, b: string | null, n: number, p: { kind?: string; unit?: number; disc?: number; credit?: number; wallet?: number; money?: number; addon?: string | null } = {}) => {
  const unit = p.unit ?? 50000, disc = p.disc ?? 0, net = unit - disc;
  const credit = p.credit ?? 0, wallet = p.wallet ?? 0, money = p.money ?? net - credit - wallet;
  return tdb.query(
    `insert into public.order_line (club_id, order_id, position, kind, booking_id, add_on_id, description_key, name_th, name_en, unit_price_satang, discount_satang, net_satang, credit_value_satang, wallet_satang, money_satang)
     values ($1,$2,$3,$4,$5,$6,'P-x','ชั่วโมงคอร์ท','Court hour',$7,$8,$9,$10,$11,$12)`,
    [A, o, n, p.kind ?? 'court_hour', b, p.addon ?? null, unit, disc, net, credit, wallet, money],
  );
};
async function priceOrder(o: string, v: { sub: number; disc: number; credit: number; wallet: number; money: number }) {
  await tdb.query(
    `update public.orders set price_group_snapshot = '{"name_en":"Adult"}', subtotal_satang = $2, discount_satang = $3, total_satang = $4, credit_value_satang = $5, wallet_satang = $6, money_satang = $7, quote_hash = repeat('a',64), priced_at = now() where id = $1`,
    [o, v.sub, v.disc, v.sub - v.disc, v.credit, v.wallet, v.money],
  );
}
/** Run statements in one transaction, so the deferred sum check fires at commit. */
async function tx(fn: (q: (sql: string, p?: unknown[]) => Promise<unknown>) => Promise<void>) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await fn((sql, p) => c.query(sql, p));
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

describe('promo codes (F04-T02)', () => {
  const code = (c: string, extra = '') => tdb.query(`insert into public.promo_code (club_id, code_upper, kind, value, applies_to ${extra ? ',' + extra.split('|')[0] : ''}) values ($1,$2,'percent',1000,'{court_hour}' ${extra ? ',' + extra.split('|')[1] : ''})`, [A, c]);
  it('a code is upper case, unique per club, and the other club may use the same text', async () => {
    await code('SUMMER10');
    await expect(code('SUMMER10')).rejects.toThrow(/promo_code_unique/);
    await expect(code('summer10')).rejects.toThrow(/promo_code_upper/);
    await expect(code('SUMMER 10')).rejects.toThrow(/promo_code_upper/);
    await tdb.query(`insert into public.promo_code (club_id, code_upper, kind, value, applies_to) values ($1,'SUMMER10','percent',500,'{court_hour}')`, [B]);
  });
  it('value, scope, dates and caps are constrained', async () => {
    const add = (kind: string, value: number, applies = '{court_hour}', extra = '') => tdb.query(`insert into public.promo_code (club_id, code_upper, kind, value, applies_to ${extra ? ',' + extra.split('|')[0] : ''}) values ($1, 'C' || floor(random()*1e9)::text, $2, $3, $4 ${extra ? ',' + extra.split('|')[1] : ''})`, [A, kind, value, applies]);
    await expect(add('percent', 0)).rejects.toThrow(/promo_code_value/);
    await expect(add('percent', 10001)).rejects.toThrow(/promo_code_value/);
    await expect(add('fixed', 0)).rejects.toThrow(/promo_code_value/);
    await expect(add('amount' as never, 5)).rejects.toThrow(/kind_values/);
    await expect(add('percent', 1000, '{}')).rejects.toThrow(/applies_to/);
    await expect(add('percent', 1000, '{court_hour,massage}')).rejects.toThrow(/applies_to/);
    await expect(add('percent', 1000, '{court_hour}', `starts_on, ends_on|'2026-12-31', '2026-12-01'`)).rejects.toThrow(/promo_code_dates/);
    await expect(add('percent', 1000, '{court_hour}', `total_cap|0`)).rejects.toThrow(/promo_code_caps/);
    await add('fixed', 5000, '{court_hour,coach,add_on,package,solo_class,group_class}');
  });
  it('one code use per order; a restored use stays and does not count; a partner cannot cross clubs', async () => {
    await code('ONCE');
    const codeId = (await tdb.query(`select id from public.promo_code where code_upper = 'ONCE'`)).rows[0].id;
    const o1 = await order(); const o2 = await order();
    await tdb.query(`insert into public.promo_redemption (club_id, code_id, order_id, customer_id) values ($1,$2,$3,$4)`, [A, codeId, o1, PLAYER]);
    await expect(tdb.query(`insert into public.promo_redemption (club_id, code_id, order_id, customer_id) values ($1,$2,$3,$4)`, [A, codeId, o1, PLAYER])).rejects.toThrow(/one_per_order/);
    await expect(tdb.query(`update public.promo_redemption set status = 'restored'`)).rejects.toThrow(/restored_together/);
    await tdb.query(`update public.promo_redemption set status = 'restored', restored_at = now(), restore_reason = 'hold_ended'`);
    await tdb.query(`insert into public.promo_redemption (club_id, code_id, order_id, customer_id) values ($1,$2,$3,$4)`, [A, codeId, o2, PLAYER]);
    expect((await tdb.query(`select count(*) filter (where status = 'counted')::int as counted, count(*)::int as total from public.promo_redemption`)).rows[0]).toEqual({ counted: 1, total: 2 });
    const pb = (await tdb.query(`insert into public.partner (club_id, name) values ($1,'Other') returning id`, [B])).rows[0].id;
    await expect(tdb.query(`insert into public.promo_code (club_id, code_upper, kind, value, applies_to, partner_id) values ($1,'XP','percent',100,'{court_hour}',$2)`, [A, pb])).rejects.toThrow(/foreign key/i);
  });
  it('a birthday entitlement is once per kind per year while used, and free again once restored', async () => {
    const o = await order();
    const use = (kind: string, year = 2026) => tdb.query(`insert into public.birthday_entitlement_use (club_id, customer_id, year, kind, order_id) values ($1,$2,$3,$4,$5)`, [A, PLAYER, year, kind, o]);
    await use('package');
    await use('solo_class');
    await expect(use('package')).rejects.toThrow(/birthday_use_once/);
    await use('package', 2027);
    await tdb.query(`update public.birthday_entitlement_use set status = 'restored', restored_at = now() where kind = 'package' and year = 2026`);
    await use('package');
    await expect(use('massage')).rejects.toThrow(/kind_values/);
  });
  it('codes and redemptions are club data: BOOQ staff have no privilege; only the owner writes codes; a player reads none', async () => {
    for (const t of ['partner', 'promo_code', 'promo_redemption', 'birthday_entitlement_use']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        expect((await tdb.query('select has_table_privilege($1, $2, $3) as ok', ['booq_platform', `public.${t}`, priv])).rows[0].ok, `${t} ${priv}`).toBe(false);
      }
    }
    await web.withClubTx(ctx(OWNER, ['owner', 'player']), (t) => t.query(`insert into public.promo_code (club_id, code_upper, kind, value, applies_to) values ($1,'OWN','percent',100,'{court_hour}')`, [A]));
    await expect(web.withClubTx(ctx(PLAYER, ['player']), (t) => t.query(`insert into public.promo_code (club_id, code_upper, kind, value, applies_to) values ($1,'PLY','percent',100,'{court_hour}')`, [A]))).rejects.toThrow(/row-level security/);
    expect((await web.withClubTx(ctx(PLAYER, ['player']), (t) => t.query('select 1 from public.promo_code'))).rowCount).toBe(0);
  });
  it('redemptions made in Testing are test rows', async () => {
    await tdb.query(`update public.club set status = 'testing' where id = $1`, [A]);
    await code('T1');
    const o = await order();
    await tdb.query(`insert into public.promo_redemption (club_id, code_id, order_id) select $1, id, $2 from public.promo_code`, [A, o]);
    expect((await tdb.query('select is_test from public.promo_redemption')).rows).toEqual([{ is_test: true }]);
  });
});

describe('order amounts and lines (F04-T03)', () => {
  it('an unpriced order has no amounts, and either all amounts are set or none', async () => {
    const o = await order();
    const r = (await tdb.query('select priced_at, money_satang from public.orders where id = $1', [o])).rows[0];
    expect(r).toEqual({ priced_at: null, money_satang: null });
    await expect(tdb.query(`update public.orders set money_satang = 100 where id = $1`, [o])).rejects.toThrow(/priced_together/);
  });
  it('a line is net = unit less discount and net = credit + wallet + money, never negative', async () => {
    const o = await order(); const b = await booking(o);
    await expect(tdb.query(`insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, discount_satang, net_satang, money_satang) values ($1,$2,1,'court_hour',$3,'k','ก','x',50000,5000,50000,50000)`, [A, o, b])).rejects.toThrow(/order_line_net/);
    await expect(line(o, b, 1, { credit: 10000, wallet: 10000, money: 10000 })).rejects.toThrow(/order_line_split/);
    await expect(line(o, b, 1, { unit: 1000, disc: 2000 })).rejects.toThrow();
    await line(o, b, 1, { disc: 5000, credit: 20000, wallet: 5000 });                  // 45000 = 20000 + 5000 + 20000
  });
  it('the order amounts equal the sums over the lines at commit (two hours, add-on, discount, credit, wallet)', async () => {
    const o = await order(); const b1 = await booking(o, 10); const b2 = await booking(o, 11);
    await tx(async (q) => {
      await q(`update public.orders set price_group_snapshot = '{}', subtotal_satang = 110000, discount_satang = 10000, total_satang = 100000, credit_value_satang = 45000, wallet_satang = 5000, money_satang = 50000, quote_hash = repeat('b',64), priced_at = now() where id = $1`, [o]);
      await q(`insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, discount_satang, net_satang, credit_value_satang, wallet_satang, money_satang) values ($1,$2,1,'court_hour',$3,'k','ก','x',50000,5000,45000,45000,0,0)`, [A, o, b1]);
      await q(`insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, discount_satang, net_satang, credit_value_satang, wallet_satang, money_satang) values ($1,$2,2,'court_hour',$3,'k','ก','x',50000,5000,45000,0,5000,40000)`, [A, o, b2]);
      await q(`insert into public.order_line (club_id, order_id, position, kind, booking_id, add_on_id, description_key, name_th, name_en, unit_price_satang, discount_satang, net_satang, credit_value_satang, wallet_satang, money_satang) values ($1,$2,3,'add_on',$3,$4,'k','ก','x',10000,0,10000,0,0,10000)`, [A, o, b1, ADDON]);
    });
    expect((await tdb.query('select count(*)::int as n from public.order_line')).rows[0].n).toBe(3);
  });
  it('lines that do not add up are refused at commit, and so is a priced order with no lines', async () => {
    const o = await order(); const b = await booking(o);
    await expect(tx(async (q) => {
      await q(`update public.orders set price_group_snapshot = '{}', subtotal_satang = 50000, discount_satang = 0, total_satang = 50000, credit_value_satang = 0, wallet_satang = 0, money_satang = 50000, quote_hash = repeat('b',64), priced_at = now() where id = $1`, [o]);
      await q(`insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, net_satang, money_satang) values ($1,$2,1,'court_hour',$3,'k','ก','x',40000,40000,40000)`, [A, o, b]);
    })).rejects.toThrow(/do not add up/);
    await expect(priceOrder(o, { sub: 50000, disc: 0, credit: 0, wallet: 0, money: 50000 })).rejects.toThrow(/do not add up/);
    await expect(tdb.query(`update public.orders set total_satang = 1, subtotal_satang = 1, discount_satang = 0, credit_value_satang = 0, wallet_satang = 0, money_satang = 2, quote_hash = repeat('a',64), priced_at = now() where id = $1`, [o])).rejects.toThrow(/total_is_split/);
  });
  it('after Pay nothing about the price changes, and lines can be neither edited nor removed (R4-AC9, R7-AC2)', async () => {
    const o = await order(); const b = await booking(o);
    await tx(async (q) => {
      await q(`update public.orders set price_group_snapshot = '{}', subtotal_satang = 50000, discount_satang = 0, total_satang = 50000, credit_value_satang = 0, wallet_satang = 0, money_satang = 50000, quote_hash = repeat('b',64), priced_at = now() where id = $1`, [o]);
      await q(`insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, net_satang, money_satang) values ($1,$2,1,'court_hour',$3,'k','ก','x',50000,50000,50000)`, [A, o, b]);
    });
    await expect(tdb.query(`update public.orders set money_satang = 0 where id = $1`, [o])).rejects.toThrow();
    await expect(tdb.query(`update public.orders set quote_hash = repeat('c',64) where id = $1`, [o])).rejects.toThrow(/does not change/);
    await tdb.query(`update public.orders set status = 'paid' where id = $1`, [o]);          // the status still moves
    await expect(tdb.query(`update public.order_line set name_en = 'renamed'`)).rejects.toThrow(/append-only/);
    await expect(tdb.query('delete from public.order_line')).rejects.toThrow(/append-only/);
  });
  it('line links: a court hour needs its booking, an add-on its add-on and a booking, a line cannot cross clubs', async () => {
    const o = await order(); const b = await booking(o);
    await expect(line(o, null, 1)).rejects.toThrow(/booking_link/);
    await expect(line(o, b, 1, { kind: 'add_on', unit: 10000 })).rejects.toThrow(/add_on_link/);
    await expect(line(o, b, 1, { kind: 'court_hour', addon: ADDON })).rejects.toThrow(/add_on_link/);
    await line(o, b, 1, { kind: 'add_on', unit: 10000, addon: ADDON });
    await expect(line(o, b, 1)).rejects.toThrow(/order_line_position/);
    await expect(line(o, b, 2, { kind: 'package' })).rejects.toThrow(/package_link/);
    const ob = await order(B);
    await expect(tdb.query(`insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, net_satang, money_satang) values ($1,$2,1,'court_hour',$3,'k','ก','x',1,1,1)`, [A, ob, b])).rejects.toThrow(/foreign key/i);
  });
  it('line rows made in Testing are test rows and go at Go live before their bookings and orders', async () => {
    await tdb.query(`update public.club set status = 'testing' where id = $1`, [A]);
    const o = await order(); const b = await booking(o);
    await line(o, b, 1);
    expect((await tdb.query('select is_test from public.order_line')).rows).toEqual([{ is_test: true }]);
    const order_ = (await tdb.query(`select table_name, delete_order from app.test_tables where table_name in ('order_line','booking','orders') order by delete_order`)).rows;
    expect(order_.map((r) => r.table_name)).toEqual(['order_line', 'booking', 'orders']);
  });
  it('reads: staff see the club’s lines, a player their own order’s lines only; BOOQ staff none', async () => {
    const o = await order(); const b = await booking(o);
    await line(o, b, 1);
    const other = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, OWNER])).rows[0].id;
    const b2 = await booking(other, 14);
    await line(other, b2, 1);
    expect((await web.withClubTx(ctx(PLAYER, ['player']), (t) => t.query('select 1 from public.order_line'))).rowCount).toBe(1);
    expect((await web.withClubTx(ctx(OWNER, ['owner', 'player']), (t) => t.query('select 1 from public.order_line'))).rowCount).toBe(2);
    expect((await tdb.query(`select has_table_privilege('booq_platform', 'public.order_line', 'select') as ok`)).rows[0].ok).toBe(false);
    await expect(web.withClubTx(ctx(OWNER, ['owner']), (t) => t.query('delete from public.order_line'))).rejects.toThrow(/permission denied/);
  });
  it('registered and checked', async () => {
    const reg = await collectRegistry();
    expect((await checkTableClasses(tdb.pool, reg)).problems.filter((p) => p.table !== 'app.test_clock')).toEqual([]);
  });
});
