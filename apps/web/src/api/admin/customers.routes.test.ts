import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FileReply } from '@booq/auth';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { customerRoutes } from './routes';

// F11-T04: A5 Customers and the walk in quick add (ADMIN-06, ADMIN-04; D168).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER = '44444444-4444-4444-8444-444444444444';
const DESK = '33333333-3333-4333-8333-333333333333';
const ACC = '55555555-5555-4555-8555-555555555555';
const ANN = '11111111-1111-4111-8111-111111111111';
const BUSER = '99999999-9999-4999-8999-999999999999';
const deps = { hasFeature: async () => true };
let tdb: TestDatabase;
let db: Db;
let routes: ReturnType<typeof customerRoutes>;

type Roles = ('owner' | 'front_desk' | 'accountant' | 'player')[];
const as = (userId: string, roles: Roles) => ({ clubId: A, userId, roles });
const desk = () => as(DESK, ['front_desk', 'player']);
const call = (method: string, path: string, session: ReturnType<typeof as> | null, input: Record<string, unknown> = {}, body?: unknown) =>
  routes.find((r) => r.def.method === method && r.def.path === path)!.handle({ session, input: { slug: 'club-a', ...input }, body }, deps) as Promise<{ ok: boolean; status: number; code?: string; params?: unknown; body?: any }>;

async function person(club: string, id: string, roles: string[], name: string, phone: string | null = null) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, display_name, phone, phone_normalized, date_of_birth) values ($1,$2,$3,$4,$5,$6,'1990-02-02')`,
      [club, id, 'L' + id, name, phone, phone ? phone.replace('+', '') : null]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [club, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  await person(A, OWNER, ['owner', 'player'], 'Owner');
  await person(A, DESK, ['front_desk', 'player'], 'Desk');
  await person(A, ACC, ['accountant', 'player'], 'Acc');
  await person(A, ANN, ['player'], 'Ann Smith', '+66811111111');
  await person(B, BUSER, ['player'], 'Other Club', '+66899999999');
  db = createDb({ connectionString: tdb.url, max: 4 });
  routes = customerRoutes({ db, clubBySlug: async (slug) => (slug === 'club-a' ? { clubId: A } : slug === 'club-b' ? { clubId: B } : null) });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('customers', () => {
  it('front desk lists and searches; no date of birth anywhere; the accountant is refused', async () => {
    const r = await call('GET', '/staff/customers', desk(), { q: 'smith' });
    expect(r.body.customers).toEqual([expect.objectContaining({ name: 'Ann Smith', phone: '+66811111111', tags: [], bookingCount: 0 })]);
    expect(JSON.stringify((await call('GET', '/staff/customers', desk())).body)).not.toMatch(/1990-02-02|date_of_birth|dateOfBirth/);
    expect(await call('GET', '/staff/customers', as(ACC, ['accountant', 'player']))).toMatchObject({ ok: false, status: 403 });
    expect(await call('GET', '/staff/customers', null)).toMatchObject({ ok: false, status: 401 });
    expect(await call('GET', '/staff/customers', desk(), { slug: 'club-b' })).toMatchObject({ ok: false, status: 404 });
  });
  it('pages by cursor; a bad cursor or an over long query is bad input', async () => {
    for (let i = 0; i < 52; i++) await person(A, `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, ['player'], `Cust ${String(i).padStart(2, '0')}`);
    const p1 = await call('GET', '/staff/customers', desk());
    expect(p1.body.customers).toHaveLength(50);
    expect(p1.body.next).toBeTruthy();
    const p2 = await call('GET', '/staff/customers', desk(), { cursor: p1.body.next });
    expect(p2.body.customers).toHaveLength(6);
    expect(p2.body.next).toBeNull();
    expect(new Set([...p1.body.customers, ...p2.body.customers].map((c: { customerId: string }) => c.customerId)).size).toBe(p1.body.customers.length + p2.body.customers.length);
    expect(p1.body.customers.length + p2.body.customers.length).toBe(56);
    expect(await call('GET', '/staff/customers', desk(), { cursor: 'zzz' })).toMatchObject({ ok: false, status: 400 });
    expect(await call('GET', '/staff/customers', desk(), { q: 'x'.repeat(101) })).toMatchObject({ ok: false, status: 400 });
  });
  it('tags: add, list, filter, remove; blank is bad input; the accountant is refused', async () => {
    expect(await call('POST', '/staff/customers/:id/tags', desk(), { id: ANN }, { tag: 'Junior' })).toMatchObject({ ok: true });
    expect((await call('GET', '/staff/customers', desk(), { tag: 'junior' })).body.customers).toEqual([expect.objectContaining({ tags: ['Junior'] })]);
    expect(await call('DELETE', '/staff/customers/:id/tags/:tag', desk(), { id: ANN, tag: 'Junior' })).toMatchObject({ ok: true });
    expect((await call('GET', '/staff/customers', desk(), { tag: 'junior' })).body.customers).toEqual([]);
    expect(await call('POST', '/staff/customers/:id/tags', desk(), { id: ANN }, { tag: ' ' })).toMatchObject({ ok: false, status: 400 });
    expect(await call('POST', '/staff/customers/:id/tags', desk(), { id: BUSER }, { tag: 'x' })).toMatchObject({ ok: false, status: 404 });
    expect(await call('POST', '/staff/customers/:id/tags', as(ACC, ['accountant', 'player']), { id: ANN }, { tag: 'x' })).toMatchObject({ ok: false, status: 403 });
  });
  it('the CSV holds only this club, writes one audit entry and needs customer.export', async () => {
    const r = await call('GET', '/staff/customers/csv', desk());
    expect(r.ok).toBe(true);
    const text = Buffer.from((r.body as FileReply).bytes).toString('utf8');
    expect(text.split('\n')[0]).toBe('name,phone,tags,signed_in,bookings,last_booking,created');
    expect(text).toContain('Ann Smith');
    expect(text).not.toContain('Other Club');
    expect(text).not.toMatch(/1990-02-02/);
    expect((await tdb.query(`select count(*)::int as n from public.audit_entry where action = 'customers.exported'`)).rows[0].n).toBe(1);
    expect(await call('GET', '/staff/customers/csv', as(ACC, ['accountant', 'player']))).toMatchObject({ ok: false, status: 403 });
  });
  it('the quick add makes an unclaimed customer; a duplicate unclaimed phone is phone_in_use; bad name or phone says which', async () => {
    const r = await call('POST', '/staff/customers', desk(), {}, { name: 'Walk In', phone: '081 333 3333' });
    expect(r.ok).toBe(true);
    expect((await tdb.query(`select claim_state, phone, line_user_id from public.app_user where id = $1`, [r.body.customerId])).rows[0]).toEqual({ claim_state: 'unclaimed', phone: '+66813333333', line_user_id: null });
    expect(await call('POST', '/staff/customers', desk(), {}, { name: 'Again', phone: '0813333333' })).toMatchObject({ ok: false, status: 409, code: 'phone_in_use' });
    expect(await call('POST', '/staff/customers', desk(), {}, { name: '', phone: '0813333334' })).toMatchObject({ ok: false, status: 400, code: 'bad_input', params: { field: 'name' } });
    expect(await call('POST', '/staff/customers', desk(), {}, { name: 'X Y', phone: '123' })).toMatchObject({ ok: false, status: 400, params: { field: 'phone' } });
    expect(await call('POST', '/staff/customers', as(ACC, ['accountant', 'player']), {}, { name: 'X Y', phone: '0813333335' })).toMatchObject({ ok: false, status: 403 });
  });
});

describe('customer profile (ADMIN-07)', () => {
  async function bookingFor(customer: string) {
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id as string;
    await tdb.query(`insert into public.location (club_id, id, name) values ($1,'00000000-0000-4000-8000-0000000000a1','M')`, [A]);
    await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,'00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000a1','Court 1','tennis')`, [A]);
    return (await tdb.query(
      `insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
       values ($1,$2,'court','00000000-0000-4000-8000-0000000000c1','2026-12-05T10:00:00+07:00','2026-12-05T11:00:00+07:00',$3,'confirmed','online',$3, app.now()) returning id`, [A, order, customer])).rows[0].id as string;
  }
  it('front desk and owner read details including the date of birth; a missing, other-club or malformed id is 404; the accountant is refused', async () => {
    expect((await call('GET', '/staff/customers/:id', desk(), { id: ANN })).body).toMatchObject({ customerId: ANN, fullName: null, displayName: 'Ann Smith', dateOfBirth: '1990-02-02', phone: '+66811111111', tags: [] });
    expect((await call('GET', '/staff/customers/:id', as(OWNER, ['owner', 'player']), { id: ANN })).ok).toBe(true);
    for (const id of [BUSER, 'nope', '99999999-0000-4000-8000-000000000000']) {
      expect(await call('GET', '/staff/customers/:id', desk(), { id })).toMatchObject({ ok: false, status: 404 });
    }
    expect(await call('GET', '/staff/customers/:id', as(ACC, ['accountant', 'player']), { id: ANN })).toMatchObject({ ok: false, status: 403 });
  });
  it('bookings and orders of that person only', async () => {
    const b = await bookingFor(ANN);
    const r = await call('GET', '/staff/customers/:id/bookings', desk(), { id: ANN });
    expect(r.body).toEqual([expect.objectContaining({ bookingId: b, type: 'court', courtName: 'Court 1', status: 'confirmed', cancelKind: null })]);
    expect((await call('GET', '/staff/customers/:id/bookings', desk(), { id: OWNER })).body).toEqual([]);
    expect(await call('GET', '/staff/customers/:id/orders', desk(), { id: ANN })).toMatchObject({ ok: true, body: [] });
  });
  it('notes: add and read newest first with the author; blank and over long are bad input; the accountant is refused', async () => {
    expect(await call('POST', '/staff/customers/:id/notes', desk(), { id: ANN }, { note: ' Prefers evenings ' })).toMatchObject({ ok: true });
    const n = (await call('GET', '/staff/customers/:id/notes', desk(), { id: ANN })).body;
    expect(n).toEqual([expect.objectContaining({ note: 'Prefers evenings', by: 'Desk' })]);
    expect(await call('POST', '/staff/customers/:id/notes', desk(), { id: ANN }, { note: '  ' })).toMatchObject({ ok: false, status: 400 });
    expect(await call('POST', '/staff/customers/:id/notes', desk(), { id: ANN }, { note: 'x'.repeat(2001) })).toMatchObject({ ok: false, status: 400 });
    expect(await call('GET', '/staff/customers/:id/notes', as(ACC, ['accountant', 'player']), { id: ANN })).toMatchObject({ ok: false, status: 403 });
  });
});

describe('A5 columns and filters (H-A05, ADMIN-06)', () => {
  const GA = '77777777-7777-4777-8777-777777777771';
  const GS = '77777777-7777-4777-8777-777777777772';
  const PROD = '66666666-6666-4666-8666-666666666666';
  const BOB = '22222222-2222-4222-8222-222222222222';
  const list = async (q: Record<string, unknown> = {}) => (await call('GET', '/staff/customers', desk(), q)).body.customers as any[];
  const names = (rows: any[]) => rows.map((r) => r.name).sort();
  beforeEach(async () => {
    await person(A, BOB, ['player'], 'Bob Student');
    await tdb.query(`update public.app_user set date_of_birth = '2012-05-05' where id = $1`, [BOB]);
    await tdb.query(`update public.app_user set date_of_birth = null where id = $1`, [OWNER]);
    await tdb.query(`insert into public.price_group (club_id, id, name_th, name_en, rule, position) values ($1,$2,'ผู้ใหญ่','Adult','{"min_age":18}',0), ($1,$3,'นักเรียน','Student','{"min_age":0,"max_age":17}',1)`, [A, GA, GS]);
    await tdb.query(`insert into public.package_product (club_id, id, name_th, name_en, credit_type, credits, validity_months, price_group_id, price_satang) values ($1,$2,'ชุด','Ten hours','court_hour',10,6,$3,100000)`, [A, PROD, GA]);
  });
  it('shows the price group of the date of birth, and null without one', async () => {
    const rows = await list();
    expect(rows.find((r) => r.name === 'Ann Smith').group).toEqual({ id: GA, nameTh: 'ผู้ใหญ่', nameEn: 'Adult' });
    expect(rows.find((r) => r.name === 'Bob Student').group).toMatchObject({ nameEn: 'Student' });
    expect(rows.find((r) => r.name === 'Owner').group).toBeNull();
    expect(names(await list({ group: GS }))).toEqual(['Bob Student']);
    expect(await call('GET', '/staff/customers', desk(), { group: 'nope' })).toMatchObject({ ok: false, status: 400 });
  });
  it('shows the active package that ends soonest, the wallet and the last visit', async () => {
    await tdb.query(`insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, purchase_date, expires_at) values ($1,$2,$3,'{}',10,app.now(),'2026-12-01','2027-06-01T16:59:59.999Z'), ($1,$2,$3,'{}',10,app.now(),'2026-12-01','2027-03-01T16:59:59.999Z')`, [A, ANN, PROD]);
    await tdb.query(`insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, dedupe_key) values ($1,$2,50000,'refund','k1')`, [A, ANN]).catch(() => undefined);
    const ann = (await list()).find((r) => r.name === 'Ann Smith');
    expect(ann.activePackage).toMatchObject({ nameEn: 'Ten hours', creditsLeft: 10, expiresAt: '2027-03-01T16:59:59.999Z' });
    expect(typeof ann.walletSatang).toBe('number');
    expect(ann.lastVisitAt).toBeNull();
  });
  it('filters: active package, expiring soon (the largest reminder day of the club setting), no visit in 30 days', async () => {
    await tdb.query(`insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, purchase_date, expires_at) values ($1,$2,$3,'{}',10,app.now(),'2026-12-01','2026-12-10T16:59:59.999Z'), ($1,$4,$3,'{}',10,app.now(),'2026-12-01','2027-06-01T16:59:59.999Z')`, [A, ANN, PROD, BOB]);
    expect(names(await list({ status: 'active_package' }))).toEqual(['Ann Smith', 'Bob Student']);
    expect(await call('GET', '/staff/customers', desk(), { status: 'expiring_soon' })).toMatchObject({ ok: false, status: 409, code: 'setting_unset' });
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'package_expiry_reminder_days','[14, 3]')`, [A]);
    expect(names(await list({ status: 'expiring_soon' }))).toEqual(['Ann Smith']);
    await tdb.query(`insert into public.location (club_id, id, name) values ($1,'00000000-0000-4000-8000-0000000000a1','M')`, [A]);
    await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,'00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000a1','1','tennis')`, [A]);
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, ANN])).rows[0].id;
    await tdb.query(`insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at) values ($1,$2,'court','00000000-0000-4000-8000-0000000000c1','2026-11-25T10:00:00+07:00','2026-11-25T11:00:00+07:00',$3,'confirmed','online',$3, app.now())`, [A, order, ANN]);
    expect(names(await list({ status: 'no_visit' }))).not.toContain('Ann Smith');
    expect(names(await list({ status: 'no_visit' }))).toContain('Bob Student');
    expect((await list()).find((r) => r.name === 'Ann Smith').lastVisitAt).toBe('2026-11-25T03:00:00.000Z');
    expect(await call('GET', '/staff/customers', desk(), { status: 'bogus' })).toMatchObject({ ok: false, status: 400 });
  });
});
