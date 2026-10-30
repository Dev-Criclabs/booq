import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { beamGateway } from '@booq/beam';
import { generateKeyPair, writeSecret } from '@booq/secrets';
import { FakeBeam, FakeClock } from '../../../../../tests/fakes';
import { fakeReceiptAndMessagePorts, fixtureSources, IDS, seedHunter } from '../../../../../packages/domain/src/checkout/test-fixture';
import { checkoutRoutes } from './routes';

// POST /checkout/pay (F04-T12a to T12d with F05-T04b; design 4.5; R4-AC9, R8-AC1, PAY-07, PAY-02-AC1 to AC3,
// D47, D61, D63). The quote, the order, the claim and the charge against the test database and the fake Beam.
const { A, COURT, ME } = IDS;
const OWNER = '77777777-7777-4777-8777-777777777777';
const HOUR = '2026-12-02T18:00:00+07:00';
const KEY = 'sk_live_route_test_0001';
const keys = generateKeyPair();
const deps = { hasFeature: async () => true };
const me: { clubId: string; userId: string; roles: ['player'] } = { clubId: A, userId: ME, roles: ['player'] };

let tdb: TestDatabase;
let db: Db;
let beam: FakeBeam;
let server: { url: string; close: () => Promise<void> };
let beamUrl: string;
let alerts: string[];

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-02T10:00:00Z');
  await seedHunter(tdb);
  await fakeReceiptAndMessagePorts(tdb);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,'LO')`, [A, OWNER]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'owner'), ($1,$2,'player')`, [A, OWNER]);
    await c.query('commit');
  } finally {
    c.release();
  }
  await tdb.query(`insert into public.payment_connection (club_id, merchant_id_live) values ($1,'m-hunter')`, [A]);
  await tdb.query(`insert into platform.config (key, value) values ('qr_expiry_margin_seconds', '30') on conflict (key) do update set value = excluded.value`);
  db = createDb({ connectionString: tdb.url, max: 3 });
  await db.withClubTx({ clubId: A, userId: OWNER, roles: ['owner', 'player'], source: 'admin' }, (tx) => writeSecret(tx, keys.publicKey, A, 'beam_api_key_live', KEY));
  beam = new FakeBeam({ clock: new FakeClock('2026-12-02T10:00:00Z'), merchants: { 'm-hunter': { apiKey: KEY, webhookKeyBase64: Buffer.from('k').toString('base64') } } });
  server = await beam.serve();
  beamUrl = server.url;
  alerts = [];
});
afterEach(async () => {
  beam.assertNoRefunds();
  await server.close();
  await db.end();
  await tdb.close();
});

const routes = () =>
  checkoutRoutes({
    db,
    clubBySlug: async (s) => (s === 'club-a' ? { clubId: A } : null),
    sources: fixtureSources(),
    payments: { privateKey: () => keys.privateKey, gateway: (cr) => beamGateway({ ...cr, baseUrl: beamUrl }), alerts: { p1: (k) => void alerts.push(k) }, now: () => new Date('2026-12-02T10:00:00Z') },
  });
const call = (path: string, body: unknown, session: typeof me | null = me, input: Record<string, unknown> = {}) =>
  routes().find((r) => r.def.path === path)!.handle({ session, input: { slug: 'club-a', ...input, ...(body as object) }, body }, deps);
const quoteHash = async (body: Record<string, unknown>) => {
  const r = await call('/checkout/quote', body);
  if (!r.ok) throw new Error(r.code);
  return (r.body as { quoteHash: string }).quoteHash;
};
const pay = async (body: Record<string, unknown>, extra: Record<string, unknown> = {}) => call('/checkout/pay', { ...body, quoteHash: await quoteHash(body), ...extra });

describe('POST /checkout/pay', () => {
  it('is a person route with no-store; a guest signs in first (R8-AC4)', async () => {
    const r = routes().find((x) => x.def.path === '/checkout/pay')!;
    expect(r.def).toMatchObject({ method: 'POST', needsPerson: true });
    expect(r.headers).toEqual({ 'Cache-Control': 'no-store' });
    expect(await call('/checkout/pay', { courtId: COURT, hours: [HOUR], quoteHash: 'a'.repeat(64) }, null)).toEqual({ ok: false, status: 401, code: 'sign_in_required' });
  });

  it('money due: the order, its hold and the QR for the exact amount (PAY-02-AC1, AC2)', async () => {
    const r = await pay({ courtId: COURT, hours: [HOUR] });
    expect(r).toMatchObject({ ok: true, body: { confirmed: false, payment: { amountSatang: 50000, qrImageBase64: 'RkFLRQ==' } } });
    const b = (r as { body: { orderId: string; holdExpiresAt: string } }).body;
    expect(b.holdExpiresAt).toBeTruthy();
    expect(beam.createRequests).toHaveLength(1);
  });

  it('a second tap returns the same order, hold and QR; no second charge (D47, PAY-02-AC3)', async () => {
    const a = await pay({ courtId: COURT, hours: [HOUR] });
    const b = await call('/checkout/pay', { courtId: COURT, hours: [HOUR], quoteHash: 'f'.repeat(64) });
    expect(b).toEqual(a);
    expect(beam.createRequests).toHaveLength(1);
  });

  it('a price changed since the quote creates nothing and returns the new quote (R4-AC9, D63)', async () => {
    const hash = await quoteHash({ courtId: COURT, hours: [HOUR] });
    await tdb.query(`update public.court_price_rule set price_satang = 55000 where club_id = $1`, [A]);
    const r = await call('/checkout/pay', { courtId: COURT, hours: [HOUR], quoteHash: hash });
    expect(r).toMatchObject({ ok: true, body: { priceChanged: true, quote: { totalSatang: 55000 } } });
    expect(Number((await tdb.query(`select count(*) from public.orders`)).rows[0].count)).toBe(0);
  });

  it('nothing left to pay confirms at once: no hold, no payment, no QR (PAY-07-AC1, AC3)', async () => {
    await tdb.query(`insert into public.promo_code (club_id, code_upper, kind, value, applies_to) values ($1,'FREE','percent',10000,array['court_hour'])`, [A]);
    const r = await pay({ courtId: COURT, hours: [HOUR], code: 'FREE' });
    expect(r).toMatchObject({ ok: true, body: { confirmed: true, holdExpiresAt: null, payment: null } });
    expect(beam.createRequests).toHaveLength(0);
  });

  it('a taken slot answers slot_unavailable with by, and nothing is charged (R8-AC1)', async () => {
    const other = '55555555-5555-4555-8555-555555555555';
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,'L5')`, [A, other]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, other]);
      await c.query('commit');
    } finally {
      c.release();
    }
    const hash = await quoteHash({ courtId: COURT, hours: [HOUR] });
    await call('/checkout/pay', { courtId: COURT, hours: [HOUR], quoteHash: hash }, { ...me, userId: other });
    const r = await call('/checkout/pay', { courtId: COURT, hours: [HOUR], quoteHash: hash });
    expect(r).toEqual({ ok: false, status: 409, code: 'slot_unavailable', params: { by: 'resource' } });
    expect(beam.createRequests).toHaveLength(1);
  });

  it('past the Pay tap limit: 429 too_many_attempts with the seconds to wait (D61)', async () => {
    await tdb.query(`insert into platform.config (key, value) values ('pay_tap_limit_count', '1'), ('pay_tap_limit_window_seconds', '600') on conflict (key) do update set value = excluded.value`);
    await pay({ courtId: COURT, hours: ['2026-12-02T20:00:00+07:00'] });
    const r = await pay({ courtId: COURT, hours: ['2026-12-02T21:00:00+07:00'] });
    expect(r).toMatchObject({ ok: false, status: 429, code: 'too_many_attempts' });
    expect((r as unknown as { params: { seconds: number } }).params.seconds).toBeGreaterThan(0);
  });

  it('Beam unreachable: 503 payment_unavailable, the hold released, a P1 alert (design 5.1 step 4)', async () => {
    beamUrl = 'http://127.0.0.1:1';
    const r = await pay({ courtId: COURT, hours: [HOUR] });
    expect(r).toEqual({ ok: false, status: 503, code: 'payment_unavailable' });
    expect(alerts).toEqual(['beam_unreachable']);
    expect((await tdb.query(`select status from public.booking`)).rows).toEqual([{ status: 'released' }]);
  });

  it('a malformed Idempotency-Key or quote hash is bad input', async () => {
    expect(await call('/checkout/pay', { courtId: COURT, hours: [HOUR], quoteHash: 'x' })).toMatchObject({ status: 400, code: 'bad_input' });
    expect(await call('/checkout/pay', { courtId: COURT, hours: [HOUR], quoteHash: 'a'.repeat(64) }, me, { idempotencyKey: 'bad key' })).toMatchObject({ status: 400, code: 'bad_input' });
  });
});

// F04-T13: GET /orders/:id (R7-AC2, ROLE-01-AC4, CC-2).
describe('GET /orders/:id', () => {
  const read = (id: string, session: { clubId: string; userId: string; roles: string[] } | null = me) =>
    routes().find((r) => r.def.path === '/orders/:id')!.handle({ session: session as never, input: { slug: 'club-a', id } }, deps);
  const DESK = '88888888-8888-4888-8888-888888888888';
  const ACC = '99999999-9999-4999-8999-999999999999';
  const OTHER = '55555555-5555-4555-8555-555555555555';
  beforeEach(async () => {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      for (const [u, role] of [[DESK, 'front_desk'], [ACC, 'accountant'], [OTHER, 'player']] as const) {
        await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)`, [A, u, `L-${u.slice(0, 4)}`]);
        await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3), ($1,$2,'player') on conflict do nothing`, [A, u, role]);
      }
      await c.query('commit');
    } finally {
      c.release();
    }
  });

  it('is permission orders.read.own, held by every club person, answered with no-store', () => {
    const r = routes().find((x) => x.def.path === '/orders/:id')!;
    expect(r.def).toMatchObject({ method: 'GET', permission: 'orders.read.own' });
    expect(r.headers).toEqual({ 'Cache-Control': 'no-store' });
  });

  it('returns the stored snapshot, unchanged after the club changes prices and names (R7-AC2)', async () => {
    const paid = await pay({ courtId: COURT, hours: [HOUR], addOnIds: [IDS.WATER] });
    const id = (paid as { body: { orderId: string } }).body.orderId;
    await tdb.query(`update public.add_on set price_satang = 1, name_en = 'Renamed' where club_id = $1`, [A]);
    await tdb.query(`update public.court_price_rule set price_satang = 1 where club_id = $1`, [A]);
    const r = await read(id);
    expect(r).toMatchObject({
      ok: true,
      body: {
        id, status: 'open', subtotalSatang: 52000, totalSatang: 52000, moneySatang: 52000,
        lines: [
          { position: 1, kind: 'court_hour', descriptionKey: 'P-0076', nameEn: '1', unitPriceSatang: 50000 },
          { position: 2, kind: 'add_on', descriptionKey: 'P-0071', nameEn: 'Water', unitPriceSatang: 2000 },
        ],
      },
    });
  });

  it('front desk and the accountant read the club order; another player gets not found (ROLE-01-AC4)', async () => {
    const paid = await pay({ courtId: COURT, hours: [HOUR] });
    const id = (paid as { body: { orderId: string } }).body.orderId;
    expect(await read(id, { clubId: A, userId: DESK, roles: ['front_desk', 'player'] })).toMatchObject({ ok: true });
    expect(await read(id, { clubId: A, userId: ACC, roles: ['accountant', 'player'] })).toMatchObject({ ok: true });
    expect(await read(id, { clubId: A, userId: OTHER, roles: ['player'] })).toEqual({ ok: false, status: 404, code: 'order_not_found' });
  });

  it('an unknown or malformed id, and a slug of another club, are not found', async () => {
    expect(await read('00000000-0000-4000-8000-00000000dead')).toEqual({ ok: false, status: 404, code: 'order_not_found' });
    expect(await read('nope')).toEqual({ ok: false, status: 404, code: 'order_not_found' });
    const r = await routes().find((x) => x.def.path === '/orders/:id')!.handle({ session: me, input: { slug: 'club-b', id: 'x' } }, deps);
    expect(r).toEqual({ ok: false, status: 404, code: 'not_found' });
  });
});

// F04-T13: the staff routes (ROLE-01-AC4, BOOK-04-AC7, D43). Skipped until the Architect's
// app.customer_dob_for_pricing reaches main (requested 30 Oct).
describe.skip('POST /staff/orders/quote and /pay', () => {
  const DESK = '88888888-8888-4888-8888-888888888888';
  const KID = '44444444-4444-4444-8444-444444444444';
  const desk = { clubId: A, userId: DESK, roles: ['front_desk', 'player'] };
  beforeEach(async () => {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,'LD')`, [A, DESK]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'front_desk'), ($1,$2,'player')`, [A, DESK]);
      await c.query(`insert into public.app_user (club_id, id, line_user_id, date_of_birth) values ($1,$2,'LK','2012-01-01')`, [A, KID]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, KID]);
      await c.query('commit');
    } finally {
      c.release();
    }
    await tdb.query(`update public.court_price_rule set price_satang = 40000 where club_id = $1 and price_group_id = $2`, [A, IDS.STUDENT]);
  });
  const staff = (path: string, body: unknown, session: unknown = desk) =>
    routes().find((r) => r.def.path === path)!.handle({ session: session as never, input: { slug: 'club-a', ...(body as object) }, body }, deps);

  it('both need booking.create.staff: a player is refused', async () => {
    for (const p of ['/staff/orders/quote', '/staff/orders/pay']) {
      expect(routes().find((r) => r.def.path === p)!.def.permission).toBe('booking.create.staff');
      expect(await staff(p, { customerId: KID, courtId: COURT, hours: [HOUR] }, me)).toMatchObject({ ok: false, status: 403 });
    }
  });

  it('staff booking for a Student pays as that player: the Student price (ROLE-01-AC4)', async () => {
    const q = await staff('/staff/orders/quote', { customerId: KID, courtId: COURT, hours: [HOUR] });
    expect(q).toMatchObject({ ok: true, body: { totalSatang: 40000, priceGroupId: IDS.STUDENT } });
    const hash = (q as { body: { quoteHash: string } }).body.quoteHash;
    const r = await staff('/staff/orders/pay', { customerId: KID, courtId: COURT, hours: [HOUR], quoteHash: hash });
    expect(r).toMatchObject({ ok: true, body: { confirmed: false, payment: { amountSatang: 40000 } } });
    const id = (r as { body: { orderId: string } }).body.orderId;
    expect((await tdb.query(`select customer_id, source from public.orders where id = $1`, [id])).rows[0]).toEqual({ customer_id: KID, source: 'staff' });
    // A staff booking awaiting payment holds for the hold time like a player's (D43; moved from F03's POST /staff/bookings).
    const b = (await tdb.query(`select status, hold_expires_at from public.booking where order_id = $1`, [id])).rows[0];
    expect(b.status).toBe('awaiting_payment');
    expect(new Date(b.hold_expires_at).toISOString()).toBe('2026-12-02T10:15:00.000Z');
  });

  it('a customerId that is not a customer of the club is customer_not_found; none at all is bad input', async () => {
    expect(await staff('/staff/orders/quote', { customerId: '00000000-0000-4000-8000-00000000beef', courtId: COURT, hours: [HOUR] })).toEqual({ ok: false, status: 404, code: 'customer_not_found' });
    expect(await staff('/staff/orders/quote', { courtId: COURT, hours: [HOUR] })).toEqual({ ok: false, status: 400, code: 'bad_input' });
  });
});
