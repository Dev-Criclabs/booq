import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { A, ctx, order, payment, PLAYER, setup, tdb, teardown, worker } from './testing/payment-fixtures';

// F05-T09 / migration 0415: the payment jobs' reads and writes (PAY-02-AC15, PAY-04-AC1 to AC7; D73, D74).
let web: Db;
const asWorker = <T>(sql: string, args: unknown[] = []) => worker.withClubTx(ctx(), async (tx) => (await tx.query(sql, args)).rows as T[]);

beforeEach(async () => {
  await setup();
  web = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await web.end();
  await teardown();
});

/** A package order: priced, no booking, a pending Beam payment whose QR ends at `qrEnds`. */
async function packageOrder(qrEnds: string): Promise<{ order: string; payment: string }> {
  const o = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, PLAYER])).rows[0].id as string;
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    await c.query(`update public.orders set price_group_snapshot='{}', subtotal_satang=90000, discount_satang=0, total_satang=90000, credit_value_satang=0,
                   wallet_satang=0, money_satang=90000, quote_hash=repeat('b',64), priced_at=now() where id=$1`, [o]);
    const product = (await c.query(`insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_satang)
                                    values ($1,'บันเดิล','Bundle','court_hour',10,6,90000) returning id`, [A])).rows[0].id as string;
    await c.query(`insert into public.order_line (club_id, order_id, position, kind, package_product_id, description_key, name_th, name_en,
                   unit_price_satang, discount_satang, net_satang, money_satang) values ($1,$2,1,'package',$3,'P-0021','บันเดิล','Bundle',90000,0,90000,90000)`, [A, o, product]);
    await c.query('commit');
  } finally {
    c.release();
  }
  const p = (await tdb.query(`insert into public.payment (club_id, order_id, method, status, environment, gateway, gateway_charge_id, amount_satang, qr_image, qr_expires_at)
                              values ($1,$2,'beam','pending','live','beam','chg_'||gen_random_uuid(),90000,'QR',$3) returning id`, [A, o, qrEnds])).rows[0].id as string;
  return { order: o, payment: p };
}

describe('the payment job functions are the worker only', () => {
  it('the app role cannot call them', async () => {
    const player = { clubId: A, userId: PLAYER, roles: ['player'] as never, source: 'player_app' as const };
    for (const sql of [`select app.beam_merchant('live')`, 'select * from app.beam_reconcile_candidates()', 'select * from app.package_order_expiry_candidates()', 'select app.clear_final_qr_images()']) {
      await expect(web.withClubTx(player, (tx) => tx.query(sql)), sql).rejects.toThrow();
    }
  });
});

describe('app.beam_merchant', () => {
  it('gives the merchant of the asked key set, never the other; null without one', async () => {
    expect(await asWorker<{ m: string | null }>(`select app.beam_merchant('live') as m`)).toEqual([{ m: null }]);
    await tdb.query(`insert into public.payment_connection (club_id, merchant_id_test, merchant_id_live) values ($1,'m-test','m-live')`, [A]);
    expect(await asWorker<{ m: string }>(`select app.beam_merchant('live') as m`)).toEqual([{ m: 'm-live' }]);
    expect(await asWorker<{ m: string }>(`select app.beam_merchant('test') as m`)).toEqual([{ m: 'm-test' }]);
    await expect(asWorker(`select app.beam_merchant('other')`)).rejects.toThrow(/unknown key set/);
  });
});

describe('app.beam_reconcile_candidates (D73)', () => {
  it('none while the age setting is unset: no value in code', async () => {
    await payment(await order('held'));
    expect(await asWorker('select * from app.beam_reconcile_candidates()')).toEqual([]);
  });
  it('pending Beam payments with a charge older than the age; not newer ones, not final ones', async () => {
    await tdb.query(`insert into platform.config (key, value) values ('beam_reconcile_age_seconds', '300') on conflict (key) do update set value = excluded.value`);
    await tdb.setNow('2026-12-01T03:00:00Z');
    const old = await payment(await order('held'));
    const done = await payment(await order('held'));
    await tdb.query(`update public.payment set status = 'failed', failure_code = 'x' where id = $1`, [done]);
    await tdb.setNow('2026-12-01T03:10:00Z');
    const fresh = await payment(await order('held'));
    const rows = await asWorker<{ payment_id: string; environment: string; amount_satang: number }>('select * from app.beam_reconcile_candidates()');
    expect(rows.map((r) => r.payment_id)).toEqual([old]);
    expect(rows[0]).toMatchObject({ environment: 'live', amount_satang: 50000 });
    void fresh;
  });
});

describe('package order expiry (PAY-04-AC2, D74)', () => {
  it('a package order whose QR time has passed is a candidate; one still within its time, or with bookings, is not', async () => {
    const due = await packageOrder('2000-01-01T00:00:00Z');
    await packageOrder('2999-01-01T00:00:00Z');
    await payment(await order('held'));
    expect(await asWorker<{ c: string }>('select c from app.package_order_expiry_candidates() c')).toEqual([{ c: due.order }]);
  });

  it('expiring cancels the order and sets the payment expired with no QR; no ledger row, no receipt; twice changes nothing', async () => {
    const due = await packageOrder('2000-01-01T00:00:00Z');
    expect(await asWorker<{ r: boolean }>('select app.expire_package_order($1) as r', [due.order])).toEqual([{ r: true }]);
    expect((await tdb.query(`select status from public.orders where id = $1`, [due.order])).rows[0].status).toBe('cancelled');
    expect((await tdb.query(`select status, qr_image from public.payment where id = $1`, [due.payment])).rows[0]).toEqual({ status: 'expired', qr_image: null });
    expect(Number((await tdb.query(`select count(*) from public.wallet_ledger`)).rows[0].count)).toBe(0);
    expect((await tdb.query(`select port from public.__log`)).rows).toEqual([]);
    expect(await asWorker<{ r: boolean }>('select app.expire_package_order($1) as r', [due.order])).toEqual([{ r: false }]);
  });

  it('a payment after the expiry goes to the wallet with its own receipt (D74)', async () => {
    const due = await packageOrder('2000-01-01T00:00:00Z');
    await asWorker('select app.expire_package_order($1)', [due.order]);
    const r = await asWorker<{ r: { outcome: string } }>('select app.apply_payment($1, 90000) as r', [due.payment]);
    expect(r[0]!.r.outcome).toBe('wallet_cancelled');
    // The wallet credit and its own receipt (and the player's message about it).
    expect((await tdb.query(`select port from public.__log order by n`)).rows.map((x) => x.port)).toEqual(expect.arrayContaining(['credit_wallet', 'issue_receipt']));
  });

  it('a QR still within its time, and an order with bookings, are not expired', async () => {
    const live = await packageOrder('2999-01-01T00:00:00Z');
    expect(await asWorker<{ r: boolean }>('select app.expire_package_order($1) as r', [live.order])).toEqual([{ r: false }]);
    const booked = await order('held');
    expect(await asWorker<{ r: boolean }>('select app.expire_package_order($1) as r', [booked])).toEqual([{ r: false }]);
  });
});

describe('app.clear_final_qr_images', () => {
  it('clears the image of final payments only', async () => {
    const pending = await payment(await order('held'));
    const failed = await payment(await order('held'));
    await tdb.query(`update public.payment set qr_image = 'QR' where id in ($1, $2)`, [pending, failed]);
    await tdb.query(`update public.payment set status = 'failed', failure_code = 'x' where id = $1`, [failed]);
    expect(await asWorker<{ n: number }>('select app.clear_final_qr_images() as n')).toEqual([{ n: 1 }]);
    expect((await tdb.query(`select id, qr_image from public.payment where id in ($1, $2) order by qr_image nulls first`, [pending, failed])).rows)
      .toEqual([{ id: failed, qr_image: null }, { id: pending, qr_image: 'QR' }]);
  });
});
