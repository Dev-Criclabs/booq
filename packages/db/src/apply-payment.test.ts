import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apply, bookingStatus, log, order, orderStatus, pay, payment, setup, tdb, teardown } from './testing/payment-fixtures';

// F05-T05a / migration 0404: app.apply_payment, part (a): a repeated callback, success while the hold runs,
// and success after the hold with the slot still open (PAY-02-AC4, AC7, PAY-03-AC7; D18, D25).
// F06 and F13 do not exist: the four ports are fakes (testing/payment-fixtures.ts, docs/architecture/apply-payment.md).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const PLAYER = '11111111-1111-4111-8111-111111111111';

afterEach(teardown);

describe('success while the hold runs (outcome applied)', () => {
  beforeEach(() => setup());

  it('confirms the booking, marks the order paid and the payment succeeded, clears the QR, and issues the receipt', async () => {
    const o = await order('held');
    const p = await payment(o);
    await tdb.query(`update public.payment set qr_image = 'abc' where id = $1`, [p]);
    expect(await apply(p)).toEqual({ outcome: 'applied', order_status: 'paid' });
    expect(await bookingStatus(o)).toBe('confirmed');
    expect(await orderStatus(o)).toBe('paid');
    expect(await pay(p)).toEqual({ status: 'succeeded', outcome: 'applied', qr_image: null, confirmed: true });
    expect((await tdb.query(`select state from public.occupancy where booking_id = (select id from public.booking where order_id = $1)`, [o])).rows[0].state).toBe('confirmed');
    expect(await log()).toEqual([{ port: 'issue_receipt', args: [o, p, 'order'] }]);
  });

  it('a repeated callback changes nothing and issues no second receipt', async () => {
    const o = await order('held');
    const p = await payment(o);
    await apply(p);
    expect(await apply(p)).toEqual({ outcome: 'applied', order_status: 'paid', repeated: true });
    expect((await log()).filter((l) => l.port === 'issue_receipt')).toHaveLength(1);
  });

  it('a package order (no hour to confirm) grants the package and issues the receipt', async () => {
    const o = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, PLAYER])).rows[0].id as string;
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
    const p = await payment(o);
    expect(await apply(p)).toEqual({ outcome: 'applied', order_status: 'paid' });
    expect((await log()).map((l) => l.port)).toEqual(['grant_package', 'issue_receipt']);
  });
});

describe('success after the hold, slot still open (outcome applied_late)', () => {
  beforeEach(() => setup());

  it('takes the slot back when the hold ended but the job had not released it yet', async () => {
    const o = await order('expired');
    const p = await payment(o);
    expect(await apply(p)).toEqual({ outcome: 'applied_late', order_status: 'paid' });
    expect(await bookingStatus(o)).toBe('confirmed');
    expect((await pay(p)).outcome).toBe('applied_late');
  });

  it('takes the slot back when the job already released it, with the same order and amounts', async () => {
    const o = await order('released');
    const p = await payment(o);
    const before = (await tdb.query(`select total_satang, money_satang from public.orders where id = $1`, [o])).rows[0];
    expect(await apply(p)).toEqual({ outcome: 'applied_late', order_status: 'paid' });
    expect(await bookingStatus(o)).toBe('confirmed');
    expect((await tdb.query(`select total_satang, money_satang from public.orders where id = $1`, [o])).rows[0]).toEqual(before);
  });

  it('takes the code use back, and re-reserves credits and wallet through the F06 port when the order used them', async () => {
    const o = await order('released', { promo: true, credit: 10000 });
    const p = await payment(o);
    await apply(p);
    expect((await tdb.query(`select status from public.promo_redemption where order_id = $1`, [o])).rows[0].status).toBe('counted');
    expect((await log()).map((l) => l.port)).toEqual(['reserve_credit_and_wallet', 'issue_receipt']);
  });

  it('an order that used no credit or wallet does not call the F06 reserve port', async () => {
    const o = await order('released');
    await apply(await payment(o));
    expect((await log()).map((l) => l.port)).toEqual(['issue_receipt']);
  });
});

describe('what part (a) leaves to the others', () => {
  beforeEach(() => setup());

  it('a wrong amount is refused here (the caller raises the owner flag)', async () => {
    const o = await order('held');
    const p = await payment(o);
    await expect(apply(p, 49999)).rejects.toThrow(/amount_mismatch/);
    expect((await pay(p)).status).toBe('pending');
  });

  it('only the worker role may call it', async () => {
    for (const role of ['booq_app', 'booq_platform']) {
      expect((await tdb.query(`select has_function_privilege($1, 'app.apply_payment(uuid, integer)', 'execute') as ok`, [role])).rows[0].ok, role).toBe(false);
    }
  });
});

describe('a missing port fails closed', () => {
  it('no receipt port: the call raises and the booking stays held, the payment pending', async () => {
    await setup({ missing: ['issue_receipt'] });
    const o = await order('held');
    const p = await payment(o);
    await expect(apply(p)).rejects.toThrow(/port_missing:issue_receipt/);
    expect(await bookingStatus(o)).toBe('awaiting_payment');
    expect((await pay(p)).status).toBe('pending');
    expect(await orderStatus(o)).toBe('open');
  });

  it('credits to re-reserve but no F06 port: the late payment raises and the booking stays released', async () => {
    await setup({ missing: ['reserve_credit_and_wallet'] });
    const o = await order('released', { credit: 10000 });
    const p = await payment(o);
    await expect(apply(p)).rejects.toThrow(/port_missing:reserve_credit_and_wallet/);
    expect(await bookingStatus(o)).toBe('released');
  });
});
