import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { playerCoachRoutes, publicCoachRoutes } from './routes';

// F07-T11: public and player coach routes (COACH-01, R1-AC1 to AC8, COACH-02-AC1, AC4, COACH-03-AC3, CC-2, CC-3, CC-5).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const NOPRICE = 'e1e1e1e1-0000-4000-8000-000000000008';
const HIDDEN = 'e3e3e3e3-0000-4000-8000-000000000006';
const BCOACH = 'e2e2e2e2-0000-4000-8000-000000000007';
const OWNER = '44444444-4444-4444-8444-444444444444';
const PLAYER = '22222222-2222-4222-8222-222222222222';
const OTHER = '11111111-1111-4111-8111-111111111111';
const TIER = '66666666-6666-4666-8666-666666666661';
const GROUP = '77777777-7777-4777-8777-777777777771';
const deps = { hasFeature: async () => true };
const SLUGS: Record<string, string> = { 'club-a': A, 'club-b': B };
let tdb: TestDatabase;
let db: Db;
let pub: ReturnType<typeof publicCoachRoutes>;
let player: ReturnType<typeof playerCoachRoutes>;

const H = (h: number, day = 2) => new Date(`2026-12-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();
const find = (list: { def: { method: string; path: string } }[], method: string, path: string) => list.find((r) => r.def.method === method && r.def.path === path)! as ReturnType<typeof publicCoachRoutes>[number];
const me = (userId: string) => ({ clubId: A, userId, roles: ['player' as const] });
const call = (list: typeof pub, method: string, path: string, session: ReturnType<typeof me> | null, input: Record<string, unknown> = {}, body?: unknown) =>
  find(list, method, path).handle({ session, input: { slug: 'club-a', ...input }, body }, deps);
const refused = async (p: Promise<{ ok: boolean; status: number; code?: string; params?: unknown }>) => {
  const r = await p;
  return r.ok ? null : { status: r.status, code: r.code, params: r.params };
};
const ok = async <T>(p: Promise<{ ok: boolean; body?: T }>): Promise<T> => {
  const r = await p;
  expect(r.ok).toBe(true);
  return r.body as T;
};

async function person(id: string, roles: string[], dob: string | null = '1990-01-01') {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, date_of_birth) values ($1,$2,$3,$4)`, [A, id, 'L' + id, dob]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [A, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
async function courtBooking(h: number, customer = PLAYER, resource = C1) {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id as string;
  const b = (await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
     values ($1,$2,'court',$3,$4,$5,$6,'confirmed','online',$6, app.now()) returning id`, [A, order, resource, H(h), H(h + 1), customer])).rows[0].id as string;
  await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, booking_id) values ($1,'court_booking',$2,$3,$4,'confirmed',$5)`, [A, resource, H(h), H(h + 1), b]);
  return b;
}
async function coachBusy(h: number, coach = COACH) {
  const o = await courtBooking(h, OTHER, C2);
  await tdb.query(`update public.booking set coach_id = $2, type = 'solo_class' where id = $1`, [o, coach]);
  await tdb.query(`update public.occupancy set coach_id = $2, kind = 'solo_class' where booking_id = $1`, [o, coach]);
}
async function addOrder(customer = PLAYER) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    const r = await c.query(
      `insert into public.orders (club_id, customer_id, source, status, price_group_snapshot, subtotal_satang, discount_satang, total_satang, credit_value_satang, wallet_satang, money_satang, quote_hash, priced_at)
       values ($1,$2,'online','open','{}'::jsonb,0,0,0,0,0,0,repeat('a',64), app.now()) returning id`, [A, customer]);
    await c.query('commit');
    return r.rows[0].id as string;
  } finally {
    c.release();
  }
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($1,$4,$3,'2','tennis')`, [A, C1, LOC, C2]);
  await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) select $1, d, '06:00', '24:00' from generate_series(1, 7) d`, [A]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [A]);
  await person(OWNER, ['owner', 'player'], null);
  await person(PLAYER, ['player']);
  await person(OTHER, ['player']);
  await tdb.query(`insert into public.price_group (club_id, id, name_th, name_en, rule) values ($1,$2,'ผู้ใหญ่','Adult','{"min_age":18}')`, [A, GROUP]);
  await tdb.query(`insert into public.coach_tier (club_id, id, name_th, name_en) values ($1,$2,'ท','Tier')`, [A, TIER]);
  await tdb.query(`insert into public.coach_tier_price (club_id, tier_id, price_group_id, price_satang) values ($1,$2,$3,100000)`, [A, TIER, GROUP]);
  for (const id of [COACH, NOPRICE, HIDDEN]) await tdb.seedCoach(A, id);
  await tdb.seedCoach(B, BCOACH);
  await tdb.query(`update public.coach set tier_id = $1 where id = $2`, [TIER, COACH]);
  await tdb.query(`update public.app_user set display_name = 'Coach One' where id = $1`, [COACH]);
  await tdb.query(`update public.coach set published = true, profile_consent_at = app.now(), profile_consent_by = $2, bio_en = 'Bio' where id = any($1) and club_id = $3`, [[COACH, NOPRICE], OWNER, A]);
  db = createDb({ connectionString: tdb.url, max: 6 });
  const d = { db, clubBySlug: async (slug: string) => (SLUGS[slug] ? { clubId: SLUGS[slug]! } : null) };
  pub = publicCoachRoutes(d);
  player = playerCoachRoutes(d);
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('GET /coaches', () => {
  it('a guest sees published coaches with public fields only, and an unset price as null (R1-AC6, CC-3, COACH-02-AC4)', async () => {
    const list = (await ok(call(pub, 'GET', '/coaches', null))) as { coachId: string; priceSatang: number | null }[];
    expect(list.map((c) => c.coachId).sort()).toEqual([COACH, NOPRICE].sort());
    expect(list.find((c) => c.coachId === COACH)!.priceSatang).toBe(100000);
    expect(list.find((c) => c.coachId === NOPRICE)!.priceSatang).toBeNull();
    expect(JSON.stringify(list)).not.toMatch(/leave|notes|pay|consent|profile_consent/i);
    expect(Object.keys(list[0]!)).not.toContain('active');
  });
  it('a Paused club answers club_paused (R1-AC8)', async () => {
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    expect(await refused(call(pub, 'GET', '/coaches', null))).toMatchObject({ status: 409, code: 'club_paused' });
  });
  it('another club slug or an unknown slug is not found', async () => {
    expect(await refused(call(pub, 'GET', '/coaches', me(PLAYER), { slug: 'club-b' }))).toMatchObject({ status: 404, code: 'not_found' });
    expect(await refused(call(pub, 'GET', '/coaches', null, { slug: 'nope' }))).toMatchObject({ status: 404 });
  });
});

describe('GET /coaches/:id', () => {
  it('a published coach is found with the caller price', async () => {
    const c = (await ok(call(pub, 'GET', '/coaches/:id', me(PLAYER), { id: COACH }))) as { displayName: string; priceSatang: number };
    expect(c).toMatchObject({ displayName: 'Coach One', priceSatang: 100000 });
  });
  it('a hidden, unpublished, other-club or malformed id is not found (CC-2, CC-3)', async () => {
    for (const id of [HIDDEN, BCOACH, 'not-a-uuid']) {
      expect(await refused(call(pub, 'GET', '/coaches/:id', null, { id }))).toMatchObject({ status: 404, code: 'not_found' });
    }
    await tdb.query(`update public.coach set active = false where id = $1`, [COACH]);
    expect(await refused(call(pub, 'GET', '/coaches/:id', null, { id: COACH }))).toMatchObject({ status: 404 });
  });
});

describe('GET /coaches/:id/times', () => {
  it('lists open hours with the court name; a bad range is bad input (R1-AC2)', async () => {
    const t = (await ok(call(pub, 'GET', '/coaches/:id/times', null, { id: COACH, from: '2026-12-02', to: '2026-12-02' }))) as { startAt: string; state: string; courtName: string }[];
    expect(t.length).toBeGreaterThan(0);
    expect(t[0]).toMatchObject({ state: 'open', courtName: '1' });
    expect(await refused(call(pub, 'GET', '/coaches/:id/times', null, { id: COACH, from: '2026-12-03', to: '2026-12-02' }))).toMatchObject({ status: 400, code: 'bad_input' });
    expect(await refused(call(pub, 'GET', '/coaches/:id/times', null, { id: COACH, from: '2026-12-01', to: '2027-02-01' }))).toMatchObject({ status: 400 });
  });
  it('an hour taken by a court booking shows no_court_open when every court is taken (R1-AC3)', async () => {
    await courtBooking(10, OTHER, C1);
    await courtBooking(10, OTHER, C2);
    const t = (await ok(call(pub, 'GET', '/coaches/:id/times', null, { id: COACH, from: '2026-12-02', to: '2026-12-02' }))) as { startAt: string; state: string }[];
    expect(t.find((x) => x.startAt === H(10))!.state).toBe('no_court_open');
  });
  it('a hidden coach is not found', async () => {
    expect(await refused(call(pub, 'GET', '/coaches/:id/times', null, { id: HIDDEN, from: '2026-12-02', to: '2026-12-02' }))).toMatchObject({ status: 404 });
  });
});

describe('GET /coaches/offerable', () => {
  it('lists the free published coaches for the hours and is not read as an id (COACH-01-AC7)', async () => {
    const list = (await ok(call(pub, 'GET', '/coaches/offerable', null, { starts: `${H(10)},${H(11)}` }))) as { coachId: string }[];
    expect(list.map((c) => c.coachId).sort()).toEqual([COACH, NOPRICE].sort());
  });
  it('a coach busy in one hour is not offered', async () => {
    await coachBusy(11);
    const list = (await ok(call(pub, 'GET', '/coaches/offerable', null, { starts: `${H(10)},${H(11)}` }))) as { coachId: string }[];
    expect(list.map((c) => c.coachId)).toEqual([NOPRICE]);
  });
  it('rejects missing, off the hour and too many hours', async () => {
    expect(await refused(call(pub, 'GET', '/coaches/offerable', null, {}))).toMatchObject({ status: 400, code: 'bad_input' });
    expect(await refused(call(pub, 'GET', '/coaches/offerable', null, { starts: '2026-12-02T10:30:00+07:00' }))).toMatchObject({ status: 400 });
    expect(await refused(call(pub, 'GET', '/coaches/offerable', null, { starts: Array.from({ length: 25 }, (_, i) => H(6 + (i % 17), 2 + Math.floor(i / 17))).join(',') }))).toMatchObject({ status: 400 });
  });
});

describe('POST /bookings/:id/coach', () => {
  it('adds the coach to the caller own booking (COACH-03-AC3)', async () => {
    const b = await courtBooking(10);
    const order = await addOrder();
    expect(await ok(call(player, 'POST', '/bookings/:id/coach', me(PLAYER), { id: b }, { coachId: COACH, orderId: order }))).toEqual({ ok: true });
    expect((await tdb.query(`select type, coach_id from public.booking where id = $1`, [b])).rows[0]).toMatchObject({ type: 'solo_class', coach_id: COACH });
  });
  it("another player's booking is not found; a guest needs sign in", async () => {
    const b = await courtBooking(10);
    const order = await addOrder(OTHER);
    expect(await refused(call(player, 'POST', '/bookings/:id/coach', me(OTHER), { id: b }, { coachId: COACH, orderId: order }))).toMatchObject({ status: 404, code: 'booking_not_found' });
    expect(await refused(call(player, 'POST', '/bookings/:id/coach', null, { id: b }, { coachId: COACH, orderId: order }))).toMatchObject({ status: 401 });
  });
  it('a busy coach answers coach_unavailable and writes nothing (CC-4)', async () => {
    await coachBusy(12);
    const b = await courtBooking(12);
    const order = await addOrder();
    expect(await refused(call(player, 'POST', '/bookings/:id/coach', me(PLAYER), { id: b }, { coachId: COACH, orderId: order }))).toMatchObject({ status: 409, code: 'coach_unavailable' });
    expect((await tdb.query(`select coach_id from public.booking where id = $1`, [b])).rows[0].coach_id).toBeNull();
  });
  it('the rest rule answers rest_rule with the cap as hours (R3)', async () => {
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'rest_cap_hours','2') on conflict (club_id, key) do update set value = '2'`, [A]);
    await coachBusy(10);
    await coachBusy(11);
    const b = await courtBooking(12);
    const order = await addOrder();
    expect(await refused(call(player, 'POST', '/bookings/:id/coach', me(PLAYER), { id: b }, { coachId: COACH, orderId: order }))).toMatchObject({ status: 409, code: 'rest_rule', params: { hours: 2 } });
  });
  it('bad input: missing ids', async () => {
    const b = await courtBooking(10);
    expect(await refused(call(player, 'POST', '/bookings/:id/coach', me(PLAYER), { id: b }, {}))).toMatchObject({ status: 400, code: 'bad_input' });
  });
});
