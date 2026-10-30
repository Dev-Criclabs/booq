import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apply, bookingStatus, log, order, orderStatus, pay, payment, setup, tdb, teardown } from './testing/payment-fixtures';

// F05-T05b / migration 0405: a late payment that cannot take its slot back goes to the wallet with its own receipt
// (PAY-03-AC1 to AC5; D25, D37, D48). The order keeps its status; only the payment records the outcome.
afterEach(teardown);

const walletCalls = async () => (await log()).filter((l) => l.port === 'credit_wallet');

describe('the slot is not open (outcome wallet_late)', () => {
  beforeEach(() => setup());

  it('another hold has the slot: the whole amount goes to the wallet, the booking stays released', async () => {
    const taken = await order('held', { hour: 90 });
    const o = await order('released', { hour: 90 });
    const p = await payment(o);
    const r = await apply(p);
    expect(r).toMatchObject({ outcome: 'wallet_late', order_status: 'open' });
    expect(await bookingStatus(o)).toBe('released');
    expect(await bookingStatus(taken)).toBe('awaiting_payment');
    expect(await pay(p)).toEqual({ status: 'succeeded', outcome: 'wallet_late', qr_image: null, confirmed: true });
    const calls = await log();
    expect(calls.map((l) => l.port)).toEqual(['credit_wallet', 'issue_receipt']);
    expect(calls[0]!.args).toEqual(['wallet_credit', expect.any(String), 50000, 'late_payment', `late_payment:${p}`, p]);
    expect(calls[1]!.args).toEqual([expect.any(String), p, 'wallet_credit']);
  });

  it('a confirmed booking or a closure has the slot', async () => {
    const taken = await order('held', { hour: 91 });
    await tdb.query(`update public.booking set status = 'confirmed', hold_expires_at = null, confirmed_at = now() where order_id = $1`, [taken]);
    await tdb.query(`update public.occupancy set state = 'confirmed', hold_expires_at = null where booking_id = (select id from public.booking where order_id = $1)`, [taken]);
    const o1 = await order('released', { hour: 91 });
    expect((await apply(await payment(o1))).outcome).toBe('wallet_late');

    await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, closure_id)
                     values ('3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c', 'closure', '00000000-0000-4000-8000-0000000000c1', date_trunc('hour', now()) + interval '92 hours', date_trunc('hour', now()) + interval '93 hours', 'confirmed', gen_random_uuid())`);
    const o2 = await order('released', { hour: 92 });
    expect((await apply(await payment(o2))).outcome).toBe('wallet_late');
  });

  it('a second call for the same payment issues no second wallet credit or receipt', async () => {
    await order('held', { hour: 90 });
    const o = await order('released', { hour: 90 });
    const p = await payment(o);
    await apply(p);
    expect(await apply(p)).toMatchObject({ outcome: 'wallet_late', repeated: true });
    expect(await walletCalls()).toHaveLength(1);
    expect((await log()).filter((l) => l.port === 'issue_receipt')).toHaveLength(1);
  });
});

describe('what cannot be re-applied (outcome wallet_late)', () => {
  beforeEach(() => setup());

  it('the code use cannot be taken back (used up meanwhile): wallet, and the booking stays released', async () => {
    const o = await order('released', { promo: true });
    await tdb.query(`update public.promo_code set active = false`);
    const p = await payment(o);
    expect((await apply(p)).outcome).toBe('wallet_late');
    expect(await bookingStatus(o)).toBe('released');
    expect((await tdb.query(`select status from public.promo_redemption where order_id = $1`, [o])).rows[0].status).toBe('restored');
  });

  it('the credits and wallet cannot be re-reserved: wallet, and nothing is left half done', async () => {
    await teardown();
    await setup({ reserveOk: false });
    const o = await order('released', { credit: 10000, promo: true });
    const p = await payment(o);
    expect((await apply(p)).outcome).toBe('wallet_late');
    expect(await bookingStatus(o)).toBe('released');
    expect((await tdb.query(`select status from public.promo_redemption where order_id = $1`, [o])).rows[0].status).toBe('restored');
    expect((await walletCalls())).toHaveLength(1);
  });
});

describe('a Paused club (D109)', () => {
  it('never confirms a late payment: the value goes to the wallet', async () => {
    await setup({ status: 'paused' });
    const o = await order('released');
    expect((await apply(await payment(o))).outcome).toBe('wallet_late');
    expect(await bookingStatus(o)).toBe('released');
    expect(await orderStatus(o)).toBe('open');
  });
});

describe('a port is missing', () => {
  it('no wallet port: the late payment raises and the payment stays pending', async () => {
    await setup({ missing: ['credit_wallet'] });
    await order('held', { hour: 90 });
    const o = await order('released', { hour: 90 });
    const p = await payment(o);
    await expect(apply(p)).rejects.toThrow(/port_missing:credit_wallet/);
    expect((await pay(p)).status).toBe('pending');
  });
});
