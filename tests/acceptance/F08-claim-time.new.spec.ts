// CLASS-02-AC13 at the database: changing the claim time or the cut off leaves offers already made with their own end time;
// the next offer uses the new values. Written by QA after the F07 and F08 sweeps. Setup follows the lane's waitlist-functions test.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createDb, type Db } from '../../packages/db/src/tx';
import { createTestDatabase, type TestDatabase } from '../../packages/db/src/testing/harness';

const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const OWNER = '44444444-4444-4444-8444-444444444444';
const P = Array.from({ length: 4 }, (_, i) => `00000000-0000-4000-8000-0000000003${String(i).padStart(2, '0')}`);
let tdb: TestDatabase;
let db: Db;
let session: string;

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
const iso = (v: Date) => new Date(v).toISOString();

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-11-30T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, C1, LOC]);
  await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) select $1, d, '06:00', '24:00' from generate_series(1, 7) d`, [A]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15'), ($1,'waitlist_claim_minutes','30'), ($1,'waitlist_no_offer_hours','2')`, [A]);
  await person(OWNER, ['owner', 'player']);
  for (const p of P) await person(p, ['player']);
  await tdb.seedCoach(A, COACH);
  const tpl = (await tdb.query(`insert into public.class_template (club_id, name_th, name_en, audience, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by) values ($1,'ก','Group','adult',$2,$3,3,'18:00',1,2,$4) returning id`, [A, COACH, C1, OWNER])).rows[0].id;
  db = createDb({ connectionString: tdb.url, max: 4 });
  await db.withClubTx(ctx(OWNER, ['owner', 'player']), async (tx) => tx.query(`select app.generate_sessions('2026-11-30'::date, '2026-12-31'::date)`));
  session = (await tdb.query(`select id from public.class_session where template_id = $1 order by start_at limit 1`, [tpl])).rows[0].id;
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

it('F08/CLASS-02-AC13 a changed claim time applies to the next offer only; the offer already made keeps its end time', async () => {
  const b0 = await seat(P[0]!);
  const b1 = await seat(P[1]!);
  for (const p of [P[2]!, P[3]!]) await db.withClubTx(ctx(p), async (tx) => tx.query(`select app.join_waitlist($1, null, null)`, [session]));
  await tdb.query(`update public.booking set status = 'cancelled' where id = $1`, [b0]);
  await internal(`select app.waitlist_advance($1, null, null)`, [session]);
  const first = await entry(P[2]!);
  expect(iso(first.offer_expires_at)).toBe('2026-11-30T03:30:00.000Z');

  await tdb.query(`update public.club_setting set value = '10' where key = 'waitlist_claim_minutes'`);
  await tdb.setNow('2026-11-30T03:05:00Z');
  await tdb.query(`update public.booking set status = 'cancelled' where id = $1`, [b1]);
  await internal(`select app.waitlist_advance($1, null, null)`, [session]);

  const again = await entry(P[2]!);
  expect(iso(again.offer_expires_at)).toBe('2026-11-30T03:30:00.000Z');       // the first offer is untouched
  expect(iso(again.hold_expires_at)).toBe('2026-11-30T03:30:00.000Z');
  const second = await entry(P[3]!);
  expect(iso(second.offer_expires_at)).toBe('2026-11-30T03:15:00.000Z');      // 03:05 plus the new 10 minutes
  expect(iso(second.hold_expires_at)).toBe('2026-11-30T03:15:00.000Z');
});

it('F08/CLASS-02-AC13 a changed cut off applies to the next spot only; an open offer stands', async () => {
  const b0 = await seat(P[0]!);
  await seat(P[1]!);
  for (const p of [P[2]!, P[3]!]) await db.withClubTx(ctx(p), async (tx) => tx.query(`select app.join_waitlist($1, null, null)`, [session]));
  await tdb.query(`update public.booking set status = 'cancelled' where id = $1`, [b0]);
  await internal(`select app.waitlist_advance($1, null, null)`, [session]);
  await tdb.query(`update public.club_setting set value = '72' where key = 'waitlist_no_offer_hours'`);   // now inside the cut off
  expect((await tdb.query(`select status from public.waitlist_entry where customer_id = $1`, [P[2]])).rows[0].status).toBe('offered');
  expect(iso((await entry(P[2]!)).offer_expires_at)).toBe('2026-11-30T03:30:00.000Z');
  const b1 = (await tdb.query(`select id from public.booking where customer_id = $1 and class_session_id = $2`, [P[1], session])).rows[0].id;
  await tdb.query(`update public.booking set status = 'cancelled' where id = $1`, [b1]);
  expect((await internal(`select app.waitlist_advance($1, null, null) as n`, [session])).n).toBe(0);      // the new cut off blocks a new offer
});
