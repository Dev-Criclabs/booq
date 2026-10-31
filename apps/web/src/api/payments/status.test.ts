import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { stateOf } from '@booq/domain';
import { paymentStatusRoutes } from './status';

// C11 (F05 design 6; PAY-01-AC1, AC2, PAY-02): GET /payments/:id.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const P1 = '22222222-2222-4222-8222-222222222222';
const P2 = '11111111-1111-4111-8111-111111111111';
const DESK = '33333333-3333-4333-8333-333333333333';
const deps = { hasFeature: async () => true };
let tdb: TestDatabase;
let db: Db;
let pay: string;
let order: string;
type Roles = ('player' | 'front_desk')[];
const get = (userId: string | null, id: string, roles: Roles = ['player']) =>
  paymentStatusRoutes({ db })[0]!.handle({ session: userId ? { clubId: A, userId, roles } : null, input: { id } }, deps) as Promise<{ ok: boolean; status: number; body?: any }>;

async function person(id: string, roles: string[]) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)`, [A, id, 'L' + id]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [A, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2027-01-09T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'2','tennis')`, [A, C1, LOC]);
  await person(P1, ['player']);
  await person(P2, ['player']);
  await person(DESK, ['front_desk', 'player']);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    order = (await c.query(
      `insert into public.orders (club_id, customer_id, source, status, price_group_snapshot, subtotal_satang, discount_satang, total_satang, credit_value_satang, wallet_satang, money_satang, quote_hash, priced_at)
       values ($1,$2,'online','open','{}'::jsonb,50000,0,50000,0,0,50000,repeat('a',64), app.now()) returning id`, [A, P1])).rows[0].id;
    await c.query('commit');
  } finally {
    c.release();
  }
  await tdb.query(`insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, hold_expires_at)
                   values ($1,$2,'court',$3,'2027-01-09T18:00:00+07:00','2027-01-09T19:00:00+07:00',$4,'awaiting_payment','online',$4, app.now() + interval '12 minutes')`, [A, order, C1, P1]);
  pay = (await tdb.query(`insert into public.payment (club_id, order_id, method, status, environment, gateway, gateway_charge_id, amount_satang, qr_image, qr_expires_at)
                          values ($1,$2,'beam','pending','test','beam','ch_1',50000,'QRBASE64', app.now() + interval '10 minutes') returning id`, [A, order])).rows[0].id;
  db = createDb({ connectionString: tdb.url, max: 3 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('GET /payments/:id', () => {
  it('a waiting payment gives the QR, the amount, the QR expiry, the hold and the court hour', async () => {
    const r = await get(P1, pay);
    expect(r.ok).toBe(true);
    expect(r.body).toMatchObject({ paymentId: pay, orderId: order, state: 'waiting', amountSatang: 50000, qrImageBase64: 'QRBASE64', booking: { courtName: '2', startAt: '2027-01-09T11:00:00.000Z' }, receiptNumber: null });
    expect(r.body.holdExpiresAt).toBe('2027-01-09T03:12:00.000Z');
    expect(r.body.qrExpiresAt).toBe('2027-01-09T03:10:00.000Z');
  });
  it('staff read the club payment; another player, another club id and a guest cannot', async () => {
    expect((await get(DESK, pay, ['front_desk', 'player'] as never)).ok).toBe(true);
    expect(await get(P2, pay)).toMatchObject({ ok: false, status: 404 });
    expect(await get(P1, '99999999-9999-4999-8999-999999999999')).toMatchObject({ ok: false, status: 404 });
    expect(await get(P1, 'nope')).toMatchObject({ ok: false, status: 404 });
    expect(await get(null, pay)).toMatchObject({ ok: false, status: 401 });
  });
  it('a final payment has no QR and no hold; a succeeded one carries the receipt number', async () => {
    await tdb.query(`update public.payment set status = 'succeeded', outcome = 'applied', qr_image = null, confirmed_at = app.now() where id = $1`, [pay]);
    await tdb.query(`update public.booking set status = 'confirmed', hold_expires_at = null, confirmed_at = app.now() where order_id = $1`, [order]);
    await tdb.query(`insert into public.receipt (club_id, order_id, kind, series, seq_no, number, vat_flag, customer_id, customer_name_snapshot, lines, total_satang) values ($1,$2,'sale','2027',1,'HTC-2027-000001',false,$3,'x','{}'::jsonb,50000)`, [A, order, P1]);
    const r = await get(P1, pay);
    expect(r.body).toMatchObject({ state: 'confirmed', qrImageBase64: null, qrExpiresAt: null, holdExpiresAt: null, receiptNumber: 'HTC-2027-000001' });
  });
  it('maps every status and outcome to a state', () => {
    expect(stateOf('pending', null)).toBe('waiting');
    expect(stateOf('pending', 'mismatch')).toBe('checking');
    expect(stateOf('succeeded', 'applied')).toBe('confirmed');
    expect(stateOf('succeeded', 'applied_late')).toBe('confirmed');
    expect(stateOf('succeeded', 'wallet_late')).toBe('wallet');
    expect(stateOf('failed', null)).toBe('failed');
    expect(stateOf('expired', null)).toBe('expired');
    expect(stateOf('cancelled', null)).toBe('expired');
  });
});

describe('GET /orders/:id/confirmation (an order with nothing to pay)', () => {
  const conf = (userId: string | null, id: string) =>
    paymentStatusRoutes({ db })[1]!.handle({ session: userId ? { clubId: A, userId, roles: ['player'] } : null, input: { id } }, deps) as Promise<{ ok: boolean; status: number; body?: any }>;
  it('is waiting while its bookings are held, and confirmed with the court, time and receipt once they are', async () => {
    expect((await conf(P1, order)).body).toMatchObject({ state: 'waiting', paymentId: null, booking: { courtName: '2' } });
    await tdb.query(`update public.booking set status = 'confirmed', hold_expires_at = null, confirmed_at = app.now() where order_id = $1`, [order]);
    await tdb.query(`insert into public.receipt (club_id, order_id, kind, series, seq_no, number, vat_flag, customer_id, customer_name_snapshot, lines, total_satang) values ($1,$2,'sale','2027',1,'HTC-2027-000002',false,$3,'x','{}'::jsonb,0)`, [A, order, P1]);
    expect((await conf(P1, order)).body).toMatchObject({ state: 'confirmed', receiptNumber: 'HTC-2027-000002', qrImageBase64: null });
  });
  it("another player's order, an unknown one and a guest are refused", async () => {
    expect(await conf(P2, order)).toMatchObject({ ok: false, status: 404 });
    expect(await conf(P1, '99999999-9999-4999-8999-999999999999')).toMatchObject({ ok: false, status: 404 });
    expect(await conf(null, order)).toMatchObject({ ok: false, status: 401 });
  });
});
