import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { beamGateway } from '@booq/beam';
import { generateKeyPair, writeSecret } from '@booq/secrets';
import { FakeBeam, FakeClock } from '../../../../../tests/fakes';
import { fakeReceiptAndMessagePorts, fixtureSources, IDS, seedHunter } from '../../../../../packages/domain/src/checkout/test-fixture';
import { checkoutRoutes } from './routes';

// POST /checkout/package/quote and /pay: a package bought on its own (C10P to C11P; F05 PAY-04-AC1 to AC4, PAY-07;
// F06 R3-AC1, AC4, PKG-02-AC6 to AC8; R1-AC6; PROMO-01; D47, D74). Against the test database and the fake Beam.
// Hunter's prices and settings are test data here, never defaults in code.
const { A, ME, ADULT, STUDENT } = IDS;
const OWNER = '77777777-7777-4777-8777-777777777777';
const BUNDLE = 'eeeeeeee-0000-4000-8000-000000000001';
const STUDENT_PACK = 'eeeeeeee-0000-4000-8000-000000000002';
const KEY = 'sk_live_package_test_0001';
const NOW = '2026-12-02T10:00:00Z';
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
  await tdb.setNow(NOW);
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
  await tdb.query(`insert into public.package_product (club_id, id, name_th, name_en, credit_type, credits, validity_months, price_satang)
                   values ($1,$2,'10 ชั่วโมง','10 hours','court_hour',10,6,450000)`, [A, BUNDLE]);
  await tdb.query(`insert into public.package_product (club_id, id, name_th, name_en, credit_type, credits, validity_months, price_group_id, price_satang)
                   values ($1,$2,'นักเรียน 10','Student 10','court_hour',10,6,$3,380000)`, [A, STUDENT_PACK, STUDENT]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'package_qr_minutes','15')`, [A]);
  await tdb.query(`insert into public.payment_connection (club_id, merchant_id_live) values ($1,'m-hunter')`, [A]);
  db = createDb({ connectionString: tdb.url, max: 3 });
  await db.withClubTx({ clubId: A, userId: OWNER, roles: ['owner', 'player'], source: 'admin' }, (tx) => writeSecret(tx, keys.publicKey, A, 'beam_api_key_live', KEY));
  beam = new FakeBeam({ clock: new FakeClock(NOW), merchants: { 'm-hunter': { apiKey: KEY, webhookKeyBase64: Buffer.from('k').toString('base64') } } });
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
    payments: { privateKey: () => keys.privateKey, gateway: (cr) => beamGateway({ ...cr, baseUrl: beamUrl }), alerts: { p1: (k) => void alerts.push(k) }, now: () => new Date(NOW) },
  });
const call = (path: string, body: unknown, session: typeof me | null = me) =>
  routes().find((r) => r.def.path === path)!.handle({ session, input: { slug: 'club-a', ...(body as object) }, body }, deps);
const quote = (body: Record<string, unknown>) => call('/checkout/package/quote', body);
const pay = async (body: Record<string, unknown>) => {
  const q = await quote(body);
  if (!q.ok) throw new Error(q.code);
  return call('/checkout/package/pay', { ...body, quoteHash: (q.body as { quoteHash: string }).quoteHash });
};
const giveWallet = (satang: number) =>
  tdb.query(`insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, dedupe_key) values ($1,$2,$3,'refund','test:wallet')`, [A, ME, satang]);
const walletOf = async () => Number((await tdb.query(`select coalesce(sum(change_satang), 0)::int as b from public.wallet_ledger where customer_id = $1`, [ME])).rows[0].b);
const one = async (sql: string, args: unknown[] = []) => (await tdb.query(sql, args)).rows[0];

describe('POST /checkout/package/quote', () => {
  it('is a person route with no-store; a guest signs in first (R8-AC4)', async () => {
    for (const p of ['/checkout/package/quote', '/checkout/package/pay']) {
      const r = routes().find((x) => x.def.path === p)!;
      expect(r.def).toMatchObject({ method: 'POST', needsPerson: true });
      expect(r.headers).toEqual({ 'Cache-Control': 'no-store' });
    }
    expect(await quote({ productId: BUNDLE })).toMatchObject({ ok: true });
    expect(await call('/checkout/package/quote', { productId: BUNDLE }, null)).toEqual({ ok: false, status: 401, code: 'sign_in_required' });
  });

  it('prices the product from the club row: one package line, the wallet before money (F06 R3-AC1, R4)', async () => {
    await giveWallet(100000);
    const r = await quote({ productId: BUNDLE, totalSatang: 1 });
    expect(r).toMatchObject({ ok: true, body: { subtotalSatang: 450000, walletSatang: 100000, moneySatang: 350000, priceGroupId: ADULT,
      lines: [{ kind: 'package', packageProductId: BUNDLE, unitPriceSatang: 450000 }] } });
  });

  it('a Student package is refused to an adult; an unpriced, inactive or unknown product is not for sale (R1-AC6, PKG-02-AC7)', async () => {
    expect(await quote({ productId: STUDENT_PACK })).toEqual({ ok: false, status: 409, code: 'student_item_not_allowed' });
    await tdb.query(`update public.package_product set price_satang = null where id = $1`, [BUNDLE]);
    expect(await quote({ productId: BUNDLE })).toEqual({ ok: false, status: 409, code: 'package_not_for_sale' });
    expect(await quote({ productId: '00000000-0000-4000-8000-00000000dead' })).toEqual({ ok: false, status: 409, code: 'package_not_for_sale' });
    expect(await quote({ productId: 'nope' })).toEqual({ ok: false, status: 400, code: 'bad_input' });
  });

  it('a paused club refuses (R4-AC10)', async () => {
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    expect(await quote({ productId: BUNDLE })).toMatchObject({ ok: false, status: 409, code: 'club_paused' });
  });
});

describe('POST /checkout/package/pay', () => {
  it('money due: an order with one package line and no booking, the QR living package_qr_minutes (PAY-04-AC1, D74)', async () => {
    const r = await pay({ productId: BUNDLE });
    expect(r).toMatchObject({ ok: true, body: { confirmed: false, payment: { amountSatang: 450000 } } });
    const id = (r as { body: { orderId: string } }).body.orderId;
    expect(await one(`select status, money_satang from public.orders where id = $1`, [id])).toEqual({ status: 'open', money_satang: 450000 });
    expect(await one(`select kind, package_product_id, description_key, name_en from public.order_line where order_id = $1`, [id]))
      .toEqual({ kind: 'package', package_product_id: BUNDLE, description_key: 'P-new.package_line', name_en: '10 hours' });
    expect(Number((await one(`select count(*) from public.booking`)).count)).toBe(0);
    expect(beam.createRequests).toHaveLength(1);
    const sent = beam.createRequests[0] as { paymentMethod: { qrPromptPay: { expiryTime: string } } };
    expect(new Date(sent.paymentMethod.qrPromptPay.expiryTime).toISOString()).toBe('2026-12-02T10:15:00.000Z');
    // No package yet: it is granted when the payment lands.
    expect(Number((await one(`select count(*) from public.customer_package`)).count)).toBe(0);
  });

  it('a second tap returns the same order and QR; no second charge (D47)', async () => {
    const a = await pay({ productId: BUNDLE });
    const b = await call('/checkout/package/pay', { productId: BUNDLE, quoteHash: 'f'.repeat(64) });
    expect(b).toEqual(a);
    expect(beam.createRequests).toHaveLength(1);
  });

  it('a price changed since the quote creates nothing and returns the new quote (R4-AC9)', async () => {
    const q = await quote({ productId: BUNDLE });
    await tdb.query(`update public.package_product set price_satang = 470000 where id = $1`, [BUNDLE]);
    const r = await call('/checkout/package/pay', { productId: BUNDLE, quoteHash: (q as { body: { quoteHash: string } }).body.quoteHash });
    expect(r).toMatchObject({ ok: true, body: { priceChanged: true, quote: { totalSatang: 470000 } } });
    expect(Number((await one(`select count(*) from public.orders`)).count)).toBe(0);
  });

  it('nothing left to pay: the package is granted at once, a receipt issued, no payment (PAY-07, F06 R3-AC4)', async () => {
    await giveWallet(450000);
    const r = await pay({ productId: BUNDLE });
    expect(r).toMatchObject({ ok: true, body: { confirmed: true, payment: null } });
    const id = (r as { body: { orderId: string } }).body.orderId;
    expect((await one(`select status from public.orders where id = $1`, [id])).status).toBe('paid');
    expect(await one(`select customer_id, product_id, credits_total from public.customer_package where order_id = $1`, [id])).toEqual({ customer_id: ME, product_id: BUNDLE, credits_total: 10 });
    expect(await walletOf()).toBe(0);
    const ports = (await tdb.query(`select port from public.__f04_port_log order by n`)).rows.map((x) => x.port);
    expect(ports).toEqual(['issue_receipt']);   // no Booking confirmed card for a package alone
    expect(beam.createRequests).toHaveLength(0);
  });

  it('a code counts its use with the order (PROMO-01)', async () => {
    await tdb.query(`insert into public.promo_code (club_id, code_upper, kind, value, applies_to) values ($1,'PACK10','percent',1000,array['package'])`, [A]);
    const r = await pay({ productId: BUNDLE, code: 'pack10' });
    expect(r).toMatchObject({ ok: true, body: { payment: { amountSatang: 405000 } } });
    expect((await one(`select status from public.promo_redemption`)).status).toBe('counted');
  });

  it('package_qr_minutes unset: 503 payment_unavailable, the order ended, the wallet and code given back, a P1 alert (D74)', async () => {
    await tdb.query(`delete from public.club_setting where club_id = $1 and key = 'package_qr_minutes'`, [A]);
    await tdb.query(`insert into public.promo_code (club_id, code_upper, kind, value, applies_to) values ($1,'PACK10','percent',1000,array['package'])`, [A]);
    await giveWallet(100000);
    const r = await pay({ productId: BUNDLE, code: 'PACK10' });
    expect(r).toEqual({ ok: false, status: 503, code: 'payment_unavailable' });
    expect(alerts).toEqual(['package_qr_unset']);
    expect((await one(`select status from public.orders`)).status).toBe('cancelled');
    expect(await one(`select status, failure_code from public.payment`)).toEqual({ status: 'failed', failure_code: 'payment_unavailable' });
    expect(await walletOf()).toBe(100000);
    expect((await one(`select status from public.promo_redemption`)).status).toBe('restored');
    expect(beam.createRequests).toHaveLength(0);
  });

  it('Beam unreachable: 503 payment_unavailable, the order ended (design 5.1 step 4)', async () => {
    beamUrl = 'http://127.0.0.1:1';
    expect(await pay({ productId: BUNDLE })).toEqual({ ok: false, status: 503, code: 'payment_unavailable' });
    expect(alerts).toEqual(['beam_unreachable']);
    expect((await one(`select status from public.orders`)).status).toBe('cancelled');
  });
});
