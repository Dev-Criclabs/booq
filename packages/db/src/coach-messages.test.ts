import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F12-T06 / migration 1206: the coach's message when a class is booked, moved or cancelled (CPORT-07, LINE-05; D91, D95; A-6).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const OWNER = '44444444-4444-4444-8444-444444444444';
const C1 = '66666666-6666-4666-8666-666666666661';
const C2 = '66666666-6666-4666-8666-666666666662';
const R1 = '88888888-8888-4888-8888-888888888881';
const LOC = '99999999-9999-4999-8999-999999999999';

let tdb: TestDatabase;
/** The way the real functions run: the club's owner role, with the club, the person and the source in the context. */
async function inClub<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role booq_owner');
    await c.query(`select set_config('app.club_id', $1, true), set_config('app.user_id', $2, true), set_config('app.source', 'admin', true)`, [A, OWNER]);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const sent = async () => (await tdb.query(`select user_id, kind, params, dedupe_key from public.message_outbox order by created_at, id`)).rows;
async function booking(c: PoolClient, over: { coach?: string | null; status?: string; start?: string; customer?: string; type?: string; session?: string } = {}) {
  const start = over.start ?? '2026-12-20T03:00:00Z';
  const status = over.status ?? 'confirmed';
  const o = (await c.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, over.customer ?? P1])).rows[0].id as string;
  return (await c.query(
    `insert into public.booking (club_id, order_id, type, resource_id, class_session_id, customer_id, coach_id, start_at, end_at, status, source, created_by, confirmed_at, hold_expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$8::timestamptz + interval '1 hour',$9,'online',$6, case when $9 = 'confirmed' then now() end, case when $9 = 'awaiting_payment' then now() + interval '1 hour' end) returning id`,
    [A, o, over.type ?? 'solo_class', R1, over.session ?? null, over.customer ?? P1, over.type === 'class_seat' ? null : over.coach === undefined ? C1 : over.coach, start, status])).rows[0].id as string;
}
async function session(c: PoolClient, over: { coach?: string; status?: string } = {}) {
  const status = over.status ?? 'scheduled';
  const t = (await c.query(
    `insert into public.class_template (club_id, name_th, name_en, audience, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by)
     values ($1,'ก','G','adult',$2,$3,1,'10:00',2,6,$4) returning id`, [A, over.coach ?? C1, R1, OWNER])).rows[0].id as string;
  return (await c.query(
    `insert into public.class_session (club_id, template_id, start_at, end_at, name_th, name_en, audience, coach_id, resource_id, min_players, max_players, status, cancel_reason, cancelled_at)
     values ($1, $5, '2026-12-21T03:00:00Z', '2026-12-21T04:00:00Z', 'ก', 'G', 'adult', $2, $3, 2, 6, $4, case when $4 = 'cancelled' then 'owner' end, case when $4 = 'cancelled' then now() end) returning id`,
    [A, over.coach ?? C1, R1, status, t])).rows[0].id as string;
}
const set = (c: PoolClient, id: string, sql: string, args: unknown[] = []) => c.query(`update public.booking set ${sql}, updated_at = app.now() where id = $1`, [id, ...args]);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  for (const [u, roles, name] of [[P1, ['player'], 'P1'], [P2, ['player'], 'P2'], [OWNER, ['owner', 'player'], 'Owner'], [C1, ['coach', 'player'], 'C1'], [C2, ['coach', 'player'], 'C2']] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id, full_name) values ($1,$2,$3,$4)', [A, u, 'L' + u.slice(-2), name]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [A, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'Court 1','tennis')`, [A, R1, LOC]);
  await tdb.query(`insert into public.coach (club_id, id) values ($1,$2), ($1,$3)`, [A, C1, C2]);
});
afterEach(async () => {
  await tdb.close();
});

describe('a solo class (CPORT-07)', () => {
  it('a class booked tells its coach once: held then paid, or confirmed at once', async () => {
    const b = await inClub((c) => booking(c, { status: 'awaiting_payment' }));
    expect(await sent()).toEqual([]);                                             // held for payment: nothing yet
    await inClub((c) => set(c, b, `status = 'confirmed', confirmed_at = app.now(), hold_expires_at = null`));
    const m = await sent();
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ user_id: C1, kind: 'session_change', params: { booking_id: b, change: 'booked' } });
    expect(m[0].dedupe_key).toMatch(new RegExp(`^coach_booking:${b}:booked:\\d+$`));
    await inClub((c) => set(c, b, `confirmed_at = app.now()`));                  // an unrelated update sends nothing more
    expect(await sent()).toHaveLength(1);
    await inClub((c) => booking(c, { start: '2026-12-22T03:00:00Z' }));
    expect(await sent()).toHaveLength(2);
  });
  it('a moved class and a cancelled class tell the coach; a late cancel too', async () => {
    const b = await inClub((c) => booking(c));
    await inClub((c) => set(c, b, `start_at = '2026-12-20T05:00:00Z', end_at = '2026-12-20T06:00:00Z'`));
    await inClub((c) => set(c, b, `status = 'cancelled'`));
    const b2 = await inClub((c) => booking(c, { start: '2026-12-23T03:00:00Z' }));
    await inClub((c) => set(c, b2, `status = 'late_cancelled'`));
    expect((await sent()).map((m) => [m.user_id, m.params.change])).toEqual([[C1, 'booked'], [C1, 'moved'], [C1, 'cancelled'], [C1, 'booked'], [C1, 'cancelled']]);
  });
  it('a released hold, a booking that was never confirmed and a court booking send nothing', async () => {
    const b = await inClub((c) => booking(c, { status: 'awaiting_payment' }));
    await inClub((c) => set(c, b, `status = 'released', release_reason = 'expired', released_at = app.now(), hold_expires_at = null`));
    await inClub((c) => booking(c, { type: 'court', coach: null }));
    await inClub((c) => booking(c, { status: 'awaiting_payment', start: '2026-12-24T03:00:00Z' }).then((id) => set(c, id, `status = 'cancelled', hold_expires_at = null`)));
    expect(await sent()).toEqual([]);
  });
  it('a substitution is F07\'s: the new coach gets no extra "booked" from this trigger', async () => {
    const b = await inClub((c) => booking(c));
    await inClub((c) => set(c, b, `coach_id = $2`, [C2]));
    expect((await sent()).map((m) => [m.user_id, m.params.change])).toEqual([[C1, 'booked']]);
  });
  it('a coach added to an existing court booking is told when the add order is confirmed, not while it is held', async () => {
    const b = await inClub((c) => booking(c, { coach: null, type: 'court' }));
    await tdb.query(`delete from public.message_outbox`);
    const o = await inClub(async (c) => (await c.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id as string);
    await inClub((c) => c.query(`insert into public.booking_coach_add (club_id, order_id, booking_id, coach_id, status, hold_expires_at) values ($1,$2,$3,$4,'pending', now() + interval '1 hour')`, [A, o, b, C1]));
    expect(await sent()).toEqual([]);
    await inClub((c) => c.query(`update public.booking_coach_add set status = 'confirmed', hold_expires_at = null where order_id = $1`, [o]));
    expect((await sent()).map((m) => [m.user_id, m.params.change])).toEqual([[C1, 'booked']]);
  });
});

describe('a group seat (A-6)', () => {
  it('a seat booked tells the session\'s coach, one message per seat; a seat cancelled tells again; the same seat twice sends once', async () => {
    const s = await inClub((c) => session(c));
    const seat1 = await inClub((c) => booking(c, { type: 'class_seat', session: s, start: '2026-12-21T03:00:00Z' }));
    const seat2 = await inClub((c) => booking(c, { type: 'class_seat', session: s, start: '2026-12-21T03:00:00Z', customer: P2 }));
    await inClub((c) => set(c, seat1, `confirmed_at = app.now()`));
    await inClub((c) => set(c, seat2, `status = 'cancelled'`));
    const m = await sent();
    expect(m.map((x) => [x.user_id, x.params.change, x.params.session_id])).toEqual([[C1, 'booked', s], [C1, 'booked', s], [C1, 'cancelled', s]]);
    expect(new Set(m.map((x) => x.dedupe_key)).size).toBe(3);
  });
  it('a held seat sends nothing until it is confirmed; a seat cancelled because the whole session was cancelled sends nothing (F08 sends one message)', async () => {
    const s = await inClub((c) => session(c));
    const held = await inClub((c) => booking(c, { type: 'class_seat', session: s, start: '2026-12-21T03:00:00Z', status: 'awaiting_payment' }));
    expect(await sent()).toEqual([]);
    await inClub((c) => set(c, held, `status = 'confirmed', confirmed_at = app.now(), hold_expires_at = null`));
    expect(await sent()).toHaveLength(1);
    await inClub(async (c) => {
      await c.query(`update public.class_session set status = 'cancelled', cancel_reason = 'owner', cancelled_at = app.now(), attention_reason = null where id = $1`, [s]);
      await set(c, held, `status = 'cancelled'`);
    });
    expect(await sent()).toHaveLength(1);
  });
  it('another coach\'s session never reaches this coach', async () => {
    const s = await inClub((c) => session(c, { coach: C2 }));
    await inClub((c) => booking(c, { type: 'class_seat', session: s, start: '2026-12-21T03:00:00Z' }));
    expect((await sent()).map((m) => m.user_id)).toEqual([C2]);
  });
});

describe('safety', () => {
  it('with no club in the context nothing is enqueued and the booking still saves', async () => {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('app.club_id', '', true)`);
      const o = (await c.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id as string;
      await c.query(`insert into public.booking (club_id, order_id, type, resource_id, customer_id, coach_id, start_at, end_at, status, source, created_by, confirmed_at)
                     values ($1,$2,'solo_class',$3,$4,$5,'2026-12-25T03:00:00Z','2026-12-25T04:00:00Z','confirmed','online',$4, now())`, [A, o, R1, P1, C1]);
      await c.query('commit');
    } finally {
      c.release();
    }
    expect(await sent()).toEqual([]);
    expect((await tdb.query(`select count(*)::int as n from public.booking`)).rows[0].n).toBe(1);
  });
});
