import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { playerPackageRoutes } from './routes';

// F06-T15: GET /packages, /me/credits and /me/ledger (PKG-01-AC9, AC10, PKG-02-AC7 to AC9; D103).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const OWNER = '44444444-4444-4444-8444-444444444444';
const SLUGS: Record<string, string> = { 'club-a': A, 'club-b': B };
const deps = { hasFeature: async () => true };
let tdb: TestDatabase;
let db: Db;
let routes: ReturnType<typeof playerPackageRoutes>;

const find = (path: string) => routes.find((r) => r.def.method === 'GET' && r.def.path === path)!;
const me = (userId: string, clubId = A) => ({ clubId, userId, roles: ['player' as const] });
const call = (path: string, session: ReturnType<typeof me> | null, input: Record<string, unknown> = {}) =>
  find(path).handle({ session, input: { slug: 'club-a', ...input } }, deps);
const ok = async <T>(p: Promise<{ ok: boolean; body?: unknown; status?: number; code?: string }>): Promise<T> => {
  const r = await p;
  expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
  return r.body as T;
};
const refused = async (p: Promise<{ ok: boolean; status?: number; code?: string }>) => {
  const r = await p;
  return r.ok ? null : { status: r.status, code: r.code };
};

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','draft')`, [A, B]);
  for (const [club, u, roles] of [[A, P1, ['player']], [A, P2, ['player']], [A, OWNER, ['owner', 'player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [club, u, 'L' + u.slice(0, 2)]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  db = createDb({ connectionString: tdb.url, max: 2 });
  routes = playerPackageRoutes({ db, clubBySlug: async (slug) => (SLUGS[slug] ? { clubId: SLUGS[slug]! } : null) });
  await tdb.setNow('2027-02-01T03:00:00Z');
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

const product = (club: string, name: string, credits: number, price: number | null, active = true) =>
  tdb.query(`insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_satang, active)
             values ($1,$2,$2,'court_hour',$3,3,$4,$5) returning id`, [club, name, credits, price, active]).then((r) => r.rows[0].id as string);
const pkg = (customer: string, productId: string, credits = 10, expires = '2027-04-05T16:59:59.999Z') =>
  tdb.query(`insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, expires_at)
             values ($1,$2,$3,'{"credit_type":"court_hour","name_th":"แพ็กเกจ 10 ชั่วโมง","name_en":"10 hour bundle"}',$4,'2027-01-04T17:30:00Z',$5) returning id`,
    [A, customer, productId, credits, expires]).then((r) => r.rows[0].id as string);
const wallet = (customer: string, satang: number, key: string, at: string) =>
  tdb.query(`insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, dedupe_key, created_at) values ($1,$2,$3,'refund',$4,$5)`, [A, customer, satang, key, at]);

describe('GET /packages (C9; PKG-02-AC7, AC8; D103)', () => {
  it('a guest reads only the named public columns; no price or inactive is not offered; price per credit rounds half up', async () => {
    const id = await product(A, '10 hour bundle', 10, 450000);
    await product(A, 'no price', 8, null);
    await product(A, 'old', 8, 100000, false);
    await product(A, 'odd', 3, 100000);                 // 33333.33 per credit -> 33333
    const body = await ok<Record<string, unknown>[]>(call('/packages', null));
    expect(body.map((p) => p['nameEn'])).toEqual(['odd', '10 hour bundle']);
    expect(Object.keys(body[1]!).sort()).toEqual(['coachTierId', 'creditType', 'credits', 'nameEn', 'nameTh', 'priceGroupId', 'priceGroupNameEn', 'priceGroupNameTh', 'pricePerCreditSatang', 'priceSatang', 'productId', 'savingSatang', 'validityMonths']);
    expect(body[1]).toMatchObject({ productId: id, priceSatang: 450000, pricePerCreditSatang: 45000, credits: 10, validityMonths: 3 });
    expect(body[0]).toMatchObject({ pricePerCreditSatang: 33333 });
    expect(body.map((p) => p['savingSatang'])).toEqual([null, null]);   // no court price set: no saving, nothing guessed (D173)
  });
  it('the saving is credits x the single court price - the package price (D173)', async () => {
    const g = (await tdb.query(`insert into public.price_group (club_id, name_th, name_en, rule) values ($1,'ผู้ใหญ่','Adult','{"min_age": 18}') returning id`, [A])).rows[0].id;
    await tdb.query(`insert into public.court_price_rule (club_id, price_group_id, price_satang) values ($1,$2,50000)`, [A, g]);
    await product(A, '10 hour bundle', 10, 450000);
    expect(await ok(call('/packages', null))).toMatchObject([{ savingSatang: 50000, priceGroupNameEn: null, priceGroupNameTh: null }]);
  });
  it('a product for one price group carries the group’s names (the Student and Adult packs share a name)', async () => {
    const g = (await tdb.query(`insert into public.price_group (club_id, name_th, name_en, rule) values ($1,'นักเรียน','Student','{"max_age": 17}') returning id`, [A])).rows[0].id;
    await tdb.query(`insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_satang, price_group_id)
                     values ($1,'แพ็ก 8 ครั้ง','Group 8 session pack','group_session',8,3,320000,$2)`, [A, g]);
    expect(await ok(call('/packages', null))).toMatchObject([{ nameEn: 'Group 8 session pack', priceGroupId: g, priceGroupNameEn: 'Student', priceGroupNameTh: 'นักเรียน' }]);
  });
  it('a Draft club shows nothing; an unknown slug is not found; another club’s session is not found here', async () => {
    await product(B, 'b', 10, 1000);
    expect(await ok(call('/packages', null, { slug: 'club-b' }))).toEqual([]);
    expect(await refused(call('/packages', null, { slug: 'nope' }))).toEqual({ status: 404, code: 'not_found' });
    expect(await refused(call('/packages', me(P1, B)))).toEqual({ status: 404, code: 'not_found' });
  });
});

describe('GET /me/credits (C14; PKG-01-AC10)', () => {
  it('the caller’s packages with credits left, expiry and status, active first, and the wallet balance; nobody else’s', async () => {
    const prod = await product(A, 'b', 10, 450000);
    const mine = await pkg(P1, prod, 10);
    const old = await pkg(P1, prod, 5, '2027-01-31T16:59:59.999Z');
    await pkg(P2, prod, 10);
    await wallet(P1, 25000, 'r1', '2027-01-10T03:00:00Z');
    await wallet(P2, 99999, 'r2', '2027-01-10T03:00:00Z');
    const body = await ok<{ packages: Record<string, unknown>[]; walletSatang: number }>(call('/me/credits', me(P1)));
    expect(body.walletSatang).toBe(25000);
    expect(body.packages.map((p) => [p['packageId'], p['status'], p['creditsLeft']])).toEqual([[mine, 'active', 10], [old, 'expired', 5]]);
    expect(body.packages[0]).toMatchObject({ nameEn: '10 hour bundle', nameTh: 'แพ็กเกจ 10 ชั่วโมง', creditType: 'court_hour', creditsTotal: 10, expiresAt: '2027-04-05T16:59:59.999Z' });
    expect(await ok(call('/me/credits', me(P2)))).toMatchObject({ walletSatang: 99999 });
  });
  it('a guest is refused', async () => {
    expect((await refused(call('/me/credits', null)))?.status).toBe(401);
  });
});

describe('GET /me/ledger (PKG-01-AC10)', () => {
  it('every wallet movement newest first with its reason code, a page at a time, with no gap or repeat at the edge', async () => {
    for (let i = 0; i < 53; i += 1) await wallet(P1, 100 + i, `w${i}`, `2027-01-${String(10 + (i % 15)).padStart(2, '0')}T03:00:00.${String(i).padStart(6, '0')}Z`);
    await wallet(P2, 5, 'other', '2027-01-30T03:00:00Z');
    const first = await ok<{ entries: Record<string, unknown>[]; nextCursor: string | null }>(call('/me/ledger', me(P1), { kind: 'wallet' }));
    expect(first.entries).toHaveLength(50);
    expect(first.entries[0]).toMatchObject({ reason: 'refund' });
    const second = await ok<{ entries: Record<string, unknown>[]; nextCursor: string | null }>(call('/me/ledger', me(P1), { kind: 'wallet', cursor: first.nextCursor }));
    expect(second.entries).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    const all = [...first.entries, ...second.entries];
    expect(new Set(all.map((e) => e['id'])).size).toBe(53);
    const times = all.map((e) => e['at'] as string);
    expect([...times].sort().reverse()).toEqual(times);
    expect(all.reduce((s, e) => s + (e['change'] as number), 0)).toBe(Array.from({ length: 53 }, (_, i) => 100 + i).reduce((a, b) => a + b, 0));
  });
  it('credit movements of the caller’s packages, never another person’s; no staff note is returned', async () => {
    const prod = await product(A, 'b', 10, 450000);
    const mine = await pkg(P1, prod);
    const theirs = await pkg(P2, prod);
    await tdb.query(`insert into public.credit_ledger (club_id, package_id, change, reason, staff_id, note) values ($1,$2,1,'adjust',$3,'goodwill: rain'), ($1,$4,1,'adjust',$3,'x')`, [A, mine, OWNER, theirs]);
    const body = await ok<{ entries: Record<string, unknown>[] }>(call('/me/ledger', me(P1), { kind: 'credit' }));
    expect(body.entries.map((e) => [e['packageId'], e['reason'], e['change']])).toEqual([[mine, 'adjust', 1]]);
    expect(JSON.stringify(body)).not.toContain('goodwill');
    expect(JSON.stringify(body)).not.toContain(OWNER);
  });
  it('an unknown kind or a broken cursor is bad input', async () => {
    expect(await refused(call('/me/ledger', me(P1), { kind: 'points' }))).toEqual({ status: 400, code: 'bad_input' });
    expect(await refused(call('/me/ledger', me(P1), { kind: 'wallet', cursor: 'not-a-cursor' }))).toEqual({ status: 400, code: 'bad_input' });
  });
});

describe('no route withdraws or refunds wallet value (PKG-01-AC9)', () => {
  it('the F06 player routes are reads only', () => {
    expect(routes.map((r) => `${r.def.method} ${r.def.path}`)).toEqual(['GET /packages', 'GET /me/credits', 'GET /me/ledger']);
  });
});
