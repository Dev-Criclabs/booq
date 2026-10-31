import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { CASH_TEXT_KEYS } from '@booq/domain';
import { fakeReceiptAndMessagePorts, IDS, seedHunter } from '../../../../../packages/domain/src/checkout/test-fixture';
import f05 from '../../../../../locales/pending/f05.json';
import en from '../../../../../locales/en.json';
import th from '../../../../../locales/th.json';
import { cashRoutes } from './cash';

// POST /staff/orders/:id/cash (F05 §5.6; PAY-06-AC1 to AC5; D174, D181). Hunter's prices are test data here.
const { A, COURT, ME } = IDS;
const DESK = '88888888-8888-4888-8888-888888888888';
const NOW = '2026-12-02T10:00:00Z';
const SLOT = '2026-12-02T11:00:00Z';
const deps = { hasFeature: async () => true };
const desk = { clubId: A, userId: DESK, roles: ['front_desk', 'player'] };

let tdb: TestDatabase;
let db: Db;
let keyNo = 0;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow(NOW);
  await seedHunter(tdb);
  await fakeReceiptAndMessagePorts(tdb);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,'LD')`, [A, DESK]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'front_desk'), ($1,$2,'player')`, [A, DESK]);
    await c.query('commit');
  } finally {
    c.release();
  }
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

/** An open priced order, held: one court hour awaiting payment inside its hold, with its occupancy and line. */
async function heldCourtOrder(holdEnds = '2026-12-02T10:15:00Z', slot = SLOT): Promise<{ order: string; booking: string }> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    const o = (await c.query(`insert into public.orders (club_id, customer_id, source, price_group_snapshot, subtotal_satang, discount_satang, total_satang, credit_value_satang,
                              wallet_satang, money_satang, quote_hash, priced_at) values ($1,$2,'online','{}',50000,0,50000,0,0,50000,repeat('a',64),now()) returning id`, [A, ME])).rows[0].id as string;
    const b = (await c.query(`insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, hold_expires_at)
                              values ($1,$2,'court',$3,$4::timestamptz,$4::timestamptz + interval '1 hour',$5,'awaiting_payment','online',$5,$6) returning id`, [A, o, COURT, slot, ME, holdEnds])).rows[0].id as string;
    await c.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, hold_expires_at, booking_id)
                   values ($1,'court_booking',$2,$3::timestamptz,$3::timestamptz + interval '1 hour','held',$4,$5)`, [A, COURT, slot, holdEnds, b]);
    await c.query(`insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, net_satang, money_satang)
                   values ($1,$2,1,'court_hour',$3,'P-0076','1','1',50000,50000,50000)`, [A, o, b]);
    await c.query(`insert into public.payment (club_id, order_id, method, status, environment, gateway, amount_satang) values ($1,$2,'beam','pending','live','beam',50000)`, [A, o]);
    await c.query('commit');
    return { order: o, booking: b };
  } finally {
    c.release();
  }
}

/** An open priced package order (no booking) for a court bundle. */
async function packageOrder(): Promise<string> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    const p = (await c.query(`insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_satang) values ($1,'บันเดิล','Bundle','court_hour',10,6,450000) returning id`, [A])).rows[0].id;
    const o = (await c.query(`insert into public.orders (club_id, customer_id, source, price_group_snapshot, subtotal_satang, discount_satang, total_satang, credit_value_satang,
                              wallet_satang, money_satang, quote_hash, priced_at) values ($1,$2,'online','{}',450000,0,450000,0,0,450000,repeat('b',64),now()) returning id`, [A, ME])).rows[0].id as string;
    await c.query(`insert into public.order_line (club_id, order_id, position, kind, package_product_id, description_key, name_th, name_en, unit_price_satang, net_satang, money_satang)
                   values ($1,$2,1,'package',$3,'P-new.package_line','บันเดิล','Bundle',450000,450000,450000)`, [A, o, p]);
    await c.query('commit');
    return o;
  } finally {
    c.release();
  }
}

const cash = (id: string, body: unknown, session: unknown = desk, key: string | null = `k-${++keyNo}`) =>
  cashRoutes({ db })[0]!.handle({ session: session as never, input: { id, ...(key === null ? {} : { idempotencyKey: key }) }, body }, deps);

describe('POST /staff/orders/:id/cash', () => {
  it('is payment.cash (front desk, owner), no-store; a player is refused', async () => {
    const r = cashRoutes({ db })[0]!;
    expect(r.def).toMatchObject({ method: 'POST', path: '/staff/orders/:id/cash', permission: 'payment.cash' });
    expect(r.headers).toEqual({ 'Cache-Control': 'no-store' });
    const { order } = await heldCourtOrder();
    expect(await cash(order, { reasonCode: 'no_banking_app' }, { clubId: A, userId: ME, roles: ['player'] })).toMatchObject({ ok: false, status: 403 });
  });

  it('a court booking order: the hold confirmed, the Beam charge cancelled, a receipt issued, nothing double booked (PAY-06-AC1, D181)', async () => {
    const { order, booking } = await heldCourtOrder();
    const r = await cash(order, { reasonCode: 'qr_failed_at_counter' });
    expect(r).toMatchObject({ ok: true, body: { orderId: order, orderStatus: 'paid' } });
    expect((await tdb.query(`select status, hold_expires_at from public.booking where id = $1`, [booking])).rows[0]).toEqual({ status: 'confirmed', hold_expires_at: null });
    expect((await tdb.query(`select count(*)::int as n, min(state) as s from public.occupancy where resource_id = $1 and start_at = $2`, [COURT, SLOT])).rows[0]).toEqual({ n: 1, s: 'confirmed' });
    expect((await tdb.query(`select method, status, cash_reason_code, taken_by from public.payment where order_id = $1 order by method`, [order])).rows)
      .toEqual([{ method: 'beam', status: 'cancelled', cash_reason_code: null, taken_by: null }, { method: 'cash', status: 'succeeded', cash_reason_code: 'qr_failed_at_counter', taken_by: DESK }]);
    expect((await tdb.query(`select port from public.__f04_port_log order by n`)).rows.map((x) => x.port)).toEqual(['issue_receipt', 'enqueue_message']);
  });

  it('the same Idempotency-Key returns the first answer and takes nothing twice; none is refused', async () => {
    const { order } = await heldCourtOrder();
    const a = await cash(order, { reasonCode: 'no_banking_app' }, desk, 'same');
    expect(await cash(order, { reasonCode: 'no_banking_app' }, desk, 'same')).toEqual(a);
    expect((await tdb.query(`select count(*)::int as n from public.payment where order_id = $1 and method = 'cash'`, [order])).rows[0].n).toBe(1);
    expect(await cash(order, { reasonCode: 'no_banking_app' }, desk, null)).toEqual({ ok: false, status: 400, code: 'idempotency_key_required' });
  });

  it('a package order: paid in cash and the package granted (PAY-06-AC4)', async () => {
    const order = await packageOrder();
    expect(await cash(order, { reasonCode: 'other', note: 'Paid at the counter' })).toMatchObject({ ok: true, body: { orderStatus: 'paid' } });
    expect((await tdb.query(`select credits_total from public.customer_package where order_id = $1`, [order])).rows).toEqual([{ credits_total: 10 }]);
  });

  it('refusals: no reason, an unknown reason, other without a note, a Paused club, an ended hold, no open order', async () => {
    const { order } = await heldCourtOrder();
    expect(await cash(order, {})).toMatchObject({ status: 400, code: 'cash_reason_required' });
    expect(await cash(order, { reasonCode: 'friend' })).toMatchObject({ status: 400, code: 'bad_input' });
    expect(await cash(order, { reasonCode: 'other', note: '  ' })).toMatchObject({ status: 400, code: 'cash_note_required' });
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    expect(await cash(order, { reasonCode: 'no_banking_app' })).toMatchObject({ status: 409, code: 'club_paused' });
    await tdb.query(`update public.club set status = 'live' where id = $1`, [A]);
    const ended = await heldCourtOrder('2026-12-02T09:59:00Z', '2026-12-02T12:00:00Z');
    expect(await cash(ended.order, { reasonCode: 'no_banking_app' })).toMatchObject({ status: 409, code: 'hold_ended' });
    expect(await cash('00000000-0000-4000-8000-00000000dead', { reasonCode: 'no_banking_app' })).toMatchObject({ status: 404, code: 'order_not_found' });
    expect((await tdb.query(`select count(*)::int as n from public.payment where method = 'cash'`)).rows[0].n).toBe(0);
  });

  it('every refusal maps to a text in both languages', () => {
    const files = [f05 as { en: Record<string, string>; th: Record<string, string> }, { en: en as Record<string, string>, th: th as Record<string, string> }];
    for (const key of Object.values(CASH_TEXT_KEYS)) {
      expect(files.some((f) => typeof f.en[key] === 'string' && typeof f.th[key] === 'string')).toBe(true);
    }
  });
});
