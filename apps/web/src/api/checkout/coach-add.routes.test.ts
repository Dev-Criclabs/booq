import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { beamGateway } from '@booq/beam';
import { generateKeyPair, writeSecret } from '@booq/secrets';
import { FakeBeam, FakeClock } from '../../../../../tests/fakes';
import { fakeReceiptAndMessagePorts, fixtureSources, IDS, seedHunter } from '../../../../../packages/domain/src/checkout/test-fixture';
import { checkoutRoutes } from './routes';

// F04-T15: add a coach to a paid court booking (R2-AC9, D111; migration 0418). Only the coaching portion is priced, as
// its own order with its own lines; the coach is claimed through F07's add_coach_to_booking. Hunter's prices and
// settings are test data here, never defaults in code.
const { A, COURT, COACH, ME } = IDS;
const OWNER = '77777777-7777-4777-8777-777777777777';
const OTHER = '55555555-5555-4555-8555-555555555555';
const COURT2 = 'c1c1c1c1-0000-4000-8000-000000000002';
const NOW = '2026-12-02T10:00:00Z';
const SLOT = '2026-12-02T11:00:00Z';   // 18:00 Bangkok
const KEY = 'sk_live_coach_add_0001';
const keys = generateKeyPair();
const deps = { hasFeature: async () => true };
type Session = { clubId: string; userId: string; roles: ['player'] };
const me: Session = { clubId: A, userId: ME, roles: ['player'] };

let tdb: TestDatabase;
let db: Db;
let beam: FakeBeam;
let server: { url: string; close: () => Promise<void> };
let alerts: string[];
let booking: string;
let firstOrder: string;

/** A paid court booking of `customer` with its confirmed occupancy row and its court line (as Pay and payment leave it). */
async function paidCourt(customer: string, court = COURT, start = SLOT): Promise<{ booking: string; order: string }> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    const o = (await c.query(`insert into public.orders (club_id, customer_id, source, status, price_group_snapshot, subtotal_satang, discount_satang, total_satang,
                              credit_value_satang, wallet_satang, money_satang, quote_hash, priced_at) values ($1,$2,'online','paid','{}',50000,0,50000,0,0,50000,repeat('a',64),now()) returning id`,
                              [A, customer])).rows[0].id as string;
    const b = (await c.query(`insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
                              values ($1,$2,'court',$3,$4::timestamptz,$4::timestamptz + interval '1 hour',$5,'confirmed','online',$5, now()) returning id`, [A, o, court, start, customer])).rows[0].id as string;
    await c.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, booking_id) values ($1,'court_booking',$2,$3::timestamptz,$3::timestamptz + interval '1 hour','confirmed',$4)`, [A, court, start, b]);
    await c.query(`insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, net_satang, money_satang)
                   values ($1,$2,1,'court_hour',$3,'P-0076','1','1',50000,50000,50000)`, [A, o, b]);
    await c.query('commit');
    return { booking: b, order: o };
  } finally {
    c.release();
  }
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow(NOW);
  await seedHunter(tdb);
  await fakeReceiptAndMessagePorts(tdb);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,'LO'), ($1,$3,'L5')`, [A, OWNER, OTHER]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'owner'), ($1,$2,'player'), ($1,$3,'player')`, [A, OWNER, OTHER]);
    await c.query('commit');
  } finally {
    c.release();
  }
  await tdb.seedCoach(A, COACH);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'2','tennis')`, [A, COURT2, IDS.LOC]);
  await tdb.query(`insert into public.payment_connection (club_id, merchant_id_live) values ($1,'m-hunter')`, [A]);
  await tdb.query(`insert into platform.config (key, value) values ('qr_expiry_margin_seconds', '30') on conflict (key) do update set value = excluded.value`);
  db = createDb({ connectionString: tdb.url, max: 3 });
  await db.withClubTx({ clubId: A, userId: OWNER, roles: ['owner', 'player'] as never, source: 'admin' }, (tx) => writeSecret(tx, keys.publicKey, A, 'beam_api_key_live', KEY));
  beam = new FakeBeam({ clock: new FakeClock(NOW), merchants: { 'm-hunter': { apiKey: KEY, webhookKeyBase64: Buffer.from('k').toString('base64') } } });
  server = await beam.serve();
  alerts = [];
  ({ booking, order: firstOrder } = await paidCourt(ME));
});
afterEach(async () => {
  beam.assertNoRefunds();
  await server.close();
  await db.end();
  await tdb.close();
});

let beamUrl = '';
const routes = () =>
  checkoutRoutes({
    db,
    clubBySlug: async () => ({ clubId: A }),
    sources: fixtureSources(),
    payments: { privateKey: () => keys.privateKey, gateway: (cr) => beamGateway({ ...cr, baseUrl: beamUrl || server.url }), alerts: { p1: (k) => void alerts.push(k) }, now: () => new Date(NOW) },
  });
const call = (path: string, body: unknown, session: Session = me) =>
  routes().find((r) => r.def.path === path)!.handle({ session, input: { slug: 'club-a', ...(body as object) }, body }, deps);
const pay = async (body: Record<string, unknown>, session: Session = me) => {
  const q = await call('/checkout/coach-add/quote', body, session);
  if (!q.ok) return q;
  return call('/checkout/coach-add/pay', { ...body, quoteHash: (q.body as { quoteHash: string }).quoteHash }, session);
};
const add = (body: Record<string, unknown> = {}) => ({ bookingId: booking, coachId: COACH, ...body });

describe('adding a coach to a booking (F04-T15)', () => {
  it('only the coaching portion is priced (R2-AC9)', async () => {
    const q = await call('/checkout/coach-add/quote', add());
    expect(q).toMatchObject({ ok: true, body: { subtotalSatang: 80000, totalSatang: 80000, moneySatang: 80000, lines: [{ kind: 'coach', unitPriceSatang: 80000 }] } });
    expect((q as { body: { lines: unknown[] } }).body.lines).toHaveLength(1);
  });

  it('Pay: a second order with its own coach line on the booking, the coach claimed, the court line untouched; a QR inside the add hold (D111)', async () => {
    const r = await pay(add());
    expect(r).toMatchObject({ ok: true, body: { confirmed: false, payment: { amountSatang: 80000 } } });
    const id = (r as { body: { orderId: string; holdExpiresAt: string } }).body.orderId;
    expect(id).not.toBe(firstOrder);
    expect((await tdb.query(`select kind, booking_id, description_key from public.order_line where order_id = $1`, [id])).rows).toEqual([{ kind: 'coach', booking_id: booking, description_key: 'P-0143' }]);
    expect((await tdb.query(`select kind, unit_price_satang from public.order_line where order_id = $1`, [firstOrder])).rows).toEqual([{ kind: 'court_hour', unit_price_satang: 50000 }]);
    expect((await tdb.query(`select type, coach_id from public.booking where id = $1`, [booking])).rows[0]).toEqual({ type: 'solo_class', coach_id: COACH });
    const hold = (await tdb.query(`select status, hold_expires_at from public.booking_coach_add where order_id = $1`, [id])).rows[0];
    expect(hold.status).toBe('pending');
    expect((r as { body: { holdExpiresAt: string } }).body.holdExpiresAt).toBe(new Date(hold.hold_expires_at).toISOString());
    const sent = beam.createRequests[0] as { paymentMethod: { qrPromptPay: { expiryTime: string } } };
    expect(new Date(sent.paymentMethod.qrPromptPay.expiryTime).getTime()).toBeLessThan(new Date(hold.hold_expires_at).getTime());
  });

  it('a second tap returns the same add order and QR (D47)', async () => {
    const a = await pay(add());
    const b = await call('/checkout/coach-add/pay', { ...add(), quoteHash: 'f'.repeat(64) });
    expect(b).toEqual(a);
    expect(beam.createRequests).toHaveLength(1);
  });

  it('a coach already busy refuses and nothing is created', async () => {
    const other = await paidCourt(OTHER, COURT2);
    // The coach teaches someone else at that hour: the other booking becomes a solo class first.
    await pay({ bookingId: other.booking, coachId: COACH }, { clubId: A, userId: OTHER, roles: ['player'] });
    const orders = Number((await tdb.query(`select count(*) from public.orders where customer_id = $1`, [ME])).rows[0].count);
    const r = await pay(add());
    expect(r).toMatchObject({ ok: false, status: 409, code: 'coach_unavailable' });
    expect(Number((await tdb.query(`select count(*) from public.orders where customer_id = $1`, [ME])).rows[0].count)).toBe(orders);
    expect((await tdb.query(`select type, coach_id from public.booking where id = $1`, [booking])).rows[0]).toEqual({ type: 'court', coach_id: null });
  });

  it('another player’s booking is not found; a started one, or one with a coach already, cannot take one', async () => {
    expect(await call('/checkout/coach-add/quote', add(), { clubId: A, userId: OTHER, roles: ['player'] })).toEqual({ ok: false, status: 404, code: 'booking_not_found' });
    await pay(add());
    expect(await call('/checkout/coach-add/quote', add())).toEqual({ ok: false, status: 409, code: 'coach_add_not_possible' });
  });

  it('nothing left to pay: confirmed at once with its receipt, no charge (PAY-07)', async () => {
    await tdb.query(`insert into public.promo_code (club_id, code_upper, kind, value, applies_to) values ($1,'FREE','percent',10000,array['coach'])`, [A]);
    const r = await pay(add({ code: 'FREE' }));
    expect(r).toMatchObject({ ok: true, body: { confirmed: true, payment: null } });
    const id = (r as { body: { orderId: string } }).body.orderId;
    expect((await tdb.query(`select status from public.orders where id = $1`, [id])).rows[0].status).toBe('paid');
    expect((await tdb.query(`select status from public.booking_coach_add where order_id = $1`, [id])).rows[0].status).toBe('confirmed');
    expect(beam.createRequests).toHaveLength(0);
  });

  it('Beam unreachable: 503 payment_unavailable, the add released and the coach freed', async () => {
    beamUrl = 'http://127.0.0.1:1';
    try {
      expect(await pay(add())).toEqual({ ok: false, status: 503, code: 'payment_unavailable' });
    } finally {
      beamUrl = '';
    }
    expect((await tdb.query(`select type, coach_id from public.booking where id = $1`, [booking])).rows[0]).toEqual({ type: 'court', coach_id: null });
    expect((await tdb.query(`select status from public.booking_coach_add`)).rows[0].status).toBe('released');
    expect(alerts).toEqual(['beam_unreachable']);
  });
});
