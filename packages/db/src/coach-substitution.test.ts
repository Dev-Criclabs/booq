import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F07-T07 / migration 0807: substitute_coach, coach_was_changed, coach_flagged_session (R4-AC1 to AC7, R6-AC1, COACH-03; D120).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const COACH2 = 'e1e1e1e1-0000-4000-8000-000000000008';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const OWNER = '44444444-4444-4444-8444-444444444444';
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
async function courtBooking(h: number, o: { customer?: string | undefined; resource?: string | undefined; day?: number | undefined } = {}) {
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
  await person(OWNER, ['owner', 'player']);
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

const owner = () => ctx(OWNER, ['owner', 'player'], 'admin');
/** A confirmed solo class of the player with COACH at hour h (court C1), as payment leaves it. */
async function solo(h: number, o: { day?: number; coach?: string; customer?: string; resource?: string } = {}) {
  const b = await courtBooking(h, { day: o.day, customer: o.customer, resource: o.resource });
  const coach = o.coach ?? COACH;
  await tdb.query(`update public.occupancy set coach_id = $2, kind = 'solo_class' where booking_id = $1`, [b, coach]);
  await tdb.query(`update public.booking set coach_id = $2, type = 'solo_class' where id = $1`, [b, coach]);
  return b;
}
const sub = (b: string, to: string, reason = 'leave', c = owner()) => attempt(() => run(c, `select app.substitute_coach($1, $2, $3)`, [b, to, reason]));
const hooks = async () => (await tdb.query(`select kind, usr, params, dedupe from public.__hook order by n`)).rows;

describe('app.substitute_coach (R4-AC1 to AC7)', () => {
  beforeEach(async () => {
    await tdb.query(`create table public.__hook (n serial, kind text, usr uuid, params jsonb, dedupe text)`);
    await tdb.query(`create or replace function app.coach_message_hook(p_kind text, p_user uuid, p_params jsonb, p_dedupe_key text) returns void language plpgsql security definer as $$ begin insert into public.__hook (kind, usr, params, dedupe) values (p_kind, p_user, p_params, p_dedupe_key); end $$`);
    await tdb.query(`grant all on public.__hook, public.__hook_n_seq to public`);
  });

  it('moves the class to a free coach: the court is kept, the old coach is freed, the new one claimed, one occupancy row', async () => {
    const b = await solo(10);
    expect(await sub(b, COACH2)).toEqual({ ok: true });
    expect(await bookingRow(b)).toEqual({ type: 'solo_class', coach_id: COACH2, status: 'confirmed' });
    expect(await occRow(b)).toEqual({ kind: 'solo_class', coach_id: COACH2, state: 'confirmed', resource_id: C1 });
    expect((await tdb.query(`select count(*)::int as n from public.occupancy where booking_id = $1`, [b])).rows[0].n).toBe(1);
    // The old coach can be booked for the same hour at once.
    const other = await courtBooking(10, { resource: C2, customer: OTHER });
    await tdb.query(`update public.occupancy set coach_id = $2, kind = 'solo_class' where booking_id = $1`, [other, COACH]);
    expect((await tdb.query(`select from_coach_id, to_coach_id, by_staff_id, reason, booking_id from public.coach_substitution`)).rows).toEqual([{ from_coach_id: COACH, to_coach_id: COACH2, by_staff_id: OWNER, reason: 'leave', booking_id: b }]);
  });

  it('the price does not change: order lines and the order are untouched (R4-AC5)', async () => {
    const b = await solo(10);
    const before = (await tdb.query(`select o.total_satang, o.status, (select count(*) from public.order_line l where l.order_id = o.id)::int as n from public.orders o join public.booking b on b.order_id = o.id where b.id = $1`, [b])).rows[0];
    await sub(b, COACH2);
    expect((await tdb.query(`select o.total_satang, o.status, (select count(*) from public.order_line l where l.order_id = o.id)::int as n from public.orders o join public.booking b on b.order_id = o.id where b.id = $1`, [b])).rows[0]).toEqual(before);
  });

  it('tells the customer (new coach id only) and both coaches, once, through the hook (R4-AC3)', async () => {
    const b = await solo(10);
    await sub(b, COACH2);
    expect(await hooks()).toEqual([
      { kind: 'coach_changed', usr: PLAYER, params: { booking_id: b, coach_id: COACH2 }, dedupe: `coach_changed:${b}:${COACH2}` },
      { kind: 'session_change', usr: COACH, params: { booking_id: b }, dedupe: `session_change:${b}:${COACH2}:${COACH}` },
      { kind: 'session_change', usr: COACH2, params: { booking_id: b }, dedupe: `session_change:${b}:${COACH2}:${COACH2}` },
    ]);
  });

  it('a busy, on-leave, inactive or rest-rule-breaking substitute is refused and nothing changes (R4-AC2, AC6)', async () => {
    const b = await solo(10);
    await solo(10, { coach: COACH2, resource: C2, customer: OTHER });                 // COACH2 is busy at 10:00
    expect(await sub(b, COACH2)).toEqual({ ok: false, code: 'coach_unavailable' });
    expect(await bookingRow(b)).toEqual({ type: 'solo_class', coach_id: COACH, status: 'confirmed' });
    expect(await occRow(b)).toMatchObject({ coach_id: COACH });
    expect((await tdb.query(`select count(*)::int as n from public.coach_substitution`)).rows[0].n).toBe(0);
    expect(await hooks()).toEqual([]);
    await tdb.seedCoach(A, 'e3e3e3e3-0000-4000-8000-000000000006');
    const COACH3 = 'e3e3e3e3-0000-4000-8000-000000000006';
    await tdb.query(`update public.coach set active = false where id = $1`, [COACH3]);
    expect(await sub(b, COACH3)).toEqual({ ok: false, code: 'coach_unavailable' });
    await tdb.query(`update public.coach set active = true where id = $1`, [COACH3]);
    await tdb.query(`insert into public.coach_leave (club_id, coach_id, start_date, end_date, status, decided_by, decided_at) values ($1,$2,'2026-12-02','2026-12-02','approved',$3,app.now())`, [A, COACH3, OWNER]);
    expect(await sub(b, COACH3)).toEqual({ ok: false, code: 'coach_unavailable' });
    // Rest rule: COACH2 works 10 to 16 in a row, so taking the class at 17:00 would make eight.
    for (const h of [11, 12, 13, 14, 15, 16]) await solo(h, { coach: COACH2, resource: C2, customer: OTHER });
    expect(await sub(await solo(17), COACH2)).toEqual({ ok: false, code: 'rest_rule', detail: '6' });
  });

  it('only the owner substitutes; the front desk, a coach and a player are refused', async () => {
    const b = await solo(10);
    for (const c of [desk(), ctx(COACH, ['coach', 'player']), player()]) {
      await expect(run(c, `select app.substitute_coach($1, $2, 'other')`, [b, COACH2])).rejects.toThrow(/not allowed/);
    }
    expect(await bookingRow(b)).toMatchObject({ coach_id: COACH });
  });

  it('refuses the same coach, an unknown booking, a court booking, a started hour, a cancelled class, and a bad reason', async () => {
    const b = await solo(10);
    expect(await sub(b, COACH)).toEqual({ ok: false, code: 'coach_unavailable' });
    expect(await sub('99999999-9999-4999-8999-999999999999', COACH2)).toEqual({ ok: false, code: 'booking_not_found' });
    expect(await sub(await courtBooking(12), COACH2)).toEqual({ ok: false, code: 'booking_not_found' });   // no coach to replace
    expect(await sub(await solo(8, { day: 1 }), COACH2)).toEqual({ ok: false, code: 'hour_started' });
    const c = await solo(14);
    await tdb.query(`update public.booking set status = 'cancelled' where id = $1`, [c]);
    expect(await sub(c, COACH2)).toEqual({ ok: false, code: 'not_movable' });
    await expect(run(owner(), `select app.substitute_coach($1, $2, 'because')`, [b, COACH2])).rejects.toThrow(/invalid reason/);
  });

  it('works in a Paused club (staff may change the coach)', async () => {
    const b = await solo(10);
    await tdb.query(`update public.club set status = 'paused'`);
    expect(await sub(b, COACH2)).toEqual({ ok: true });
  });

  it('coach_substitution is append only', async () => {
    const b = await solo(10);
    await sub(b, COACH2);
    await expect(tdb.query(`update public.coach_substitution set reason = 'other'`)).rejects.toThrow();
    await expect(tdb.query(`delete from public.coach_substitution`)).rejects.toThrow();
  });
});

describe('app.coach_was_changed (R4-AC4, CANCEL-01-AC18)', () => {
  it('is true only for a booking that had its coach changed', async () => {
    const b = await solo(10);
    const was = async (x: string) => (await run<{ r: boolean }>(player(), `select app.coach_was_changed($1) as r`, [x]))[0]!.r;
    expect(await was(b)).toBe(false);
    await sub(b, COACH2);
    expect(await was(b)).toBe(true);
    expect(await was(await solo(12))).toBe(false);
  });
});

describe('public.coach_flagged_session (R6-AC1, R6-AC2)', () => {
  const flags = (c = owner()) => run<{ booking_id: string; coach_id: string; reason: string }>(c, `select booking_id, coach_id, reason from public.coach_flagged_session order by start_at`);

  it('lists future confirmed solo classes whose hour no longer works, with the reason; saving the rule moves no booking', async () => {
    const b1 = await solo(10);
    const b2 = await solo(12);
    const b3 = await solo(14, { coach: COACH2, resource: C2 });
    expect(await flags()).toEqual([]);
    await tdb.query(`insert into public.coach_leave (club_id, coach_id, start_date, end_date, from_hour, to_hour, status, decided_by, decided_at) values ($1,$2,'2026-12-02',null,null,null,'approved',$3,app.now())`.replace("'2026-12-02',null,null,null", "'2026-12-02','2026-12-02',10,11"), [A, COACH, OWNER]);
    expect(await flags()).toEqual([{ booking_id: b1, coach_id: COACH, reason: 'leave' }]);
    await tdb.query(`insert into public.coach_availability_rule (club_id, coach_id, kind, on_date, start_time, end_time) values ($1,$2,'closed','2026-12-02','12:00','13:00')`, [A, COACH]);
    expect((await flags()).map((f) => [f.booking_id, f.reason])).toEqual([[b1, 'leave'], [b2, 'not_working']]);
    await tdb.query(`update public.coach set active = false where id = $1`, [COACH2]);
    expect((await flags()).map((f) => f.reason)).toEqual(['leave', 'not_working', 'inactive']);
    expect((await tdb.query(`select status, coach_id from public.booking where id = any($1)`, [[b1, b2, b3]])).rows.every((r) => r.status === 'confirmed' && r.coach_id !== null)).toBe(true);
  });

  it('a pending leave, a past class, a court booking and a cancelled class are not flagged; a substitute clears the flag', async () => {
    const b = await solo(10);
    await tdb.query(`insert into public.coach_leave (club_id, coach_id, start_date, end_date) values ($1,$2,'2026-12-02','2026-12-02')`, [A, COACH]);
    expect(await flags()).toEqual([]);
    await tdb.query(`update public.coach_leave set status = 'approved', decided_by = $1, decided_at = app.now()`, [OWNER]);
    expect(await flags()).toHaveLength(1);
    await sub(b, COACH2);
    expect(await flags()).toEqual([]);
    const c = await solo(14);
    await tdb.query(`update public.booking set status = 'cancelled' where id = $1`, [c]);
    expect(await flags()).toEqual([]);
  });

  it('is for the owner only, and only the club’s own', async () => {
    await solo(10);
    await tdb.query(`insert into public.coach_leave (club_id, coach_id, start_date, end_date, status, decided_by, decided_at) values ($1,$2,'2026-12-02','2026-12-02','approved',$3,app.now())`, [A, COACH, OWNER]);
    expect(await flags(desk())).toEqual([]);
    expect(await flags(ctx(COACH, ['coach', 'player']))).toEqual([]);
    expect(await flags(player())).toEqual([]);
    expect(await flags(ctx(OWNER, ['owner', 'player'], 'admin'))).toHaveLength(1);
  });
});

describe('grants', () => {
  it('substitute_coach is for booq_app; coach_was_changed for app and worker', async () => {
    const f = (r: string, fn: string) => tdb.query(`select has_function_privilege($1, $2, 'execute') as ok`, [r, fn]).then((x) => x.rows[0].ok);
    expect(await f('booq_app', 'app.substitute_coach(uuid, uuid, text)')).toBe(true);
    expect(await f('booq_worker', 'app.substitute_coach(uuid, uuid, text)')).toBe(false);
    expect(await f('booq_worker', 'app.coach_was_changed(uuid)')).toBe(true);
    expect(await f('booq_platform', 'app.coach_was_changed(uuid)')).toBe(false);
  });
});
