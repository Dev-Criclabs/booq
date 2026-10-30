import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F04-T12b-db / migration 0317: app.create_priced_order and app.add_order_lines (CC-2, SR-07, R4-AC4).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
const PB = '55555555-5555-4555-8555-555555555555';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const RES = '00000000-0000-4000-8000-0000000000c1';
const ADDON = '00000000-0000-4000-8000-0000000000d1';
const HASH = 'a'.repeat(64);
let tdb: TestDatabase;
let web: Db;

const ctx = (user: string | null, roles: string[], club = A) => ({ clubId: club, userId: user, roles: roles as never, source: 'player_app' as const });
const player = (u = P1) => ctx(u, ['player']);
const staff = () => ctx(DESK, ['front_desk', 'player']);
const priced = (over: Record<string, unknown> = {}) => ({
  price_group_snapshot: { id: '00000000-0000-4000-8000-0000000000f1', name_th: 'ผู้ใหญ่', name_en: 'Adult' },
  subtotal_satang: 50000, discount_satang: 5000, total_satang: 45000, credit_value_satang: 10000, wallet_satang: 5000, money_satang: 30000,
  promo_code_id: null, birthday_entitlement: false, quote_hash: HASH, ...over,
});
/** Pay writes the order and its lines in ONE transaction (the sum check runs at commit), so a lone order is read inside its transaction and rolled back. */
class Rollback extends Error {
  constructor(readonly value: unknown) {
    super('rollback');
  }
}
const seen = async <T>(c: ReturnType<typeof ctx>, fn: (tx: Parameters<Parameters<Db['withClubTx']>[1]>[0]) => Promise<T>): Promise<T> => {
  try {
    await web.withClubTx(c, async (tx) => {
      throw new Rollback(await fn(tx));
    });
  } catch (e) {
    if (e instanceof Rollback) return e.value as T;
    throw e;
  }
  throw new Error('unreachable');
};
const createIn = async (tx: Parameters<Parameters<Db['withClubTx']>[1]>[0], customer: string | null, p: unknown = priced()) =>
  (await tx.query(`select app.create_priced_order($1, $2::jsonb) as id`, [customer, JSON.stringify(p)])).rows[0]?.id as string;
const orderRow = (id: string, tx: Parameters<Parameters<Db['withClubTx']>[1]>[0]) =>
  tx.query(`select customer_id, source, status, kind, priced_at, subtotal_satang, discount_satang, total_satang, credit_value_satang, wallet_satang, money_satang, quote_hash, price_group_snapshot, is_test from public.orders where id = $1`, [id]);
const create = (c: ReturnType<typeof ctx>, customer: string | null, p: unknown = priced()) => seen(c, (tx) => createIn(tx, customer, p));

/** An order as Pay leaves it before the lines (written outside the function with the sum trigger off, so the lines can follow in their own call). */
async function seedOrder(customer = P1, p: Record<string, number | null | object | string | boolean> = priced(), club = A): Promise<string> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    const r = await c.query(
      `insert into public.orders (club_id, customer_id, source, status, price_group_snapshot, subtotal_satang, discount_satang, total_satang, credit_value_satang, wallet_satang, money_satang, quote_hash, priced_at)
       values ($1,$2,'online','open',$3::jsonb,$4,$5,$6,$7,$8,$9,$10, app.now()) returning id`,
      [club, customer, JSON.stringify(p.price_group_snapshot), p.subtotal_satang, p.discount_satang, p.total_satang, p.credit_value_satang, p.wallet_satang, p.money_satang, p.quote_hash]);
    await c.query('commit');
    return r.rows[0].id as string;
  } finally {
    c.release();
  }
}

async function person(club: string, id: string, roles: string[], active = true) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('insert into public.app_user (club_id, id, line_user_id, active) values ($1,$2,$3,$4)', [club, id, 'L' + id.slice(0, 4), active]);
    for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await person(A, P1, ['player']);
  await person(A, P2, ['player']);
  await person(A, DESK, ['front_desk', 'player']);
  await person(B, PB, ['player']);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, RES, LOC]);
  await tdb.query(`insert into public.add_on (club_id, id, name_th, name_en, price_satang) values ($1,$2,'ลูกเทนนิส','Balls',10000)`, [A, ADDON]);
  web = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});

describe('app.create_priced_order', () => {
  it('writes one open priced order for the caller, source online, with the frozen amounts and priced_at now', async () => {
    const o = await seen(player(), async (tx) => (await orderRow(await createIn(tx, null), tx)).rows[0]!);
    expect(o).toMatchObject({ customer_id: P1, source: 'online', status: 'open', kind: 'sale', subtotal_satang: 50000, discount_satang: 5000, total_satang: 45000, credit_value_satang: 10000, wallet_satang: 5000, money_satang: 30000, quote_hash: HASH, is_test: false });
    expect(o.price_group_snapshot).toMatchObject({ name_en: 'Adult' });
    expect(new Date(o.priced_at).toISOString()).toBe('2026-12-01T03:00:00.000Z');
  });

  it('the caller may name themselves; another player may not (R-own)', async () => {
    expect(await create(player(), P1)).toBeTruthy();
    await expect(create(player(), P2)).rejects.toThrow(/not allowed/);
  });

  it('staff pay for another active person of the club, source staff; not for an unknown, inactive or other club’s person', async () => {
    const o = await seen(staff(), async (tx) => (await orderRow(await createIn(tx, P2), tx)).rows[0]!);
    expect(o).toMatchObject({ customer_id: P2, source: 'staff' });
    await person(A, '66666666-6666-4666-8666-666666666666', ['player'], false);
    await expect(create(staff(), '66666666-6666-4666-8666-666666666666')).rejects.toThrow(/unknown customer/);
    await expect(create(staff(), PB)).rejects.toThrow(/unknown customer/);
    await expect(create(staff(), '99999999-9999-4999-8999-999999999999')).rejects.toThrow(/unknown customer/);
  });

  it('a guest or no one is refused, and no club in the context is refused', async () => {
    await expect(create(ctx(null, ['guest']), null)).rejects.toThrow(/not allowed/);
  });

  it('the 0303 checks apply: the split must add up, no negative amounts, a 64 hex quote hash, a known promo code', async () => {
    await expect(create(player(), null, priced({ money_satang: 29999 }))).rejects.toThrow(/invalid priced order/);
    await expect(create(player(), null, priced({ total_satang: 44999 }))).rejects.toThrow(/invalid priced order/);
    await expect(create(player(), null, priced({ discount_satang: -1, total_satang: 50001, money_satang: 30001 }))).rejects.toThrow(/invalid priced order/);
    await expect(create(player(), null, priced({ quote_hash: 'xyz' }))).rejects.toThrow(/invalid priced order/);
    await expect(create(player(), null, priced({ promo_code_id: '99999999-9999-4999-8999-999999999999' }))).rejects.toThrow(/invalid priced order/);
    await expect(create(player(), null, priced({ subtotal_satang: 'many' }))).rejects.toThrow(/invalid priced order/);
    await expect(create(player(), null, { ...priced(), price_group_snapshot: null })).rejects.toThrow(/invalid priced order/);
    await expect(create(player(), null, 'not an object')).rejects.toThrow(/invalid priced order/);
    expect((await tdb.query(`select count(*)::int as n from public.orders`)).rows[0].n).toBe(0);
  });

  it('a Testing club’s order is a test row', async () => {
    await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ('9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6e','c','ค','C','testing')`);
    const T = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6e';
    await person(T, '77777777-7777-4777-8777-777777777777', ['player']);
    const o = await seen(ctx('77777777-7777-4777-8777-777777777777', ['player'], T), async (tx) => (await orderRow(await createIn(tx, null), tx)).rows[0]!);
    expect(o.is_test).toBe(true);
  });

  it('is for booq_app only', async () => {
    for (const role of ['booq_worker', 'booq_platform']) {
      expect((await tdb.query(`select has_function_privilege($1, 'app.create_priced_order(uuid, jsonb)', 'execute') as ok`, [role])).rows[0].ok, role).toBe(false);
      expect((await tdb.query(`select has_function_privilege($1, 'app.add_order_lines(uuid, jsonb)', 'execute') as ok`, [role])).rows[0].ok, role).toBe(false);
    }
  });
});

describe('app.add_order_lines', () => {
  const booking = async (order: string, customer = P1, hour = 30) => {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local session_replication_role = replica');
      const r = await c.query(
      `insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, hold_expires_at)
       values ($1,$2,'court',$3, date_trunc('hour', timestamptz '2026-12-01T03:00:00Z') + interval '${hour} hours', date_trunc('hour', timestamptz '2026-12-01T03:00:00Z') + interval '${hour + 1} hours', $4,'awaiting_payment','online',$4, timestamptz '2026-12-01T03:00:00Z' + interval '15 minutes') returning id`,
      [A, order, RES, customer]);
      await c.query('commit');
      return r.rows[0].id as string;
    } finally {
      c.release();
    }
  };
  const line = (pos: number, kind: string, extra: Record<string, unknown> = {}) => ({
    position: pos, kind, booking_id: null, add_on_id: null, package_product_id: null, description_key: 'k', name_th: 'ก', name_en: 'x',
    unit_price_satang: 0, discount_satang: 0, net_satang: 0, credit_package_id: null, credit_units: 0, credit_value_satang: 0, wallet_satang: 0, money_satang: 0, scope: {}, ...extra,
  });
  const add = (c: ReturnType<typeof ctx>, order: string, lines: unknown) =>
    web.withClubTx(c, async (tx) => tx.query(`select app.add_order_lines($1, $2::jsonb)`, [order, JSON.stringify(lines)]));

  const goodLines = (b: string) => [
    line(1, 'court_hour', { booking_id: b, unit_price_satang: 50000, discount_satang: 5000, net_satang: 45000, credit_package_id: '99999999-9999-4999-8999-999999999999', credit_units: 1, credit_value_satang: 10000, wallet_satang: 5000, money_satang: 30000 }),
  ];
  /** An order priced for one court hour, with a booking for it, written outside the function (the hold is reserve_court's job). */
  async function orderWithBooking(customer = P1) {
    const id = await seedOrder(customer);
    return { id, booking: await booking(id, customer) };
  }

  it('writes the lines of the caller’s own priced order, and the sums are checked at commit', async () => {
    const { id, booking: b } = await orderWithBooking();
    await add(player(), id, goodLines(b));
    expect((await tdb.query(`select kind, position, booking_id, net_satang from public.order_line where order_id = $1`, [id])).rows).toEqual([{ kind: 'court_hour', position: 1, booking_id: b, net_satang: 45000 }]);
  });

  it('an add-on line links the first hour’s booking (D111)', async () => {
    const id = await seedOrder(P1, priced({ subtotal_satang: 60000, discount_satang: 5000, total_satang: 55000, credit_value_satang: 10000, wallet_satang: 5000, money_satang: 40000 }));
    const b = await booking(id);
    await add(player(), id, [...goodLines(b), line(2, 'add_on', { booking_id: b, add_on_id: ADDON, unit_price_satang: 10000, net_satang: 10000, money_satang: 10000 })]);
    expect((await tdb.query(`select count(*)::int as n from public.order_line where order_id = $1`, [id])).rows[0].n).toBe(2);
  });

  it('lines that do not add up to the order are refused at commit by the sum trigger', async () => {
    const { id, booking: b } = await orderWithBooking();
    const lines = goodLines(b);
    (lines[0] as Record<string, unknown>).money_satang = 25000;
    (lines[0] as Record<string, unknown>).net_satang = 45000;
    await expect(add(player(), id, lines)).rejects.toThrow(/order_line_split|do not add up/);
  });

  it('only once: a second write for the same order is refused', async () => {
    const { id, booking: b } = await orderWithBooking();
    await add(player(), id, goodLines(b));
    await expect(add(player(), id, goodLines(b))).rejects.toThrow(/already written/);
  });

  it('another player’s order, an unknown order and another club’s order look the same; staff may write any order of the club', async () => {
    const { id, booking: b } = await orderWithBooking();
    await expect(add(player(P2), id, goodLines(b))).rejects.toThrow(/no such order/);
    await expect(add(player(), '99999999-9999-4999-8999-999999999999', goodLines(b))).rejects.toThrow(/no such order/);
    await expect(add(ctx(PB, ['player'], B), id, goodLines(b))).rejects.toThrow(/no such order/);
    await add(staff(), id, goodLines(b));
    expect((await tdb.query(`select count(*)::int as n from public.order_line where order_id = $1`, [id])).rows[0].n).toBe(1);
  });

  it('each booking must belong to the order', async () => {
    const { id } = await orderWithBooking();
    const other = await seedOrder(P2);
    const foreign = await booking(other, P2, 40);
    await expect(add(player(), id, goodLines(foreign))).rejects.toThrow(/booking of another order/);
    await expect(add(player(), id, goodLines('99999999-9999-4999-8999-999999999999'))).rejects.toThrow(/booking of another order/);
  });

  it('a court hour line without its booking is refused by the 0303 check', async () => {
    const { id } = await orderWithBooking();
    await expect(add(player(), id, [line(1, 'court_hour', { unit_price_satang: 50000, net_satang: 50000, money_satang: 50000 })])).rejects.toThrow(/invalid line/);
  });

  it('wallet_credit lines are refused here; class_seat lines are allowed (F08 seat, F04-T22b)', async () => {
    const { id, booking: b } = await orderWithBooking();
    await expect(add(player(), id, [line(1, 'wallet_credit', { unit_price_satang: 45000, net_satang: 45000, money_satang: 45000 })])).rejects.toThrow(/invalid line kind/);
    await expect(add(player(), id, [line(1, 'refund')])).rejects.toThrow(/invalid line kind/);
    await add(player(), id, [line(1, 'class_seat', { booking_id: b, unit_price_satang: 50000, discount_satang: 5000, net_satang: 45000, credit_value_satang: 10000, wallet_satang: 5000, money_satang: 30000 })]);
  });

  it('an unpriced, paid, cancelled or wallet_credit order takes no lines, and an empty or malformed list is refused', async () => {
    const { id, booking: b } = await orderWithBooking();
    const unpriced = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id;
    await expect(add(player(), unpriced, goodLines(b))).rejects.toThrow(/not an open priced sale/);
    await expect(add(player(), id, [])).rejects.toThrow(/invalid lines/);
    await expect(add(player(), id, { not: 'a list' })).rejects.toThrow(/invalid lines/);
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local session_replication_role = replica');
      await c.query(`update public.orders set status = 'cancelled' where id = $1`, [id]);
      await c.query('commit');
    } finally {
      c.release();
    }
    await expect(add(player(), id, goodLines(b))).rejects.toThrow(/not an open priced sale/);
  });
});

describe('lock order (migration 0318, FA 3.4)', () => {
  /** Runs fn inside a club transaction and rolls it back (an order without lines cannot commit). */
  const probe = async (c: ReturnType<typeof ctx>, fn: (tx: Parameters<Parameters<Db['withClubTx']>[1]>[0]) => Promise<void>) => {
    try {
      await web.withClubTx(c, async (tx) => {
        await fn(tx);
        throw new Rollback(null);
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  };

  it('creating a priced order takes the customer lock first: a second Pay of the same customer waits for the first, and nothing deadlocks', async () => {
    const events: string[] = [];
    const first = probe(player(), async (tx) => {
      await createIn(tx, null);
      events.push('first has its order');
      await tx.query(`select pg_sleep(0.4)`);
      events.push('first ends');
    });
    await new Promise((r) => setTimeout(r, 150));
    const second = probe(player(), async (tx) => {
      await createIn(tx, null);
      events.push('second has its order');
    });
    await Promise.all([first, second]);
    expect(events).toEqual(['first has its order', 'first ends', 'second has its order']);
  });

  it('two different customers do not wait for each other', async () => {
    const events: string[] = [];
    const first = probe(player(P1), async (tx) => {
      await createIn(tx, null);
      await tx.query(`select pg_sleep(0.4)`);
      events.push('first ends');
    });
    await new Promise((r) => setTimeout(r, 150));
    const second = probe(player(P2), async (tx) => {
      await createIn(tx, null);
      events.push('second has its order');
    });
    await Promise.all([first, second]);
    expect(events).toEqual(['second has its order', 'first ends']);
  });

  it('reserve_court takes the same customer lock later in the same transaction without waiting for itself', async () => {
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [A]);
    await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) select $1, d, '06:00', '24:00' from generate_series(1, 7) d`, [A]);
    await probe(player(), async (tx) => {
      const id = await createIn(tx, null);
      await tx.query(`select app.reserve_court($1, $2, $3::timestamptz[], null, null)`, [id, RES, [new Date('2026-12-02T18:00:00+07:00').toISOString()]]);
    });
  });
});
