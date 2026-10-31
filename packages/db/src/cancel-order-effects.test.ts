import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F09-T06a / migration 1006: app.cancel_order_effects(booking, kind) (F09 design 4.2 step 4; CANCEL-01-AC8, AC11,
// AC12, AC15; D67, D70). After a booking's status is set: F04's restore_line for its lines, which restores the promo
// code use and the birthday entitlement only when the last live hour of the order is cancelled (a restored use no
// longer counts toward the partner's redemptions, D70), and the order becomes cancelled when every line is.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const COURT = '00000000-0000-4000-8000-0000000000e1';

let tdb: TestDatabase;

async function asDefiner(sql: string, args: unknown[] = []): Promise<any> {
  const c: pg.PoolClient = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role booq_owner');
    await c.query(`select set_config('app.club_id', $1, true), set_config('app.user_id', $2, true), set_config('app.roles', 'player', true),
                          set_config('app.source', 'player_app', true), set_config('app.request_id', 'r', true)`, [A, PLAYER]);
    const r = await c.query(sql, args);
    await c.query('commit');
    return Object.values(r.rows[0] ?? {})[0];
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
/** Admin fixture writes with triggers off. */
async function fixture<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } finally {
    c.release();
  }
}
/** An order of `hours` confirmed hours, one line each, with a counted promo use and a used birthday entitlement. */
async function order(hours: number, o: { packageLine?: boolean } = {}) {
  return fixture(async (c) => {
    const order = (await c.query(`insert into public.orders (club_id, customer_id, source, status) values ($1,$2,'online','paid') returning id`, [A, PLAYER])).rows[0].id as string;
    const bookings: string[] = [];
    for (let h = 0; h < hours; h += 1) {
      const start = new Date(Date.parse('2027-02-10T10:00:00Z') + h * 3_600_000).toISOString();
      const b = (await c.query(
        `insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
         values ($1,$2,'court',$3,$4::timestamptz,$4::timestamptz + interval '1 hour',$5,'confirmed','online',$5,now()) returning id`, [A, order, COURT, start, PLAYER])).rows[0].id as string;
      await c.query(
        `insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, net_satang, money_satang)
         values ($1,$2,$3,'court_hour',$4,'k','ก','x',40000,40000,40000)`, [A, order, h + 1, b]);
      bookings.push(b);
    }
    if (o.packageLine) {
      await c.query(
        `insert into public.order_line (club_id, order_id, position, kind, package_product_id, description_key, name_th, name_en, unit_price_satang, net_satang, money_satang)
         values ($1,$2,$3,'package',gen_random_uuid(),'k','ก','x',100000,100000,100000)`, [A, order, hours + 1]);
    }
    const code = (await c.query(`insert into public.promo_code (club_id, code_upper, kind, value, applies_to) values ($1,$2,'percent',1000,'{court_hour}') returning id`,
      [A, ('SAVE' + order.slice(0, 4)).toUpperCase()])).rows[0].id;
    await c.query(`insert into public.promo_redemption (club_id, code_id, order_id, customer_id, status) values ($1,$2,$3,$4,'counted')`, [A, code, order, PLAYER]);
    await c.query(`insert into public.birthday_entitlement_use (club_id, customer_id, year, kind, order_id) values ($1,$2,2027,'solo_class',$3)`, [A, PLAYER, order]);
    return { order, bookings };
  });
}
const setStatus = (booking: string, status: string) => fixture((c) => c.query(`update public.booking set status = $2 where id = $1`, [booking, status]));
const effects = (booking: string, kind = 'player_cancel') => asDefiner('select app.cancel_order_effects($1, $2)', [booking, kind]) as Promise<{ codeRestored: boolean; orderCancelled: boolean }>;
const promo = async (o: string) => (await tdb.query(`select status from public.promo_redemption where order_id = $1`, [o])).rows[0].status;
const birthday = async (o: string) => (await tdb.query(`select status from public.birthday_entitlement_use where order_id = $1`, [o])).rows[0].status;
const orderStatus = async (o: string) => (await tdb.query(`select status from public.orders where id = $1`, [o])).rows[0].status;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [A, PLAYER, 'L1']);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, PLAYER]);
    await c.query('commit');
  } finally {
    c.release();
  }
  const loc = (await tdb.query(`insert into public.location (club_id, name) values ($1,'Main') returning id`, [A])).rows[0].id;
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, COURT, loc]);
});
afterEach(async () => {
  await tdb.close();
});

describe('app.cancel_order_effects (D67, D70)', () => {
  it('cancelling one of two hours restores nothing yet; cancelling the last restores the code use and the birthday entitlement once', async () => {
    const o = await order(2);
    await setStatus(o.bookings[0]!, 'cancelled');
    expect(await effects(o.bookings[0]!)).toEqual({ codeRestored: false, orderCancelled: false });
    expect(await promo(o.order)).toBe('counted');
    expect(await birthday(o.order)).toBe('used');
    expect(await orderStatus(o.order)).toBe('paid');
    await setStatus(o.bookings[1]!, 'cancelled');
    expect(await effects(o.bookings[1]!)).toEqual({ codeRestored: true, orderCancelled: true });
    expect(await promo(o.order)).toBe('restored');      // a restored use no longer counts for the partner (D70)
    expect(await birthday(o.order)).toBe('restored');
    expect(await orderStatus(o.order)).toBe('cancelled');
  });

  it('a repeat changes nothing', async () => {
    const o = await order(1);
    await setStatus(o.bookings[0]!, 'cancelled');
    expect(await effects(o.bookings[0]!)).toEqual({ codeRestored: true, orderCancelled: true });
    expect(await effects(o.bookings[0]!)).toEqual({ codeRestored: false, orderCancelled: false });
    expect((await tdb.query(`select count(*)::int n from public.promo_redemption where status = 'restored'`)).rows[0].n).toBe(1);
  });

  it('a late cancel of the last hour restores no code use (the value is forfeited) but the order is still cancelled', async () => {
    const o = await order(1);
    await setStatus(o.bookings[0]!, 'late_cancelled');
    expect(await effects(o.bookings[0]!, 'late_cancel_mark')).toEqual({ codeRestored: false, orderCancelled: true });
    expect(await promo(o.order)).toBe('counted');
  });

  it('an order that also bought a package is not cancelled by cancelling its hours', async () => {
    const o = await order(1, { packageLine: true });
    await setStatus(o.bookings[0]!, 'cancelled');
    expect((await effects(o.bookings[0]!)).orderCancelled).toBe(false);
    expect(await orderStatus(o.order)).toBe('paid');
  });

  it('refuses a booking that is not cancelled yet, an unknown booking and a kind that is not a cancel', async () => {
    const o = await order(1);
    await expect(effects(o.bookings[0]!)).rejects.toThrow(/cancel:not_cancelled/);
    await setStatus(o.bookings[0]!, 'cancelled');
    await expect(effects(o.bookings[0]!, 'no_show_mark')).rejects.toThrow(/cancel:kind/);
    await expect(effects('ffffffff-0000-4000-8000-000000000000')).rejects.toThrow(/cancel:not_found/);
  });

  it('no app role may call it', async () => {
    for (const role of ['booq_app', 'booq_worker', 'booq_platform']) {
      expect((await tdb.query(`select has_function_privilege($1, 'app.cancel_order_effects(uuid, text)', 'execute') as ok`, [role])).rows[0].ok, role).toBe(false);
    }
  });
});
