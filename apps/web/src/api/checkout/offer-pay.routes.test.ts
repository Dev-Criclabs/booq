import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { beamGateway } from '@booq/beam';
import { generateKeyPair, writeSecret } from '@booq/secrets';
import { FakeBeam, FakeClock } from '../../../../../tests/fakes';
import { fakeReceiptAndMessagePorts, fixtureSources, IDS, seedHunter } from '../../../../../packages/domain/src/checkout/test-fixture';
import { checkoutRoutes } from './routes';

// F04-T22c: Pay for a court-slot waitlist offer (CLASS-02-AC3, AC6, WAIT-01-AC2; migration 0417). The claim names the
// offer's held booking and its unpriced order; Pay prices that shell and pays the held booking, reserving nothing again.
// Hunter's prices and settings are test data here, never defaults in code.
const { A, COURT, ME } = IDS;
const OWNER = '77777777-7777-4777-8777-777777777777';
const OTHER = '55555555-5555-4555-8555-555555555555';
const SLOT = '2026-12-02T18:00:00+07:00';
const NOW = '2026-12-02T10:00:00Z';
const KEY = 'sk_live_offer_test_0001';
const keys = generateKeyPair();
const deps = { hasFeature: async () => true };
type Session = { clubId: string; userId: string; roles: ['player'] };
const me: Session = { clubId: A, userId: ME, roles: ['player'] };

let tdb: TestDatabase;
let db: Db;
let beam: FakeBeam;
let server: { url: string; close: () => Promise<void> };
let alerts: string[];
let offer: { orderId: string; bookingId: string; entryId: string };

async function asOwnerRole<T>(sql: string, args: unknown[]): Promise<T> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.club_id', $1, true)`, [A]);
    await c.query('set local role booq_owner');
    const r = (await c.query(sql, args)).rows[0] as T;
    await c.query('commit');
    return r;
  } finally {
    c.release();
  }
}

/** A waiting court-slot entry for `customer`, offered through app.offer_hold (0908): the held booking and its shell. */
async function makeOffer(customer: string) {
  const entry = (await tdb.query(
    `insert into public.waitlist_entry (club_id, customer_id, subject_kind, resource_id, slot_start_at, seq) values ($1,$2,'court_slot',$3,$4, 1) returning id`,
    [A, customer, COURT, SLOT],
  )).rows[0].id as string;
  const { b } = await asOwnerRole<{ b: string }>('select app.offer_hold($1) as b', [entry]);
  const orderId = (await tdb.query(`select order_id from public.booking where id = $1`, [b])).rows[0].order_id as string;
  return { orderId, bookingId: b, entryId: entry };
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
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'waitlist_claim_minutes','30') on conflict (club_id, key) do update set value = excluded.value`, [A]);
  await tdb.query(`insert into public.payment_connection (club_id, merchant_id_live) values ($1,'m-hunter')`, [A]);
  await tdb.query(`insert into platform.config (key, value) values ('qr_expiry_margin_seconds', '30') on conflict (key) do update set value = excluded.value`);
  db = createDb({ connectionString: tdb.url, max: 3 });
  await db.withClubTx({ clubId: A, userId: OWNER, roles: ['owner', 'player'], source: 'admin' }, (tx) => writeSecret(tx, keys.publicKey, A, 'beam_api_key_live', KEY));
  beam = new FakeBeam({ clock: new FakeClock(NOW), merchants: { 'm-hunter': { apiKey: KEY, webhookKeyBase64: Buffer.from('k').toString('base64') } } });
  server = await beam.serve();
  alerts = [];
  offer = await makeOffer(ME);
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
    payments: { privateKey: () => keys.privateKey, gateway: (cr) => beamGateway({ ...cr, baseUrl: server.url }), alerts: { p1: (k) => void alerts.push(k) }, now: () => new Date(NOW) },
  });
const call = (path: string, body: unknown, session: Session = me) =>
  routes().find((r) => r.def.path === path)!.handle({ session, input: { slug: 'club-a', ...(body as object) }, body }, deps);
const ref = () => ({ orderId: offer.orderId, bookingId: offer.bookingId });
const quoteHash = async (body: Record<string, unknown> = {}) => {
  const q = await call('/checkout/quote', { ...ref(), ...body });
  if (!q.ok) throw new Error(q.code);
  return (q.body as { quoteHash: string }).quoteHash;
};
const pay = async (body: Record<string, unknown> = {}) => call('/checkout/pay', { ...ref(), ...body, quoteHash: await quoteHash(body) });
const count = async (sql: string, args: unknown[] = []) => Number((await tdb.query(sql, args)).rows[0].n);

describe('paying a court-slot waitlist offer (F04-T22c)', () => {
  it('the quote prices the held booking’s court and hour; a court or hour in the body is ignored', async () => {
    const q = await call('/checkout/quote', { ...ref(), courtId: '00000000-0000-4000-8000-00000000dead', hours: ['2026-12-03T09:00:00+07:00'] });
    expect(q).toMatchObject({ ok: true, body: { totalSatang: 50000, lines: [{ kind: 'court_hour', startsAt: new Date(SLOT).toISOString() }] } });
  });

  it('Pay prices the shell and pays the held booking: nothing reserved twice, the QR inside the offer hold (CLASS-02-AC3, WAIT-01-AC2)', async () => {
    const bookings = await count(`select count(*)::int as n from public.booking`);
    const r = await pay();
    expect(r).toMatchObject({ ok: true, body: { orderId: offer.orderId, confirmed: false, payment: { amountSatang: 50000 } } });
    expect(await count(`select count(*)::int as n from public.booking`)).toBe(bookings);
    expect(await count(`select count(*)::int as n from public.orders`)).toBe(1);
    const o = (await tdb.query(`select status, money_satang, priced_at is not null as priced from public.orders where id = $1`, [offer.orderId])).rows[0];
    expect(o).toEqual({ status: 'open', money_satang: 50000, priced: true });
    expect((await tdb.query(`select booking_id, kind from public.order_line where order_id = $1`, [offer.orderId])).rows).toEqual([{ booking_id: offer.bookingId, kind: 'court_hour' }]);
    const hold = new Date((await tdb.query(`select hold_expires_at from public.booking where id = $1`, [offer.bookingId])).rows[0].hold_expires_at);
    expect(hold.toISOString()).toBe('2026-12-02T10:30:00.000Z');
    expect((r as { body: { holdExpiresAt: string } }).body.holdExpiresAt).toBe(hold.toISOString());
    expect(beam.createRequests).toHaveLength(1);
  });

  it('a second tap, and two Pays for one offer, give one priced order and one charge (D47)', async () => {
    const hash = await quoteHash();
    const [a, b] = await Promise.all([
      call('/checkout/pay', { ...ref(), quoteHash: hash }),
      call('/checkout/pay', { ...ref(), quoteHash: hash }),
    ]);
    expect(a).toMatchObject({ ok: true, body: { orderId: offer.orderId } });
    expect(b).toEqual(a);
    expect(await count(`select count(*)::int as n from public.order_line where order_id = $1`, [offer.orderId])).toBe(1);
    // Parallel taps may both reach Beam with the payment's idempotency key; there is one payment and one charge (G8).
    expect(await count(`select count(*)::int as n from public.payment where order_id = $1`, [offer.orderId])).toBe(1);
    const sent = beam.createRequests.length;
    expect(await call('/checkout/pay', { ...ref(), quoteHash: 'f'.repeat(64) })).toEqual(a);
    expect(beam.createRequests).toHaveLength(sent);   // a later tap returns the stored QR, no new charge request
  });

  it('nothing left to pay confirms the held booking at once and the entry is claimed (PAY-07)', async () => {
    await tdb.query(`insert into public.promo_code (club_id, code_upper, kind, value, applies_to) values ($1,'FREE','percent',10000,array['court_hour'])`, [A]);
    const r = await pay({ code: 'FREE' });
    expect(r).toMatchObject({ ok: true, body: { confirmed: true, payment: null } });
    expect((await tdb.query(`select status, hold_expires_at from public.booking where id = $1`, [offer.bookingId])).rows[0]).toEqual({ status: 'confirmed', hold_expires_at: null });
    expect((await tdb.query(`select state from public.occupancy where booking_id = $1`, [offer.bookingId])).rows[0].state).toBe('confirmed');
    expect((await tdb.query(`select status from public.waitlist_entry where id = $1`, [offer.entryId])).rows[0].status).toBe('claimed');
    expect((await tdb.query(`select status from public.orders where id = $1`, [offer.orderId])).rows[0].status).toBe('paid');
    expect(beam.createRequests).toHaveLength(0);
  });

  it('an offer that has ended answers spot_gone, and its hold is already released (CLASS-02-AC6)', async () => {
    await db.withClubTx({ clubId: A, userId: ME, roles: ['player'], source: 'player_app' }, (tx) => tx.query('select app.decline_offer($1)', [offer.entryId]));
    expect((await tdb.query(`select status from public.booking where id = $1`, [offer.bookingId])).rows[0].status).toBe('released');
    expect(await call('/checkout/quote', ref())).toEqual({ ok: false, status: 409, code: 'spot_gone' });
    expect(await call('/checkout/pay', { ...ref(), quoteHash: 'a'.repeat(64) })).toEqual({ ok: false, status: 409, code: 'spot_gone' });
    expect(await count(`select count(*)::int as n from public.order_line`)).toBe(0);
  });

  it('a hold past its time is spot_gone too', async () => {
    await tdb.setNow('2026-12-02T10:31:00Z');
    expect(await call('/checkout/pay', { ...ref(), quoteHash: 'a'.repeat(64) })).toEqual({ ok: false, status: 409, code: 'spot_gone' });
  });

  it('another player’s offer is spot_gone; a malformed reference is bad input', async () => {
    expect(await call('/checkout/quote', ref(), { clubId: A, userId: OTHER, roles: ['player'] })).toEqual({ ok: false, status: 409, code: 'spot_gone' });
    expect(await call('/checkout/quote', { orderId: offer.orderId })).toEqual({ ok: false, status: 400, code: 'bad_input' });
  });

  it('a price changed since the quote prices nothing and returns the new quote (R4-AC9)', async () => {
    const hash = await quoteHash();
    await tdb.query(`update public.court_price_rule set price_satang = 55000 where club_id = $1`, [A]);
    expect(await call('/checkout/pay', { ...ref(), quoteHash: hash })).toMatchObject({ ok: true, body: { priceChanged: true, quote: { totalSatang: 55000 } } });
    expect((await tdb.query(`select priced_at from public.orders where id = $1`, [offer.orderId])).rows[0].priced_at).toBeNull();
  });
});
