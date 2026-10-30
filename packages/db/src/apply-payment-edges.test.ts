import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { A, PLAYER, apply, bookingStatus, log, order, orderStatus, pay, payment, setup, tdb, teardown } from './testing/payment-fixtures';

// F05-T05c / migration 0406: money that arrives for something that can no longer take it goes to the wallet
// (PAY-03, PAY-04-AC7; D74, D107, D109). The order keeps its status; the payment records the outcome.
afterEach(teardown);
beforeEach(() => setup());

const wallet = async () => (await log()).filter((l) => l.port === 'credit_wallet');
const setOrder = async (o: string, status: string) => {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    await c.query(`update public.orders set status = $2 where id = $1`, [o, status]);
    await c.query('commit');
  } finally {
    c.release();
  }
};

describe('a second success for a paid order', () => {
  it('sends the second amount to the wallet as duplicate_payment, with its own receipt, once', async () => {
    const o = await order('held');
    const first = await payment(o);
    await apply(first);
    expect(await orderStatus(o)).toBe('paid');
    const second = (await tdb.query(`insert into public.payment (club_id, order_id, method, status, environment, gateway, gateway_charge_id, amount_satang) values ($1,$2,'beam','pending','live','beam','chg_dup', (select money_satang from public.orders where id = $2)) returning id`, [A, o])).rows[0].id as string;
    expect(await apply(second)).toMatchObject({ outcome: 'wallet_duplicate', order_status: 'paid' });
    expect(await pay(second)).toMatchObject({ status: 'succeeded', outcome: 'wallet_duplicate' });
    const w = await wallet();
    expect(w).toHaveLength(1);
    expect(w[0]!.args).toEqual(['wallet_credit', PLAYER, 50000, 'duplicate_payment', `late_payment:${second}`, second]);
    expect(await apply(second)).toMatchObject({ repeated: true });
    expect(await wallet()).toHaveLength(1);
  });
});

describe('a cancelled order', () => {
  it('goes to the wallet as wallet_cancelled with reason late_payment and the order stays cancelled', async () => {
    const o = await order('released');
    await setOrder(o, 'cancelled');
    const p = await payment(o);
    expect(await apply(p)).toMatchObject({ outcome: 'wallet_cancelled', order_status: 'cancelled' });
    expect((await wallet())[0]!.args).toEqual(['wallet_credit', PLAYER, 50000, 'late_payment', `late_payment:${p}`, p]);
    expect(await bookingStatus(o)).toBe('released');
  });

  it('a cancelled package order does the same (D74)', async () => {
    const o = await order('held');
    await setOrder(o, 'cancelled');
    const p = await payment(o);
    expect((await apply(p)).outcome).toBe('wallet_cancelled');
    expect((await log()).map((l) => l.port)).not.toContain('grant_package');
  });
});

describe('a Beam success on a payment that cash already cancelled', () => {
  it('is accepted: the money goes to the wallet, the cash-settled order is untouched', async () => {
    const o = await order('held');
    const p = await payment(o);
    await tdb.query(`update public.payment set status = 'cancelled' where id = $1`, [p]);
    await setOrder(o, 'paid');
    expect(await apply(p)).toMatchObject({ outcome: 'wallet_cancelled', order_status: 'paid' });
    expect(await pay(p)).toMatchObject({ status: 'succeeded', outcome: 'wallet_cancelled' });
    expect(await orderStatus(o)).toBe('paid');
  });
});

describe('a deleted account (D107)', () => {
  it('never gets the booking back from a late payment: the value goes to the wallet', async () => {
    const o = await order('released');
    await tdb.query(`update public.app_user set anonymised_at = now() where id = $1`, [PLAYER]);
    const p = await payment(o);
    expect(await apply(p)).toMatchObject({ outcome: 'wallet_late' });
    expect(await bookingStatus(o)).toBe('released');
  });
});

describe('nothing raises for the old gap any more', () => {
  it('a payment can always be placed: applied, applied_late or a wallet outcome', async () => {
    const outcomes = new Set<string>();
    for (const state of ['held', 'expired', 'released'] as const) {
      outcomes.add(String((await apply(await payment(await order(state)))).outcome));
    }
    expect([...outcomes].sort()).toEqual(['applied', 'applied_late']);
  });
});

describe('the guard stays narrow', () => {
  it('a cancelled payment can still not become anything but succeeded with outcome wallet_cancelled', async () => {
    const o = await order('held');
    const p = await payment(o);
    await tdb.query(`update public.payment set status = 'cancelled' where id = $1`, [p]);
    await expect(tdb.query(`update public.payment set status = 'failed' where id = $1`, [p])).rejects.toThrow(/is final/);
    await expect(tdb.query(`update public.payment set status = 'pending' where id = $1`, [p])).rejects.toThrow(/is final/);
    await expect(tdb.query(`update public.payment set status = 'succeeded', outcome = 'applied', confirmed_at = now() where id = $1`, [p])).rejects.toThrow(/is final/);
  });
});
