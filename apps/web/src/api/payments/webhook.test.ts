import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { beamGateway } from '@booq/beam';
import { hashInviteToken } from '@booq/auth';
import { generateKeyPair, writeSecret } from '@booq/secrets';
import { FakeBeam, FakeClock, type DeliveryTarget } from '../../../../../tests/fakes';
import { fakeReceiptAndMessagePorts, fixtureSources, IDS, seedHunter } from '../../../../../packages/domain/src/checkout/test-fixture';
import { checkoutRoutes } from '../checkout/routes';
import { beamWebhookRoute } from './webhook';

// F05-T08a to T08c: POST /api/webhooks/beam/{token} against the fake Beam's signed deliveries (PAY-02-AC4 to AC15;
// D24, D32, D36, D71, D73). Skipped until the Architect's app.club_by_beam_webhook and app.record_payment_event land.
const { A, COURT, ME } = IDS;
const OWNER = '77777777-7777-4777-8777-777777777777';
const HOUR = '2026-12-02T18:00:00+07:00';
const API_KEY = 'sk_live_webhook_0001';
const HMAC_KEY = Buffer.from('club-a-live-webhook-key').toString('base64');
const TOKEN = 'live-token-for-club-a-0123456789';
const TEST_TOKEN = 'test-token-for-club-a-0123456789';
const keys = generateKeyPair();
const deps = { hasFeature: async () => true };
const me: { clubId: string; userId: string; roles: ['player'] } = { clubId: A, userId: ME, roles: ['player'] };

let tdb: TestDatabase;
let db: Db;
let worker: Db;
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
  await tdb.query(
    `insert into public.payment_connection (club_id, merchant_id_live, merchant_id_test, webhook_token_hash_live, webhook_token_hash_test) values ($1,'m-hunter','m-hunter-test',$2,$3)`,
    [A, hashInviteToken(TOKEN), hashInviteToken(TEST_TOKEN)],
  );
  await tdb.query(`insert into platform.config (key, value) values ('qr_expiry_margin_seconds', '30') on conflict (key) do update set value = excluded.value`);
  db = createDb({ connectionString: tdb.url, max: 3 });
  worker = createDb({ connectionString: tdb.url, max: 3, role: 'booq_worker' });
  const owner = { clubId: A, userId: OWNER, roles: ['owner', 'player'], source: 'admin' as const };
  await db.withClubTx(owner, (tx) => writeSecret(tx, keys.publicKey, A, 'beam_api_key_live', API_KEY));
  await db.withClubTx(owner, (tx) => writeSecret(tx, keys.publicKey, A, 'beam_hmac_key_live', HMAC_KEY));
  await db.withClubTx(owner, (tx) => writeSecret(tx, keys.publicKey, A, 'beam_hmac_key_test', HMAC_KEY));
  beam = new FakeBeam({ clock: new FakeClock('2026-12-02T10:00:00Z'), merchants: { 'm-hunter': { apiKey: API_KEY, webhookKeyBase64: HMAC_KEY } } });
  server = await beam.serve();
  beamUrl = server.url;
  alerts = [];
});
afterEach(async () => {
  beam.assertNoRefunds();
  await server.close();
  await db.end();
  await worker.end();
  await tdb.close();
});

const gateway = (cr: { set: 'test' | 'live'; merchantId: string; apiKey: string }) => beamGateway({ ...cr, baseUrl: beamUrl });
const hook = () => beamWebhookRoute({ db, worker, privateKey: () => keys.privateKey, gateway, alerts: { p1: (k) => void alerts.push(k) } });
const target = (token = TOKEN): DeliveryTarget => async (d) => {
  const r = await hook().handle({ session: null, input: { token }, rawBody: d.rawBody, headers: d.headers } as never, deps);
  return { status: r.ok ? 200 : r.status, body: JSON.stringify(r) };
};
const events = async () => (await tdb.query(`select event_type, outcome, signature_ok from public.payment_event order by received_at, id`)).rows;

async function paidOrder(): Promise<{ orderId: string; chargeId: string; paymentId: string }> {
  const routes = checkoutRoutes({ db, clubBySlug: async () => ({ clubId: A }), sources: fixtureSources(), payments: { privateKey: () => keys.privateKey, gateway, alerts: { p1: () => undefined }, now: () => new Date('2026-12-02T10:00:00Z') } });
  const call = (path: string, body: unknown) => routes.find((r) => r.def.path === path)!.handle({ session: me, input: { slug: 'club-a', ...(body as object) }, body }, deps);
  const choice = { courtId: COURT, hours: [HOUR] };
  const q = await call('/checkout/quote', choice);
  const r = await call('/checkout/pay', { ...choice, quoteHash: (q as { body: { quoteHash: string } }).body.quoteHash });
  const b = (r as { body: { orderId: string; payment: { id: string } } }).body;
  const chargeId = (await tdb.query(`select gateway_charge_id from public.payment where id = $1`, [b.payment.id])).rows[0].gateway_charge_id as string;
  return { orderId: b.orderId, chargeId, paymentId: b.payment.id };
}

describe.skip('POST /api/webhooks/beam/{token}', () => {
  it('a signed success while the hold runs confirms the booking and records the event (PAY-02-AC4)', async () => {
    const o = await paidOrder();
    const rec = await beam.pay(o.chargeId, target());
    expect(rec.response?.status).toBe(200);
    expect((await tdb.query(`select status from public.booking where order_id = $1`, [o.orderId])).rows).toEqual([{ status: 'confirmed' }]);
    expect(await events()).toEqual([{ event_type: 'charge.succeeded', outcome: 'applied', signature_ok: true }]);
  });

  it('a bad signature answers 401, changes nothing, writes no event and alerts (PAY-02-AC5, D24)', async () => {
    const o = await paidOrder();
    for (const signing of ['wrong-key', 'tampered-body', 'reformatted-body', 'missing', 'malformed'] as const) {
      const rec = await beam.pay(o.chargeId, target(), { signing });
      expect(rec.response?.status, signing).toBe(401);
    }
    expect((await tdb.query(`select status from public.booking where order_id = $1`, [o.orderId])).rows).toEqual([{ status: 'awaiting_payment' }]);
    expect(await events()).toEqual([]);
    expect(alerts.every((a) => a === 'beam_bad_signature')).toBe(true);
  });

  it('a replayed old callback does nothing more (PAY-02-AC10)', async () => {
    const o = await paidOrder();
    const first = await beam.pay(o.chargeId, target());
    const again = await target()(first.delivery);
    expect(again.status).toBe(200);
    expect(JSON.parse(again.body!).body).toEqual({ outcome: 'duplicate' });
    expect(await events()).toHaveLength(1);
  });

  it('parallel duplicates give one record and one confirmation', async () => {
    const o = await paidOrder();
    beam.getCharge(o.chargeId);
    const recs = await beam.deliverParallel('charge.succeeded', { ...beam.getCharge(o.chargeId), status: 'SUCCEEDED' } as never, target(), 4);
    expect(recs.every((r) => r.response?.status === 200)).toBe(true);
    expect(await events()).toHaveLength(1);
  });

  it('a callback on the key set that is not active for the club status is recorded ignored and answers 200 (design 5.3)', async () => {
    const o = await paidOrder();
    const rec = await beam.pay(o.chargeId, target(TEST_TOKEN));
    expect(rec.response?.status).toBe(200);
    expect(await events()).toEqual([{ event_type: 'charge.succeeded', outcome: 'ignored', signature_ok: true }]);
    expect((await tdb.query(`select status from public.booking where order_id = $1`, [o.orderId])).rows).toEqual([{ status: 'awaiting_payment' }]);
  });

  it('an unknown token is not found', async () => {
    const o = await paidOrder();
    expect((await beam.pay(o.chargeId, target('no-such-token'))).response?.status).toBe(404);
  });
});
