import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { playerBookingRoutes, publicScheduleRoutes, staffBookingRoutes } from './routes';

// F03-T20 public schedule routes (BOOK-01-AC6, AC14, BOOK-02-AC1, AC2, AC5; design 5.1): thin handlers
// over the schedule service. The service's states are tested in packages/domain/src/booking/schedule.test.ts.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURT1 = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT2 = 'c2c2c2c2-0000-4000-8000-000000000002';
const P1 = '00000000-0000-4000-8000-000000000001';
const P2 = '00000000-0000-4000-8000-000000000002';
const deps = { hasFeature: async () => true };
const SLUGS: Record<string, string> = { 'club-a': A, 'club-b': B };

let tdb: TestDatabase;
let db: Db;
let routes: ReturnType<typeof publicScheduleRoutes>;
const find = (path: string) => routes.find((r) => r.def.path === path)!;
const at = (date: string, h: number) => new Date(`${date}T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, COURT1, LOC]);
  for (let d = 1; d <= 7; d += 1) await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [A, d]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [A]);
  db = createDb({ connectionString: tdb.url, max: 2 });
  routes = publicScheduleRoutes({ db, clubBySlug: async (slug) => (SLUGS[slug] ? { clubId: SLUGS[slug]! } : null) });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('public schedule routes', () => {
  it('declares GET /courts, /schedule/days and /schedule as public, each answered with no-store', () => {
    expect(routes.map((r) => `${r.def.method} ${r.def.path}`)).toEqual(['GET /courts', 'GET /schedule/days', 'GET /schedule']);
    for (const r of routes) {
      expect(r.def.public).toBe(true);
      expect(r.def.permission).toBeUndefined();
      expect(r.headers).toEqual({ 'Cache-Control': 'no-store' });
    }
  });

  it('a guest with no session opens C4: courts, the date strip and a day (BOOK-02-AC1, AC2, AC5)', async () => {
    const courts = await find('/courts').handle({ session: null, input: { slug: 'club-a' } }, deps);
    expect(courts).toMatchObject({ ok: true, body: { bookingWindowDays: 30, courts: [{ id: COURT1, name: '1', sport: 'tennis' }] } });
    const days = await find('/schedule/days').handle({ session: null, input: { slug: 'club-a', from: '2026-12-01', to: '2026-12-02' } }, deps);
    expect(days).toMatchObject({ ok: true, body: { days: [{ date: '2026-12-01' }, { date: '2026-12-02', courts: [{ id: COURT1, openHours: 18 }], dayFull: false }] } });
    const day = await find('/schedule').handle({ session: null, input: { slug: 'club-a', date: '2026-12-02' } }, deps);
    expect(day.ok).toBe(true);
  });

  it('a signed in player gets My booking; the same slot is Taken for a guest', async () => {
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id as string;
    await db.withClubTx({ clubId: A, userId: P1, roles: ['player'], requestId: 'r', source: 'player_app' }, (tx) =>
      tx.query(`select app.reserve_court($1, $2, $3::timestamptz[])`, [order, COURT1, [at('2026-12-02', 18)]]));
    const state = async (session: { clubId: string; userId: string; roles: ['player'] } | null) => {
      const r = await find('/schedule').handle({ session, input: { slug: 'club-a', date: '2026-12-02' } }, deps);
      if (!r.ok) throw new Error(r.code);
      return (r.body as { courts: Array<{ hours: Array<{ start: string; state: string }> }> }).courts[0]!.hours.find((h) => h.start === '2026-12-02T18:00:00+07:00')!.state;
    };
    expect(await state({ clubId: A, userId: P1, roles: ['player'] })).toBe('mine');
    expect(await state(null)).toBe('held');
  });

  it('an unknown slug, a malformed slug and a session of another club are not found', async () => {
    expect(await find('/courts').handle({ session: null, input: { slug: 'nope' } }, deps)).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(await find('/courts').handle({ session: null, input: { slug: 'Club A!' } }, deps)).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(await find('/courts').handle({ session: null, input: {} }, deps)).toEqual({ ok: false, status: 404, code: 'not_found' });
    const other = { clubId: B, userId: P1, roles: ['player' as const] };
    expect(await find('/schedule').handle({ session: other, input: { slug: 'club-a', date: '2026-12-02' } }, deps)).toEqual({ ok: false, status: 404, code: 'not_found' });
  });

  it('a Draft club is not found; a date out of range or malformed is a typed code', async () => {
    expect(await find('/schedule').handle({ session: null, input: { slug: 'club-a', date: '2027-01-01' } }, deps)).toEqual({ ok: false, status: 400, code: 'outside_window' });
    expect(await find('/schedule').handle({ session: null, input: { slug: 'club-a', date: '2026-11-30' } }, deps)).toEqual({ ok: false, status: 400, code: 'in_the_past' });
    expect(await find('/schedule').handle({ session: null, input: { slug: 'club-a' } }, deps)).toEqual({ ok: false, status: 400, code: 'bad_input' });
    await tdb.query(`update public.club set status = 'draft' where id = $1`, [A]);
    expect(await find('/schedule').handle({ session: null, input: { slug: 'club-a', date: '2026-12-02' } }, deps)).toEqual({ ok: false, status: 404, code: 'not_found' });
  });
});

describe('player booking routes (F03-T21)', () => {
  let player: ReturnType<typeof playerBookingRoutes>;
  const get = () => player.find((r) => r.def.path === '/bookings/:id')!;
  const release = () => player.find((r) => r.def.path === '/bookings/:id/release')!;
  const me = (userId = P1) => ({ clubId: A, userId, roles: ['player' as const] });
  async function hold(confirm = false, hour = 18) {
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id as string;
    const r = await db.withClubTx({ clubId: A, userId: P1, roles: ['player'], requestId: 'r', source: 'player_app' }, (tx) =>
      tx.query<{ r: { booking_ids: string[] } }>(`select app.reserve_court($1, $2, $3::timestamptz[]) as r`, [order, COURT1, [at('2026-12-02', hour)]]));
    if (confirm) await db.withClubTx({ clubId: A, userId: P2, roles: ['owner', 'player'], requestId: 'r', source: 'admin' }, (tx) => tx.query(`select app.confirm_booking($1)`, [order]));
    return { order, id: r.rows[0]!.r.booking_ids[0]! };
  }
  beforeEach(() => {
    player = playerBookingRoutes({ db, clubBySlug: async (slug) => (SLUGS[slug] ? { clubId: SLUGS[slug]! } : null) });
  });

  it('declares GET /bookings/:id (booking.read.own) and POST /bookings/:id/release (a signed in person)', async () => {
    expect(player.map((r) => `${r.def.method} ${r.def.path}`)).toEqual(['GET /bookings/:id', 'POST /bookings/:id/release']);
    expect(get().def.permission).toBe('booking.read.own');
    expect(release().def.needsPerson).toBe(true);
    const { id } = await hold();
    expect(await get().handle({ session: null, input: { id } }, deps)).toEqual({ ok: false, status: 401, code: 'unauthenticated' });
    expect(await release().handle({ session: null, input: { id } }, deps)).toEqual({ ok: false, status: 401, code: 'sign_in_required' });
  });

  it("the player reads their own booking; another player's is 404 (ROLE-01-AC4)", async () => {
    const { id } = await hold();
    expect(await get().handle({ session: me(), input: { slug: 'club-a', id } }, deps)).toMatchObject({ ok: true, body: { id, status: 'awaiting_payment', holdEnded: false } });
    expect(await get().handle({ session: me(P2), input: { id } }, deps)).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(await get().handle({ session: me(), input: { slug: 'club-b', id } }, deps)).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(await get().handle({ session: me(), input: { id: 'not-a-uuid' } }, deps)).toEqual({ ok: false, status: 404, code: 'not_found' });
  });

  it('releasing a confirmed booking is refused; releasing a hold works', async () => {
    const confirmed = await hold(true);
    expect(await release().handle({ session: me(), input: { id: confirmed.id } }, deps)).toEqual({ ok: false, status: 409, code: 'not_releasable' });
    const { order, id } = await hold(false, 19);
    expect(await release().handle({ session: me(P2), input: { id } }, deps)).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(await release().handle({ session: me(), input: { id } }, deps)).toEqual({ ok: true, status: 200, body: { orderId: order, status: 'released' } });
  });

  it('the same Idempotency-Key gets the same answer; reused for another request it is refused', async () => {
    const { order, id } = await hold();
    const first = await release().handle({ session: me(), input: { id, idempotencyKey: 'k-1' } }, deps);
    expect(first).toEqual({ ok: true, status: 200, body: { orderId: order, status: 'released' } });
    expect(await release().handle({ session: me(), input: { id, idempotencyKey: 'k-1' } }, deps)).toEqual(first);
    expect(await release().handle({ session: me(), input: { id: order, idempotencyKey: 'k-1' } }, deps)).toEqual({ ok: false, status: 409, code: 'idempotency_key_reused' });
    expect(await release().handle({ session: me(), input: { id, idempotencyKey: 'bad key' } }, deps)).toEqual({ ok: false, status: 400, code: 'bad_input' });
  });
});

describe('staff booking routes (F03-T22 move and release)', () => {
  let staff: ReturnType<typeof staffBookingRoutes>;
  const move = () => staff.find((r) => r.def.path === '/staff/bookings/:id/move')!;
  const release = () => staff.find((r) => r.def.path === '/staff/bookings/:id/release')!;
  const DESK = '00000000-0000-4000-8000-0000000000d1';
  const OWNER = '00000000-0000-4000-8000-0000000000e1';
  const as = (userId: string, ...roles: Array<'player' | 'front_desk' | 'owner' | 'accountant' | 'coach'>) => ({ clubId: A, userId, roles });
  async function book(hour: number, customer = P1, confirm = true) {
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id as string;
    const r = await db.withClubTx({ clubId: A, userId: customer, roles: ['player'], requestId: 'r', source: 'player_app' }, (tx) =>
      tx.query<{ r: { booking_ids: string[] } }>(`select app.reserve_court($1, $2, $3::timestamptz[]) as r`, [order, COURT1, [at('2026-12-02', hour)]]));
    if (confirm) await db.withClubTx({ clubId: A, userId: DESK, roles: ['front_desk', 'player'], requestId: 'r', source: 'admin' }, (tx) => tx.query(`select app.confirm_booking($1)`, [order]));
    return { order, id: r.rows[0]!.r.booking_ids[0]! };
  }
  beforeEach(async () => {
    await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'2','tennis')`, [A, COURT2, LOC]);
    staff = staffBookingRoutes({ db, clubBySlug: async (slug) => (SLUGS[slug] ? { clubId: SLUGS[slug]! } : null) });
  });

  it('front desk and owner only: a guest is 401; a player, coach or accountant is 403', async () => {
    expect(staff.map((r) => `${r.def.method} ${r.def.path}`)).toEqual(['PUT /staff/bookings/:id/move', 'POST /staff/bookings/:id/release']);
    const { id } = await book(18, P1, false);
    expect(move().def.permission).toBe('booking.move');
    expect(release().def.permission).toBe('booking.create.staff');
    for (const r of staff) {
      expect(await r.handle({ session: null, input: { id } }, deps)).toEqual({ ok: false, status: 401, code: 'unauthenticated' });
      for (const s of [as(P1, 'player'), as(P2, 'coach', 'player'), as(P2, 'accountant', 'player')]) {
        expect(await r.handle({ session: s, input: { id, courtId: COURT2, start: '2026-12-02T20:00:00+07:00' } }, deps)).toEqual({ ok: false, status: 403, code: 'forbidden' });
      }
    }
    expect((await tdb.query(`select status from public.booking where id = $1`, [id])).rows[0].status).toBe('awaiting_payment');
  });

  it('front desk moves a booking; a conflict is 409 slot_unavailable and nothing changes (BOOK-04-AC7)', async () => {
    const { id } = await book(18);
    await book(19, P2);
    expect(await move().handle({ session: as(DESK, 'front_desk', 'player'), input: { id, courtId: COURT1, start: '2026-12-02T19:00:00+07:00' } }, deps)).toEqual({ ok: false, status: 409, code: 'slot_unavailable', params: { by: 'resource' } });
    const ok = await move().handle({ session: as(DESK, 'front_desk', 'player'), input: { slug: 'club-a', id, courtId: COURT2, start: '2026-12-02T19:00:00+07:00' } }, deps);
    expect(ok).toMatchObject({ ok: true, body: { id, court: { id: COURT2 }, start: '2026-12-02T19:00:00+07:00' } });
  });

  it('front desk abandons an awaiting booking; a confirmed one is 409 not_releasable', async () => {
    const held = await book(18, P1, false);
    const done = await book(20, P2);
    expect(await release().handle({ session: as(DESK, 'front_desk', 'player'), input: { id: done.id } }, deps)).toEqual({ ok: false, status: 409, code: 'not_releasable' });
    expect(await release().handle({ session: as(DESK, 'front_desk', 'player'), input: { id: held.id, idempotencyKey: 's-1' } }, deps)).toEqual({ ok: true, status: 200, body: { orderId: held.order, status: 'released' } });
    expect(await release().handle({ session: as(DESK, 'front_desk', 'player'), input: { id: held.id, idempotencyKey: 's-1' } }, deps)).toEqual({ ok: true, status: 200, body: { orderId: held.order, status: 'released' } });
  });

  it('in a Paused club front desk and the owner can still move and release existing bookings (D107)', async () => {
    const held = await book(18, P1, false);
    const done = await book(20, P2);
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    const desk = as(DESK, 'front_desk', 'player');
    const owner = as(OWNER, 'owner', 'player');
    expect(await move().handle({ session: desk, input: { id: done.id, courtId: COURT2, start: '2026-12-02T21:00:00+07:00' } }, deps)).toMatchObject({ ok: true });
    expect(await move().handle({ session: owner, input: { id: done.id, courtId: COURT1, start: '2026-12-02T22:00:00+07:00' } }, deps)).toMatchObject({ ok: true });
    expect(await release().handle({ session: desk, input: { id: held.id } }, deps)).toMatchObject({ ok: true, body: { status: 'released' } });
  });
});
