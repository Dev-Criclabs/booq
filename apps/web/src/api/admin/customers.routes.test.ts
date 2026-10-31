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
