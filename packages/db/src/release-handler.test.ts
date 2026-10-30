import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F06-T05 / migration 0509: the release handler app.f06_release (R1-AC8, BOOK-03-AC5, F04 R7-AC6).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const IMPORTED = '66666666-6666-4666-8666-666666666666';
const ADULT = '00000000-0000-4000-8000-0000000000a1';
const STUDENT = '00000000-0000-4000-8000-0000000000a2';
const TIER1 = '00000000-0000-4000-8000-0000000000c1';
const TIER2 = '00000000-0000-4000-8000-0000000000c2';
const COURT1 = '00000000-0000-4000-8000-0000000000e1';
const COURT2 = '00000000-0000-4000-8000-0000000000e2';
const NOW = '2027-02-01T03:00:00Z';
const EXPIRES = '2027-04-05T16:59:59.999Z';            // 5 Apr 2027 23:59:59.999 Bangkok

let tdb: TestDatabase;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  for (const u of [PLAYER, OTHER]) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [A, u, 'L' + u.slice(0, 2)]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, u]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, claim_state) values ($1,$2,null,'unclaimed')`, [A, IMPORTED]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, IMPORTED]);
    await c.query('commit');
  } finally {
    c.release();
  }
  await tdb.query(`insert into public.price_group (club_id, id, name_th, name_en, rule) values ($1,$2,'ผู้ใหญ่','Adult','{"min_age":18}'), ($1,$3,'นักเรียน','Student','{"max_age":17}')`, [A, ADULT, STUDENT]);
  await tdb.query(`insert into public.coach_tier (club_id, id, name_th, name_en) values ($1,$2,'1','Tier 1'), ($1,$3,'2','Tier 2')`, [A, TIER1, TIER2]);
  const loc = (await tdb.query(`insert into public.location (club_id, name) values ($1,'Main') returning id`, [A])).rows[0].id;
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$4,'Court 1','tennis'), ($1,$3,$4,'Court 2','tennis')`, [A, COURT1, COURT2, loc]);
  await tdb.setNow(NOW);
});
afterEach(async () => {
  await tdb.close();
});

type Snapshot = { credit_type: string; coach_tier_id?: string; price_group_id?: string };
/** A package with a snapshot of what it fits; the product row is only the FK target. */
async function newPackage(snapshot: Snapshot, credits = 10, expires = EXPIRES, customer = PLAYER) {
  const product = (await tdb.query(
    `insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_group_id, coach_tier_id, price_satang)
     values ($1,'แพ็ก','Pack',$2,$3,3,$4,$5,100000) returning id`,
    [A, snapshot.credit_type, credits, snapshot.price_group_id ?? (snapshot.credit_type === 'court_hour' ? null : ADULT), snapshot.coach_tier_id ?? null],
  )).rows[0].id;
  return (await tdb.query(
    `insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, expires_at)
     values ($1,$2,$3,$4,$5,'2027-01-04T17:30:00Z',$6) returning id`,
    [A, customer, product, JSON.stringify(snapshot), credits, expires],
  )).rows[0].id as string;
}
/** A held order: hours bookings awaiting payment, one court_hour line each with `credit` credit units on `pkg` and `wallet` satang
 * of wallet; the hold ended at HOLD_END (fixture: sums and FKs of the order off). */
const HOLD_END = '2027-02-01T03:15:00Z';
async function heldOrder(pkg: string | null, hours: number[], wallet = 0, customer = PLAYER) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    const o = (await c.query(`insert into public.orders (club_id, customer_id, source, status) values ($1,$2,'online','open') returning id`, [A, customer])).rows[0].id as string;
    const lines: { booking: string; line: string }[] = [];
    let pos = 1;
    for (const hour of hours) {
      const start = `2027-02-10T${String(hour - 7).padStart(2, '0')}:00:00Z`;
      const b = (await c.query(
        `insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, hold_expires_at)
         values ($1,$2,'court',$3,$4::timestamptz,$4::timestamptz + interval '1 hour',$5,'awaiting_payment','online',$5,$6) returning id`,
        [A, o, COURT1, start, customer, HOLD_END],
      )).rows[0].id as string;
      const l = (await c.query(
        `insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, net_satang, credit_package_id, credit_units, credit_value_satang, wallet_satang)
         values ($1,$2,$3,'court_hour',$4,'k','ก','x',$5,$5,$6,$7,$8,$9) returning id`,
        [A, o, pos++, b, (pkg ? 50000 : 0) + wallet, pkg, pkg ? 1 : 0, pkg ? 50000 : 0, wallet],
      )).rows[0].id as string;
      lines.push({ booking: b, line: l });
    }
    await c.query('commit');
    return { order: o, lines };
  } finally {
    c.release();
  }
}
const gen = () => '00000000-0000-4000-8000-' + Math.floor(Math.random() * 1e12).toString().padStart(12, '0');

async function asDefiner<T = Record<string, unknown>>(sql: string, args: unknown[] = [], client?: pg.PoolClient): Promise<T[]> {
  const c = client ?? (await tdb.pool.connect());
  try {
    await c.query('begin');
    await c.query('set local role booq_owner');
    await c.query(`select set_config('app.club_id', $1, true)`, [A]);
    const r = (await c.query(sql, args)).rows as T[];
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    if (!client) c.release();
  }
}
const one = async <T = unknown>(sql: string, args: unknown[] = []) => Object.values((await asDefiner(sql, args))[0] ?? {})[0] as T;
const reserve = (pkg: string, b: { booking: string; line: string }) => one<string>('select app.credit_reserve($1, $2, $3)', [pkg, b.booking, b.line]);
const release = (order: string, reason = 'expired') => one<boolean>('select app.release_hold($1, $2)', [order, reason]);
const spend = (amount: number, o: string, line: string) => one('select app.wallet_spend($1, $2, $3, $4)', [PLAYER, amount, o, line]);
const walletBalance = async () => Number((await tdb.query(`select coalesce(sum(change_satang), 0) as n from public.wallet_ledger where customer_id = $1`, [PLAYER])).rows[0].n);
const counts = async () => (await tdb.query(`select reason, count(*)::int as n from public.credit_ledger group by reason
                                              union all select 'w_' || reason, count(*)::int from public.wallet_ledger group by reason order by 1`)).rows;
const left = (pkg: string) => one<number>('select app.package_credits_left($1)', [pkg]);


describe('f06_release (R1-AC8)', () => {
  it('is registered as a release handler with ord 30, between F05 and F07', async () => {
    const r = (await tdb.query(`select name, ord from app.release_handlers order by ord, name`)).rows;
    expect(r).toContainEqual({ name: 'f06_credit_wallet', ord: 30 });
    const ords = r.map((x) => x.ord as number);
    expect(ords.filter((o) => o < 30).every((o) => o === 10 || o === 20)).toBe(true);
  });
  it('a released hold returns every reserved credit and wallet spend once; a second release changes nothing', async () => {
    const pkg = await newPackage({ credit_type: 'court_hour' }, 5);
    await one('select app.wallet_credit($1, 30000, $2, $3)', [PLAYER, 'refund', 'refund:seed']);
    const h = await heldOrder(pkg, [10, 11], 10000);
    for (const l of h.lines) {
      await reserve(pkg, l);
      await spend(10000, h.order, l.line);
    }
    expect(await left(pkg)).toBe(3);
    expect(await walletBalance()).toBe(10000);
    await tdb.setNow('2027-02-01T03:16:00Z');
    expect(await release(h.order)).toBe(true);
    expect(await left(pkg)).toBe(5);
    expect(await walletBalance()).toBe(30000);
    const after = await counts();
    expect(await release(h.order)).toBe(false);                     // nothing awaiting payment any more
    expect(await one('select app.f06_release($1, $2)', [h.order, 'expired'])).toBe('');   // a direct second call is a no-op too
    expect(await counts()).toEqual(after);
    expect(after).toEqual([{ reason: 'reserve', n: 2 }, { reason: 'return', n: 2 }, { reason: 'w_refund', n: 1 }, { reason: 'w_return', n: 2 }, { reason: 'w_spend', n: 2 }]);
  });
  it('the credit comes back even if the package expired while the hold ran (a hold ending is not a player cancel)', async () => {
    const pkg = await newPackage({ credit_type: 'court_hour' }, 5, '2027-02-01T03:10:00Z');
    const h = await heldOrder(pkg, [10]);
    await reserve(pkg, h.lines[0]!);
    await tdb.setNow('2027-02-01T03:16:00Z');
    await release(h.order);
    expect(await left(pkg)).toBe(5);
  });
  it('a reclaimed order reserves again with attempt 2 after its release (late payment, A-13)', async () => {
    const pkg = await newPackage({ credit_type: 'court_hour' }, 5);
    const h = await heldOrder(pkg, [10]);
    const l = h.lines[0]!;
    await reserve(pkg, l);
    await tdb.setNow('2027-02-01T03:16:00Z');
    await release(h.order);
    await reserve(pkg, l);
    expect((await tdb.query(`select dedupe_key from public.credit_ledger where reason = 'reserve' order by dedupe_key`)).rows.map((r) => r.dedupe_key))
      .toEqual([`reserve:${l.line}:1`, `reserve:${l.line}:2`]);
    expect(await left(pkg)).toBe(4);
  });
  it('an order with no credit or wallet part, and a confirmed booking of another order, are untouched', async () => {
    const pkg = await newPackage({ credit_type: 'court_hour' }, 5);
    const kept = await heldOrder(pkg, [12]);
    await reserve(pkg, kept.lines[0]!);
    const plain = await heldOrder(null, [10]);
    await tdb.setNow('2027-02-01T03:16:00Z');
    expect(await release(plain.order)).toBe(true);
    expect(await left(pkg)).toBe(4);
    expect(await one('select count(*)::int from public.credit_ledger where reason = $1', ['return'])).toBe(0);
  });
  it('an order with no wallet spend never takes the wallet lock (a walk-in or a customer without a wallet)', async () => {
    const h = await heldOrder(null, [10]);
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local session_replication_role = replica');   // fixture: an order whose customer is no app_user
      await c.query(`update public.orders set customer_id = gen_random_uuid() where id = $1`, [h.order]);
      await c.query('commit');
    } finally {
      c.release();
    }
    await tdb.setNow('2027-02-01T03:16:00Z');
    expect(await release(h.order)).toBe(true);
    expect(await one('select count(*)::int from public.wallet_account')).toBe(0);
  });
});
