import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F07-T06 / migration 0806: Add a coach to an existing booking, the add order's hold and release, and the
// two-hour solo class (COACH-03, R5-AC1, AC2, R6-AC1 to AC3, BOOK-04-AC2, AC3, D111).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const COACH2 = 'e1e1e1e1-0000-4000-8000-000000000008';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
let tdb: TestDatabase;
let db: Db;
let dbw: Db;   // booq_worker: where the payment callback and the hold job run

/** 2026-12-02 is a Wednesday; the club clock is 2026-12-01 10:00 Bangkok. */
const H = (h: number, day = 2) => new Date(`2026-12-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();
const ctx = (user: string | null, roles: string[], role?: string) => ({ clubId: A, userId: user, roles: roles as never, source: (role ?? 'player_app') as never });
const player = (u = PLAYER) => ctx(u, ['player']);
const desk = () => ctx(DESK, ['front_desk', 'player'], 'admin');
const run = async <T>(c: ReturnType<typeof ctx>, sql: string, params: unknown[] = []) => db.withClubTx(c, async (tx) => (await tx.query(sql, params)).rows as T[]);

type Out = { ok: true } | { ok: false; code: string; detail?: string | undefined };
async function attempt(fn: () => Promise<unknown>): Promise<Out> {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string; message: string; detail?: string };
    if (err.code === 'BK001') return { ok: false, code: err.message, detail: err.detail };
    throw e;
  }
}

async function person(id: string, roles: string[]) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [A, id, 'L' + id.slice(0, 4)]);
    for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [A, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
/** A confirmed court booking for the hour h of the player, with its confirmed occupancy row (as payment leaves it). */
async function courtBooking(h: number, o: { customer?: string; resource?: string; day?: number } = {}) {
  const customer = o.customer ?? PLAYER;
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id as string;
  const b = (await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
     values ($1,$2,'court',$3,$4,$5,$6,'confirmed','online',$6, app.now()) returning id`,
    [A, order, o.resource ?? C1, H(h, o.day), H(h + 1, o.day), customer])).rows[0].id as string;
  await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, booking_id) values ($1,'court_booking',$2,$3,$4,'confirmed',$5)`,
    [A, o.resource ?? C1, H(h, o.day), H(h + 1, o.day), b]);
  return b;
}
/** The add order: priced for the coaching portion, with no lines (written outside the function with the sum trigger off). */
async function addOrder(money = 80000, customer = PLAYER) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    const r = await c.query(
      `insert into public.orders (club_id, customer_id, source, status, price_group_snapshot, subtotal_satang, discount_satang, total_satang, credit_value_satang, wallet_satang, money_satang, quote_hash, priced_at)
       values ($1,$2,'online','open','{}'::jsonb,$3,0,$3,0,0,$3,repeat('a',64), app.now()) returning id`, [A, customer, money]);
    await c.query('commit');
    return r.rows[0].id as string;
  } finally {
    c.release();
  }
}
const add = (b: string, coach: string, order: string, c = player()) => attempt(() => run(c, `select app.add_coach_to_booking($1, $2, $3)`, [b, coach, order]));
const bookingRow = async (b: string) => (await tdb.query(`select type, coach_id, status from public.booking where id = $1`, [b])).rows[0];
const occRow = async (b: string) => (await tdb.query(`select kind, coach_id, state, resource_id from public.occupancy where booking_id = $1`, [b])).rows[0];
const addRow = async (order: string) => (await tdb.query(`select status, hold_expires_at, coach_id from public.booking_coach_add where order_id = $1`, [order])).rows[0];

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($1,$4,$3,'2','tennis')`, [A, C1, LOC, C2]);
  await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) select $1, d, '06:00', '24:00' from generate_series(1, 7) d`, [A]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [A]);
  await person(PLAYER, ['player']);
  await person(OTHER, ['player']);
  await person(DESK, ['front_desk', 'player']);
  await tdb.seedCoach(A, COACH);
  await tdb.seedCoach(A, COACH2);
  db = createDb({ connectionString: tdb.url, max: 6 });
  dbw = createDb({ connectionString: tdb.url, max: 3, role: 'booq_worker' });
});
afterEach(async () => {
  await db.end();
  await dbw.end();
  await tdb.close();
});

describe('the record of a solo class (R5-AC1, BOOK-04-AC2)', () => {
  it('the database refuses a solo class without a coach or a court booking with one, on the booking and on the occupancy row', async () => {
    const b = await courtBooking(10);
    await expect(tdb.query(`update public.booking set type = 'solo_class' where id = $1`, [b])).rejects.toThrow(/booking_coach_matches_type/);
    await expect(tdb.query(`update public.booking set coach_id = $2 where id = $1`, [b, COACH])).rejects.toThrow(/booking_coach_matches_type/);
    await expect(tdb.query(`update public.occupancy set kind = 'solo_class' where booking_id = $1`, [b])).rejects.toThrow(/occupancy_solo_needs_both/);
    await expect(tdb.query(`update public.occupancy set coach_id = $2 where booking_id = $1`, [b, COACH])).rejects.toThrow(/occupancy_court_has_no_coach/);
  });

  it('a two hour selection is one order with one solo booking per hour, and the rest rule runs across both (R5-AC2)', async () => {
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, PLAYER])).rows[0].id;
    const r = await attempt(() => run(player(), `select app.reserve_court($1, $2, $3::timestamptz[], $4, null)`, [order, C1, [H(10), H(11)], COACH]));
    expect(r).toEqual({ ok: true });
    expect((await tdb.query(`select type, coach_id, resource_id from public.booking where order_id = $1 order by start_at`, [order])).rows).toEqual([
      { type: 'solo_class', coach_id: COACH, resource_id: C1 }, { type: 'solo_class', coach_id: COACH, resource_id: C1 }]);
    // Seven hours in a row for one coach break the cap of 6 (the default, R3-AC6).
    const o2 = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, OTHER])).rows[0].id;
    const r2 = await attempt(() => run(player(OTHER), `select app.reserve_court($1, $2, $3::timestamptz[], $4, null)`, [o2, C2, [H(12), H(13), H(14), H(15), H(16)], COACH]));
    expect(r2).toEqual({ ok: false, code: 'rest_rule', detail: '6' });
    expect((await tdb.query(`select count(*)::int as n from public.booking where order_id = $1`, [o2])).rows[0].n).toBe(0);
  });
});

describe('app.add_coach_to_booking', () => {
  it('claims a free coach on the existing occupancy row, holds them for the add order, and leaves the court as it was', async () => {
    const b = await courtBooking(10);
    const order = await addOrder();
    expect(await add(b, COACH, order)).toEqual({ ok: true });
    expect(await bookingRow(b)).toEqual({ type: 'solo_class', coach_id: COACH, status: 'confirmed' });
    expect(await occRow(b)).toEqual({ kind: 'solo_class', coach_id: COACH, state: 'confirmed', resource_id: C1 });
    const a = await addRow(order);
    expect(a).toMatchObject({ status: 'pending', coach_id: COACH });
    expect(new Date(a.hold_expires_at).toISOString()).toBe(new Date('2026-12-01T03:15:00Z').toISOString());
    expect((await tdb.query(`select count(*)::int as n from public.occupancy where booking_id = $1`, [b])).rows[0].n).toBe(1);   // the same row
  });

  it('a busy coach is refused and the booking is unchanged; so is a coach who breaks the rest rule or is on approved leave', async () => {
    const b = await courtBooking(10);
    const other = await courtBooking(10, { resource: C2, customer: OTHER });
    await add(other, COACH, await addOrder(80000, OTHER), player(OTHER));
    expect(await add(b, COACH, await addOrder())).toEqual({ ok: false, code: 'coach_unavailable' });
    expect(await bookingRow(b)).toEqual({ type: 'court', coach_id: null, status: 'confirmed' });
    expect(await occRow(b)).toMatchObject({ kind: 'court_booking', coach_id: null });
    // Rest rule: COACH2 works hours 11 to 16, a seventh hour in a row breaks the cap.
    for (const h of [11, 12, 13, 14, 15, 16]) {
      const x = await courtBooking(h, { resource: C2, customer: OTHER });
      expect(await add(x, COACH2, await addOrder(80000, OTHER), player(OTHER))).toEqual({ ok: true });
    }
    const seventh = await courtBooking(17, { resource: C2, customer: OTHER });
    expect(await add(seventh, COACH2, await addOrder(80000, OTHER), player(OTHER))).toEqual({ ok: false, code: 'rest_rule', detail: '6' });
    const leaveDay = await courtBooking(10, { day: 3 });
    await tdb.query(`insert into public.coach_leave (club_id, coach_id, start_date, end_date, status, decided_by, decided_at) values ($1,$2,'2026-12-03','2026-12-03','approved',$3,app.now())`, [A, COACH, DESK]);
    expect(await add(leaveDay, COACH, await addOrder())).toEqual({ ok: false, code: 'coach_unavailable' });
  });

  it('a second coach on the same hour is refused, by the function and by the database', async () => {
    const b = await courtBooking(10);
    await add(b, COACH, await addOrder());
    expect(await add(b, COACH2, await addOrder())).toMatchObject({ ok: false });
    await expect(tdb.query(`insert into public.booking_coach_add (club_id, order_id, booking_id, coach_id, status, hold_expires_at) values ($1,$2,$3,$4,'pending',app.now())`, [A, await addOrder(), b, COACH2])).rejects.toThrow(/booking_coach_add_one_live/);
  });

  it('the player adds on their own booking only; staff on any, and also in a Paused club; a player in a Paused club is refused', async () => {
    const b = await courtBooking(10);
    expect(await add(b, COACH, await addOrder(80000, OTHER), player(OTHER))).toEqual({ ok: false, code: 'booking_not_found' });
    await tdb.query(`update public.club set status = 'paused'`);
    expect(await add(b, COACH, await addOrder())).toEqual({ ok: false, code: 'club_paused' });
    expect(await add(b, COACH, await addOrder(), desk())).toEqual({ ok: true });
  });

  it('refuses a past or started hour, a booking that is not a confirmed court booking, and an order that is not the booking customer’s open priced sale', async () => {
    const past = await courtBooking(8, { day: 1 });   // 2026-12-01 08:00 Bangkok is before the clock (10:00)
    expect(await add(past, COACH, await addOrder())).toEqual({ ok: false, code: 'hour_started' });
    const b = await courtBooking(10);
    expect(await add(b, COACH, await addOrder(80000, OTHER))).toEqual({ ok: false, code: 'order_not_found' });
    expect(await add(b, COACH, '99999999-9999-4999-8999-999999999999')).toEqual({ ok: false, code: 'booking_not_found' });
    await tdb.query(`update public.booking set status = 'cancelled' where id = $1`, [b]);
    expect(await add(b, COACH, await addOrder())).toEqual({ ok: false, code: 'not_movable' });
    const c = await courtBooking(12);
    const used = await addOrder();
    await add(c, COACH, used);
    expect(await add(await courtBooking(14), COACH, used)).toEqual({ ok: false, code: 'order_not_found' });   // one add per order
  });

  it('an add order that needs no payment confirms the add at once', async () => {
    const b = await courtBooking(10);
    const order = await addOrder(0);
    expect(await add(b, COACH, order)).toEqual({ ok: true });
    expect(await addRow(order)).toMatchObject({ status: 'confirmed', hold_expires_at: null });
  });

  it('a club with no hold time setting refuses while an add order needs payment', async () => {
    await tdb.query(`delete from public.club_setting where key = 'hold_minutes'`);
    const b = await courtBooking(10);
    expect(await add(b, COACH, await addOrder())).toEqual({ ok: false, code: 'hold_setting_unset' });
  });
});

describe('payment, release and expiry of the add order (D111, CC-4)', () => {
  const asWorker = <T>(sql: string, params: unknown[] = []) => dbw.withClubTx({ clubId: A, userId: null, roles: [], source: 'job' }, async (tx) => (await tx.query(sql, params)).rows as T[]);

  it('payment confirms the add (worker or staff, a player cannot); the coach stays on the booking', async () => {
    const b = await courtBooking(10);
    const order = await addOrder();
    await add(b, COACH, order);
    await expect(run(player(), `select app.confirm_coach_add($1)`, [order])).rejects.toThrow(/forbidden/);
    expect((await asWorker<{ r: boolean }>(`select app.confirm_coach_add($1) as r`, [order]))[0]!.r).toBe(true);
    expect(await addRow(order)).toMatchObject({ status: 'confirmed', hold_expires_at: null });
    expect((await asWorker<{ r: boolean }>(`select app.confirm_coach_add($1) as r`, [order]))[0]!.r).toBe(false);
    expect(await bookingRow(b)).toMatchObject({ type: 'solo_class', coach_id: COACH });
  });

  it('an expired hold frees the coach again, in one statement, and the court booking is unchanged', async () => {
    const b = await courtBooking(10);
    const order = await addOrder();
    await add(b, COACH, order);
    expect((await run<{ r: boolean }>(player(), `select app.release_coach_add($1, 'expired') as r`, [order]))[0]!.r).toBe(false);   // still running
    await tdb.advance('16 minutes');
    expect((await asWorker<{ n: number }>(`select count(*)::int as n from app.due_coach_add_orders()`))[0]!.n).toBe(1);
    expect((await run<{ r: boolean }>(player(OTHER), `select app.release_coach_add($1, 'expired') as r`, [order]))[0]!.r).toBe(true);
    expect(await bookingRow(b)).toEqual({ type: 'court', coach_id: null, status: 'confirmed' });
    expect(await occRow(b)).toMatchObject({ kind: 'court_booking', coach_id: null, state: 'confirmed' });
    expect(await addRow(order)).toMatchObject({ status: 'released', hold_expires_at: null });
    // The coach is free for the hour again.
    expect(await add(await courtBooking(10, { resource: C2, customer: OTHER }), COACH, await addOrder(80000, OTHER), player(OTHER))).toEqual({ ok: true });
    expect((await run<{ r: boolean }>(player(), `select app.release_coach_add($1, 'expired') as r`, [order]))[0]!.r).toBe(false);   // a second call is a no-op
  });

  it('the player ends their own add; another player cannot; staff may; a confirmed add is not released', async () => {
    const b = await courtBooking(10);
    const order = await addOrder();
    await add(b, COACH, order);
    await expect(run(player(OTHER), `select app.release_coach_add($1, 'player')`, [order])).rejects.toThrow(/release not allowed/);
    expect((await run<{ r: boolean }>(player(), `select app.release_coach_add($1, 'player') as r`, [order]))[0]!.r).toBe(true);
    const c = await courtBooking(12);
    const o2 = await addOrder();
    await add(c, COACH, o2);
    expect((await run<{ r: boolean }>(desk(), `select app.release_coach_add($1, 'staff') as r`, [o2]))[0]!.r).toBe(true);
    const d = await courtBooking(14);
    const o3 = await addOrder();
    await add(d, COACH, o3);
    await asWorker(`select app.confirm_coach_add($1)`, [o3]);
    expect((await run<{ r: boolean }>(desk(), `select app.release_coach_add($1, 'staff') as r`, [o3]))[0]!.r).toBe(false);
    expect(await bookingRow(d)).toMatchObject({ type: 'solo_class', coach_id: COACH });
  });

  it('f07_release is registered at ord 35, after F04 (10) and F05 (20)', async () => {
    expect((await tdb.query(`select ord from app.release_handlers where name = 'f07_coach_add'`)).rows).toEqual([{ ord: 35 }]);
    expect((await tdb.query(`select name from app.release_handlers where ord < 35 order by ord`)).rows.map((r) => r.name)).toEqual(['f04_entitlements', 'f05_payment_unavailable']);
  });

  it('the ordinary release of a court order runs the handler as a no op', async () => {
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, PLAYER])).rows[0].id;
    await run(player(), `select app.reserve_court($1, $2, $3::timestamptz[], null, null)`, [order, C1, [H(10)]]);
    expect((await run<{ r: boolean }>(player(), `select app.release_hold($1, 'player') as r`, [order]))[0]!.r).toBe(true);
  });
});

describe('grants', () => {
  it('the add is for booq_app; the confirm for app and worker; the due list for the worker only', async () => {
    const f = (r: string, fn: string) => tdb.query(`select has_function_privilege($1, $2, 'execute') as ok`, [r, fn]).then((x) => x.rows[0].ok);
    expect(await f('booq_app', 'app.add_coach_to_booking(uuid, uuid, uuid)')).toBe(true);
    expect(await f('booq_worker', 'app.add_coach_to_booking(uuid, uuid, uuid)')).toBe(false);
    expect(await f('booq_worker', 'app.confirm_coach_add(uuid)')).toBe(true);
    expect(await f('booq_app', 'app.due_coach_add_orders(integer)')).toBe(false);
    expect(await f('booq_worker', 'app.due_coach_add_orders(integer)')).toBe(true);
    expect(await f('booq_platform', 'app.release_coach_add(uuid, text)')).toBe(false);
    expect(await f('booq_app', 'app.f07_release(uuid, text)')).toBe(false);
  });
});
