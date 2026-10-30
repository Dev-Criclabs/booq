import { afterEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createDb } from './tx';
import { createTestDatabase } from './testing/harness';
import { A, PLAYER, RES, apply, bookingStatus, order, orderStatus, pay, payment, setup, tdb, teardown } from './testing/payment-fixtures';

// F06-T09 / migration 0511: the F06 payment ports and app.lock_wallet_and_packages (PKG-01-AC12, R3-AC1, AC7, AC9;
// design 4.4, 4.9). The F05 fixtures register fakes for every port; these tests put F06's real ports back.
afterEach(teardown);

const OTHER = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
const F06_PORTS: [string, string][] = [
  ['reserve_credit_and_wallet', 'app.port_reserve_credit_and_wallet(uuid)'],
  ['grant_package', 'app.port_grant_package(uuid)'],
  ['credit_wallet', 'app.port_credit_wallet(text, uuid, integer, text, text, uuid)'],
];
let product: string;

async function realPorts() {
  for (const [port, handler] of F06_PORTS) {
    await tdb.query(`delete from app.payment_ports where port = $1`, [port]);
    await tdb.query(`select app.register_payment_port($1, $2::regprocedure)`, [port, handler]);
  }
}
async function people() {
  for (const [u, roles] of [[OTHER, ['player']], [DESK, ['front_desk', 'player']], ['44444444-4444-4444-8444-444444444444', ['owner', 'player']]] as const) {
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
}
async function start(opts: { reserveOk?: boolean } = {}) {
  await setup(opts);
  await realPorts();
  await people();
  product = (await tdb.query(`insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_satang)
                              values ($1,'10 ชั่วโมง','10 hours','court_hour',10,3,450000) returning id`, [A])).rows[0].id;
}
/** Runs as booq_owner in the club's context, as the definer functions call the ports. */
async function asDefiner<T = unknown>(sql: string, args: unknown[] = [], client?: pg.ClientBase): Promise<T> {
  const c = client ?? (await tdb.pool.connect());
  try {
    await c.query('begin');
    await c.query('set local role booq_owner');
    await c.query(`select set_config('app.club_id', $1, true)`, [A]);
    const r = Object.values((await c.query(sql, args)).rows[0] ?? {})[0] as T;
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    if (!client) (c as pg.PoolClient).release();
  }
}
/** As the app role, the way Pay calls it: a player for themselves, or staff. */
const asApp = (user: string, roles: string[], sql: string, args: unknown[]) => {
  const db = createDb({ connectionString: tdb.url, max: 1 });
  return db.withClubTx({ clubId: A, userId: user, roles, source: 'player_app' as const }, (tx) => tx.query(sql, args)).finally(() => db.end());
};
/** Sets a line's allocation on a fixture order (sums off: a fixture). */
async function allocate(o: string, fields: { credit_package_id?: string | null; credit_units?: number; wallet_satang?: number; scope?: object }) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    await c.query(`update public.order_line set credit_package_id = $2, credit_units = $3, wallet_satang = $4, scope = $5,
                     money_satang = net_satang - credit_value_satang - $4 where order_id = $1 and position = 1`,
      [o, fields.credit_package_id ?? null, fields.credit_units ?? 0, fields.wallet_satang ?? 0, JSON.stringify(fields.scope ?? {})]);
    await c.query(`update public.orders set wallet_satang = $2, money_satang = total_satang - credit_value_satang - $2 where id = $1`, [o, fields.wallet_satang ?? 0]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
async function ownedPackage(credits = 5, expires = "now() + interval '30 days'") {
  return (await tdb.query(`insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, expires_at)
                           values ($1,$2,$3,'{"credit_type":"court_hour"}',$4, now() - interval '1 day', ${expires}) returning id`, [A, PLAYER, product, credits])).rows[0].id as string;
}
const credit = (amount: number, key: string) => asDefiner('select app.wallet_credit($1, $2, $3, $4)', [PLAYER, amount, 'refund', key]);
const reserve = (o: string) => asDefiner<boolean>('select app.port_reserve_credit_and_wallet($1)', [o]);
const rows = async () => (await tdb.query(`select (select count(*)::int from public.credit_ledger) as c, (select count(*)::int from public.wallet_ledger) as w`)).rows[0];

describe('registration (design 4.9)', () => {
  it('a database with only the migrations has each F06 port pointing at its function', async () => {
    await setup();                                        // teardown expects it
    const fresh = await createTestDatabase();
    try {
      const r = (await fresh.query(`select port, handler::text as h from app.payment_ports where port in ('reserve_credit_and_wallet', 'grant_package', 'credit_wallet') order by port`)).rows;
      expect(r).toEqual([
        { port: 'credit_wallet', h: 'app.port_credit_wallet(text,uuid,integer,text,text,uuid)' },
        { port: 'grant_package', h: 'app.port_grant_package(uuid)' },
        { port: 'reserve_credit_and_wallet', h: 'app.port_reserve_credit_and_wallet(uuid)' },
      ]);
    } finally {
      await fresh.close();
    }
  });
  it('a missing port raises payment:port_missing', async () => {
    await setup();
    await tdb.query(`delete from app.payment_ports where port = 'grant_package'`);
    await expect(asDefiner(`select app.port_of('grant_package')`)).rejects.toThrow(/payment:port_missing:grant_package/);
  });
});

describe('reserve_credit_and_wallet (R3-AC7, A-13, A-14)', () => {
  it('true reserves every credit and wallet part; true twice writes once', async () => {
    await start();
    const pkg = await ownedPackage();
    await credit(20000, 'seed');
    const o = await order('held');
    await allocate(o, { credit_package_id: pkg, credit_units: 1, wallet_satang: 10000 });
    expect(await reserve(o)).toBe(true);
    const after = await rows();
    expect(await reserve(o)).toBe(true);
    expect(await rows()).toEqual(after);
    expect((await tdb.query(`select reason, change from public.credit_ledger`)).rows).toEqual([{ reason: 'reserve', change: -1 }]);
    expect((await tdb.query(`select reason, change_satang from public.wallet_ledger where reason = 'spend'`)).rows).toEqual([{ reason: 'spend', change_satang: '-10000' }]);
  });
  it('false and nothing written when the wallet is short, even though the credit could be reserved', async () => {
    await start();
    const pkg = await ownedPackage();
    await credit(5000, 'seed');
    const o = await order('held');
    await allocate(o, { credit_package_id: pkg, credit_units: 1, wallet_satang: 10000 });
    const before = await rows();
    expect(await reserve(o)).toBe(false);
    expect(await rows()).toEqual(before);
  });
  it('false and nothing written when the package expired or is used up', async () => {
    await start();
    const expired = await ownedPackage(5, "now() - interval '1 minute'");
    const o = await order('held');
    await allocate(o, { credit_package_id: expired, credit_units: 1 });
    expect(await reserve(o)).toBe(false);
    const empty = await ownedPackage(1);
    await tdb.query(`insert into public.credit_ledger (club_id, package_id, change, reason) values ($1,$2,-1,'import')`, [A, empty]);
    const o2 = await order('held');
    await allocate(o2, { credit_package_id: empty, credit_units: 1 });
    expect(await reserve(o2)).toBe(false);
    expect((await tdb.query(`select count(*)::int as n from public.credit_ledger where reason = 'reserve'`)).rows[0].n).toBe(0);
  });
  it('an order with no credit or wallet part needs nothing: true', async () => {
    await start();
    expect(await reserve(await order('held'))).toBe(true);
  });
  it('a player reserves for their own open order as booq_app; another person’s order is refused; staff may', async () => {
    await start();
    const pkg = await ownedPackage();
    const o = await order('held');
    await allocate(o, { credit_package_id: pkg, credit_units: 1 });
    await expect(asApp(OTHER, ['player'], 'select app.port_reserve_credit_and_wallet($1)', [o])).rejects.toThrow(/forbidden/);
    expect((await tdb.query(`select count(*)::int as n from public.credit_ledger`)).rows[0].n).toBe(0);
    const r = await asApp(PLAYER, ['player'], 'select app.port_reserve_credit_and_wallet($1) as ok', [o]);
    expect(r.rows[0]?.ok).toBe(true);
    expect((await asApp(DESK, ['front_desk', 'player'], 'select app.port_reserve_credit_and_wallet($1) as ok', [o])).rows[0]?.ok).toBe(true);
    await tdb.query(`update public.orders set status = 'cancelled' where id = $1`, [o]);
    await expect(asApp(PLAYER, ['player'], 'select app.port_reserve_credit_and_wallet($1)', [o])).rejects.toThrow(/order_not_open/);
  });
  it('the other two ports are not callable by the app role', async () => {
    await setup();
    for (const f of ['app.port_grant_package(uuid)', 'app.port_credit_wallet(text, uuid, integer, text, text, uuid)']) {
      expect((await tdb.query('select has_function_privilege($1, $2, $3) as ok', ['booq_app', f, 'execute'])).rows[0].ok, f).toBe(false);
      expect((await tdb.query('select has_function_privilege($1, $2, $3) as ok', ['booq_worker', f, 'execute'])).rows[0].ok, f).toBe(true);
    }
  });
});

describe('grant_package and credit_wallet ports', () => {
  it('grant_package raises on an order with no package line', async () => {
    await start();
    await expect(asDefiner('select app.port_grant_package($1)', [await order('held')])).rejects.toThrow(/payment:grant:order_not_package/);
  });
  it('credit_wallet twice with one key returns the same order id: one order, one row; unlisted reason or kind raises', async () => {
    await start();
    const call = (kind: string, reason: string, key: string) =>
      asDefiner<string>('select app.port_credit_wallet($1, $2, $3, $4, $5, null)', [kind, PLAYER, 40000, reason, key]);
    const a = await call('wallet_credit', 'late_payment', 'late_payment:x');
    expect(await call('wallet_credit', 'late_payment', 'late_payment:x')).toBe(a);
    expect((await tdb.query(`select count(*)::int as n from public.orders where kind = 'wallet_credit'`)).rows[0].n).toBe(1);
    expect((await tdb.query(`select count(*)::int as n from public.wallet_ledger`)).rows[0].n).toBe(1);
    await expect(call('wallet_credit', 'referral_reward', 'r:1')).rejects.toThrow(/payment:wallet:reason/);
    await expect(call('sale', 'late_payment', 'l:2')).rejects.toThrow(/payment:wallet:order_kind/);
  });
});

describe('through app.apply_payment with the real F06 ports (design 4.4)', () => {
  /** Turns a fixture order into a package bought with a booking: a package line, and the hour paid by the marker. */
  async function bundleWithBooking(o: string, extraWallet = 0) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local session_replication_role = replica');
      await c.query(`update public.order_line set credit_units = 1, credit_value_satang = 50000, money_satang = 0, wallet_satang = 0, scope = $2 where order_id = $1 and position = 1`,
        [o, JSON.stringify({ new_package_line: product })]);
      await c.query(`insert into public.order_line (club_id, order_id, position, kind, package_product_id, description_key, name_th, name_en, unit_price_satang, net_satang, wallet_satang, money_satang)
                     values ($1,$2,2,'package',$3,'package','แพ็ก','Pack',450000,450000,$4,450000 - $4)`, [A, o, product, extraWallet]);
      await c.query(`update public.orders set subtotal_satang = 500000, total_satang = 500000, credit_value_satang = 50000, wallet_satang = $2, money_satang = 450000 - $2 where id = $1`, [o, extraWallet]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  it('grants the package, reserves the booked hour from it through the marker, then confirms', async () => {
    await start();
    const o = await order('held');
    await bundleWithBooking(o);
    expect(await apply(await payment(o))).toEqual({ outcome: 'applied', order_status: 'paid' });
    expect(await bookingStatus(o)).toBe('confirmed');
    const pk = (await tdb.query(`select p.id, p.credits_total, (select sum(change)::int from public.credit_ledger l where l.package_id = p.id) as used from public.customer_package p where p.order_id = $1`, [o])).rows;
    expect(pk).toEqual([{ id: expect.any(String), credits_total: 10, used: -1 }]);
  });
  it('a false reserve undoes the sub-block: no package, the whole amount to the wallet with its wallet_credit order (R3-AC7, D87)', async () => {
    await start();
    const o = await order('held');
    await bundleWithBooking(o, 1000);                   // 1,000 satang of wallet that the player does not have
    const p = await payment(o);
    const r = await apply(p);
    expect(r).toMatchObject({ outcome: 'wallet_late' });
    expect(await bookingStatus(o)).toBe('released');
    expect(await orderStatus(o)).toBe('open');
    expect((await pay(p)).outcome).toBe('wallet_late');
    expect((await tdb.query(`select count(*)::int as n from public.customer_package`)).rows[0].n).toBe(0);
    const w = (await tdb.query(`select reason, change_satang, payment_id from public.wallet_ledger`)).rows;
    expect(w).toEqual([{ reason: 'late_payment', change_satang: String(449000), payment_id: p }]);
    expect((await tdb.query(`select count(*)::int as n from public.orders where kind = 'wallet_credit' and customer_id = $1`, [PLAYER])).rows[0].n).toBe(1);
  });
});

describe('lock_wallet_and_packages (lock order step 2, before the court)', () => {
  it('the player for themselves or staff; another player is refused; the anchor is created', async () => {
    await start();
    await expect(asApp(OTHER, ['player'], 'select app.lock_wallet_and_packages($1)', [PLAYER])).rejects.toThrow(/forbidden/);
    await asApp(PLAYER, ['player'], 'select app.lock_wallet_and_packages($1)', [PLAYER]);
    await asApp(DESK, ['front_desk', 'player'], 'select app.lock_wallet_and_packages($1)', [PLAYER]);
    expect((await tdb.query(`select count(*)::int as n from public.wallet_account where customer_id = $1`, [PLAYER])).rows[0].n).toBe(1);
  });
  it('holds the customer’s packages until commit: a second locker waits', async () => {
    await start();
    await ownedPackage();
    const c1 = new pg.Client({ connectionString: tdb.url });
    const c2 = new pg.Client({ connectionString: tdb.url });
    await c1.connect();
    await c2.connect();
    try {
      for (const c of [c1, c2]) {
        await c.query('begin');
        await c.query(`select set_config('app.club_id', $1, true)`, [A]);
      }
      await c1.query('select app.lock_wallet_and_packages($1)', [PLAYER]);
      await c2.query(`set local lock_timeout = '200ms'`);
      await expect(c2.query('select app.lock_wallet_and_packages($1)', [PLAYER])).rejects.toThrow(/lock timeout/);
    } finally {
      await c1.query('rollback').catch(() => undefined);
      await c2.query('rollback').catch(() => undefined);
      await c1.end();
      await c2.end();
    }
  });
  it('a Pay with credit and a release of the same customer in parallel, retries off: both finish, no deadlock', async () => {
    await start();
    const pkg = await ownedPackage(20);
    for (let i = 0; i < 5; i++) {
      // A held order whose credit is reserved (to be released) and a new order being paid with credit.
      const held = await order('expired');
      await allocate(held, { credit_package_id: pkg, credit_units: 1 });
      await reserve(held);
      const paying = await order('held');
      await allocate(paying, { credit_package_id: pkg, credit_units: 1 });
      const pc = new pg.Client({ connectionString: tdb.url });
      const rc = new pg.Client({ connectionString: tdb.url });
      await pc.connect();
      await rc.connect();
      try {
        const payTx = (async () => {
          await pc.query('begin');
          await pc.query(`select set_config('app.club_id', $1, true)`, [A]);
          await pc.query('select app.lock_wallet_and_packages($1)', [PLAYER]);                 // step 2 first
          await pc.query(`select pg_advisory_xact_lock(hashtextextended('court:' || $1::text, 0))`, [RES]);   // then the court
          await pc.query('select app.port_reserve_credit_and_wallet($1)', [paying]);            // re-entrant
          await pc.query('commit');
        })();
        const releaseTx = (async () => {
          await rc.query('begin');
          await rc.query(`select set_config('app.club_id', $1, true)`, [A]);
          await rc.query(`select app.release_hold($1, 'expired')`, [held]);
          await rc.query('commit');
        })();
        const r = await Promise.allSettled([payTx, releaseTx]);
        expect(r.filter((x) => x.status === 'rejected').map((x) => String((x as PromiseRejectedResult).reason))).toEqual([]);
      } finally {
        await pc.end();
        await rc.end();
      }
    }
    expect(Number((await tdb.query(`select 20 + sum(change) as n from public.credit_ledger where package_id = $1`, [pkg])).rows[0].n)).toBe(15);
  });
});
