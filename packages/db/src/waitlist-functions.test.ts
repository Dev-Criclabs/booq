import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F08-T06 / migration 0908: join, leave, advance, offer, decline, expire, pass on, and the claim trigger
// (CLASS-02-AC1 to AC16, WAIT-01-AC1 to AC5; D44, D121, D157).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const COACH2 = 'e1e1e1e1-0000-4000-8000-000000000008';
const OWNER = '44444444-4444-4444-8444-444444444444';
const P = Array.from({ length: 7 }, (_, i) => `00000000-0000-4000-8000-0000000003${String(i).padStart(2, '0')}`);
const KID = '11111111-1111-4111-8111-111111111111';
let tdb: TestDatabase;
let db: Db;
let dbw: Db;
let tpl: string;
let session: string;

const ctx = (user: string | null, roles: string[] = ['player']) => ({ clubId: A, userId: user, roles: roles as never, source: 'player_app' as const });
type Out<T = unknown> = { ok: true; res: T } | { ok: false; code: string };
async function run<T = unknown>(d: Db, c: ReturnType<typeof ctx>, sql: string, params: unknown[] = []): Promise<Out<T>> {
  try {
    return { ok: true, res: (await d.withClubTx(c, async (tx) => (await tx.query(sql, params)).rows[0])) as T };
  } catch (e) {
    const err = e as { code?: string; message: string };
    if (err.code === 'BK001') return { ok: false, code: err.message };
    throw e;
  }
}
const join = (user: string, sess: string | null = session, resource: string | null = null, slot: string | null = null) =>
  run<{ id: string }>(db, ctx(user), `select app.join_waitlist($1, $2, $3) as id`, [sess, resource, slot]).then((r) => (r.ok ? { ok: true as const, id: r.res.id } : r));
/** Internal functions are run as the function owner in the club's context, as the release handlers will. */
async function internal<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.club_id', $1, true)`, [A]);
    await c.query('set local role booq_owner');
    const r = await c.query(sql, params);
    await c.query('commit');
    return r.rows[0] as T;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const advance = (sess: string | null = session, resource: string | null = null, slot: string | null = null) =>
  internal<{ n: number }>(`select app.waitlist_advance($1, $2, $3) as n`, [sess, resource, slot]).then((r) => r.n);
const entries = async (sess = session) => (await tdb.query(`select customer_id, status, offer_no, ended_reason from public.waitlist_entry where class_session_id = $1 order by seq`, [sess])).rows;
const entry = async (user: string, sess = session) => (await tdb.query(`select * from public.waitlist_entry where customer_id = $1 and class_session_id = $2 order by seq desc limit 1`, [user, sess])).rows[0];
const outbox = async () => (await tdb.query(`select kind, user_id, status, dedupe_key, void_reason from public.message_outbox order by created_at, dedupe_key`)).rows;

async function person(id: string, roles: string[] = ['player'], dob: string | null = '1990-01-01') {
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
async function seat(customer: string, sess = session, status: 'confirmed' | 'awaiting_payment' = 'confirmed') {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id;
  const s = (await tdb.query(`select start_at, end_at, resource_id from public.class_session where id = $1`, [sess])).rows[0];
  return (await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, class_session_id, start_at, end_at, customer_id, status, source, created_by, hold_expires_at, confirmed_at)
     values ($1,$2,'class_seat',$3,$4,$5,$6,$7,$8,'online',$7, $9, $10) returning id`,
    [A, order, s.resource_id, sess, s.start_at, s.end_at, customer, status, status === 'awaiting_payment' ? new Date(Date.now() + 600000).toISOString() : null, status === 'confirmed' ? new Date().toISOString() : null])).rows[0].id as string;
}
const freeSeat = (booking: string) => tdb.query(`update public.booking set status = 'cancelled' where id = $1`, [booking]);

beforeEach(async () => {
  tdb = await createTestDatabase();
  // Wednesday 2 Dec 2026, 18:00 Bangkok is the first session; "now" is the Monday before, so the 2 hour cut off is far away.
  await tdb.setNow('2026-11-30T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($1,$4,$3,'2','tennis')`, [A, C1, LOC, C2]);
  await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) select $1, d, '06:00', '24:00' from generate_series(1, 7) d`, [A]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15'), ($1,'waitlist_claim_minutes','30'), ($1,'waitlist_no_offer_hours','2')`, [A]);
  await person(OWNER, ['owner', 'player'], null);
  await person(KID, ['player'], '2012-05-17');
  for (const p of P) await person(p);
  await tdb.seedCoach(A, COACH);
  await tdb.seedCoach(A, COACH2);
  tpl = (await tdb.query(`insert into public.class_template (club_id, name_th, name_en, audience, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by) values ($1,'ก','Group','adult',$2,$3,3,'18:00',2,2,$4) returning id`, [A, COACH, C1, OWNER])).rows[0].id;
  db = createDb({ connectionString: tdb.url, max: 6 });
  dbw = createDb({ connectionString: tdb.url, max: 3, role: 'booq_worker' });
  await db.withClubTx(ctx(OWNER, ['owner', 'player']), async (tx) => tx.query(`select app.generate_sessions('2026-11-30'::date, '2026-12-31'::date)`));
  session = (await tdb.query(`select id from public.class_session where template_id = $1 order by start_at limit 1`, [tpl])).rows[0].id;
});
afterEach(async () => {
  await db.end();
  await dbw.end();
  await tdb.close();
});

describe('app.join_waitlist for a class (CLASS-02-AC1, AC12, AC16)', () => {
  it('a full class: the player is added with a position, nothing is charged or held; a repeat returns the same entry', async () => {
    await seat(P[0]!); await seat(P[1]!);
    const r = await join(P[2]!);
    expect(r).toMatchObject({ ok: true });
    expect(await entries()).toEqual([{ customer_id: P[2], status: 'waiting', offer_no: 0, ended_reason: null }]);
    expect(await join(P[2]!)).toEqual(r);
    expect(await join(P[3]!)).toMatchObject({ ok: true });
    expect((await entries()).map((e) => e.customer_id)).toEqual([P[2], P[3]]);
    expect((await tdb.query(`select count(*)::int as n from public.orders`)).rows[0].n).toBe(2);   // only the two seat orders: nothing held or charged
  });

  it('a class with a free seat is not_full; a seat holder is already_seated; a class outside the audience is refused', async () => {
    expect(await join(P[2]!)).toEqual({ ok: false, code: 'not_full' });
    await seat(P[0]!); await seat(P[1]!);
    expect(await join(P[0]!)).toEqual({ ok: false, code: 'already_seated' });
    expect(await join(KID)).toEqual({ ok: false, code: 'class_not_for_you' });
  });

  it('a guest signs in first; a Paused club, a started class and an unknown class are refused', async () => {
    await seat(P[0]!); await seat(P[1]!);
    expect(await run(db, ctx(null, ['guest']), `select app.join_waitlist($1, null, null)`, [session])).toEqual({ ok: false, code: 'sign_in_required' });
    expect(await join(P[2]!, '99999999-9999-4999-8999-999999999999')).toEqual({ ok: false, code: 'session_not_available' });
    await tdb.setNow('2026-12-02T11:00:01Z');
    expect(await join(P[2]!)).toEqual({ ok: false, code: 'hour_started' });
    await tdb.setNow('2026-11-30T03:00:00Z');
    await tdb.query(`update public.club set status = 'paused'`);
    expect(await join(P[2]!)).toEqual({ ok: false, code: 'club_paused' });
  });

  it('a player may be on several waitlists (D157); there is no maximum length (CLASS-02-AC16)', async () => {
    await seat(P[0]!); await seat(P[1]!);
    for (const p of P.slice(2)) expect(await join(p)).toMatchObject({ ok: true });
    expect((await entries()).length).toBe(5);
  });
});

describe('opening a spot: the offer is a held booking (CLASS-02-AC2, AC3, AC14; WAIT-01-AC3)', () => {
  let b1: string;
  beforeEach(async () => {
    b1 = await seat(P[0]!); await seat(P[1]!);
    for (const p of [P[2]!, P[3]!, P[4]!]) await join(p);
    await freeSeat(b1);
  });

  it('offers the freed seat to the first in line as a held class seat; the offer message is queued; nothing else is offered', async () => {
    expect(await advance()).toBe(1);
    expect((await entries()).map((e) => [e.customer_id, e.status, e.offer_no])).toEqual([[P[2], 'offered', 1], [P[3], 'waiting', 0], [P[4], 'waiting', 0]]);
    const e = await entry(P[2]!);
    const bk = (await tdb.query(`select type, status, customer_id, created_by, waitlist_entry_id, hold_expires_at, class_session_id from public.booking where id = $1`, [e.offer_booking_id])).rows[0];
    expect(bk).toMatchObject({ type: 'class_seat', status: 'awaiting_payment', customer_id: P[2], created_by: P[2], waitlist_entry_id: e.id, class_session_id: session });
    expect(new Date(e.offer_expires_at).toISOString()).toBe('2026-11-30T03:30:00.000Z');              // now + 30 minutes
    expect(new Date(bk.hold_expires_at).toISOString()).toBe('2026-11-30T03:30:00.000Z');
    expect((await outbox()).filter((m) => m.kind === 'waitlist_offer')).toMatchObject([{ user_id: P[2], dedupe_key: `offer:${e.id}:1` }]);
  });

  it('the offered seat counts as taken, so a walk-in cannot take it (the slot never shows Open to others)', async () => {
    await advance();
    expect(await run(db, ctx(P[5]!), `select app.take_seat($1, $2)`, [(await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P[5]])).rows[0].id, session])).toEqual({ ok: false, code: 'session_full' });
  });

  it('the offer ends at the earlier of now plus the claim time and the start (D157)', async () => {
    await tdb.query(`update public.club_setting set value = '100000' where key = 'waitlist_claim_minutes'`);
    await tdb.query(`update public.club_setting set value = '0' where key = 'waitlist_no_offer_hours'`);
    await advance();
    expect(new Date((await entry(P[2]!)).offer_expires_at).toISOString()).toBe('2026-12-02T11:00:00.000Z');   // the start, 18:00 Bangkok
  });

  it('a class with several free seats makes several offers, one per seat', async () => {
    await tdb.query(`update public.booking set status = 'cancelled' where class_session_id = $1 and customer_id = $2`, [session, P[1]]);
    expect(await advance()).toBe(2);
    expect((await entries()).map((e) => e.status)).toEqual(['offered', 'offered', 'waiting']);
  });

  it('no offers before the claim time is set, and none inside the cut off; an open offer stands when the mark passes (AC5, AC15)', async () => {
    await tdb.query(`delete from public.club_setting where key = 'waitlist_claim_minutes'`);
    expect(await advance()).toBe(0);
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'waitlist_claim_minutes','30')`, [A]);
    await tdb.setNow('2026-12-02T09:30:00Z');                                     // 16:30 Bangkok: 90 minutes before the start, inside 2 hours
    expect(await advance()).toBe(0);
    await tdb.setNow('2026-11-30T03:00:00Z');
    expect(await advance()).toBe(1);
    await tdb.setNow('2026-12-02T09:20:00Z');                                     // the mark has passed: the offer stands
    expect((await entry(P[2]!)).status).toBe('offered');
    await tdb.query(`update public.booking set hold_expires_at = '2026-12-02T10:00:00Z' where id = $1`, [(await entry(P[2]!)).offer_booking_id]);
    expect(await advance()).toBe(0);
  });

  it('a player with a live offer at the same start for another subject is skipped and keeps their place (Q1, A-5)', async () => {
    const t2 = (await tdb.query(`insert into public.class_template (club_id, name_th, name_en, audience, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by) values ($1,'ก','Other','adult',$2,$3,3,'18:00',1,1,$4) returning id`, [A, COACH2, C2, OWNER])).rows[0].id;
    await db.withClubTx(ctx(OWNER, ['owner', 'player']), async (tx) => tx.query(`select app.generate_sessions('2026-11-30'::date, '2026-12-31'::date)`));
    const other = (await tdb.query(`select id from public.class_session where template_id = $1 order by start_at limit 1`, [t2])).rows[0].id;
    const ob = await seat(P[5]!, other);
    const e2 = (await join(P[2]!, other)) as { id: string };
    await freeSeat(ob);
    expect(await advance(other)).toBe(1);                                         // P2 is offered the other class
    expect(await advance()).toBe(1);                                              // P2 is skipped here: P3 gets the seat, P2 keeps the place
    expect((await entries()).map((e) => [e.customer_id, e.status])).toEqual([[P[2], 'waiting'], [P[3], 'offered'], [P[4], 'waiting']]);
    void e2;
  });
});

describe('passing on (CLASS-02-AC4, AC9)', () => {
  beforeEach(async () => {
    const b1 = await seat(P[0]!); await seat(P[1]!);
    for (const p of [P[2]!, P[3]!]) await join(p);
    await freeSeat(b1);
    await advance();
  });

  it('declining ends the entry, releases the held seat, voids the offer message and offers the seat to the next', async () => {
    const e = await entry(P[2]!);
    expect(await run(db, ctx(P[2]!), `select app.decline_offer($1)`, [e.id])).toMatchObject({ ok: true });
    expect((await entries()).map((x) => [x.customer_id, x.status])).toEqual([[P[2], 'declined'], [P[3], 'offered']]);
    expect((await tdb.query(`select status, release_reason from public.booking where id = $1`, [e.offer_booking_id])).rows[0]).toEqual({ status: 'released', release_reason: 'offer_ended' });
    expect((await outbox()).find((m) => m.dedupe_key === `offer:${e.id}:1`)).toMatchObject({ status: 'void', void_reason: 'cancelled' });
    expect((await outbox()).filter((m) => m.kind === 'waitlist_offer' && m.status === 'pending').map((m) => m.user_id)).toEqual([P[3]]);
  });

  it('only the player declines their own offer', async () => {
    const e = await entry(P[2]!);
    expect(await run(db, ctx(P[3]!), `select app.decline_offer($1)`, [e.id])).toEqual({ ok: false, code: 'entry_not_found' });
  });

  it('an offer that passes its time expires through the job and passes on; not before', async () => {
    const e = await entry(P[2]!);
    expect((await run<{ r: boolean }>(dbw, ctx(null, []), `select app.offer_expire($1) as r`, [e.id]))).toMatchObject({ ok: true, res: { r: false } });
    await tdb.advance('31 minutes');
    expect((await run<{ n: number }>(dbw, ctx(null, []), `select count(*)::int as n from app.due_offers()`))).toMatchObject({ res: { n: 1 } });
    expect((await run<{ r: boolean }>(dbw, ctx(null, []), `select app.offer_expire($1) as r`, [e.id]))).toMatchObject({ ok: true, res: { r: true } });
    expect((await entries()).map((x) => x.status)).toEqual(['expired', 'offered']);
    expect((await tdb.query(`select release_reason from public.booking where id = $1`, [e.offer_booking_id])).rows[0].release_reason).toBe('offer_ended');
  });

  it('F10 passes an undeliverable offer on at once (CLASS-02-AC9)', async () => {
    const e = await entry(P[2]!);
    expect((await run<{ r: boolean }>(dbw, ctx(null, []), `select app.waitlist_pass_on($1) as r`, [e.id]))).toMatchObject({ res: { r: true } });
    expect((await entries()).map((x) => x.status)).toEqual(['expired', 'offered']);
    expect((await run<{ r: boolean }>(dbw, ctx(null, []), `select app.waitlist_pass_on($1) as r`, [e.id]))).toMatchObject({ res: { r: false } });
  });

  it('the expiry and pass on functions are for the worker only', async () => {
    const e = await entry(P[2]!);
    for (const sql of [`select app.offer_expire($1)`, `select app.waitlist_pass_on($1)`]) {
      await expect(run(db, ctx(P[2]!), sql, [e.id])).rejects.toThrow(/permission denied/);
    }
  });

  it('leaving while offered declines the offer; leaving while waiting ends the entry as left', async () => {
    const e = await entry(P[2]!);
    expect(await run(db, ctx(P[3]!), `select app.leave_waitlist($1)`, [(await entry(P[3]!)).id])).toMatchObject({ ok: true });
    expect((await entry(P[3]!)).status).toBe('left');
    expect(await run(db, ctx(P[2]!), `select app.leave_waitlist($1)`, [e.id])).toMatchObject({ ok: true });
    expect((await entry(P[2]!)).status).toBe('declined');
    expect(await run(db, ctx(P[4]!), `select app.leave_waitlist($1)`, [e.id])).toEqual({ ok: false, code: 'entry_not_found' });
  });
});

describe('claiming and the booking trigger (CLASS-02-AC3, AC7)', () => {
  it('a claim that confirms the held seat sets the entry claimed and voids the offer message', async () => {
    const b1 = await seat(P[0]!); await seat(P[1]!);
    await join(P[2]!);
    await freeSeat(b1);
    await advance();
    const e = await entry(P[2]!);
    await tdb.query(`update public.booking set status = 'confirmed', confirmed_at = app.now(), hold_expires_at = null where id = $1`, [e.offer_booking_id]);
    expect((await entry(P[2]!)).status).toBe('claimed');
    expect((await outbox()).find((m) => m.dedupe_key === `offer:${e.id}:1`)).toMatchObject({ status: 'void' });
  });

  it('a player who takes a seat ends their waiting entries for the session (joined_seat)', async () => {
    const b1 = await seat(P[0]!); await seat(P[1]!);
    await join(P[2]!);
    await freeSeat(b1);
    await seat(P[2]!, session, 'awaiting_payment');                                 // they book the open seat directly
    expect(await entries()).toEqual([{ customer_id: P[2], status: 'ended', offer_no: 0, ended_reason: 'joined_seat' }]);
  });

  it('back at the minimum voids the pending below-minimum alert', async () => {
    await seat(P[0]!);
    await internal(`select app.enqueue_message('class_below_minimum', $1, '{}'::jsonb, $2, app.now() + interval '1 day')`, [OWNER, `below_min:${session}`]);
    expect((await outbox()).find((m) => m.dedupe_key === `below_min:${session}`)).toMatchObject({ status: 'pending' });
    await seat(P[1]!);
    expect((await outbox()).find((m) => m.dedupe_key === `below_min:${session}`)).toMatchObject({ status: 'void', void_reason: 'superseded' });
  });
});

describe('a court slot (WAIT-01-AC1 to AC3, CLASS-02-AC6)', () => {
  const SLOT = '2026-12-05T20:00:00+07:00';
  let b1: string;
  beforeEach(async () => {
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P[0]])).rows[0].id;
    b1 = (await tdb.query(`insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at) values ($1,$2,'court',$3,$4::timestamptz,$4::timestamptz + interval '1 hour',$5,'confirmed','online',$5, app.now()) returning id`, [A, order, C2, SLOT, P[0]])).rows[0].id;
    await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, booking_id) values ($1,'court_booking',$2,$3::timestamptz,$3::timestamptz + interval '1 hour','confirmed',$4)`, [A, C2, SLOT, b1]);
  });
  const free = async () => {
    await tdb.query(`update public.booking set status = 'cancelled' where id = $1`, [b1]);
    await tdb.query(`delete from public.occupancy where booking_id = $1`, [b1]);
  };
  const slotEntries = async () => (await tdb.query(`select customer_id, status from public.waitlist_entry where resource_id = $1 order by seq`, [C2])).rows;

  it('a taken hour can be joined; a free hour and a booking of one’s own cannot', async () => {
    expect(await join(P[1]!, null, C2, SLOT)).toMatchObject({ ok: true });
    expect(await join(P[1]!, null, C2, SLOT)).toMatchObject({ ok: true });
    expect(await join(P[1]!, null, C1, SLOT)).toEqual({ ok: false, code: 'not_taken' });
    expect(await join(P[0]!, null, C2, SLOT)).toEqual({ ok: false, code: 'already_booked' });
    expect(await join(P[1]!, null, C2, '2026-12-05T20:30:00+07:00')).toEqual({ ok: false, code: 'not_on_the_hour' });
    expect(await join(P[1]!, null, C2, '2026-11-29T20:00:00+07:00')).toEqual({ ok: false, code: 'in_the_past' });
    expect(await join(P[1]!, null, C2, '2027-03-05T20:00:00+07:00')).toEqual({ ok: false, code: 'outside_window' });
    expect(await slotEntries()).toHaveLength(1);
  });

  it('a held hour can be joined too (D157)', async () => {
    await tdb.query(`update public.booking set status = 'awaiting_payment', confirmed_at = null, hold_expires_at = app.now() + interval '10 minutes' where id = $1`, [b1]);
    await tdb.query(`update public.occupancy set state = 'held', hold_expires_at = app.now() + interval '10 minutes' where booking_id = $1`, [b1]);
    expect(await join(P[1]!, null, C2, SLOT)).toMatchObject({ ok: true });
  });

  it('when the booking is cancelled the first in line gets the slot as a held court booking; the slot shows held, not Open', async () => {
    await join(P[1]!, null, C2, SLOT); await join(P[2]!, null, C2, SLOT);
    await free();
    expect(await advance(null, C2, SLOT)).toBe(1);
    expect(await slotEntries()).toEqual([{ customer_id: P[1], status: 'offered' }, { customer_id: P[2], status: 'waiting' }]);
    const e = (await tdb.query(`select offer_booking_id from public.waitlist_entry where customer_id = $1 and resource_id = $2`, [P[1], C2])).rows[0];
    expect((await tdb.query(`select type, status, resource_id, customer_id from public.booking where id = $1`, [e.offer_booking_id])).rows[0]).toEqual({ type: 'court', status: 'awaiting_payment', resource_id: C2, customer_id: P[1] });
    expect((await tdb.query(`select kind, state from public.occupancy where booking_id = $1`, [e.offer_booking_id])).rows[0]).toEqual({ kind: 'court_booking', state: 'held' });
    expect((await db.withClubTx(ctx(P[3]!), async (tx) => (await tx.query(`select state from public.public_slot_state where resource_id = $1 and start_at = $2::timestamptz`, [C2, SLOT])).rows[0]))).toEqual({ state: 'held' });
  });

  it('declining a court slot offer frees the hold and offers the next; the slot is Open when nobody waits', async () => {
    await join(P[1]!, null, C2, SLOT);
    await free();
    await advance(null, C2, SLOT);
    const e = (await tdb.query(`select id from public.waitlist_entry where customer_id = $1`, [P[1]])).rows[0];
    await run(db, ctx(P[1]!), `select app.decline_offer($1)`, [e.id]);
    expect((await tdb.query(`select count(*)::int as n from public.occupancy where resource_id = $1 and start_at = $2::timestamptz`, [C2, SLOT])).rows[0].n).toBe(0);
    expect(await slotEntries()).toEqual([{ customer_id: P[1], status: 'declined' }]);
  });
});

describe('grants', () => {
  it('join, leave and decline are for booq_app; expiry and pass on for the worker; the internals for nobody', async () => {
    const f = (r: string, fn: string) => tdb.query(`select has_function_privilege($1, $2, 'execute') as ok`, [r, fn]).then((x) => x.rows[0].ok);
    expect(await f('booq_app', 'app.join_waitlist(uuid, uuid, timestamptz)')).toBe(true);
    expect(await f('booq_app', 'app.leave_waitlist(uuid)')).toBe(true);
    expect(await f('booq_app', 'app.decline_offer(uuid)')).toBe(true);
    expect(await f('booq_worker', 'app.offer_expire(uuid)')).toBe(true);
    expect(await f('booq_app', 'app.offer_expire(uuid)')).toBe(false);
    for (const fn of ['app.waitlist_advance(uuid, uuid, timestamptz)', 'app.offer_hold(uuid)', 'app.end_offer(uuid, text)', 'app.pass_offer_on(uuid, text)']) {
      for (const r of ['booq_app', 'booq_worker', 'booq_platform']) expect(await f(r, fn), `${r} ${fn}`).toBe(false);
    }
    expect(await f('booq_platform', 'app.join_waitlist(uuid, uuid, timestamptz)')).toBe(false);
  });
});
