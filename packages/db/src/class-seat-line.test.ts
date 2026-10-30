import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F04-T22a / migration 0516: order_line.kind gains class_seat (CLASS-01-AC14, AC17; R4). A seat line names its
// booking and carries the same allocation columns as a court hour line; the sum invariant of 0303 holds.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const RES = '00000000-0000-4000-8000-0000000000c1';
let tdb: TestDatabase;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, RES, LOC]);
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

/** An order with one booking of the given type; the order's amounts are those of one line of `net` satang. */
async function build(opts: { type: 'class_seat' | 'court'; kind: string; withBooking?: boolean; net?: number; credit?: number; wallet?: number }) {
  const net = opts.net ?? 40000;
  const credit = opts.credit ?? 0;
  const wallet = opts.wallet ?? 0;
  const money = net - credit - wallet;
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    const o = (await c.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, PLAYER])).rows[0].id as string;
    const b = (await c.query(
      `insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, hold_expires_at)
       values ($1,$2,$3,$4, date_trunc('hour', now()) + interval '50 hours', date_trunc('hour', now()) + interval '51 hours', $5,'awaiting_payment','online',$5, now() + interval '10 minutes') returning id`,
      [A, o, opts.type, RES, PLAYER])).rows[0].id as string;
    await c.query(`update public.orders set price_group_snapshot='{}', subtotal_satang=$2, discount_satang=0, total_satang=$2, credit_value_satang=$3, wallet_satang=$4, money_satang=$5, quote_hash=repeat('a',64), priced_at=now() where id=$1`, [o, net, credit, wallet, money]);
    await c.query(
      `insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, discount_satang, net_satang, credit_value_satang, wallet_satang, money_satang)
       values ($1,$2,1,$3,$4,'k','ที่นั่ง','Seat',$5,0,$5,$6,$7,$8)`,
      [A, o, opts.kind, opts.withBooking === false ? null : b, net, credit, wallet, money]);
    await c.query('commit');
    return o;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

describe('a class_seat order line', () => {
  it('is accepted with its booking, with money, credit or wallet as the allocation', async () => {
    const o1 = await build({ type: 'class_seat', kind: 'class_seat' });
    const o2 = await build({ type: 'class_seat', kind: 'class_seat', credit: 40000 });
    const o3 = await build({ type: 'class_seat', kind: 'class_seat', credit: 10000, wallet: 10000 });
    for (const o of [o1, o2, o3]) expect((await tdb.query(`select kind from public.order_line where order_id = $1`, [o])).rows[0].kind).toBe('class_seat');
  });

  it('is refused without a booking', async () => {
    await expect(build({ type: 'class_seat', kind: 'class_seat', withBooking: false })).rejects.toThrow(/order_line_booking_link/);
  });

  it('keeps the sum invariant: the split must add up to the net, and the lines to the order', async () => {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      const o = (await c.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, PLAYER])).rows[0].id as string;
      const b = (await c.query(
        `insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, hold_expires_at)
         values ($1,$2,'class_seat',$3, date_trunc('hour', now()) + interval '60 hours', date_trunc('hour', now()) + interval '61 hours', $4,'awaiting_payment','online',$4, now() + interval '10 minutes') returning id`,
        [A, o, RES, PLAYER])).rows[0].id as string;
      await expect(c.query(
        `insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, discount_satang, net_satang, credit_value_satang, wallet_satang, money_satang)
         values ($1,$2,1,'class_seat',$3,'k','ก','x',40000,0,40000,10000,10000,10000)`, [A, o, b])).rejects.toThrow(/order_line_split/);
      await c.query('rollback');
    } finally {
      c.release();
    }
    // a priced order whose seat line is missing fails at commit
    const c2 = await tdb.pool.connect();
    try {
      await c2.query('begin');
      const o = (await c2.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, PLAYER])).rows[0].id as string;
      await c2.query(`update public.orders set price_group_snapshot='{}', subtotal_satang=40000, discount_satang=0, total_satang=40000, credit_value_satang=0, wallet_satang=0, money_satang=40000, quote_hash=repeat('a',64), priced_at=now() where id=$1`, [o]);
      await expect(c2.query('commit')).rejects.toThrow(/do not add up/);
    } finally {
      c2.release();
    }
  });
});

describe('the other kinds are unchanged', () => {
  it('a wallet_credit line (migration 0504) is still accepted by the kind list', async () => {
    const kinds = (await tdb.query(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'order_line_kind_values'`)).rows[0].d as string;
    for (const k of ['court_hour', 'coach', 'add_on', 'package', 'wallet_credit', 'class_seat']) expect(kinds).toContain(`'${k}'`);
  });

  it('a court hour still needs its booking, and an unknown kind is still refused', async () => {
    await build({ type: 'court', kind: 'court_hour' });
    await expect(build({ type: 'court', kind: 'court_hour', withBooking: false })).rejects.toThrow(/order_line_booking_link/);
    await expect(build({ type: 'court', kind: 'seat' })).rejects.toThrow(/order_line_kind_values/);
  });
});
