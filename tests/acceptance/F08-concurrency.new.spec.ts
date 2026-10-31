// F08-T20 (QA) concurrency: a freed seat offered to the first in line while a walk-in takes a seat at the same instant, and an offer expiring while its claim confirms.
// IDs: CLASS-01-AC4, CLASS-02-AC6, AC7, AC14, WAIT-01-AC2, CC-4. Setup follows the lane's waitlist-functions test.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { raceAll } from '../support/parallel';
import { createDb, type Db } from '../../packages/db/src/tx';
import { createTestDatabase, type TestDatabase } from '../../packages/db/src/testing/harness';

const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const OWNER = '44444444-4444-4444-8444-444444444444';
const P = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-0000000003${String(i).padStart(2, '0')}`);
let tdb: TestDatabase;
let db: Db;
let session: string;
let dbw: Db;

async function person(id: string, roles: string[]) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, date_of_birth) values ($1,$2,$3,'1990-01-01')`, [A, id, 'L' + id]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [A, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
async function seat(customer: string) {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id;
  const s = (await tdb.query(`select start_at, end_at, resource_id from public.class_session where id = $1`, [session])).rows[0];
  return (await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, class_session_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
     values ($1,$2,'class_seat',$3,$4,$5,$6,$7,'confirmed','online',$7, app.now()) returning id`,
    [A, order, s.resource_id, session, s.start_at, s.end_at, customer])).rows[0].id as string;
}
async function internal(sql: string, params: unknown[] = []) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.club_id', $1, true)`, [A]);
    await c.query('set local role booq_owner');
    const r = await c.query(sql, params);
    await c.query('commit');
    return r.rows[0];
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const ctx = (user: string, roles: string[] = ['player']) => ({ clubId: A, userId: user, roles: roles as never, source: 'player_app' as const });
const entry = async (user: string) => (await tdb.query(`select e.offer_expires_at, b.hold_expires_at from public.waitlist_entry e left join public.booking b on b.id = e.offer_booking_id where e.customer_id = $1 and e.class_session_id = $2`, [user, session])).rows[0];

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-11-30T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, C1, LOC]);
  await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) select $1, d, '06:00', '24:00' from generate_series(1, 7) d`, [A]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15'), ($1,'waitlist_claim_minutes','30'), ($1,'waitlist_no_offer_hours','2'), ($1,'cancel_window_hours','12')`, [A]);
  await person(OWNER, ['owner', 'player']);
  for (const p of P) await person(p, ['player']);
  await tdb.seedCoach(A, COACH);
  const tpl = (await tdb.query(`insert into public.class_template (club_id, name_th, name_en, audience, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by) values ($1,'ก','Group','adult',$2,$3,3,'18:00',1,2,$4) returning id`, [A, COACH, C1, OWNER])).rows[0].id;
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

const ctxOf = (user: string) => ({ clubId: A, userId: user, roles: ['player'] as never, source: 'player_app' as const });
async function sessions(n: number): Promise<string[]> {
  return (await tdb.query(`select id from public.class_session where status = 'scheduled' order by start_at limit $1`, [n])).rows.map((r) => r.id as string);
}
async function seatFor(customer: string, sess: string, status: 'confirmed' | 'awaiting_payment' = 'confirmed') {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id;
  const s = (await tdb.query(`select start_at, end_at, resource_id from public.class_session where id = $1`, [sess])).rows[0];
  const b = (await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, class_session_id, start_at, end_at, customer_id, status, source, created_by, hold_expires_at, confirmed_at)
     values ($1,$2,'class_seat',$3,$4,$5,$6,$7,$8,'online',$7, $9, $10) returning id`,
    [A, order, s.resource_id, sess, s.start_at, s.end_at, customer, status, status === 'awaiting_payment' ? new Date(Date.now() + 600000).toISOString() : null, status === 'confirmed' ? new Date().toISOString() : null])).rows[0].id as string;
  return { order: order as string, booking: b };
}
const taken = async (sess: string) => (await tdb.query(`select count(*)::int as n from public.booking where class_session_id = $1 and type = 'class_seat' and (status = 'confirmed' or (status = 'awaiting_payment' and hold_expires_at > app.now()))`, [sess])).rows[0].n as number;

it('F08-T20 a seat freed by a cancel is offered to the first in line while a walk-in asks for it at the same instant: the session never holds more than its maximum, and the spot is the offer holder\'s or the walk-in\'s, never both', async () => {
  const list = await sessions(5);
  expect(list.length).toBeGreaterThanOrEqual(4);
  for (const [i, sess] of list.slice(0, 4).entries()) {
    const a = await seatFor(P[0]!, sess);
    await seatFor(P[1]!, sess);
    await db.withClubTx(ctxOf(P[2]!), async (tx) => tx.query(`select app.join_waitlist($1, null, null)`, [sess]));
    const walkInOrder = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P[3]])).rows[0].id as string;
    const out = await raceAll([
      () => db.withClubTx(ctxOf(P[0]!), async (tx) => tx.query(`select app.cancel_booking($1, false, false, null)`, [a.booking])),
      () => db.withClubTx(ctxOf(P[3]!), async (tx) => tx.query(`select app.take_seat($1, $2)`, [walkInOrder, sess])),
    ], { jitterMs: 2 });
    for (const o of out) if (o.status === 'error') expect(String((o as { error: unknown }).error), `round ${i}: a business refusal, not a crash`).toMatch(/session_full|BK001|not_in_time|already/);
    expect(await taken(sess), `round ${i}: never over the maximum of 2`).toBeLessThanOrEqual(2);
    const offered = (await tdb.query(`select status from public.waitlist_entry where customer_id = $1 and class_session_id = $2`, [P[2], sess])).rows[0]?.status as string | undefined;
    const walkIn = (await tdb.query(`select count(*)::int as n from public.booking where class_session_id = $1 and customer_id = $2 and status in ('confirmed','awaiting_payment')`, [sess, P[3]])).rows[0].n as number;
    expect(walkIn, `round ${i}: the walk-in never gets the seat that the first in line is waiting for`).toBe(0);
    expect(offered, `round ${i}: the freed seat is offered to the first in line`).toBe('offered');
  }
}, 120_000);

it('F08-T20 an offer that expires while its holder confirms the seat: exactly one outcome, never a confirmed seat on an expired entry', async () => {
  const list = await sessions(5);
  for (const [i, sess] of list.slice(0, 4).entries()) {
    const a = await seatFor(P[0]!, sess);
    await seatFor(P[1]!, sess);
    await db.withClubTx(ctxOf(P[2]!), async (tx) => tx.query(`select app.join_waitlist($1, null, null)`, [sess]));
    await tdb.query(`update public.booking set status = 'cancelled' where id = $1`, [a.booking]);
    await internal(`select app.waitlist_advance($1, null, null)`, [sess]);
    const e = (await tdb.query(`select id, offer_booking_id from public.waitlist_entry where customer_id = $1 and class_session_id = $2`, [P[2], sess])).rows[0];
    const order = (await tdb.query(`select order_id from public.booking where id = $1`, [e.offer_booking_id])).rows[0].order_id as string;
    await tdb.setNow(new Date(Date.parse((await tdb.query(`select offer_expires_at from public.waitlist_entry where id = $1`, [e.id])).rows[0].offer_expires_at) + 1000).toISOString());   // the offer has just ended
    const out = await raceAll([
      () => dbw.withClubTx({ clubId: A, userId: null, roles: [] as never, source: 'job' as const, actorLabel: 'offer_expiry' }, async (tx) => tx.query(`select app.offer_expire($1) as r`, [e.id])),
      () => dbw.withClubTx({ clubId: A, userId: null, roles: [] as never, source: 'webhook' as const }, async (tx) => tx.query(`select app.confirm_booking($1)`, [order])),
    ], { jitterMs: 2 });
    for (const o of out) if (o.status === 'error') expect(String((o as { error: unknown }).error), `round ${i}`).toMatch(/BK001|offer|not_|gone|expired/);
    const entry = (await tdb.query(`select status from public.waitlist_entry where id = $1`, [e.id])).rows[0].status as string;
    const booking = (await tdb.query(`select status from public.booking where id = $1`, [e.offer_booking_id])).rows[0].status as string;
    expect(!(booking === 'confirmed' && entry === 'expired'), `round ${i}: a confirmed seat on an expired entry (${booking}, ${entry})`).toBe(true);
    expect(await taken(sess), `round ${i}`).toBeLessThanOrEqual(2);
    await tdb.setNow('2026-11-30T03:00:00Z');
  }
}, 120_000);
