import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { can } from '@booq/auth';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { fakeReceiptAndMessagePorts, fixtureSources, IDS, seedHunter } from '../../../../../packages/domain/src/checkout/test-fixture';
import { staffPackageRoutes } from './staff';

// F06-T16 (D174): POST /staff/customers/:id/package-sale, the desk cash package sale (R3-AC5, AC6, AC8; F05 PAY-06).
// Hunter's prices are test data here, never defaults in code.
const { A, ME, STUDENT } = IDS;
const OWNER = '77777777-7777-4777-8777-777777777777';
const DESK = '78787878-7878-4878-8878-787878787878';
const ACCT = '79797979-7979-4979-8979-797979797979';
const KID = '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a';
const BUNDLE = 'eeeeeeee-0000-4000-8000-000000000001';
const STUDENT_PACK = 'eeeeeeee-0000-4000-8000-000000000002';
const NOW = '2026-12-02T10:00:00Z';
const deps = { hasFeature: async () => true };
type Role = 'owner' | 'front_desk' | 'accountant' | 'player';
const as = (userId: string, roles: Role[]) => ({ clubId: A, userId, roles });
const desk = as(DESK, ['front_desk', 'player']);
const owner = as(OWNER, ['owner', 'player']);

let tdb: TestDatabase;
let db: Db;
let n = 0;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow(NOW);
  await seedHunter(tdb);
  await fakeReceiptAndMessagePorts(tdb);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    for (const [u, roles] of [[OWNER, ['owner', 'player']], [DESK, ['front_desk', 'player']], [ACCT, ['accountant', 'player']]] as const) {
      await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)`, [A, u, 'L' + u.slice(0, 3)]);
      for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [A, u, r]);
    }
    await c.query(`insert into public.app_user (club_id, id, line_user_id, full_name, date_of_birth) values ($1,$2,'LK','Kid','2011-03-01')`, [A, KID]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, KID]);
    await c.query('commit');
  } finally {
    c.release();
  }
  await tdb.query(`insert into public.package_product (club_id, id, name_th, name_en, credit_type, credits, validity_months, price_satang)
                   values ($1,$2,'10 ชั่วโมง','10 hours','court_hour',10,6,450000)`, [A, BUNDLE]);
  await tdb.query(`insert into public.package_product (club_id, id, name_th, name_en, credit_type, credits, validity_months, price_group_id, price_satang)
                   values ($1,$2,'นักเรียน 10','Student 10','court_hour',10,6,$3,380000)`, [A, STUDENT_PACK, STUDENT]);
  db = createDb({ connectionString: tdb.url, max: 3 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

const routes = () => staffPackageRoutes({ db, clubBySlug: async (s) => (s === 'club-a' ? { clubId: A } : null), sources: fixtureSources() });
const sell = (session: ReturnType<typeof as> | null, customer: string, body: Record<string, unknown>, key: string | null = `k-${++n}`) =>
  routes()[0]!.handle({ session, input: { slug: 'club-a', id: customer, ...(key === null ? {} : { idempotencyKey: key }) }, body }, deps);
const one = async (sql: string, args: unknown[] = []) => (await tdb.query(sql, args)).rows[0];
const packagesOf = async (customer: string) =>
  (await tdb.query(`select p.product_id, p.credits_total, p.order_id from public.customer_package p where p.customer_id = $1`, [customer])).rows;
const cash = { productId: BUNDLE, reasonCode: 'no_banking_app' };

describe('POST /staff/customers/:id/package-sale', () => {
  it('needs payment.cash: front desk and owner only, no-store', () => {
    const r = routes()[0]!;
    expect(r.def).toMatchObject({ method: 'POST', path: '/staff/customers/:id/package-sale', permission: 'payment.cash' });
    expect(r.headers).toEqual({ 'Cache-Control': 'no-store' });
    expect(['owner', 'front_desk', 'accountant', 'coach', 'player'].filter((x) => can([x as Role], 'payment.cash'))).toEqual(['owner', 'front_desk']);
  });

  it('front desk sells a package for cash: the order is paid in cash with the reason code, the package is created and a receipt is issued (R3-AC5)', async () => {
    const r = await sell(desk, ME, cash);
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, body: { cashSatang: 450000, walletSatang: 0 } });
    const { orderId, paymentId } = (r as { body: { orderId: string; paymentId: string } }).body;
    expect(await one(`select status, money_satang from public.orders where id = $1`, [orderId])).toEqual({ status: 'paid', money_satang: 450000 });
    expect(await one(`select method, status, amount_satang, cash_reason_code, taken_by from public.payment where id = $1`, [paymentId]))
      .toEqual({ method: 'cash', status: 'succeeded', amount_satang: 450000, cash_reason_code: 'no_banking_app', taken_by: DESK });
    expect(await packagesOf(ME)).toEqual([{ product_id: BUNDLE, credits_total: 10, order_id: orderId }]);
    expect((await tdb.query(`select args from public.__f04_port_log where port = 'issue_receipt'`)).rows.map((x) => x.args[0])).toEqual([orderId]);
  });

  it('the wallet goes before cash; a wallet that covers the price leaves nothing for cash', async () => {
    await tdb.query(`insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, dedupe_key) values ($1,$2,100000,'refund','t:w1')`, [A, ME]);
    expect(await sell(desk, ME, cash)).toMatchObject({ ok: true, body: { cashSatang: 350000, walletSatang: 100000 } });
    await tdb.query(`insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, dedupe_key) values ($1,$2,450000,'refund','t:w2')`, [A, ME]);
    expect(await sell(desk, ME, cash)).toMatchObject({ ok: true, body: { paymentId: null, cashSatang: 0, walletSatang: 450000 } });
    expect(await packagesOf(ME)).toHaveLength(2);
  });

  it('a Paused club refuses and nothing is created (R3-AC6)', async () => {
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    expect(await sell(owner, ME, cash)).toEqual({ ok: false, status: 409, code: 'club_paused' });
    expect(await one(`select count(*)::int as n from public.orders where customer_id = $1`, [ME])).toEqual({ n: 0 });
  });

  it('the owner sells a Student product to a buyer under 18, and not to an adult (R3-AC8, PKG-02-AC6)', async () => {
    expect(await sell(owner, KID, { ...cash, productId: STUDENT_PACK })).toMatchObject({ ok: true, body: { cashSatang: 380000 } });
    expect(await packagesOf(KID)).toMatchObject([{ product_id: STUDENT_PACK, credits_total: 10 }]);
    expect(await sell(owner, ME, { ...cash, productId: STUDENT_PACK })).toEqual({ ok: false, status: 409, code: 'student_item_not_allowed' });
    expect(await packagesOf(ME)).toEqual([]);
  });

  it('the reason other needs a note; an unknown reason, product or key is refused; the same key sells once', async () => {
    expect(await sell(desk, ME, { ...cash, reasonCode: 'other' })).toEqual({ ok: false, status: 400, code: 'reason_required' });
    expect(await sell(desk, ME, { ...cash, reasonCode: 'other', note: '   ' })).toEqual({ ok: false, status: 400, code: 'reason_required' });
    expect(await sell(desk, ME, { ...cash, reasonCode: 'cheque' })).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
    expect(await sell(desk, ME, { ...cash, productId: 'x' })).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
    expect(await sell(desk, ME, cash, null)).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
    expect(await sell(desk, ME, { ...cash, productId: 'eeeeeeee-0000-4000-8000-0000000000ff' })).toEqual({ ok: false, status: 409, code: 'package_not_for_sale' });
    const first = await sell(desk, ME, { ...cash, reasonCode: 'other', note: 'phone battery flat' }, 'same');
    const again = await sell(desk, ME, { ...cash, reasonCode: 'other', note: 'phone battery flat' }, 'same');
    expect(again).toEqual(first);
    expect(await packagesOf(ME)).toHaveLength(1);
    expect(await one(`select cash_reason_note from public.payment where method = 'cash'`)).toEqual({ cash_reason_note: 'phone battery flat' });
  });

  it('the accountant, a player and a guest cannot sell; another club’s slug is not found', async () => {
    expect(await sell(as(ACCT, ['accountant', 'player']), ME, cash)).toMatchObject({ ok: false, status: 403 });
    expect(await sell(as(ME, ['player']), ME, cash)).toMatchObject({ ok: false, status: 403 });
    expect((await sell(null, ME, cash)).ok).toBe(false);
    const r = await routes()[0]!.handle({ session: desk, input: { slug: 'club-b', id: ME, idempotencyKey: 'z' }, body: cash }, deps);
    expect(r).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(await packagesOf(ME)).toEqual([]);
  });
});
