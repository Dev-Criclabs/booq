import { afterEach, describe, expect, it } from 'vitest';
import { A, PLAYER, apply, bookingStatus, log, order, orderStatus, pay, payment, setup, tdb, teardown } from './testing/payment-fixtures';

// F05 / migration 0410: a package bought with a booking (F06 4.4, flows H and I): grant, then reserve, then confirm,
// in one sub-block; when that cannot be done nothing is left half created and the whole amount goes to the wallet
// (R3-AC7, D87). Plus the message port (booking_confirmed, late_payment). Fakes: testing/payment-fixtures.ts.
afterEach(teardown);

/** Adds a package line to an order with hours: the order is then a package bought with a booking. */
async function withPackage(o: string) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    await c.query(`update public.orders set subtotal_satang = subtotal_satang + 450000, total_satang = total_satang + 450000, money_satang = money_satang + 450000 where id = $1`, [o]);
    await c.query(`insert into public.order_line (club_id, order_id, position, kind, package_product_id, description_key, name_th, name_en, unit_price_satang, discount_satang, net_satang, credit_value_satang, wallet_satang, money_satang)
                   values ($1,$2,2,'package',gen_random_uuid(),'package','แพ็กเกจ','Package',450000,0,450000,0,0,450000)`, [A, o]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
const ports = async () => (await log()).map((l) => l.port);

describe('hold running', () => {
  it('grants the package, reserves what the order allocated, then confirms: grant, reserve, receipt, message', async () => {
    await setup();
    const o = await order('held', { credit: 10000 });
    await withPackage(o);
    const p = await payment(o);
    expect(await apply(p)).toEqual({ outcome: 'applied', order_status: 'paid' });
    expect(await ports()).toEqual(['grant_package', 'reserve_credit_and_wallet', 'issue_receipt', 'enqueue_message']);
    expect(await bookingStatus(o)).toBe('confirmed');
  });

  it('without an allocation there is nothing to reserve: grant, confirm', async () => {
    await setup();
    const o = await order('held');
    await withPackage(o);
    await apply(await payment(o));
    expect(await ports()).toEqual(['grant_package', 'issue_receipt', 'enqueue_message']);
  });

  it('when the reserve says no, nothing is half created: the hold is released, the whole amount goes to the wallet, no message says released', async () => {
    await setup({ reserveOk: false });
    const o = await order('held', { credit: 10000 });
    await withPackage(o);
    const p = await payment(o);
    const r = await apply(p);
    expect(r).toMatchObject({ outcome: 'wallet_late' });
    expect(await bookingStatus(o)).toBe('released');
    expect((await tdb.query(`select release_reason from public.booking where order_id = $1`, [o])).rows[0].release_reason).toBe('payment_unavailable');
    expect(await orderStatus(o)).toBe('open');
    expect((await pay(p)).outcome).toBe('wallet_late');
    // the fakes log inside the transaction: the grant and the reserve were undone with the sub-block
    expect(await ports()).toEqual(['credit_wallet', 'issue_receipt', 'enqueue_message']);
  });
});

describe('late payment', () => {
  it('after the slot is taken back it grants, then reserves', async () => {
    await setup();
    const o = await order('released', { credit: 10000 });
    await withPackage(o);
    expect((await apply(await payment(o))).outcome).toBe('applied_late');
    expect(await ports()).toEqual(['grant_package', 'reserve_credit_and_wallet', 'issue_receipt', 'enqueue_message']);
  });

  it('a package order without hours is granted and received', async () => {
    await setup();
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
    await apply(await payment(o));
    expect(await ports()).toEqual(['grant_package', 'issue_receipt']);   // no hours, so no booking_confirmed
  });
});

describe('a grant that raises is not swallowed', () => {
  it('the payment stays pending and the booking held', async () => {
    await setup();
    await tdb.query(`create or replace function public.__grant_package(o uuid) returns void language plpgsql as $$ begin raise exception 'payment:grant:product_missing'; end $$`);
    const o = await order('held');
    await withPackage(o);
    const p = await payment(o);
    await expect(apply(p)).rejects.toThrow(/grant:product_missing/);
    expect((await pay(p)).status).toBe('pending');
    expect(await bookingStatus(o)).toBe('awaiting_payment');
  });
});

describe('the message port is required', () => {
  it('without enqueue_message the payment is not applied', async () => {
    await setup({ missing: ['enqueue_message'] });
    const o = await order('held');
    const p = await payment(o);
    await expect(apply(p)).rejects.toThrow(/port_missing:enqueue_message/);
    expect((await pay(p)).status).toBe('pending');
    expect(await bookingStatus(o)).toBe('awaiting_payment');
  });
});
