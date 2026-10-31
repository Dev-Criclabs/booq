import { afterEach, describe, expect, it } from 'vitest';
import { createDb } from './tx';
import { A, PLAYER, apply, bookingStatus, order, payment, setup, tdb, teardown } from './testing/payment-fixtures';

// Migration 0520: Pay skips the marker line of an order that buys a package and pays its hour from it (F04 bundle
// accept, R6-AC3; F06 design 4.4, 4.9). The package is granted when the payment lands, then the line is reserved from it.
afterEach(teardown);

let product: string;
const PORTS: [string, string][] = [
  ['reserve_credit_and_wallet', 'app.port_reserve_credit_and_wallet(uuid)'],
  ['grant_package', 'app.port_grant_package(uuid)'],
  ['credit_wallet', 'app.port_credit_wallet(text, uuid, integer, text, text, uuid)'],
];
async function start() {
  await setup();
  for (const [port, handler] of PORTS) {
    await tdb.query(`delete from app.payment_ports where port = $1`, [port]);
    await tdb.query(`select app.register_payment_port($1, $2::regprocedure)`, [port, handler]);
  }
  product = (await tdb.query(`insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_satang)
                              values ($1,'10 ชั่วโมง','10 hours','court_hour',10,3,450000) returning id`, [A])).rows[0].id;
}
/** A fixture order buying the package (line 2, part of it from the wallet) with the booked hour paid by the marker (line 1). */
async function bundleWithBooking(o: string, wallet: number, marker = true) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    await c.query(`update public.order_line set credit_units = 1, credit_value_satang = 50000, money_satang = 0, wallet_satang = 0, credit_package_id = null, scope = $2
                    where order_id = $1 and position = 1`, [o, JSON.stringify(marker ? { new_package_line: product } : {})]);
    await c.query(`insert into public.order_line (club_id, order_id, position, kind, package_product_id, description_key, name_th, name_en, unit_price_satang, net_satang, wallet_satang, money_satang)
                   values ($1,$2,2,'package',$3,'package','แพ็ก','Pack',450000,450000,$4,450000 - $4)`, [A, o, product, wallet]);
    await c.query(`update public.orders set subtotal_satang = 500000, total_satang = 500000, credit_value_satang = 50000, wallet_satang = $2, money_satang = 450000 - $2 where id = $1`, [o, wallet]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
async function asDefiner<T = unknown>(sql: string, args: unknown[] = []): Promise<T> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role booq_owner');
    await c.query(`select set_config('app.club_id', $1, true)`, [A]);
    const r = Object.values((await c.query(sql, args)).rows[0] ?? {})[0] as T;
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const asPlayer = async (sql: string, args: unknown[]) => {
  const db = createDb({ connectionString: tdb.url, max: 1 });
  try {
    return (await db.withClubTx({ clubId: A, userId: PLAYER, roles: ['player'], source: 'player_app' as const }, (tx) => tx.query(sql, args))).rows[0];
  } finally {
    await db.end();
  }
};
const ledgers = async () => ({
  credit: (await tdb.query(`select reason, change from public.credit_ledger order by created_at, id`)).rows,
  wallet: (await tdb.query(`select reason, change_satang::int as c from public.wallet_ledger order by created_at, id`)).rows,
});

describe('the marker line at Pay (0520)', () => {
  it('Pay as the player skips the marker and spends the wallet part: true, no credit row', async () => {
    await start();
    await asDefiner('select app.wallet_credit($1, $2, $3, $4)', [PLAYER, 20000, 'refund', 'seed']);
    const o = await order('held');
    await bundleWithBooking(o, 20000);
    expect(await asPlayer('select app.port_reserve_credit_and_wallet($1) as ok', [o])).toEqual({ ok: true });
    expect(await ledgers()).toEqual({ credit: [], wallet: [{ reason: 'refund', c: 20000 }, { reason: 'spend', c: -20000 }] });
  });

  it('after the grant, the reserve takes 1 credit from the new package; the wallet is spent once', async () => {
    await start();
    await asDefiner('select app.wallet_credit($1, $2, $3, $4)', [PLAYER, 20000, 'refund', 'seed']);
    const o = await order('held');
    await bundleWithBooking(o, 20000);
    expect(await asPlayer('select app.port_reserve_credit_and_wallet($1) as ok', [o])).toEqual({ ok: true });
    expect(await apply(await payment(o))).toEqual({ outcome: 'applied', order_status: 'paid' });
    expect(await bookingStatus(o)).toBe('confirmed');
    const pk = (await tdb.query(`select p.credits_total, (select sum(change)::int from public.credit_ledger l where l.package_id = p.id) as used
                                   from public.customer_package p where p.order_id = $1`, [o])).rows;
    expect(pk).toEqual([{ credits_total: 10, used: -1 }]);
    expect((await ledgers()).wallet).toEqual([{ reason: 'refund', c: 20000 }, { reason: 'spend', c: -20000 }]);
  });

  it('as the definer a marker whose package is missing is still false, and nothing is written', async () => {
    await start();
    const o = await order('held');
    await bundleWithBooking(o, 0);
    expect(await asDefiner<boolean>('select app.port_reserve_credit_and_wallet($1)', [o])).toBe(false);
    expect(await ledgers()).toEqual({ credit: [], wallet: [] });
  });

  it('a credit line with no package and no marker is still false for the player', async () => {
    await start();
    const o = await order('held');
    await bundleWithBooking(o, 0, false);
    expect(await asPlayer('select app.port_reserve_credit_and_wallet($1) as ok', [o])).toEqual({ ok: false });
  });
});
