import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F06-T03b / migration 0504: orders.kind (default sale) and the order line kind wallet_credit (PKG-01-AC4; D37, D74, D79).
// A wallet_credit order is the record a receipt attaches to when money arrives that cannot confirm anything: one
// line, money equals the amount credited, no credit part, no wallet part, no hour, add-on or package.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const PLAYER = '11111111-1111-4111-8111-111111111111';
let tdb: TestDatabase;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A')`, [A]);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [A, PLAYER, 'L1']);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, PLAYER]);
    await c.query('commit');
  } finally {
    c.release();
  }
});
afterEach(async () => {
  await tdb.close();
});

const LINE = `insert into public.order_line (club_id, order_id, position, kind, description_key, name_th, name_en, unit_price_satang, discount_satang, net_satang, credit_value_satang, wallet_satang, money_satang)
              values ($1,$2,$3,$4,'k','เครดิต','Credit',$5,0,$5,$6,$7,$8)`;

/** An order of `kind` with one real add-on line (a booking, a resource and an add-on behind it), to test the kind rules. */
async function sale(kind: string) {
  const loc = '00000000-0000-4000-8000-0000000000a1';
  const res = '00000000-0000-4000-8000-0000000000c1';
  const addOn = '00000000-0000-4000-8000-0000000000d1';
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M') on conflict do nothing`, [A, loc]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis') on conflict do nothing`, [A, res, loc]);
  await tdb.query(`insert into public.add_on (club_id, id, name_th, name_en, price_satang) values ($1,$2,'ก','Balls',40000) on conflict do nothing`, [A, addOn]);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    const o = (await c.query(`insert into public.orders (club_id, customer_id, source, kind) values ($1,$2,'staff',$3) returning id`, [A, PLAYER, kind])).rows[0].id as string;
    const b = (await c.query(
      `insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, hold_expires_at)
       values ($1,$2,'court',$3, date_trunc('hour', now()) + interval '70 hours', date_trunc('hour', now()) + interval '71 hours', $4,'awaiting_payment','staff',$4, now() + interval '10 minutes') returning id`,
      [A, o, res, PLAYER])).rows[0].id as string;
    await c.query(`update public.orders set price_group_snapshot='{}', subtotal_satang=40000, discount_satang=0, total_satang=40000, credit_value_satang=0, wallet_satang=0, money_satang=40000, quote_hash=repeat('a',64), priced_at=now() where id=$1`, [o]);
    await c.query(`insert into public.order_line (club_id, order_id, position, kind, booking_id, add_on_id, description_key, name_th, name_en, unit_price_satang, discount_satang, net_satang, money_satang)
                   values ($1,$2,1,'add_on',$3,$4,'k','ก','x',40000,0,40000,40000)`, [A, o, b, addOn]);
    await c.query('commit');
    return o;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

/** Builds a priced order of `kind` with the given lines (kind, net, credit, wallet) in one transaction. */
async function build(kind: string, lines: Array<[string, number, number, number]>, totals?: { sub: number; credit: number; wallet: number }) {
  const sub = totals?.sub ?? lines.reduce((s, l) => s + l[1], 0);
  const credit = totals?.credit ?? lines.reduce((s, l) => s + l[2], 0);
  const wallet = totals?.wallet ?? lines.reduce((s, l) => s + l[3], 0);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    const o = (await c.query(`insert into public.orders (club_id, customer_id, source, kind) values ($1,$2,'staff',$3) returning id`, [A, PLAYER, kind])).rows[0].id as string;
    await c.query(`update public.orders set price_group_snapshot='{}', subtotal_satang=$2, discount_satang=0, total_satang=$2, credit_value_satang=$3, wallet_satang=$4, money_satang=$5, quote_hash=repeat('a',64), priced_at=now() where id=$1`, [o, sub, credit, wallet, sub - credit - wallet]);
    let pos = 1;
    for (const [k, net, cr, wa] of lines) await c.query(LINE, [A, o, pos++, k, net, cr, wa, net - cr - wa]);
    await c.query('commit');
    return o;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

describe('orders.kind', () => {
  it('an order without a kind is a sale, and the kind is one of two', async () => {
    const o = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id, kind`, [A, PLAYER])).rows[0];
    expect(o.kind).toBe('sale');
    await expect(tdb.query(`insert into public.orders (club_id, customer_id, source, kind) values ($1,$2,'online','refund')`, [A, PLAYER])).rejects.toThrow(/orders_kind_values/);
  });

  it('the kind of an order never changes', async () => {
    const o = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, PLAYER])).rows[0].id;
    await expect(tdb.query(`update public.orders set kind = 'wallet_credit' where id = $1`, [o])).rejects.toThrow(/kind of an order/);
  });
});

describe('a wallet_credit order', () => {
  it('with one line of the amount passes the sum check', async () => {
    const o = await build('wallet_credit', [['wallet_credit', 40000, 0, 0]]);
    expect((await tdb.query(`select kind, total_satang, money_satang, credit_value_satang, wallet_satang from public.orders where id = $1`, [o])).rows[0]).toEqual({ kind: 'wallet_credit', total_satang: 40000, money_satang: 40000, credit_value_satang: 0, wallet_satang: 0 });
  });

  it('with a credit part or a wallet part on the line is refused', async () => {
    await expect(build('wallet_credit', [['wallet_credit', 40000, 10000, 0]])).rejects.toThrow(/wallet_credit/);
    await expect(build('wallet_credit', [['wallet_credit', 40000, 0, 10000]])).rejects.toThrow(/wallet_credit/);
  });

  it('with a sale line, two lines, or no line is refused; a sale order with a wallet_credit line is refused', async () => {
    await expect(sale('wallet_credit')).rejects.toThrow(/only wallet_credit lines|exactly one/);
    await expect(build('wallet_credit', [['wallet_credit', 20000, 0, 0], ['wallet_credit', 20000, 0, 0]])).rejects.toThrow(/exactly one/);
    await expect(build('sale', [['wallet_credit', 40000, 0, 0]])).rejects.toThrow(/only on a wallet_credit order/);
    expect(await sale('sale')).toBeTruthy();   // a real sale line is fine on a sale order
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      const o = (await c.query(`insert into public.orders (club_id, customer_id, source, kind) values ($1,$2,'staff','wallet_credit') returning id`, [A, PLAYER])).rows[0].id as string;
      await c.query(`update public.orders set price_group_snapshot='{}', subtotal_satang=40000, discount_satang=0, total_satang=40000, credit_value_satang=0, wallet_satang=0, money_satang=40000, quote_hash=repeat('a',64), priced_at=now() where id=$1`, [o]);
      await expect(c.query('commit')).rejects.toThrow(/exactly one|do not add up/);
    } finally {
      c.release();
    }
  });

  it('the lines must add up to the order amounts, as for every priced order', async () => {
    await expect(build('wallet_credit', [['wallet_credit', 40000, 0, 0]], { sub: 50000, credit: 0, wallet: 0 })).rejects.toThrow(/do not add up/);
  });

  it('names no hour, add-on or package', async () => {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      const o = (await c.query(`insert into public.orders (club_id, customer_id, source, kind) values ($1,$2,'staff','wallet_credit') returning id`, [A, PLAYER])).rows[0].id as string;
      await expect(c.query(
        `insert into public.order_line (club_id, order_id, position, kind, package_product_id, description_key, name_th, name_en, unit_price_satang, discount_satang, net_satang, money_satang)
         values ($1,$2,1,'wallet_credit',gen_random_uuid(),'k','ก','x',40000,0,40000,40000)`, [A, o])).rejects.toThrow();
      await c.query('rollback');
    } finally {
      c.release();
    }
  });
});
