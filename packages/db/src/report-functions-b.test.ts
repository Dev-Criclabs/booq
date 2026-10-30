import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F13-T09 / migration 0707: reports, second set (R2-AC3, AC4, AC5, AC8, AC10, AC11; D33, D35, D57, D70, D119).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const IMPORTED = '99999999-9999-4999-8999-999999999991';
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
const call = async (sql: string, params: unknown[], c = owner) => (await web.withClubTx(c, (tx) => tx.query(sql, params))).rows as Array<Record<string, any>>;
const range = (fn: string, from = '2026-12-01', to = '2026-12-31', c = owner) => call(`select * from app.${fn}($1::date, $2::date)`, [from, to], c);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status, receipt_prefix) values ($1,'a','ก','A','live','HTC'), ($2,'b','ข','B','live','BBB')`, [A, B]);
  for (const [club, u, roles, line] of [[A, P1, ['player'], 'L1'], [A, P2, ['player'], 'L2'], [A, DESK, ['front_desk', 'player'], 'L3'], [A, OWNER, ['owner', 'player'], 'L4'], [A, ACC, ['accountant', 'player'], 'L5'], [A, COACH, ['coach', 'player'], 'L6'], [A, IMPORTED, ['player'], null], [B, OWNER_B, ['owner', 'player'], 'L7']] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id, full_name, claim_state) values ($1,$2,$3,$4,$5)', [club, u, line, u, line === null ? 'unclaimed' : null]);
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

async function raw<T>(fn: (q: (s: string, p?: unknown[]) => Promise<{ rows: any[] }>) => Promise<T>): Promise<T> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    const r = await fn((s, p) => c.query(s, p));
    await c.query('commit');
    return r;
  } finally {
    c.release();
  }
}
const pkg = (customer: string, price: number, credits: number, over: { expires?: string; purchased?: string; club?: string; test?: boolean } = {}) =>
  raw(async (q) => (await q(
    `insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, purchase_date, expires_at, is_test)
     values ($1,$2,gen_random_uuid(),jsonb_build_object('price_satang', $3::int),$4,$5,($5::timestamptz at time zone 'Asia/Bangkok')::date,$6,$7) returning id`,
    [over.club ?? A, customer, price, credits, over.purchased ?? '2026-12-01T03:00:00Z', over.expires ?? '2027-06-01T00:00:00Z', over.test ?? false])).rows[0].id as string);
const credit = (p: string, change: number, reason: string, at: string, over: { line?: string | null; test?: boolean } = {}) =>
  raw((q) => q(`insert into public.credit_ledger (club_id, package_id, change, reason, order_line_id, created_at, dedupe_key, is_test) values ($1,$2,$3,$4,$5,$6,gen_random_uuid()::text,$7)`, [A, p, change, reason, over.line ?? null, at, over.test ?? false]));
const wallet = (customer: string, satang: number, reason: string, at: string, test = false) =>
  raw((q) => q(`insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, order_id, order_line_id, created_at, dedupe_key, is_test) values ($1,$2,$3,$4,$5,$6,$7,gen_random_uuid()::text,$8)`,
    [A, customer, satang, reason, reason === 'spend' || reason === 'return' ? '99999999-9999-4999-8999-999999999990' : null, reason === 'spend' || reason === 'return' ? '99999999-9999-4999-8999-999999999990' : null, at, test]));

async function sale(over: { club?: string; customer?: string; lines: Array<{ kind: 'court_hour' | 'coach' | 'add_on' | 'package'; net: number; credit?: number }>; at?: string; test?: boolean; created?: string; partnerCode?: string }) {
  const club = over.club ?? A;
  const money = over.lines.reduce((n, l) => n + l.net - (l.credit ?? 0), 0);
  const credits = over.lines.reduce((n, l) => n + (l.credit ?? 0), 0);
  const total = money + credits;
  const at = over.at ?? '2026-12-10T05:00:00Z';
  const { o, pay, line } = await raw(async (q) => {
    const id = (await q(`insert into public.orders (club_id, customer_id, source, status, is_test, created_at) values ($1,$2,'online','paid',$3,$4) returning id`, [club, over.customer ?? P1, over.test ?? false, over.created ?? at])).rows[0].id as string;
    await q(`update public.orders set price_group_snapshot='{}', subtotal_satang=$2, discount_satang=0, total_satang=$2, credit_value_satang=$3, wallet_satang=0, money_satang=$4, quote_hash=repeat('a',64), priced_at=now() where id=$1`, [id, total, credits, money]);
    let first = '';
    let pos = 0;
    for (const l of over.lines) {
      pos += 1;
      const lid = (await q(
        `insert into public.order_line (club_id, order_id, position, kind, package_product_id, add_on_id, booking_id, description_key, name_th, name_en, unit_price_satang, net_satang, credit_value_satang, money_satang, credit_units)
         values ($1,$2,$3,$4,$5,$6,$7,'k','ก','x',$8,$8,$9,$10,$11) returning id`,
        [club, id, pos, l.kind, l.kind === 'package' ? '99999999-9999-4999-8999-999999999999' : null, l.kind === 'add_on' ? '99999999-9999-4999-8999-999999999992' : null, l.kind === 'package' ? null : '99999999-9999-4999-8999-999999999990', l.net, l.credit ?? 0, l.net - (l.credit ?? 0), l.credit ? 1 : 0],
      )).rows[0].id as string;
      if (!first) first = lid;
    }
    const payId = money > 0
      ? ((await q(`insert into public.payment (club_id, order_id, method, status, environment, gateway, gateway_charge_id, amount_satang, confirmed_at, is_test) values ($1,$2,'beam','succeeded','live','beam','chg_'||gen_random_uuid()::text,$3,$4,$5) returning id`, [club, id, money, at, over.test ?? false])).rows[0].id as string)
      : null;
    return { o: id, pay: payId, line: first };
  });
  const before = (await tdb.query(`select app.now() as n`)).rows[0].n as Date;
  await tdb.setNow(at);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.club_id', $1, true)`, [club]);
    const r = await c.query(`select app.issue_receipt($1, $2, 'order') as id`, [o, pay]);
    await c.query('commit');
    return { order: o, receipt: r.rows[0].id as string, line };
  } finally {
    c.release();
    await tdb.setNow(before.toISOString());
  }
}

describe('who may read a report (R2-AC11)', () => {
  it('front desk, a coach and a player are refused; the owner and the accountant are not', async () => {
    for (const c of [ctx(DESK, ['front_desk', 'player']), ctx(COACH, ['coach', 'player']), ctx(P1, ['player'])]) {
      for (const fn of ['report_revenue_earned', 'report_occupancy', 'report_partner']) await expect(range(fn, '2026-12-01', '2026-12-31', c), `${fn} ${c.roles.join()}`).rejects.toThrow(/report:forbidden/);
      await expect(call(`select * from app.report_value_owed($1::date)`, ['2026-12-31'], c)).rejects.toThrow(/report:forbidden/);
    }
    for (const c of [owner, acc]) {
      for (const fn of ['report_revenue_earned', 'report_occupancy', 'report_partner']) await range(fn, '2026-12-01', '2026-12-31', c);
      await call(`select * from app.report_value_owed($1::date)`, ['2026-12-31'], c);
    }
  });
});

describe('revenue earned (R2-AC3; D119)', () => {
  it('credits used at their package price per credit, plus single sales; the credit part of a sale is not counted twice', async () => {
    const pk = await pkg(P1, 100000, 10);                                                   // 100.00 a credit... 1,000.00 over 10 credits
    await credit(pk, 0, 'use', '2026-12-05T05:00:00Z');
    await credit(pk, 0, 'use', '2026-12-06T05:00:00Z');
    await credit(pk, 0, 'use', '2027-01-02T05:00:00Z');                                      // outside the range
    await credit(pk, 0, 'use', '2026-12-07T05:00:00Z', { test: true });                      // test
    await sale({ lines: [{ kind: 'court_hour', net: 50000 }, { kind: 'add_on', net: 20000 }] });
    await sale({ lines: [{ kind: 'court_hour', net: 50000, credit: 30000 }], at: '2026-12-11T05:00:00Z' });   // 20,000 of it is money
    await sale({ lines: [{ kind: 'package', net: 450000 }], at: '2026-12-12T05:00:00Z' });                   // package sales are another line
    await sale({ lines: [{ kind: 'court_hour', net: 99000 }], at: '2026-11-30T05:00:00Z' });                  // outside the range
    expect(await range('report_revenue_earned')).toEqual([{ credits_used: 2, credit_value_satang: '20000', single_sales_satang: '90000', total_satang: '110000' }]);
  });

  it('a voided sale and a test sale are left out', async () => {
    const s = await sale({ lines: [{ kind: 'court_hour', net: 50000 }] });
    await web.withClubTx(owner, (tx) => tx.query('select app.void_receipt($1, $2)', [s.receipt, 'typo']));
    expect((await range('report_revenue_earned'))[0]).toMatchObject({ single_sales_satang: '0' });
  });

  it('an imported package has no price and adds nothing', async () => {
    const pk = await raw(async (q) => (await q(`insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, purchase_date, expires_at) values ($1,$2,gen_random_uuid(),'{}'::jsonb,5,'2026-12-01T03:00:00Z','2026-12-01','2027-06-01T00:00:00Z') returning id`, [A, P1])).rows[0].id as string);
    await credit(pk, 0, 'use', '2026-12-05T05:00:00Z');
    expect((await range('report_revenue_earned'))[0]).toMatchObject({ credits_used: 1, credit_value_satang: '0' });
  });
});

describe('value still owed (R2-AC4; D57)', () => {
  const owed = async (day = '2026-12-31') => Object.fromEntries((await call(`select * from app.report_value_owed($1::date)`, [day])).map((r) => [r.line, r]));
  it('shows unused credit at price per credit and wallet balances as separate lines, as at the end of the day', async () => {
    const pk = await pkg(P1, 100000, 10);                                                   // 10,000 a credit... 1,000.00 / 10 = 100.00
    await credit(pk, -1, 'reserve', '2026-12-10T05:00:00Z');
    await credit(pk, -1, 'reserve', '2026-12-11T05:00:00Z');
    await credit(pk, 1, 'return', '2026-12-12T05:00:00Z');
    await credit(pk, -1, 'reserve', '2027-01-05T05:00:00Z');                                 // after the day asked about
    await credit(pk, -1, 'reserve', '2027-01-06T05:00:00Z');
    await wallet(P1, 50000, 'late_payment', '2026-12-10T05:00:00Z');
    await wallet(P1, -20000, 'spend', '2026-12-11T05:00:00Z');
    await wallet(P2, 15000, 'refund', '2027-01-03T05:00:00Z');                               // after
    const o = await owed();
    expect(o['credit']).toEqual({ line: 'credit', packages: 1, credits: '9', amount_satang: '90000' });
    expect(o['wallet']).toEqual({ line: 'wallet', packages: 1, credits: '0', amount_satang: '30000' });
    expect((await owed('2027-01-31'))['credit']).toMatchObject({ credits: '7', amount_satang: '70000' });
  });
  it('an expired package, a package with nothing left, a negative wallet and test rows add nothing', async () => {
    await pkg(P1, 100000, 10, { expires: '2026-12-20T00:00:00Z' });
    const used = await pkg(P1, 100000, 2);
    await credit(used, -1, 'reserve', '2026-12-10T05:00:00Z');
    await credit(used, -1, 'reserve', '2026-12-10T06:00:00Z');
    await pkg(P1, 100000, 10, { test: true });
    await wallet(P2, 5000, 'refund', '2026-12-10T05:00:00Z', true);
    const o = await owed();
    expect(o['credit']).toMatchObject({ packages: 0, credits: '0', amount_satang: '0' });
    expect(o['wallet']).toMatchObject({ packages: 0, amount_satang: '0' });
  });
  it('value held for a player who has not claimed their imported record is its own line, not mixed in', async () => {
    const pk = await pkg(IMPORTED, 50000, 5);
    await wallet(IMPORTED, 12000, 'import', '2026-12-01T05:00:00Z');
    await wallet(P1, 3000, 'refund', '2026-12-02T05:00:00Z');
    const o = await owed();
    expect(o['imported_credit']).toEqual({ line: 'imported_credit', packages: 1, credits: '5', amount_satang: '50000' });
    expect(o['imported_wallet']).toMatchObject({ amount_satang: '12000' });
    expect(o['wallet']).toMatchObject({ amount_satang: '3000' });
    expect(o['credit']).toMatchObject({ amount_satang: '0' });
    void pk;
  });
});

describe('occupancy (R2-AC5; D119)', () => {
  it('booked hours over bookable hours per court, weekday and hour; held hours and closed hours do not count', async () => {
    await tdb.query(`insert into public.location (club_id, id, name) values ($1,'00000000-0000-4000-8000-0000000000a1','M')`, [A]);
    await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,'00000000-0000-4000-8000-0000000000a1','1','tennis')`, [A, RES]);
    await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,1,'08:00','10:00'), ($1,2,'08:00','10:00')`, [A]);
    const occ = (kind: string, state: string, start: string, end: string, test = false) =>
      raw((q) => q(
        `insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, hold_expires_at, booking_id, closure_id, is_test)
         values ($1,$2,$3,$4,$5,$6,case when $6 = 'held' then now() + interval '10 minutes' end, case when $2 = 'closure' then null else gen_random_uuid() end, case when $2 = 'closure' then gen_random_uuid() end, $7)`,
        [A, kind, RES, start, end, state, test]));
    await occ('court_booking', 'confirmed', '2026-12-28T01:00:00Z', '2026-12-28T02:00:00Z');   // Monday 08:00 Bangkok
    await occ('court_booking', 'held', '2026-12-28T02:00:00Z', '2026-12-28T03:00:00Z');        // Monday 09:00 held: not counted
    await occ('court_booking', 'confirmed', '2026-12-29T01:00:00Z', '2026-12-29T02:00:00Z', true);   // a test row on Tuesday 08:00
    await occ('closure', 'confirmed', '2026-12-29T02:00:00Z', '2026-12-29T03:00:00Z');         // Tuesday 09:00 closed
    expect(await range('report_occupancy', '2026-12-28', '2026-12-29')).toEqual([
      { resource_id: RES, weekday: 1, hour: 8, booked: 1, bookable: 1 },
      { resource_id: RES, weekday: 1, hour: 9, booked: 0, bookable: 1 },
      { resource_id: RES, weekday: 2, hour: 8, booked: 0, bookable: 1 },
    ]);
  });
});

describe('partner report (R2-AC8; D70)', () => {
  it('per partner: redemptions, money, new customers and repeats within 30 and 60 days; a restored use is not counted', async () => {
    const partner = (await tdb.query(`insert into public.partner (club_id, name) values ($1,'Easy Tennis') returning id`, [A])).rows[0].id as string;
    await tdb.query(`insert into public.partner (club_id, name) values ($1,'Quiet Partner')`, [A]);
    const code = (await tdb.query(`insert into public.promo_code (club_id, code_upper, kind, value, applies_to, partner_id) values ($1,'EASY','percent',1000,array['court_hour'],$2) returning id`, [A, partner])).rows[0].id as string;
    // P1: first order ever uses the code on 10 December, comes back 20 days later (inside 30 and 60).
    const first = await sale({ customer: P1, lines: [{ kind: 'court_hour', net: 45000 }], at: '2026-12-10T05:00:00Z' });
    await sale({ customer: P1, lines: [{ kind: 'court_hour', net: 50000 }], at: '2026-12-30T05:00:00Z' });
    await raw((q) => q(`insert into public.promo_redemption (club_id, code_id, order_id, customer_id, counted_at) values ($1,$2,$3,$4,'2026-12-10T05:00:00Z')`, [A, code, first.order, P1]));
    // P2: already a customer before the code: a redemption, not a new customer.
    await sale({ customer: P2, lines: [{ kind: 'court_hour', net: 50000 }], at: '2026-10-01T05:00:00Z' });
    const second = await sale({ customer: P2, lines: [{ kind: 'court_hour', net: 40000 }], at: '2026-12-15T05:00:00Z' });
    await raw((q) => q(`insert into public.promo_redemption (club_id, code_id, order_id, customer_id, counted_at) values ($1,$2,$3,$4,'2026-12-15T05:00:00Z')`, [A, code, second.order, P2]));
    // A restored use does not count.
    const third = await sale({ customer: P1, lines: [{ kind: 'court_hour', net: 10000 }], at: '2026-12-18T05:00:00Z' });
    await raw((q) => q(`insert into public.promo_redemption (club_id, code_id, order_id, customer_id, status, counted_at, restored_at, restore_reason) values ($1,$2,$3,$4,'restored','2026-12-18T05:00:00Z','2026-12-19T05:00:00Z','hold ended')`, [A, code, third.order, P1]));
    expect(await range('report_partner')).toEqual([
      { partner_id: partner, partner_name: 'Easy Tennis', redemptions: 2, revenue_satang: '85000', new_customers: 1, repeat_30: 1, repeat_60: 1 },
      { partner_id: expect.any(String), partner_name: 'Quiet Partner', redemptions: 0, revenue_satang: '0', new_customers: 0, repeat_30: 0, repeat_60: 0 },
    ]);
  });
});
