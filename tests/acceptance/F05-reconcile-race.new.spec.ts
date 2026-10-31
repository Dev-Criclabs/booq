import { afterEach, beforeEach, expect, it } from 'vitest';
import { raceAll } from '../support/parallel';
import { createDb, type Db, type Tx } from '../../packages/db/src/tx';
import { createTestDatabase, type TestDatabase } from '../../packages/db/src/testing/harness';
import { generateKeyPair, writeSecret } from '../../packages/secrets/src/index';
import { beamGateway } from '../../packages/beam/src/adapter';
import { FakeBeam, FakeClock } from '../fakes';
import { parsePayRequest, placeOrder, preparePay } from '../../packages/domain/src/checkout/pay';
import { quoteFor } from '../../packages/domain/src/checkout/quote';
import { fakeReceiptAndMessagePorts, fixtureSources, IDS, seedHunter } from '../../packages/domain/src/checkout/test-fixture';
import { reconcileClub } from '../../packages/domain/src/payments/jobs';
import { startPayment } from '../../packages/domain/src/payments/start';

// CONC-31 (QA): two beam_reconcile runs and a hold release on one paid charge leave exactly one outcome. Setup follows the lane's domain/payments/jobs.test.ts.
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

async function pendingPaymentAt(hour: number): Promise<{ orderId: string; paymentId: string; chargeId: string }> {
  const src = fixtureSources();
  const body = { courtId: COURT, hours: [`2026-12-02T${hour}:00:00+07:00`] };
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

const count = async (sql: string, p: unknown[]) => (await tdb.query(sql, p)).rows[0].n as number;

it('F05/PAY-02-AC15 F05/PAY-02-AC11 CONC-31 parallel reconcile runs on a paid charge confirm it once: one booking, one receipt call, one applied event', async () => {
  const rounds = [18, 19, 20, 21];
  const ps = [];
  for (const h of rounds) {
    const p = await pendingPaymentAt(h);
    await beam.pay(p.chargeId, async () => ({ status: 200 }), { deliver: false });
    ps.push(p);
  }
  await tdb.setNow('2026-12-02T10:05:00Z');
  const outs = await raceAll([() => run(), () => run(), () => run()], { jitterMs: 3 });
  expect(outs.filter((o) => o.status !== 'ok'), 'a run threw').toEqual([]);
  for (const p of ps) {
    expect((await tdb.query(`select status from public.booking where order_id = $1`, [p.orderId])).rows[0].status).toBe('confirmed');
    expect(await count(`select count(*)::int as n from public.__f04_port_log where port = 'issue_receipt' and args->>0 = $1`, [p.orderId])).toBe(1);
    expect(await count(`select count(*)::int as n from public.payment_event where gateway_charge_id = $1 and outcome = 'applied'`, [p.chargeId])).toBe(1);
    expect((await tdb.query(`select status from public.payment where id = $1`, [p.paymentId])).rows[0].status).toBe('succeeded');
  }
  expect(await count(`select count(*)::int as n from public.wallet_ledger`, [])).toBe(0);   // nothing went to the wallet
});
