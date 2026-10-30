import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { A, PLAYER, apply, bookingStatus, log, order, orderStatus, pay, payment, setup, tdb, teardown } from './testing/payment-fixtures';

// F05-T07 / migration 0408: cash at the front desk (PAY-06; D56). Front desk or owner, with a reason code and, for
// "other", a note. It cancels the order's pending Beam payment, records a succeeded cash payment for exactly the money
// due, confirms the order the same way a Beam success would (a package order is granted), issues the receipt and the
// confirmation message through the ports, and audits the reason code. A late Beam success then follows the wallet rule.
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const ACC = '55555555-5555-4555-8555-555555555555';
let app: Db;

const staffCtx = (user: string | null, roles: string[]) => ({ clubId: A, userId: user, roles: roles as never, source: 'admin' as const });
const cash = (o: string, code: string, note: string | null = null, c = staffCtx(DESK, ['front_desk', 'player'])) =>
  app.withClubTx(c, async (tx) => (await tx.query(`select app.take_cash($1, $2, $3) as r`, [o, code, note])).rows[0]?.r as Record<string, unknown>);
const cashRows = async (o: string) => (await tdb.query(`select method, status, amount_satang, cash_reason_code, cash_reason_note, taken_by, gateway, outcome from public.payment where order_id = $1 and method = 'cash'`, [o])).rows;

async function staff() {
  for (const [u, roles] of [[DESK, ['front_desk', 'player']], [OWNER, ['owner', 'player']], [ACC, ['accountant', 'player']]] as const) {
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
  app = createDb({ connectionString: tdb.url, max: 2 });
}
beforeEach(async () => {
  await setup();
  await staff();
});
afterEach(async () => {
  await app.end();
  await teardown();
});

describe('taking cash', () => {
  it('confirms the booking, marks the order paid, records the cash payment, issues the receipt and the message', async () => {
    const o = await order('held');
    const r = await cash(o, 'no_banking_app');
    expect(r).toMatchObject({ outcome: 'applied', order_status: 'paid' });
    expect(await bookingStatus(o)).toBe('confirmed');
    expect(await orderStatus(o)).toBe('paid');
    expect(await cashRows(o)).toEqual([{ method: 'cash', status: 'succeeded', amount_satang: 50000, cash_reason_code: 'no_banking_app', cash_reason_note: null, taken_by: DESK, gateway: null, outcome: 'applied' }]);
    const calls = await log();
    expect(calls.map((l) => l.port)).toEqual(['issue_receipt', 'enqueue_message']);
    expect(calls[0]!.args).toEqual([o, expect.any(String), 'order']);
  });

  it('cancels a pending Beam payment of the order; a Beam success that still arrives goes to the wallet', async () => {
    const o = await order('held');
    const beam = await payment(o);
    await cash(o, 'qr_failed_at_counter', null, staffCtx(OWNER, ['owner', 'player']));
    expect((await pay(beam)).status).toBe('cancelled');
    expect(await apply(beam)).toMatchObject({ outcome: 'wallet_cancelled', order_status: 'paid' });
    expect((await log()).filter((l) => l.port === 'credit_wallet')).toHaveLength(1);
  });

  it('is allowed for a package order: the package is granted', async () => {
    const o = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'staff') returning id`, [A, PLAYER])).rows[0].id as string;
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local session_replication_role = replica');
      await c.query(`update public.orders set price_group_snapshot='{}', subtotal_satang=450000, discount_satang=0, total_satang=450000, credit_value_satang=0, wallet_satang=0, money_satang=450000, quote_hash=repeat('a',64), priced_at=now() where id=$1`, [o]);
      await c.query(`insert into public.order_line (club_id, order_id, position, kind, package_product_id, description_key, name_th, name_en, unit_price_satang, discount_satang, net_satang, credit_value_satang, wallet_satang, money_satang)
                     values ($1,$2,1,'package',gen_random_uuid(),'package','แพ็กเกจ','Package',450000,0,450000,0,0,450000)`, [A, o]);
      await c.query('commit');
    } finally {
      c.release();
    }
    await cash(o, 'other', 'customer has cash only');
    expect((await log()).map((l) => l.port)).toEqual(['grant_package', 'issue_receipt']);
    expect(await orderStatus(o)).toBe('paid');
  });

  it('reason code and note rules: a known code, and a note for "other"', async () => {
    const o = await order('held');
    await expect(cash(o, 'because')).rejects.toThrow(/reason code/);
    await expect(cash(o, 'other')).rejects.toThrow(/note/);
    await expect(cash(o, 'other', '   ')).rejects.toThrow(/note/);
    expect(await bookingStatus(o)).toBe('awaiting_payment');
    expect(await cashRows(o)).toEqual([]);
    await cash(o, 'other', 'phone battery died');
    expect((await cashRows(o))[0]).toMatchObject({ cash_reason_code: 'other', cash_reason_note: 'phone battery died' });
  });

  it('only front desk and owner', async () => {
    const o = await order('held');
    await expect(cash(o, 'no_banking_app', null, staffCtx(ACC, ['accountant', 'player']))).rejects.toThrow(/not allowed/);
    await expect(cash(o, 'no_banking_app', null, staffCtx(PLAYER, ['player']))).rejects.toThrow(/not allowed/);
    await expect(cash(o, 'no_banking_app', null, staffCtx(null, ['guest']))).rejects.toThrow(/not allowed/);
    expect(await orderStatus(o)).toBe('open');
  });

  it('needs an open priced order with money due and a running hold; a second cash is refused', async () => {
    const expired = await order('expired');
    await expect(cash(expired, 'no_banking_app')).rejects.toThrow(/hold is not running/);
    const released = await order('released');
    await expect(cash(released, 'no_banking_app')).rejects.toThrow(/hold is not running/);
    const o = await order('held');
    await cash(o, 'no_banking_app');
    await expect(cash(o, 'no_banking_app')).rejects.toThrow(/no open order/);
    await expect(cash('99999999-9999-4999-8999-999999999999', 'no_banking_app')).rejects.toThrow(/no open order/);
  });

  it('audits the reason code, and keeps the staff note as personal data in the audit log', async () => {
    const o = await order('held');
    await cash(o, 'other', 'regular customer, forgot phone');
    const e = (await tdb.query(`select actor_user_id, new_value, pii_new from public.audit_entry where action = 'payment.cash_taken'`)).rows;
    expect(e).toHaveLength(1);
    expect(e[0].actor_user_id).toBe(DESK);
    expect(e[0].new_value).toMatchObject({ reason_code: 'other', amount_satang: 50000 });
    expect(JSON.stringify(e[0].new_value)).not.toContain('forgot phone');
    expect(e[0].pii_new).toEqual({ note: 'regular customer, forgot phone' });
    const row = (await tdb.query(`select new_value, pii_new from public.audit_entry where record_type = 'payment' and action = 'insert' and (new_value ->> 'method' = 'cash' or pii_new ->> 'cash_reason_note' is not null)`)).rows;
    for (const r of row) expect(JSON.stringify(r.new_value)).not.toContain('forgot phone');
  });

  it('a missing receipt port undoes the whole cash taking', async () => {
    await app.end();
    await teardown();
    await setup({ missing: ['issue_receipt'] });
    await staff();
    const o = await order('held');
    await expect(cash(o, 'no_banking_app')).rejects.toThrow(/port_missing:issue_receipt/);
    expect(await cashRows(o)).toEqual([]);
    expect(await bookingStatus(o)).toBe('awaiting_payment');
    expect(await orderStatus(o)).toBe('open');
  });
});
