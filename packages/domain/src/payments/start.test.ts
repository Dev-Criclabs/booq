import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db, type Tx } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { generateKeyPair, writeSecret } from '../../../secrets/src/index';
import { beamGateway } from '../../../beam/src/adapter';
import { FakeBeam, FakeClock } from '../../../../tests/fakes';
import { findLiveHold, parsePayRequest, placeOrder, preparePay } from '../checkout/pay';
import { quoteFor } from '../checkout/quote';
import { fixtureSources, IDS, seedHunter } from '../checkout/test-fixture';
import { startPayment, type PaymentAlertKind } from './start';

// F05-T04b: startPayment after the Pay commit (PAY-02-AC1 to AC3, PAY-01-AC1, AC7; D47, D72, D75, D80;
// design 5.1). Against QA's fake Beam over HTTP; real Playground keys are not available yet.
const { A, COURT, ME } = IDS;
const OWNER = '77777777-7777-4777-8777-777777777777';
const HOUR = '2026-12-02T18:00:00+07:00';
const API_KEY = 'sk_test_never_in_a_log_0001';
const keys = generateKeyPair();
const me = { clubId: A, userId: ME, roles: ['player'], requestId: 'r', source: 'player_app' as const };

let tdb: TestDatabase;
let db: Db;
let beam: FakeBeam;
let server: { url: string; close: () => Promise<void> };
let alerts: Array<{ kind: PaymentAlertKind; clubId: string }>;
const inTx = <T>(fn: (tx: Tx) => Promise<T>) => db.withClubTx(me, fn);
const count = async (sql: string, args: unknown[] = []) => Number((await tdb.query(sql, args)).rows[0].n);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-02T10:00:00Z');
  await seedHunter(tdb);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,'LO')`, [A, OWNER]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'owner'), ($1,$2,'player')`, [A, OWNER]);
    await c.query('commit');
  } finally {
    c.release();
  }
  // A Live club uses the live key set (PAY-01-AC4); the fake Beam stands in for its host.
  await tdb.query(`insert into public.payment_connection (club_id, merchant_id_live) values ($1,'m-hunter')`, [A]);
  await tdb.query(`insert into platform.config (key, value) values ('qr_expiry_margin_seconds', '30') on conflict (key) do update set value = excluded.value`);
  db = createDb({ connectionString: tdb.url, max: 3 });
  await db.withClubTx({ clubId: A, userId: OWNER, roles: ['owner', 'player'], source: 'admin' }, (tx) => writeSecret(tx, keys.publicKey, A, 'beam_api_key_live', API_KEY));
  beam = new FakeBeam({ clock: new FakeClock('2026-12-02T10:00:00Z'), merchants: { 'm-hunter': { apiKey: API_KEY, webhookKeyBase64: Buffer.from('k').toString('base64') } } });
  server = await beam.serve();
  alerts = [];
});
afterEach(async () => {
  beam.assertNoRefunds();
  await server.close();
  await db.end();
  await tdb.close();
});

const deps = (baseUrl = () => server.url) => ({
  db,
  privateKey: keys.privateKey,
  gateway: (c: { set: 'test' | 'live'; merchantId: string; apiKey: string }) => beamGateway({ ...c, baseUrl: baseUrl() }),
  alerts: { p1: (kind: PaymentAlertKind, clubId: string) => void alerts.push({ kind, clubId }) },
  now: () => new Date('2026-12-02T10:00:00Z'),
});

async function placed(extra: Record<string, unknown> = {}): Promise<string> {
  const src = fixtureSources();
  const body = { courtId: COURT, hours: [HOUR], ...extra };
  const hash = (await inTx((tx) => quoteFor(tx, ME, parsePayRequest({ ...body, quoteHash: '0'.repeat(64) }).choice, src))).quoteHash;
  const req = parsePayRequest({ ...body, quoteHash: hash });
  return inTx(async (tx) => {
    const r = await preparePay(tx, ME, req, src);
    if (r.kind !== 'ready') throw new Error('expected ready');
    return (await placeOrder(tx, ME, req.choice, r.quote, src)).orderId;
  });
}

describe('startPayment', () => {
  it('creates one QR charge for the exact money due, ending the margin before the hold; stores it (PAY-02-AC1, AC2, D80)', async () => {
    const order = await placed();
    const r = await startPayment(deps(), me, order);
    if (!r.ok) throw new Error(r.code);
    expect(r).toMatchObject({ amountSatang: 50000, qrImageBase64: 'RkFLRQ==' });
    const hold = (await tdb.query(`select hold_expires_at from public.booking where order_id = $1`, [order])).rows[0].hold_expires_at as Date;
    expect(new Date(r.qrExpiresAt).getTime()).toBe(hold.getTime() - 30_000);
    const p = (await tdb.query(`select status, amount_satang, environment, gateway_charge_id, qr_image from public.payment where id = $1`, [r.paymentId])).rows[0];
    expect(p).toMatchObject({ status: 'pending', amount_satang: 50000, environment: 'live', qr_image: 'RkFLRQ==' });
    expect(beam.getCharge(p.gateway_charge_id)).toMatchObject({ amount: 50000, referenceId: r.paymentId });
    expect(beam.createRequests).toHaveLength(1);
    expect(r).not.toHaveProperty('slipUpload'); // the QR is the only way to pay (PAY-01-AC1)
  });

  it('a second tap returns the same payment and QR and creates no second charge (PAY-02-AC3, D47)', async () => {
    const order = await placed();
    const a = await startPayment(deps(), me, order);
    const b = await startPayment(deps(), me, order);
    expect(b).toEqual(a);
    expect(beam.createRequests).toHaveLength(1);
    expect(await count(`select count(*) as n from public.payment where order_id = $1`, [order])).toBe(1);
  });

  it('a failed charge inside the hold, then a tap: a new payment and a new charge in the same hold (D72)', async () => {
    const order = await placed();
    const a = await startPayment(deps(), me, order);
    if (!a.ok) throw new Error(a.code);
    await tdb.query(`update public.payment set status = 'failed', failure_code = 'test' where id = $1`, [a.paymentId]);
    const b = await startPayment(deps(), me, order);
    if (!b.ok) throw new Error(b.code);
    expect(b.paymentId).not.toBe(a.paymentId);
    expect(b.qrExpiresAt).toBe(a.qrExpiresAt);
    expect(beam.createRequests).toHaveLength(2);
  });

  it('Beam unreachable releases the hold and restores the code, raises the P1 alert only, answers payment_unavailable (design 5.1 step 4)', async () => {
    await tdb.query(`insert into public.promo_code (club_id, code_upper, kind, value, applies_to) values ($1,'TEN','percent',1000,array['court_hour'])`, [A]);
    const order = await placed({ code: 'TEN' });
    const r = await startPayment(deps(() => 'http://127.0.0.1:1'), me, order);
    expect(r).toEqual({ ok: false, code: 'payment_unavailable' });
    expect((await tdb.query(`select status, release_reason from public.booking where order_id = $1`, [order])).rows[0]).toEqual({ status: 'released', release_reason: 'payment_unavailable' });
    expect(alerts).toEqual([{ kind: 'beam_unreachable', clubId: A }]);
    expect((await tdb.query(`select status, restore_reason from public.promo_redemption where order_id = $1`, [order])).rows).toEqual([{ status: 'restored', restore_reason: 'payment_unavailable' }]);
    expect(await count(`select count(*) as n from public.owner_flag`)).toBe(0);
    expect((await tdb.query(`select check_key, status, reason from platform.club_health where club_id = $1`, [A])).rows).toEqual([{ check_key: 'beam_charge', status: 'failed', reason: 'unreachable' }]);
    expect(await inTx((tx) => findLiveHold(tx, parsePayRequest({ courtId: COURT, hours: [HOUR], quoteHash: '0'.repeat(64) }).choice, ME))).toBeNull();
  });

  it('missing keys release the hold, flag the owner and raise the P1 alert (PAY-01-AC7, D75)', async () => {
    await tdb.query(`update public.payment_connection set merchant_id_live = null where club_id = $1`, [A]);
    const order = await placed();
    expect(await startPayment(deps(), me, order)).toEqual({ ok: false, code: 'payment_unavailable' });
    expect(alerts).toEqual([{ kind: 'beam_keys_missing', clubId: A }]);
    expect((await tdb.query(`select check_key, status, reason from platform.club_health where club_id = $1`, [A])).rows).toEqual([{ check_key: 'beam_keys', status: 'failed', reason: 'keys_missing' }]);
    expect(await count(`select count(*) as n from public.owner_flag where kind = 'key_check_failed'`)).toBe(1);
    expect(beam.createRequests).toHaveLength(0);
  });

  it('a key Beam refuses is a failed key check: released, owner flag, P1 alert (PAY-01-AC7)', async () => {
    const order = await placed();
    const bad = { ...deps(), gateway: (c: { set: 'test' | 'live'; merchantId: string; apiKey: string }) => beamGateway({ ...c, apiKey: 'wrong', baseUrl: server.url }) };
    expect(await startPayment(bad, me, order)).toEqual({ ok: false, code: 'payment_unavailable' });
    expect(alerts).toEqual([{ kind: 'beam_key_check_failed', clubId: A }]);
    expect(await count(`select count(*) as n from public.owner_flag where kind = 'key_check_failed'`)).toBe(1);
  });

  it('the margin unset: payment unavailable with the P1 alert, no value built in, no charge (D80)', async () => {
    await tdb.query(`update platform.config set value = 'null' where key = 'qr_expiry_margin_seconds'`);
    const order = await placed();
    expect(await startPayment(deps(), me, order)).toEqual({ ok: false, code: 'payment_unavailable' });
    expect(alerts).toEqual([{ kind: 'qr_margin_unset', clubId: A }]);
    expect(beam.createRequests).toHaveLength(0);
  });

  it('a recorded charge sets both Beam checks ok again on the health tile (F05-T04c)', async () => {
    await tdb.query(`insert into platform.club_health (club_id, check_key, status, reason) values ($1,'beam_charge','failed','unreachable')`, [A]);
    const order = await placed();
    expect((await startPayment(deps(), me, order)).ok).toBe(true);
    expect((await tdb.query(`select check_key, status, reason from platform.club_health where club_id = $1 order by check_key`, [A])).rows).toEqual([
      { check_key: 'beam_charge', status: 'ok', reason: null },
      { check_key: 'beam_keys', status: 'ok', reason: null },
    ]);
  });

  it('the key is never in an alert, a result or the stored rows', async () => {
    const order = await placed();
    const r = await startPayment(deps(), me, order);
    const all = JSON.stringify([r, alerts, (await tdb.query(`select * from public.payment`)).rows]);
    expect(all).not.toContain(API_KEY);
  });
});
