import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { calendarRoutes } from './routes';

// F11-T03: GET /staff/calendar (ADMIN-03; BOOK-04).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const OWNER = '44444444-4444-4444-8444-444444444444';
const DESK = '33333333-3333-4333-8333-333333333333';
const ACC = '55555555-5555-4555-8555-555555555555';
const PLAYER = '22222222-2222-4222-8222-222222222222';
const deps = { hasFeature: async () => true };
let tdb: TestDatabase;
let db: Db;
let routes: ReturnType<typeof calendarRoutes>;

type Roles = ('owner' | 'front_desk' | 'accountant' | 'player')[];
const as = (userId: string, roles: Roles) => ({ clubId: A, userId, roles });
const owner = () => as(OWNER, ['owner', 'player']);
const get = (session: ReturnType<typeof as> | null, input: Record<string, unknown> = {}) =>
  routes[0]!.handle({ session, input: { slug: 'club-a', from: '2026-12-02', to: '2026-12-02', ...input } }, deps) as Promise<{ ok: boolean; status: number; code?: string; body?: Record<string, unknown>[] }>;
const H = (h: number, day = 2) => new Date(`2026-12-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();

async function person(id: string, roles: string[], name: string) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, display_name, phone, phone_normalized) values ($1,$2,$3,$4,'+66811111111','66811111111')`, [A, id, 'L' + id, name]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [A, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
async function court(h: number, o: { resource?: string; held?: 'live' | 'expired'; coach?: string; day?: number } = {}) {
  const day = o.day ?? 2;
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, PLAYER])).rows[0].id as string;
  const res = o.resource ?? C1;
  const held = o.held !== undefined;
  const hold = o.held === 'live' ? `app.now() + interval '10 minutes'` : o.held === 'expired' ? `app.now() - interval '5 minutes'` : 'null';
  const b = (await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, coach_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at, hold_expires_at)
     values ($1,$2,$8,$3,$9,$4,$5,$6,$7,'online',$6, ${held ? 'null' : 'app.now()'}, ${hold}) returning id`,
    [A, order, res, H(h, day), H(h + 1, day), PLAYER, held ? 'awaiting_payment' : 'confirmed', o.coach ? 'solo_class' : 'court', o.coach ?? null])).rows[0].id as string;
  await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, hold_expires_at, booking_id) values ($1,$8,$2,$7,$3,$4,$5,${hold},$6)`,
    [A, res, H(h, day), H(h + 1, day), held ? 'held' : 'confirmed', b, o.coach ?? null, o.coach ? 'solo_class' : 'court_booking']);
  return b;
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'Court 1','tennis'), ($1,$4,$3,'Court 2','tennis')`, [A, C1, LOC, C2]);
  await person(OWNER, ['owner', 'player'], 'Owner');
  await person(DESK, ['front_desk', 'player'], 'Desk');
  await person(ACC, ['accountant', 'player'], 'Acc');
  await person(PLAYER, ['player'], 'Pat Player');
  await tdb.seedCoach(A, COACH);
  await tdb.query(`update public.app_user set display_name = 'Coach One' where id = $1`, [COACH]);
  db = createDb({ connectionString: tdb.url, max: 4 });
  routes = calendarRoutes({ db, clubBySlug: async (slug) => (slug === 'club-a' ? { clubId: A } : slug === 'club-b' ? { clubId: B } : null) });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('GET /staff/calendar', () => {
  it('front desk and owner see the day: confirmed, held, solo class and closure cells with names only', async () => {
    const b = await court(10);
    await court(11, { resource: C2, held: 'live' });
    await court(12, { coach: COACH });
    const cl = await tdb.seedClosure(A);
    await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, closure_id) values ($1,'closure',$2,$3,$4,'confirmed',$5)`, [A, C2, H(14), H(15), cl]);
    for (const s of [owner(), as(DESK, ['front_desk', 'player'])]) {
      const r = await get(s);
      expect(r.ok).toBe(true);
      const cells = r.body!;
      expect(cells.map((c) => c['kind'])).toEqual(['court_booking', 'court_booking', 'solo_class', 'closure']);
      expect(cells[0]).toMatchObject({ bookingId: b, customerName: 'Pat Player', resourceName: 'Court 1', state: 'confirmed', bookingStatus: 'confirmed' });
      expect(cells[1]).toMatchObject({ state: 'held', bookingStatus: 'awaiting_payment', resourceName: 'Court 2' });
      expect(cells[2]).toMatchObject({ coachName: 'Coach One' });
      expect(cells[3]).toMatchObject({ closureId: cl });
      expect(JSON.stringify(cells)).not.toMatch(/811111111|phone|date_of_birth|dateOfBirth/i);
    }
  });
  it('an expired hold is not a cell; days outside the range are not returned', async () => {
    await court(10, { resource: C2, held: 'expired' });
    await court(10);
    await court(9, { day: 5 });
    const r = await get(owner());
    expect(r.body!).toHaveLength(1);
    expect(r.body![0]).toMatchObject({ state: 'confirmed', resourceName: 'Court 1' });
    expect((await get(owner(), { to: '2026-12-05' })).body!).toHaveLength(2);
  });
  it('a range over 7 days, a bad date or an inverted range is bad input', async () => {
    for (const q of [{ to: '2026-12-09' }, { from: 'x' }, { from: '2026-12-05', to: '2026-12-02' }]) {
      expect(await get(owner(), q), JSON.stringify(q)).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
    }
    expect((await get(owner(), { to: '2026-12-08' })).ok).toBe(true);
  });
  it('the accountant, a player and a guest are refused; another club slug is not found', async () => {
    expect(await get(as(ACC, ['accountant', 'player']))).toMatchObject({ ok: false, status: 403 });
    expect(await get(as(PLAYER, ['player']))).toMatchObject({ ok: false, status: 403 });
    expect(await get(null)).toMatchObject({ ok: false, status: 401 });
    expect(await get(owner(), { slug: 'club-b' })).toMatchObject({ ok: false, status: 404 });
  });
});
