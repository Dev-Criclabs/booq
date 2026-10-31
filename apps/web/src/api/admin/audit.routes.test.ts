import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { auditRoutes } from './routes';

// F11-T08: A17 audit log and A2 booking history (ADMIN-17, ADMIN-04; PLAT-04, D28).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const OWNER = '44444444-4444-4444-8444-444444444444';
const DESK = '33333333-3333-4333-8333-333333333333';
const ACC = '55555555-5555-4555-8555-555555555555';
const ANN = '11111111-1111-4111-8111-111111111111';
const deps = { hasFeature: async () => true };
let tdb: TestDatabase;
let db: Db;
let routes: ReturnType<typeof auditRoutes>;

type Roles = ('owner' | 'front_desk' | 'accountant' | 'player')[];
const as = (userId: string, roles: Roles) => ({ clubId: A, userId, roles });
const owner = () => as(OWNER, ['owner', 'player']);
const desk = () => as(DESK, ['front_desk', 'player']);
const call = (method: string, path: string, session: ReturnType<typeof as> | null, input: Record<string, unknown> = {}) =>
  routes.find((r) => r.def.method === method && r.def.path === path)!.handle({ session, input: { slug: 'club-a', ...input } }, deps) as Promise<{ ok: boolean; status: number; code?: string; body?: any }>;

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
/** Runs a change as a person of club A so the audit trigger records it. */
const as_ = (session: ReturnType<typeof as>, sql: string, params: unknown[] = []) =>
  db.withClubTx({ clubId: A, userId: session.userId, roles: session.roles as never, source: 'admin' }, (tx) => tx.query(sql, params));

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  await person(A, OWNER, ['owner', 'player'], 'Owner');
  await person(A, DESK, ['front_desk', 'player'], 'Desk');
  await person(A, ACC, ['accountant', 'player'], 'Acc');
  await person(A, ANN, ['player'], 'Ann');
  db = createDb({ connectionString: tdb.url, max: 4 });
  routes = auditRoutes({ db, clubBySlug: async (slug) => (slug === 'club-a' ? { clubId: A } : slug === 'club-b' ? { clubId: B } : null) });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('GET /staff/audit (owner)', () => {
  it('lists newest first, filters by staff, record type, record and day; front desk, accountant and guest are refused', async () => {
    await as_(desk(), `select app.customer_tag_set($1, 'VIP', true)`, [ANN]);
    await tdb.setNow('2026-12-02T03:00:00Z');
    await as_(owner(), `select app.customer_tag_set($1, 'Junior', true)`, [ANN]);
    const all = (await call('GET', '/staff/audit', owner(), { type: 'customer_tag' })).body.entries;
    expect(all.map((e: { actorUserId: string }) => e.actorUserId)).toEqual([OWNER, DESK]);
    expect(all[0]).toMatchObject({ action: expect.any(String), recordType: 'customer_tag', source: 'admin' });
    expect((await call('GET', '/staff/audit', owner(), { staff: DESK, type: 'customer_tag' })).body.entries).toHaveLength(1);
    expect((await call('GET', '/staff/audit', owner(), { type: 'customer_tag', from: '2026-12-02', to: '2026-12-02' })).body.entries).toHaveLength(1);
    expect((await call('GET', '/staff/audit', owner(), { type: 'customer_tag', from: '2026-12-03' })).body.entries).toHaveLength(0);
    for (const s of [desk(), as(ACC, ['accountant', 'player']), as(ANN, ['player'])]) expect(await call('GET', '/staff/audit', s)).toMatchObject({ ok: false, status: 403 });
    expect(await call('GET', '/staff/audit', null)).toMatchObject({ ok: false, status: 401 });
  });
  it('shows the names of personal fields that changed, never their values', async () => {
    await as_(owner(), `update public.app_user set date_of_birth = '1991-03-03' where id = $1`, [ANN]);
    const e = (await call('GET', '/staff/audit', owner(), { type: 'app_user', record: ANN })).body.entries;
    expect(e.length).toBeGreaterThan(0);
    expect(e.some((x: { piiFields: string[] }) => x.piiFields.includes('date_of_birth'))).toBe(true);
    expect(JSON.stringify(e)).not.toContain('1991-03-03');
  });
  it('pages with a cursor, each entry once; a bad filter or cursor is bad input; another club slug is not found', async () => {
    for (let i = 0; i < 55; i++) await as_(owner(), `select app.customer_tag_set($1, $2, true)`, [ANN, `t${i}`]);
    const p1 = (await call('GET', '/staff/audit', owner(), { type: 'customer_tag' })).body;
    expect(p1.entries).toHaveLength(50);
    const p2 = (await call('GET', '/staff/audit', owner(), { type: 'customer_tag', cursor: p1.next })).body;
    expect(p2.entries).toHaveLength(5);
    expect(new Set([...p1.entries, ...p2.entries].map((e: { entryId: string }) => e.entryId)).size).toBe(55);
    for (const q of [{ staff: 'x' }, { from: 'x' }, { type: 'a b' }, { cursor: 'zz' }, { from: '2026-12-05', to: '2026-12-01' }]) {
      expect(await call('GET', '/staff/audit', owner(), q), JSON.stringify(q)).toMatchObject({ ok: false, status: 400 });
    }
    expect(await call('GET', '/staff/audit', owner(), { slug: 'club-b' })).toMatchObject({ ok: false, status: 404 });
  });
  it('there is no route that writes or deletes a log entry', () => {
    expect(routes.every((r) => r.def.method === 'GET')).toBe(true);
  });
});

describe('GET /staff/bookings/:id/history', () => {
  async function booking() {
    await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
    await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, C1, LOC]);
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, ANN])).rows[0].id as string;
    const b = (await tdb.query(
      `insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
       values ($1,$2,'court',$3,'2026-12-05T10:00:00+07:00','2026-12-05T11:00:00+07:00',$4,'confirmed','online',$4, app.now()) returning id`, [A, order, C1, ANN])).rows[0].id as string;
    return { b, order };
  }
  it('front desk and owner read changes and cancel rows, newest first; the accountant and a player are refused', async () => {
    const { b, order } = await booking();
    await tdb.query(`update public.booking set status = 'cancelled' where id = $1`, [b]);
    await tdb.query(`insert into public.booking_cancel (club_id, booking_id, order_id, kind, outcome, version, reason, by_user) values ($1,$2,$3,'staff_cancel','returned',1,'asked by phone',$4)`, [A, b, order, DESK]);
    for (const s of [desk(), owner()]) {
      const r = await call('GET', '/staff/bookings/:id/history', s, { id: b });
      expect(r.ok).toBe(true);
      expect(r.body.map((x: { kind: string }) => x.kind)).toEqual(expect.arrayContaining(['audit', 'cancel']));
      expect(r.body.find((x: { kind: string }) => x.kind === 'cancel')).toMatchObject({ action: 'staff_cancel', actor: 'Desk', reason: 'asked by phone', detail: { outcome: 'returned', version: 1 } });
    }
    expect(await call('GET', '/staff/bookings/:id/history', as(ACC, ['accountant', 'player']), { id: b })).toMatchObject({ ok: false, status: 403 });
    expect(await call('GET', '/staff/bookings/:id/history', as(ANN, ['player']), { id: b })).toMatchObject({ ok: false, status: 403 });
  });
  it('an unknown or malformed booking id is 404', async () => {
    for (const id of ['99999999-9999-4999-8999-999999999999', 'nope']) expect(await call('GET', '/staff/bookings/:id/history', desk(), { id })).toMatchObject({ ok: false, status: 404 });
  });
});
