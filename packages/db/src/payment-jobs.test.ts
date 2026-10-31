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

/** The wallet spend and the code use a package order took at Pay (written as Pay's definer functions would). */
async function tookWalletAndCode(o: string): Promise<void> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    await c.query(`insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, dedupe_key) values ($1,$2,20000,'refund','t:in')`, [A, PLAYER]);
    await c.query(`insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, order_id, order_line_id, dedupe_key)
                   select $1, $2, -20000, 'spend', $3, l.id, 't:spend' from public.order_line l where l.order_id = $3`, [A, PLAYER, o]);
    const code = (await c.query(`insert into public.promo_code (club_id, code_upper, kind, value, applies_to) values ($1,'PACK','percent',1000,'{package}') returning id`, [A])).rows[0].id;
    await c.query(`insert into public.promo_redemption (club_id, code_id, order_id, customer_id, status) values ($1,$2,$3,$4,'counted')`, [A, code, o, PLAYER]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
const walletOf = async () => Number((await tdb.query(`select coalesce(sum(change_satang), 0)::int as b from public.wallet_ledger where customer_id = $1`, [PLAYER])).rows[0].b);

// 0416: a package order that ends unpaid gives back what it took at Pay (PAY-04-AC2, R1-AC8, D67).
describe('app.end_package_order and the expiry (0416)', () => {
  it('the expiry returns the wallet spend and restores the code use', async () => {
    const due = await packageOrder('2000-01-01T00:00:00Z');
    await tookWalletAndCode(due.order);
    expect(await walletOf()).toBe(0);
    expect(await asWorker<{ r: boolean }>('select app.expire_package_order($1) as r', [due.order])).toEqual([{ r: true }]);
    expect(await walletOf()).toBe(20000);
    expect((await tdb.query(`select status, restore_reason from public.promo_redemption`)).rows[0]).toEqual({ status: 'restored', restore_reason: 'expired' });
    expect(await asWorker<{ r: boolean }>('select app.expire_package_order($1) as r', [due.order])).toEqual([{ r: false }]);
    expect(await walletOf()).toBe(20000);
  });

  it('payment_unavailable, by the order’s player: the order cancelled, the payment failed, the wallet and code given back', async () => {
    const live = await packageOrder('2999-01-01T00:00:00Z');
    await tookWalletAndCode(live.order);
    const asPlayer = { clubId: A, userId: PLAYER, roles: ['player'] as never, source: 'player_app' as const };
    expect(await web.withClubTx(asPlayer, async (tx) => (await tx.query(`select app.end_package_order($1, 'payment_unavailable') as r`, [live.order])).rows[0]!.r)).toBe(true);
    expect((await tdb.query(`select status from public.orders where id = $1`, [live.order])).rows[0].status).toBe('cancelled');
    expect((await tdb.query(`select status, failure_code, qr_image from public.payment where id = $1`, [live.payment])).rows[0])
      .toEqual({ status: 'failed', failure_code: 'payment_unavailable', qr_image: null });
    expect(await walletOf()).toBe(20000);
    expect((await tdb.query(`select status from public.promo_redemption`)).rows[0].status).toBe('restored');
    expect((await tdb.query(`select port from public.__log`)).rows).toEqual([]);   // no receipt, no message
  });

  it('another player may not end it, a player may not expire it, and an order with bookings is left alone', async () => {
    const OTHER = '22222222-2222-4222-8222-222222222222';
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,'L2')`, [A, OTHER]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, OTHER]);
      await c.query('commit');
    } finally {
      c.release();
    }
    const live = await packageOrder('2999-01-01T00:00:00Z');
    const as = (u: string) => ({ clubId: A, userId: u, roles: ['player'] as never, source: 'player_app' as const });
    await expect(web.withClubTx(as(OTHER), (tx) => tx.query(`select app.end_package_order($1, 'payment_unavailable')`, [live.order]))).rejects.toThrow(/not allowed/);
    await expect(web.withClubTx(as(PLAYER), (tx) => tx.query(`select app.end_package_order($1, 'expired')`, [live.order]))).rejects.toThrow(/not allowed/);
    await expect(web.withClubTx(as(PLAYER), (tx) => tx.query(`select app.end_package_order($1, 'player')`, [live.order]))).rejects.toThrow(/unknown end reason/);
    const booked = await order('held');
    expect(await web.withClubTx(as(PLAYER), async (tx) => (await tx.query(`select app.end_package_order($1, 'payment_unavailable') as r`, [booked])).rows[0]!.r)).toBe(false);
    expect((await tdb.query(`select status from public.orders where id = $1`, [live.order])).rows[0].status).toBe('open');
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
