import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { customerValueRoutes } from './routes';

// F11-T07: the credit and wallet panels of A6 (ADMIN-07; PKG-01, PKG-03-AC5; D88, D118).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER = '44444444-4444-4444-8444-444444444444';
const DESK = '33333333-3333-4333-8333-333333333333';
const ACC = '55555555-5555-4555-8555-555555555555';
const ANN = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const BUSER = '99999999-9999-4999-8999-999999999999';
const PROD = '66666666-6666-4666-8666-666666666666';
const deps = { hasFeature: async () => true };
let tdb: TestDatabase;
let db: Db;
let routes: ReturnType<typeof customerValueRoutes>;
let pkg: string;

type Roles = ('owner' | 'front_desk' | 'accountant' | 'player')[];
const as = (userId: string, roles: Roles) => ({ clubId: A, userId, roles });
const desk = () => as(DESK, ['front_desk', 'player']);
const owner = () => as(OWNER, ['owner', 'player']);
let n = 0;
const call = (method: string, path: string, session: ReturnType<typeof as> | null, input: Record<string, unknown> = {}, body?: unknown, key: string | null = `k${++n}`) =>
  routes.find((r) => r.def.method === method && r.def.path === path)!.handle({ session, input: { slug: 'club-a', ...(key ? { idempotencyKey: key } : {}), ...input }, body }, deps) as Promise<{ ok: boolean; status: number; code?: string; body?: any }>;

async function person(club: string, id: string, roles: string[], name: string) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, display_name) values ($1,$2,$3,$4)`, [club, id, 'L' + id, name]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [club, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
const credits = async () => Number((await tdb.query(`select 10 + coalesce(sum(change), 0) as n from public.credit_ledger where package_id = $1`, [pkg])).rows[0].n);
const wallet = async () => Number((await tdb.query(`select coalesce(sum(change_satang), 0) as b from public.wallet_ledger where customer_id = $1`, [ANN])).rows[0].b);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  await person(A, OWNER, ['owner', 'player'], 'Owner');
  await person(A, DESK, ['front_desk', 'player'], 'Desk');
  await person(A, ACC, ['accountant', 'player'], 'Acc');
  await person(A, ANN, ['player'], 'Ann');
  await person(A, BOB, ['player'], 'Bob');
  await person(B, BUSER, ['player'], 'Other');
  await tdb.query(`insert into public.price_group (club_id, id, name_th, name_en, rule) values ($1,'77777777-7777-4777-8777-777777777771','ผู้ใหญ่','Adult','{"min_age":18}')`, [A]);
  await tdb.query(`insert into public.package_product (club_id, id, name_th, name_en, credit_type, credits, validity_months, price_group_id, price_satang) values ($1,$2,'ชุด','Ten hours','court_hour',10,6,'77777777-7777-4777-8777-777777777771',100000)`, [A, PROD]);
  pkg = (await tdb.query(
    `insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, purchase_date, expires_at)
     values ($1,$2,$3,'{}',10,app.now(),'2026-12-01','2027-03-01T16:59:59.999Z') returning id`, [A, ANN, PROD])).rows[0].id;
  db = createDb({ connectionString: tdb.url, max: 4 });
  routes = customerValueRoutes({ db, clubBySlug: async (slug) => (slug === 'club-a' ? { clubId: A } : slug === 'club-b' ? { clubId: B } : null) });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('GET /staff/customers/:id/credits', () => {
  it('lists packages with credits left and status, the wallet balance and the ledgers', async () => {
    await call('POST', '/staff/customers/:id/wallet-adjust', desk(), { id: ANN }, { deltaSatang: 5000, note: 'goodwill' });
    const r = (await call('GET', '/staff/customers/:id/credits', desk(), { id: ANN }, undefined, null)).body;
    expect(r.packages).toEqual([expect.objectContaining({ packageId: pkg, nameEn: 'Ten hours', creditsTotal: 10, creditsLeft: 10, status: 'active' })]);
    expect(r.wallet).toMatchObject({ balanceSatang: 5000, ledger: [expect.objectContaining({ change: 5000, reason: 'adjust', note: 'goodwill' })] });
  });
  it('another club, an accountant and a guest cannot read it', async () => {
    expect(await call('GET', '/staff/customers/:id/credits', desk(), { id: BUSER }, undefined, null)).toMatchObject({ ok: false, status: 404 });
    expect(await call('GET', '/staff/customers/:id/credits', as(ACC, ['accountant', 'player']), { id: ANN }, undefined, null)).toMatchObject({ ok: false, status: 403 });
    expect(await call('GET', '/staff/customers/:id/credits', null, { id: ANN }, undefined, null)).toMatchObject({ ok: false, status: 401 });
  });
});

describe('adjusting credits and wallet (ADMIN-07)', () => {
  it('a credit adjust without a reason is refused; with one a ledger row is added and credits change', async () => {
    expect(await call('POST', '/staff/customers/:id/credit-adjust', desk(), { id: ANN }, { packageId: pkg, delta: -2 })).toMatchObject({ ok: false, status: 400, code: 'reason_required' });
    expect(await call('POST', '/staff/customers/:id/credit-adjust', desk(), { id: ANN }, { packageId: pkg, delta: -2, note: '  ' })).toMatchObject({ ok: false, code: 'reason_required' });
    expect(await credits()).toBe(10);
    expect(await call('POST', '/staff/customers/:id/credit-adjust', desk(), { id: ANN }, { packageId: pkg, delta: -2, note: 'played at counter' })).toMatchObject({ ok: true });
    expect(await credits()).toBe(8);
    expect((await tdb.query(`select reason, staff_id, note from public.credit_ledger where package_id = $1`, [pkg])).rows).toEqual([{ reason: 'adjust', staff_id: DESK, note: 'played at counter' }]);
  });
  it('below zero, zero, non integer and another customer’s package are refused', async () => {
    expect(await call('POST', '/staff/customers/:id/credit-adjust', desk(), { id: ANN }, { packageId: pkg, delta: -11, note: 'x' })).toMatchObject({ ok: false, status: 409, code: 'below_zero' });
    expect(await call('POST', '/staff/customers/:id/credit-adjust', desk(), { id: ANN }, { packageId: pkg, delta: 0, note: 'x' })).toMatchObject({ ok: false, status: 400 });
    expect(await call('POST', '/staff/customers/:id/credit-adjust', desk(), { id: ANN }, { packageId: pkg, delta: 1.5, note: 'x' })).toMatchObject({ ok: false, status: 400 });
    expect(await call('POST', '/staff/customers/:id/credit-adjust', desk(), { id: BOB }, { packageId: pkg, delta: 1, note: 'x' })).toMatchObject({ ok: false, status: 404 });
  });
  it('a wallet adjust without a reason is refused; with one a ledger row is added; it cannot go below zero', async () => {
    expect(await call('POST', '/staff/customers/:id/wallet-adjust', desk(), { id: ANN }, { deltaSatang: 1000 })).toMatchObject({ ok: false, code: 'reason_required' });
    expect(await wallet()).toBe(0);
    expect(await call('POST', '/staff/customers/:id/wallet-adjust', desk(), { id: ANN }, { deltaSatang: 1000, note: 'refund by hand' })).toMatchObject({ ok: true });
    expect(await wallet()).toBe(1000);
    expect(await call('POST', '/staff/customers/:id/wallet-adjust', desk(), { id: ANN }, { deltaSatang: -2000, note: 'fix' })).toMatchObject({ ok: false, status: 409, code: 'below_zero' });
    expect(await call('POST', '/staff/customers/:id/wallet-adjust', desk(), { id: ANN }, { deltaSatang: 12.5, note: 'fix' })).toMatchObject({ ok: false, status: 400 });
  });
  it('the same Idempotency-Key repeats one adjust once; a missing key is bad input', async () => {
    const send = () => call('POST', '/staff/customers/:id/credit-adjust', desk(), { id: ANN }, { packageId: pkg, delta: -1, note: 'once' }, 'same-key');
    const a = await send();
    const b = await send();
    expect(a.body).toEqual(b.body);
    expect(await credits()).toBe(9);
    expect(await call('POST', '/staff/customers/:id/wallet-adjust', desk(), { id: ANN }, { deltaSatang: 1, note: 'x' }, null)).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
  });
  it('the accountant, a player and a guest cannot adjust', async () => {
    for (const s of [as(ACC, ['accountant', 'player']), as(BOB, ['player'])]) {
      expect(await call('POST', '/staff/customers/:id/wallet-adjust', s, { id: ANN }, { deltaSatang: 1, note: 'x' })).toMatchObject({ ok: false, status: 403 });
    }
    expect(await call('POST', '/staff/customers/:id/wallet-adjust', null, { id: ANN }, { deltaSatang: 1, note: 'x' })).toMatchObject({ ok: false, status: 401 });
  });
});

describe('POST /staff/packages/:id/extend (owner, D88)', () => {
  it('the owner extends to a later day ending at the end of the Bangkok day with a reason; front desk is refused', async () => {
    expect(await call('POST', '/staff/packages/:id/extend', desk(), { id: pkg }, { newExpiresOn: '2027-04-01', reason: 'x' })).toMatchObject({ ok: false, status: 403 });
    expect(await call('POST', '/staff/packages/:id/extend', owner(), { id: pkg }, { newExpiresOn: '2027-04-01' })).toMatchObject({ ok: false, code: 'reason_required' });
    expect(await call('POST', '/staff/packages/:id/extend', owner(), { id: pkg }, { newExpiresOn: '2027-04-01', reason: 'club closed' })).toMatchObject({ ok: true });
    expect(new Date((await tdb.query(`select expires_at from public.customer_package where id = $1`, [pkg])).rows[0].expires_at).toISOString()).toBe('2027-04-01T16:59:59.999Z');
    expect(await call('POST', '/staff/packages/:id/extend', owner(), { id: pkg }, { newExpiresOn: '2027-03-01', reason: 'earlier' })).toMatchObject({ ok: false, status: 400 });
    expect(await call('POST', '/staff/packages/:id/extend', owner(), { id: pkg }, { newExpiresOn: 'nope', reason: 'x' })).toMatchObject({ ok: false, status: 400 });
  });
});
