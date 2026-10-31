import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db, type Tx } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { generateKeyPair, writeSecret } from '../../../secrets/src/index';
import { beamGateway } from '../../../beam/src/adapter';
import { FakeBeam, FakeClock } from '../../../../tests/fakes';
import { parsePayRequest, placeOrder, preparePay } from '../checkout/pay';
import { quoteFor } from '../checkout/quote';
import { fakeReceiptAndMessagePorts, fixtureSources, IDS, seedHunter } from '../checkout/test-fixture';
import { reconcileClub } from './jobs';
import { startPayment } from './start';

// F05-T09: beam_reconcile when a callback never arrives (PAY-02-AC15, D73), against the fake Beam.
const { A, COURT, ME } = IDS;
const OWNER = '77777777-7777-4777-8777-777777777777';
const API_KEY = 'sk_live_reconcile_0001';
const keys = generateKeyPair();
const me = { clubId: A, userId: ME, roles: ['player'], requestId: 'r', source: 'player_app' as const };
const job = { clubId: A, userId: null, roles: [], source: 'job' as const, actorLabel: 'beam_reconcile' };

let tdb: TestDatabase;
let db: Db;
let worker: Db;
let beam: FakeBeam;
let server: { url: string; close: () => Promise<void> };
let alerts: string[];
const gateway = (c: { set: 'test' | 'live'; merchantId: string; apiKey: string }) => beamGateway({ ...c, baseUrl: server.url });

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
  await tdb.query(`insert into platform.config (key, value) values ('qr_expiry_margin_seconds', '30'), ('beam_reconcile_age_seconds', '120')
                   on conflict (key) do update set value = excluded.value`);
  db = createDb({ connectionString: tdb.url, max: 3 });
  worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
  await db.withClubTx({ clubId: A, userId: OWNER, roles: ['owner', 'player'], source: 'admin' }, (tx) => writeSecret(tx, keys.publicKey, A, 'beam_api_key_live', API_KEY));
  beam = new FakeBeam({ clock: new FakeClock('2026-12-02T10:00:00Z'), merchants: { 'm-hunter': { apiKey: API_KEY, webhookKeyBase64: Buffer.from('k').toString('base64') } } });
  server = await beam.serve();
  alerts = [];
});
afterEach(async () => {
  beam.assertNoRefunds();
  await server.close();
  await db.end();
  await worker.end();
  await tdb.close();
});

async function pendingPayment(): Promise<{ orderId: string; paymentId: string; chargeId: string }> {
  const src = fixtureSources();
  const body = { courtId: COURT, hours: ['2026-12-02T18:00:00+07:00'] };
  const hash = (await db.withClubTx(me, (tx: Tx) => quoteFor(tx, ME, parsePayRequest({ ...body, quoteHash: '0'.repeat(64) }).choice, src))).quoteHash;
  const req = parsePayRequest({ ...body, quoteHash: hash });
  const orderId = await db.withClubTx(me, async (tx: Tx) => {
    const r = await preparePay(tx, ME, req, src);
    if (r.kind !== 'ready') throw new Error('expected ready');
    return (await placeOrder(tx, ME, req.choice, r.quote, src)).orderId;
  });
  const started = await startPayment({ db, privateKey: keys.privateKey, gateway, alerts: { p1: () => undefined }, now: () => new Date('2026-12-02T10:00:00Z') }, me, orderId);
  if (!started.ok) throw new Error('no payment');
  const chargeId = (await tdb.query(`select gateway_charge_id from public.payment where id = $1`, [started.paymentId])).rows[0].gateway_charge_id as string;
  return { orderId, paymentId: started.paymentId, chargeId };
}
const run = () => worker.withClubTx(job, (tx: Tx) => reconcileClub(tx, A, { privateKey: keys.privateKey, gateway, alerts: { p1: (k) => void alerts.push(k) } }));
const events = async () => (await tdb.query(`select event_type, outcome from public.payment_event`)).rows;
const status = async (o: string) => (await tdb.query(`select status from public.booking where order_id = $1`, [o])).rows[0].status;

describe('reconcileClub (D73)', () => {
  it('a paid charge whose callback never came is confirmed by the lookup, recorded as reconcile (PAY-02-AC15)', async () => {
    const p = await pendingPayment();
    await beam.pay(p.chargeId, async () => ({ status: 200 }), { deliver: false });
    await tdb.setNow('2026-12-02T10:05:00Z');
    expect(await run()).toEqual({ checked: 1, acted: 1, skipped: 0, failed: 0 });
    expect(await status(p.orderId)).toBe('confirmed');
    expect(await events()).toEqual([{ event_type: 'reconcile', outcome: 'applied' }]);
    // A second run finds nothing left to do.
    expect(await run()).toEqual({ checked: 0, acted: 0, skipped: 0, failed: 0 });
  });

  it('a payment younger than the age setting is not looked up; a still pending charge changes nothing', async () => {
    const p = await pendingPayment();
    expect((await run()).checked).toBe(0);
    await tdb.setNow('2026-12-02T10:05:00Z');
    expect(await run()).toEqual({ checked: 1, acted: 0, skipped: 0, failed: 0 });
    expect(await status(p.orderId)).toBe('awaiting_payment');
    expect(await events()).toEqual([]);
  });

  it('a wrong amount is flagged, never confirmed; a failed charge fails the payment and keeps the hold', async () => {
    const a = await pendingPayment();
    await beam.pay(a.chargeId, async () => ({ status: 200 }), { deliver: false });
    (beam as unknown as { charges: Map<string, { amount: number }> }).charges.get(a.chargeId)!.amount = 49900;
    await tdb.setNow('2026-12-02T10:05:00Z');
    await run();
    expect(await status(a.orderId)).toBe('awaiting_payment');
    expect((await tdb.query(`select kind from public.owner_flag where payment_id = $1`, [a.paymentId])).rows).toEqual([{ kind: 'wrong_amount' }]);
    expect(await events()).toEqual([{ event_type: 'reconcile', outcome: 'mismatch' }]);
  });

  it('a failed charge fails the payment and keeps the hold (D72)', async () => {
    const p = await pendingPayment();
    await beam.fail(p.chargeId, async () => ({ status: 200 }));
    await tdb.setNow('2026-12-02T10:05:00Z');
    await run();
    expect((await tdb.query(`select status from public.payment where id = $1`, [p.paymentId])).rows[0].status).toBe('failed');
    expect(await status(p.orderId)).toBe('awaiting_payment');
  });

  it('none while the age setting is unset (no value in code)', async () => {
    await pendingPayment();
    await tdb.query(`update platform.config set value = 'null' where key = 'beam_reconcile_age_seconds'`);
    await tdb.setNow('2026-12-02T10:05:00Z');
    expect(await run()).toEqual({ checked: 0, acted: 0, skipped: 0, failed: 0 });
  });

  it('Beam unreachable skips the payment for the next run, alerts and marks the health check', async () => {
    const p = await pendingPayment();
    await server.close();
    server = { url: 'http://127.0.0.1:1', close: async () => undefined };
    await tdb.setNow('2026-12-02T10:05:00Z');
    expect(await run()).toEqual({ checked: 1, acted: 0, skipped: 1, failed: 0 });
    expect(alerts).toEqual(['beam_unreachable']);
    expect(await status(p.orderId)).toBe('awaiting_payment');
    expect((await tdb.query(`select status, reason from platform.club_health where club_id = $1 and check_key = 'beam_charge'`, [A])).rows).toEqual([{ status: 'failed', reason: 'unreachable' }]);
  });
});
