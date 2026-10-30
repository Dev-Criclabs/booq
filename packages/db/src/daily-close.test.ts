import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F13-T07 / migration 0705: daily close (RCPT-03-AC1 to AC10; D33, D35, D37, D79, D119).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const ACC = '55555555-5555-4555-8555-555555555555';
const OWNER_B = '77777777-7777-4777-8777-777777777777';

let tdb: TestDatabase;
let web: Db;
const ctx = (user: string, roles: string[], club = A) => ({ clubId: club, userId: user, roles, source: 'admin' as const });
const owner = ctx(OWNER, ['owner', 'player']);
const acc = ctx(ACC, ['accountant', 'player']);
const run = (day: string, c = owner) => web.withClubTx(c, (tx) => tx.query('select app.run_daily_close($1::date) as id', [day]));
const preview = async (day: string, c = owner) => (await web.withClubTx(c, (tx) => tx.query('select app.preview_daily_close($1::date) as t', [day]))).rows[0]!.t as Record<string, any>;
const closed = async (day: string) => (await tdb.query(`select totals, receipt_count from public.daily_close where day = $1`, [day])).rows[0];

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status, receipt_prefix) values ($1,'a','ก','A','live','HTC'), ($2,'b','ข','B','live','BBB')`, [A, B]);
  for (const [club, u, roles] of [[A, PLAYER, ['player']], [A, DESK, ['front_desk', 'player']], [A, OWNER, ['owner', 'player']], [A, ACC, ['accountant', 'player']], [B, OWNER_B, ['owner', 'player']]] as const) {
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
  await tdb.setNow('2026-12-31T03:00:00Z');   // 10:00 on 31 December in Bangkok: 29 and 30 December are over
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});

/** Fixture helpers: triggers off, so only the numbers matter. */
async function paidOrder(over: { club?: string; money?: number; credit?: number; units?: number; wallet?: number; method?: 'beam' | 'cash' | null; at?: string; test?: boolean; kind?: string } = {}) {
  const club = over.club ?? A;
  const money = over.money ?? 50000;
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local session_replication_role = replica`);
    const o = (await c.query(`insert into public.orders (club_id, customer_id, source, kind, status, is_test) values ($1,$2,'online',$3,'paid',$4) returning id`, [club, club === A ? PLAYER : OWNER_B, over.kind ?? 'sale', over.test ?? false])).rows[0].id as string;
    const total = money + (over.credit ?? 0) + (over.wallet ?? 0);
    await c.query(`update public.orders set price_group_snapshot='{}', subtotal_satang=$2, discount_satang=0, total_satang=$2, credit_value_satang=$3, wallet_satang=$4, money_satang=$5, quote_hash=repeat('a',64), priced_at=now() where id=$1`, [o, total, over.credit ?? 0, over.wallet ?? 0, money]);
    const l = (await c.query(
      `insert into public.order_line (club_id, order_id, position, kind, package_product_id, description_key, name_th, name_en, unit_price_satang, net_satang, credit_value_satang, wallet_satang, money_satang, credit_units)
       values ($1,$2,1,$3,$4,'k','ก','x',$5,$5,$6,$7,$8,$9) returning id`,
      [club, o, over.kind === 'wallet_credit' ? 'wallet_credit' : 'package', over.kind === 'wallet_credit' ? null : '99999999-9999-4999-8999-999999999999', total, over.credit ?? 0, over.wallet ?? 0, money, over.units ?? (over.credit ? 1 : 0)])).rows[0].id as string;
    let pay: string | null = null;
    if (over.method !== null && money > 0) {
      pay = (await c.query(
        over.method === 'cash'
          ? `insert into public.payment (club_id, order_id, method, status, amount_satang, cash_reason_code, confirmed_at, is_test, taken_by) values ($1,$2,'cash','succeeded',$3,'no_banking_app',$4,$5,$6) returning id`
          : `insert into public.payment (club_id, order_id, method, status, environment, gateway, gateway_charge_id, amount_satang, confirmed_at, is_test) values ($1,$2,'beam','succeeded','live','beam','chg_'||gen_random_uuid()::text,$3,$4,$5) returning id`,
        over.method === 'cash' ? [club, o, money, over.at ?? '2026-12-29T05:00:00Z', over.test ?? false, DESK] : [club, o, money, over.at ?? '2026-12-29T05:00:00Z', over.test ?? false],
      )).rows[0].id as string;
    }
    await c.query('commit');
    return { order: o, line: l, payment: pay };
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
/** Issues the receipt as the payment functions do, at a given time. */
async function receiptFor(x: { order: string; payment: string | null }, at: string, kind = 'order', club = A): Promise<string> {
  const before = (await tdb.query(`select app.now() as n`)).rows[0].n as Date;
  await tdb.setNow(at);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.club_id', $1, true)`, [club]);
    const r = await c.query(`select app.issue_receipt($1, $2, $3) as id`, [x.order, x.payment, kind]);
    await c.query('commit');
    return r.rows[0].id as string;
  } finally {
    c.release();
    await tdb.setNow(before.toISOString());
  }
}
const voidReceipt = async (id: string, at: string, reason = 'typo') => {
  const before = (await tdb.query(`select app.now() as n`)).rows[0].n as Date;
  await tdb.setNow(at);
  try {
    await web.withClubTx(owner, (tx) => tx.query('select app.void_receipt($1, $2)', [id, reason]));
  } finally {
    await tdb.setNow(before.toISOString());
  }
};

describe('who and when (RCPT-03-AC8, AC10)', () => {
  it('only the owner and the accountant run or preview a close; front desk, a player and another club cannot', async () => {
    for (const c of [ctx(DESK, ['front_desk', 'player']), ctx(PLAYER, ['player'])]) {
      await expect(run('2026-12-29', c), c.roles.join()).rejects.toThrow(/close:forbidden/);
      await expect(preview('2026-12-29', c), c.roles.join()).rejects.toThrow(/close:forbidden/);
    }
    await run('2026-12-29', acc);
    expect((await tdb.query(`select count(*)::int as n from public.daily_close where club_id = $1`, [B])).rows[0].n).toBe(0);
    expect((await closed('2026-12-29')).receipt_count).toBe(0);
  });

  it('today and a later day are refused (a day closes after it ends in Bangkok), and a closed day cannot be closed again', async () => {
    await expect(run('2026-12-31')).rejects.toThrow(/close:day_not_over/);
    await expect(run('2027-01-02')).rejects.toThrow(/close:day_not_over/);
    await run('2026-12-30');
    await expect(run('2026-12-30')).rejects.toThrow(/close:already_closed/);
    await expect(run('2026-12-30', acc)).rejects.toThrow(/close:already_closed/);
  });

  it('a close is immutable: no role changes or removes one, and the club audit log records the run', async () => {
    await run('2026-12-29');
    await expect(tdb.query(`update public.daily_close set receipt_count = 9`)).rejects.toThrow(/append-only/);
    await expect(tdb.query(`delete from public.daily_close`)).rejects.toThrow(/append-only/);
    expect((await tdb.query(`select actor_user_id, new_value from public.audit_entry where action = 'daily_close.run'`)).rows).toEqual([{ actor_user_id: OWNER, new_value: { day: '2026-12-29', receipt_count: 0 } }]);
    expect((await tdb.query(`select has_table_privilege('booq_platform', 'public.daily_close', 'select') as ok`)).rows[0].ok).toBe(false);
  });

  it('a preview of an open day writes nothing', async () => {
    const t = await preview('2026-12-31');
    expect(t['day']).toBe('2026-12-31');
    expect((await tdb.query(`select count(*)::int as n from public.daily_close`)).rows[0].n).toBe(0);
  });
});

describe('the day and the money (RCPT-03-AC1, AC2)', () => {
  it('totals each method received in the Bangkok day: 23:59 is in the day and 00:00 is in the next', async () => {
    const a = await paidOrder({ money: 50000, method: 'beam', at: '2026-12-28T16:59:00Z' });   // 23:59 on 28 December
    const b = await paidOrder({ money: 30000, method: 'cash', at: '2026-12-28T17:00:00Z' });    // 00:00 on 29 December
    const c = await paidOrder({ money: 70000, method: 'beam', at: '2026-12-29T16:59:59Z' });   // 23:59:59 on 29 December
    for (const x of [a, b, c]) await receiptFor(x, '2026-12-29T05:00:00Z');
    expect((await preview('2026-12-28'))['methods']).toEqual({ beam: 50000, cash: 0 });
    const d29 = await preview('2026-12-29');
    expect(d29['methods']).toEqual({ beam: 70000, cash: 30000 });
    expect(d29['money_total_satang']).toBe(100000);
  });

  it('a close stores what the preview showed, with the receipt count', async () => {
    const x = await paidOrder({ money: 50000, method: 'beam' });
    await receiptFor(x, '2026-12-29T05:00:00Z');
    const t = await preview('2026-12-29');
    await run('2026-12-29');
    const c = await closed('2026-12-29');
    expect(c.totals).toEqual(JSON.parse(JSON.stringify(t)));
    expect(c.receipt_count).toBe(1);
  });

  it('an order paid by credit or wallet only adds no money; credit use and wallet use are separate non money lines (RCPT-03-AC6)', async () => {
    const x = await paidOrder({ money: 0, credit: 40000, units: 2, wallet: 10000, method: null });
    await receiptFor(x, '2026-12-29T05:00:00Z');
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local session_replication_role = replica');   // the fixture ledger needs no packages
      await c.query(`insert into public.credit_ledger (club_id, package_id, change, reason, order_line_id, created_at, dedupe_key) values ($1, gen_random_uuid(), 0, 'use', $2, '2026-12-29T06:00:00Z', 'u1'), ($1, gen_random_uuid(), 0, 'use', $2, '2026-12-29T06:00:00Z', 'u2')`, [A, x.line]);
      await c.query(`insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, order_id, order_line_id, created_at, dedupe_key) values ($1,$2,-10000,'spend',$3,$4,'2026-12-29T06:00:00Z','s1'), ($1,$2,2500,'return',$3,$4,'2026-12-29T07:00:00Z','r1')`, [A, PLAYER, x.order, x.line]);
      await c.query('commit');
    } finally {
      c.release();
    }
    const t = await preview('2026-12-29');
    expect(t['methods']).toEqual({ beam: 0, cash: 0 });
    expect(t['money_total_satang']).toBe(0);
    expect(t['credit_used']).toEqual({ count: 2, value_satang: 40000 });
    expect([t['wallet_used_satang'], t['wallet_returned_satang']]).toEqual([10000, 2500]);
    expect(t['receipts']).toHaveLength(1);
  });
});

describe('voids (RCPT-03-AC3, AC10; D119)', () => {
  it('a voided receipt is shown as void and its payment is not counted in the totals', async () => {
    const a = await paidOrder({ money: 50000, method: 'beam' });
    const b = await paidOrder({ money: 20000, method: 'beam' });
    const ra = await receiptFor(a, '2026-12-29T05:00:00Z');
    await receiptFor(b, '2026-12-29T06:00:00Z');
    await voidReceipt(ra, '2026-12-29T08:00:00Z', 'wrong item');
    const t = await preview('2026-12-29');
    expect(t['methods']).toEqual({ beam: 20000, cash: 0 });
    expect(t['voided_payments']).toEqual([{ number: 'HTC-2026-000001', method: 'beam', amount_satang: 50000 }]);
    expect(t['voids_made']).toEqual([{ number: 'HTC-2026-000001', total_satang: 50000, reason: 'wrong item' }]);
    expect(t['receipts'].map((r: { status: string }) => r.status)).toEqual(['void', 'issued']);
  });

  it('a void made on a later day shows on the day it is made, and an earlier closed day is not reopened', async () => {
    const a = await paidOrder({ money: 50000, method: 'beam', at: '2026-12-28T05:00:00Z' });
    const ra = await receiptFor(a, '2026-12-28T05:00:00Z');
    await run('2026-12-28').catch(() => undefined);   // 28 December is over: close it before the void
    const before = await closed('2026-12-28');
    expect(before.totals.methods.beam).toBe(50000);
    await voidReceipt(ra, '2026-12-30T04:00:00Z');
    expect(await closed('2026-12-28')).toEqual(before);                                    // untouched
    const d30 = await preview('2026-12-30');
    expect(d30['voids_made']).toHaveLength(1);                                             // shown on the day it is made
    expect(d30['methods']).toEqual({ beam: 0, cash: 0 });                                  // and it takes nothing from that day's money
    expect((await preview('2026-12-29'))['voids_made']).toEqual([]);
  });
});

describe('late and wrong amount credits (RCPT-03-AC5; D37, D79)', () => {
  it('the money counts in the method it arrived by and is listed as credited to the wallet, once', async () => {
    const sold = await paidOrder({ money: 50000, method: 'beam', at: '2026-12-29T05:00:00Z' });
    const wo = await paidOrder({ money: 50000, method: null, kind: 'wallet_credit' });
    await receiptFor({ order: wo.order, payment: sold.payment }, '2026-12-29T05:00:00Z', 'wallet_credit');
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local session_replication_role = replica');
      await c.query(`insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, order_id, payment_id, created_at, dedupe_key) values ($1,$2,50000,'late_payment',$3,$4,'2026-12-29T05:00:00Z','late_payment:x')`, [A, PLAYER, wo.order, sold.payment]);
      await c.query('commit');
    } finally {
      c.release();
    }
    const t = await preview('2026-12-29');
    expect(t['methods']).toEqual({ beam: 50000, cash: 0 });
    expect(t['wallet_credited']).toEqual([{ reason: 'late_payment', amount_satang: 50000, receipt_number: 'HTC-2026-000001' }]);
  });

  it('a payment reported after a close belongs to the day it is made, not the closed day (RCPT-03-AC9)', async () => {
    await run('2026-12-29');
    const late = await paidOrder({ money: 40000, method: 'beam', at: '2026-12-30T09:00:00Z' });
    await receiptFor(late, '2026-12-30T09:00:00Z');
    expect((await closed('2026-12-29')).totals.methods).toEqual({ beam: 0, cash: 0 });
    expect((await preview('2026-12-30'))['methods']).toEqual({ beam: 40000, cash: 0 });
  });
});

describe('test rows and other clubs (RCPT-03-AC4; D33)', () => {
  it('test payments, test receipts and test ledger rows are left out; so is another club', async () => {
    const t1 = await paidOrder({ money: 99000, method: 'beam', test: true });
    await tdb.query(`update public.club set status = 'testing' where id = $1`, [A]);
    await receiptFor(t1, '2026-12-29T05:00:00Z');
    await tdb.query(`update public.club set status = 'live' where id = $1`, [A]);
    const other = await paidOrder({ club: B, money: 12000, method: 'beam' });
    await receiptFor(other, '2026-12-29T05:00:00Z', 'order', B);
    const t = await preview('2026-12-29');
    expect(t['methods']).toEqual({ beam: 0, cash: 0 });
    expect(t['receipts']).toEqual([]);
  });

  it('a close run in a Testing club is a test row and goes with the purge', async () => {
    await tdb.query(`update public.club set status = 'testing' where id = $1`, [A]);
    await run('2026-12-29');
    expect((await tdb.query(`select is_test from public.daily_close`)).rows).toEqual([{ is_test: true }]);
    expect((await tdb.query(`select delete_order from app.test_tables where table_name = 'daily_close'`)).rows).toEqual([{ delete_order: 256 }]);
  });
});

describe('what an accountant sees (RCPT-03-AC8; D35)', () => {
  it('the totals carry receipt numbers and customer names and no phone number or date of birth', async () => {
    const x = await paidOrder({ money: 50000, method: 'beam' });
    await receiptFor(x, '2026-12-29T05:00:00Z');
    const t = await preview('2026-12-29', acc);
    expect(JSON.stringify(t)).toContain('HTC-2026-000001');
    expect(t['receipts'][0]).toEqual({ number: 'HTC-2026-000001', kind: 'sale', status: 'issued', customer_name: expect.any(String), total_satang: 50000 });
    expect(JSON.stringify(t)).not.toMatch(/phone|date_of_birth|dob/);
  });
});
