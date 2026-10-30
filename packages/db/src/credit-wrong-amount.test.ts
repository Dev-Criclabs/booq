import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { A, PLAYER, log, order, payment, pay, setup, tdb, teardown, worker, ctx as workerCtx } from './testing/payment-fixtures';

// F05-T06 / migration 0407: a validly signed payment of the wrong amount (PAY-02-AC6; D24, D77, D79). The worker
// flags it (the booking is not confirmed, the owner sees a banner); front desk or owner then credit the FULL amount
// received to the wallet with a reason, own receipt, and the flag resolves. Never a refund to Beam (PAY-05-AC4).
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const ACC = '55555555-5555-4555-8555-555555555555';
let app: Db;

const staffCtx = (user: string, roles: string[]) => ({ clubId: A, userId: user, roles: roles as never, source: 'admin' as const });
const flag = (p: string, received: number) => worker.withClubTx(workerCtx(), async (tx) => tx.query(`select app.flag_wrong_amount($1, $2)`, [p, received]));
const credit = (p: string, note: string | null, c = staffCtx(DESK, ['front_desk', 'player'])) =>
  app.withClubTx(c, async (tx) => (await tx.query(`select app.credit_wrong_amount($1, $2) as r`, [p, note])).rows[0]?.r as Record<string, unknown>);
const flags = async () => (await tdb.query(`select kind, status, payment_id, resolved_by, note from public.owner_flag order by created_at`)).rows;

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

describe('app.flag_wrong_amount (the worker)', () => {
  it('records the amount received, opens one owner flag for the payment and leaves the booking and the payment pending', async () => {
    const o = await order('held');
    const p = await payment(o);
    await flag(p, 40000);
    expect(await flags()).toEqual([{ kind: 'wrong_amount', status: 'open', payment_id: p, resolved_by: null, note: null }]);
    expect((await tdb.query(`select status, outcome, received_satang from public.payment where id = $1`, [p])).rows[0]).toEqual({ status: 'pending', outcome: 'mismatch', received_satang: 40000 });
    expect((await tdb.query(`select status from public.booking where order_id = $1`, [o])).rows[0].status).toBe('awaiting_payment');
  });

  it('a repeated callback keeps one flag; a received amount equal to the expected one is not a mismatch; worker only', async () => {
    const p = await payment(await order('held'));
    await flag(p, 40000);
    await flag(p, 40000);
    expect(await flags()).toHaveLength(1);
    await expect(flag(await payment(await order('held')), 50000)).rejects.toThrow(/not a wrong amount/);
    await expect(app.withClubTx(staffCtx(DESK, ['front_desk', 'player']), async (tx) => tx.query(`select app.flag_wrong_amount($1, 1)`, [p]))).rejects.toThrow(/permission denied/);
  });
});

describe('app.credit_wrong_amount (staff)', () => {
  it('credits an underpayment in full to the wallet, with its own receipt, and resolves the flag', async () => {
    const o = await order('held');
    const p = await payment(o);
    await flag(p, 40000);
    expect(await credit(p, 'customer paid 400 instead of 500')).toMatchObject({ outcome: 'wallet_wrong_amount' });
    const calls = await log();
    expect(calls.map((l) => l.port)).toEqual(['credit_wallet', 'issue_receipt', 'enqueue_message']);
    expect(calls[0]!.args).toEqual(['wallet_credit', PLAYER, 40000, 'wrong_amount', `wrong_amount:${p}`, p]);
    expect(calls[2]!.args).toEqual(['wrong_amount', PLAYER, { payment_id: p, amount_satang: 40000 }, `wrong_amount:${p}`]);
    expect(await pay(p)).toMatchObject({ status: 'succeeded', outcome: 'wallet_wrong_amount', confirmed: true });
    expect(await flags()).toEqual([{ kind: 'wrong_amount', status: 'open', payment_id: p, resolved_by: null, note: null }].map((f) => ({ ...f, status: 'resolved', resolved_by: DESK, note: 'customer paid 400 instead of 500' })));
    expect((await tdb.query(`select status from public.booking where order_id = $1`, [o])).rows[0].status).toBe('awaiting_payment');   // the booking is not confirmed
  });

  it('credits an overpayment in full, including the extra', async () => {
    const p = await payment(await order('held'));
    await flag(p, 62000);
    await credit(p, 'paid 620', staffCtx(OWNER, ['owner', 'player']));
    expect((await log())[0]!.args).toEqual(['wallet_credit', PLAYER, 62000, 'wrong_amount', `wrong_amount:${p}`, p]);
  });

  it('writes an audit entry saying who and why, with the note kept apart as personal data', async () => {
    const p = await payment(await order('held'));
    await flag(p, 40000);
    await credit(p, 'a note about the customer');
    const e = (await tdb.query(`select actor_user_id, new_value, pii_new from public.audit_entry where action = 'payment.wrong_amount_credited'`)).rows;
    expect(e).toHaveLength(1);
    expect(e[0].actor_user_id).toBe(DESK);
    expect(JSON.stringify(e[0].new_value)).not.toContain('a note about');
    expect(e[0].pii_new).toEqual({ note: 'a note about the customer' });
  });

  it('needs a reason; front desk and owner only; nothing happens twice', async () => {
    const p = await payment(await order('held'));
    await flag(p, 40000);
    await expect(credit(p, null)).rejects.toThrow(/reason/);
    await expect(credit(p, '   ')).rejects.toThrow(/reason/);
    await expect(credit(p, 'x', staffCtx(ACC, ['accountant', 'player']))).rejects.toThrow(/not allowed/);
    await expect(credit(p, 'x', staffCtx(PLAYER, ['player']))).rejects.toThrow(/not allowed/);
    expect(await flags()).toMatchObject([{ status: 'open' }]);
    await credit(p, 'ok');
    await expect(credit(p, 'again')).rejects.toThrow(/not a wrong amount payment/);
    expect((await log()).filter((l) => l.port === 'credit_wallet')).toHaveLength(1);
  });

  it('refuses a payment that was never flagged, and another club’s payment', async () => {
    const p = await payment(await order('held'));
    await expect(credit(p, 'x')).rejects.toThrow(/not a wrong amount payment/);
    await expect(credit('99999999-9999-4999-8999-999999999999', 'x')).rejects.toThrow(/not_found/);
  });

  it('no port, no credit: the call raises and the flag stays open', async () => {
    await app.end();
    await teardown();
    await setup({ missing: ['credit_wallet'] });
    await staff();
    const p = await payment(await order('held'));
    await flag(p, 40000);
    await expect(credit(p, 'x')).rejects.toThrow(/port_missing:credit_wallet/);
    expect(await flags()).toMatchObject([{ status: 'open' }]);
    expect((await pay(p)).status).toBe('pending');
  });
});
