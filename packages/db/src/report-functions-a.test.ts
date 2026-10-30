import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F13-T08 / migration 0706: reports, first set (R2-AC2, AC3, AC6, AC7, AC10, AC11; D33, D35).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const ACC = '55555555-5555-4555-8555-555555555555';
const COACH = '66666666-6666-4666-8666-666666666666';
const OWNER_B = '77777777-7777-4777-8777-777777777777';
const RES = '88888888-8888-4888-8888-888888888888';

let tdb: TestDatabase;
let web: Db;
const ctx = (user: string, roles: string[], club = A) => ({ clubId: club, userId: user, roles, source: 'admin' as const });
const owner = ctx(OWNER, ['owner', 'player']);
const acc = ctx(ACC, ['accountant', 'player']);
const call = async (fn: string, from: string, to: string, c = owner) =>
  (await web.withClubTx(c, (tx) => tx.query(`select * from app.${fn}($1::date, $2::date)`, [from, to]))).rows as Array<Record<string, any>>;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status, receipt_prefix) values ($1,'a','ก','A','live','HTC'), ($2,'b','ข','B','live','BBB')`, [A, B]);
  for (const [club, u, roles] of [[A, P1, ['player']], [A, P2, ['player']], [A, DESK, ['front_desk', 'player']], [A, OWNER, ['owner', 'player']], [A, ACC, ['accountant', 'player']], [A, COACH, ['coach', 'player']], [B, OWNER_B, ['owner', 'player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id, full_name) values ($1,$2,$3,$3)', [club, u, 'L' + u.slice(0, 2)]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  web = createDb({ connectionString: tdb.url, max: 2 });
  await tdb.setNow('2026-12-31T03:00:00Z');
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});

/** Fixtures with triggers off: only the numbers matter. */
async function raw<T>(fn: (c: { query: (s: string, p?: unknown[]) => Promise<{ rows: any[] }> }) => Promise<T>): Promise<T> {
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
type Kind = 'package' | 'court';
async function order(over: { club?: string; customer?: string; kind?: Kind; money?: number; method?: 'beam' | 'cash'; at?: string; test?: boolean; status?: string; noPayment?: boolean } = {}) {
  const club = over.club ?? A;
  const money = over.money ?? 50000;
  return raw(async (c) => {
    const o = (await c.query(`insert into public.orders (club_id, customer_id, source, status, is_test) values ($1,$2,'online',$3,$4) returning id`, [club, over.customer ?? P1, over.status ?? 'paid', over.test ?? false])).rows[0].id as string;
    await c.query(`update public.orders set price_group_snapshot='{}', subtotal_satang=$2, discount_satang=0, total_satang=$2, credit_value_satang=0, wallet_satang=0, money_satang=$2, quote_hash=repeat('a',64), priced_at=now() where id=$1`, [o, money]);
    await c.query(
      `insert into public.order_line (club_id, order_id, position, kind, package_product_id, booking_id, description_key, name_th, name_en, unit_price_satang, net_satang, money_satang)
       values ($1,$2,1,$3,$4,$5,'k','ก','x',$6,$6,$6)`,
      [club, o, (over.kind ?? 'package') === 'package' ? 'package' : 'court_hour', (over.kind ?? 'package') === 'package' ? '99999999-9999-4999-8999-999999999999' : null, (over.kind ?? 'package') === 'package' ? null : '99999999-9999-4999-8999-999999999990', money],
    );
    let pay: string | null = null;
    if (!over.noPayment) {
      pay = (
        await c.query(
          over.method === 'cash'
            ? `insert into public.payment (club_id, order_id, method, status, amount_satang, cash_reason_code, confirmed_at, is_test, taken_by) values ($1,$2,'cash','succeeded',$3,'no_banking_app',$4,$5,$6) returning id`
            : `insert into public.payment (club_id, order_id, method, status, environment, gateway, gateway_charge_id, amount_satang, confirmed_at, is_test) values ($1,$2,'beam','succeeded','live','beam','chg_'||gen_random_uuid()::text,$3,$4,$5) returning id`,
          over.method === 'cash' ? [club, o, money, over.at ?? '2026-12-20T05:00:00Z', over.test ?? false, DESK] : [club, o, money, over.at ?? '2026-12-20T05:00:00Z', over.test ?? false],
        )
      ).rows[0].id as string;
    }
    return { order: o, payment: pay };
  });
}
async function receipt(x: { order: string; payment: string | null }, club = A): Promise<string> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.club_id', $1, true)`, [club]);
    const r = await c.query(`select app.issue_receipt($1, $2, 'order') as id`, [x.order, x.payment]);
    await c.query('commit');
    return r.rows[0].id as string;
  } finally {
    c.release();
  }
}
let slot = 0;
async function booking(over: { customer?: string; source?: 'online' | 'staff'; status?: string; start?: string; test?: boolean; club?: string } = {}) {
  slot += 1;
  const club = over.club ?? A;
  return raw(async (c) => {
    const o = (await c.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [club, over.customer ?? P1])).rows[0].id as string;
    const start = new Date(Date.parse(over.start ?? '2026-12-20T03:00:00Z') + slot * 3600_000 * 24 * 0).toISOString();
    return (
      await c.query(
        `insert into public.booking (club_id, order_id, type, resource_id, customer_id, start_at, end_at, status, source, created_by, confirmed_at, is_test)
         values ($1,$2,'court',$3,$4,$5::timestamptz,$5::timestamptz + interval '1 hour',$6,$7,$4, now(), $8) returning id`,
        [club, o, RES, over.customer ?? P1, start, over.status ?? 'confirmed', over.source ?? 'online', over.test ?? false],
      )
    ).rows[0].id as string;
  });
}

describe('who may read a report (R2-AC11)', () => {
  it('front desk, a coach and a player are refused; the owner and the accountant are not; a bad range is refused', async () => {
    for (const fn of ['report_cash_by_type', 'report_package_sales', 'report_online_vs_staff', 'report_no_show_rate', 'report_new_vs_returning']) {
      for (const c of [ctx(DESK, ['front_desk', 'player']), ctx(COACH, ['coach', 'player']), ctx(P1, ['player'])]) {
        await expect(call(fn, '2026-12-01', '2026-12-31', c), `${fn} ${c.roles.join()}`).rejects.toThrow(/report:forbidden/);
      }
      await call(fn, '2026-12-01', '2026-12-31', owner);
      await call(fn, '2026-12-01', '2026-12-31', acc);
      await expect(call(fn, '2026-12-31', '2026-12-01'), fn).rejects.toThrow(/report:invalid_range/);
    }
  });
  it('no role but the app role can call them', async () => {
    for (const role of ['booq_worker', 'booq_platform', 'anon', 'authenticated']) {
      const r = await tdb.query(`select has_function_privilege($1, 'app.report_cash_by_type(date, date)', 'execute') as ok`, [role]);
      expect(r.rows[0].ok, role).toBe(false);
    }
  });
});

describe('cash received by type (R2-AC2)', () => {
  it('totals money by method from payments in the range, both ends included, in the Bangkok day', async () => {
    await order({ money: 50000, at: '2026-12-01T00:00:00Z' });                                 // 07:00 on 1 December
    await order({ money: 30000, method: 'cash', at: '2026-12-10T05:00:00Z' });
    await order({ money: 70000, at: '2026-12-31T16:59:59Z' });                                 // 23:59:59 on 31 December
    await order({ money: 99000, at: '2026-12-31T17:00:00Z' });                                 // 00:00 on 1 January: outside
    await order({ money: 11000, at: '2026-11-30T16:59:59Z' });                                 // 23:59:59 on 30 November: outside
    expect(await call('report_cash_by_type', '2026-12-01', '2026-12-31')).toEqual([
      { method: 'beam', payments: 2, amount_satang: '120000' },
      { method: 'cash', payments: 1, amount_satang: '30000' },
    ]);
  });
  it('a voided receipt, test payments and another club are left out; an empty range gives zero rows for both methods', async () => {
    const v = await order({ money: 50000 });
    const rv = await receipt(v);
    await web.withClubTx(owner, (tx) => tx.query('select app.void_receipt($1, $2)', [rv, 'typo']));
    await order({ money: 40000, test: true });
    await order({ club: B, customer: OWNER_B, money: 12000 });
    expect(await call('report_cash_by_type', '2026-12-01', '2026-12-31')).toEqual([{ method: 'beam', payments: 0, amount_satang: '0' }, { method: 'cash', payments: 0, amount_satang: '0' }]);
  });
  it('the accountant gets the same numbers and nothing personal', async () => {
    await order({ money: 50000 });
    const rows = await call('report_cash_by_type', '2026-12-01', '2026-12-31', acc);
    expect(rows[0]).toEqual({ method: 'beam', payments: 1, amount_satang: '50000' });
    expect(Object.keys(rows[0]!)).toEqual(['method', 'payments', 'amount_satang']);
  });
});

describe('package sales (R2-AC3)', () => {
  it('is the money part of package lines of orders paid in the range; court sales are not package sales', async () => {
    await order({ kind: 'package', money: 450000 });
    await order({ kind: 'package', money: 800000, at: '2026-12-25T05:00:00Z' });
    await order({ kind: 'court', money: 50000 });
    await order({ kind: 'package', money: 100000, at: '2026-11-20T05:00:00Z' });
    expect(await call('report_package_sales', '2026-12-01', '2026-12-31')).toEqual([{ orders: 2, packages: 2, money_satang: '1250000' }]);
  });
  it('leaves out a voided sale, a test order and an unpaid order', async () => {
    const v = await order({ kind: 'package', money: 450000 });
    const rv = await receipt(v);
    await web.withClubTx(owner, (tx) => tx.query('select app.void_receipt($1, $2)', [rv, 'typo']));
    await order({ kind: 'package', money: 200000, test: true });
    await order({ kind: 'package', money: 300000, status: 'open', noPayment: true });
    expect(await call('report_package_sales', '2026-12-01', '2026-12-31')).toEqual([{ orders: 0, packages: 0, money_satang: '0' }]);
  });
});

describe('online against staff, no show rate, new against returning (R2-AC6, AC7)', () => {
  it('counts played and no show bookings by source, in the range, without test bookings', async () => {
    await booking({ source: 'online' });
    await booking({ source: 'online', status: 'no_show' });
    await booking({ source: 'staff' });
    await booking({ source: 'staff', status: 'cancelled' });
    await booking({ source: 'online', test: true });
    await booking({ source: 'online', start: '2027-01-02T03:00:00Z' });
    expect(await call('report_online_vs_staff', '2026-12-01', '2026-12-31')).toEqual([{ source: 'online', bookings: 2 }, { source: 'staff', bookings: 1 }]);
  });
  it('the no show rate is no shows over played plus no shows, in basis points, null when nothing happened', async () => {
    expect(await call('report_no_show_rate', '2026-12-01', '2026-12-31')).toEqual([{ played: 0, no_shows: 0, rate_basis_points: null }]);
    await booking();
    await booking();
    await booking();
    await booking({ status: 'no_show' });
    await booking({ status: 'cancelled' });
    await booking({ start: '2027-01-05T03:00:00Z' });                                    // in the future and outside
    expect(await call('report_no_show_rate', '2026-12-01', '2026-12-31')).toEqual([{ played: 3, no_shows: 1, rate_basis_points: 2500 }]);
  });
  it('a booking whose hour has not ended is not played yet', async () => {
    await tdb.setNow('2026-12-20T03:30:00Z');
    await booking({ start: '2026-12-20T03:00:00Z' });
    expect((await call('report_no_show_rate', '2026-12-20', '2026-12-20'))[0]).toMatchObject({ played: 0, no_shows: 0 });
  });
  it('a customer is new when their first booking ever is in the range; earlier customers are returning; each counted once', async () => {
    await booking({ customer: P1, start: '2026-10-05T03:00:00Z' });                        // P1 played before
    await booking({ customer: P1, start: '2026-12-10T03:00:00Z' });
    await booking({ customer: P1, start: '2026-12-11T03:00:00Z' });
    await booking({ customer: P2, start: '2026-12-12T03:00:00Z' });
    await booking({ customer: P2, start: '2026-12-13T03:00:00Z' });
    expect(await call('report_new_vs_returning', '2026-12-01', '2026-12-31')).toEqual([{ new_customers: 1, returning_customers: 1 }]);
  });
});
