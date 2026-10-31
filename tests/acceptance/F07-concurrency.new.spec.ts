// F07-T20 (QA) concurrency: substitutions of two coaches in opposite directions (lock order by id), and a player's Add a coach racing a staff booking of the same coach. IDs: COACH-01, COACH-03, R4, BOOK-04, CC-4.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { raceAll } from '../support/parallel';
import { createDb, type Db } from '../../packages/db/src/tx';
import { createTestDatabase, type TestDatabase } from '../../packages/db/src/testing/harness';

const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const COACH2 = 'e1e1e1e1-0000-4000-8000-000000000008';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const OWNER = '44444444-4444-4444-8444-444444444444';
let tdb: TestDatabase;
let db: Db;

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
const H = (h: number) => new Date(Date.parse('2026-12-02T00:00:00+07:00') + h * 3_600_000).toISOString();   // h may pass 24: the next days

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, C1, LOC]);
  await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) select $1, d, '06:00', '24:00' from generate_series(1, 7) d`, [A]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [A]);
  await person(PLAYER, ['player']);
  await person(OWNER, ['owner', 'player']);
  await tdb.seedCoach(A, COACH);
  await tdb.seedCoach(A, COACH2);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'2','tennis')`, [A, C2, LOC]);
  db = createDb({ connectionString: tdb.url, max: 3 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

/** A lock order bug shows only now and then; QA_ROUNDS=150 runs the swap test long enough to see one. */
const ROUNDS = Number(process.env['QA_ROUNDS'] ?? 8);
const owner = () => ({ clubId: A, userId: OWNER, roles: ['owner', 'player'] as never, source: 'admin' as never });
const player = () => ({ clubId: A, userId: PLAYER, roles: ['player'] as never, source: 'player_app' as never });
async function court(h: number, resource = C1): Promise<string> {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, PLAYER])).rows[0].id;
  const b = (await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
     values ($1,$2,'court',$3,$4,$5,$6,'confirmed','online',$6, app.now()) returning id`, [A, order, resource, H(h), H(h + 1), PLAYER])).rows[0].id as string;
  await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, booking_id) values ($1,'court_booking',$2,$3,$4,'confirmed',$5)`, [A, resource, H(h), H(h + 1), b]);
  return b;
}
async function solo(h: number, coach: string, resource = C1): Promise<string> {
  const b = await court(h, resource);
  await tdb.query(`update public.occupancy set coach_id = $2, kind = 'solo_class' where booking_id = $1`, [b, coach]);
  await tdb.query(`update public.booking set coach_id = $2, type = 'solo_class' where id = $1`, [b, coach]);
  return b;
}
async function addOrder(money = 80000) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    const r = await c.query(
      `insert into public.orders (club_id, customer_id, source, status, price_group_snapshot, subtotal_satang, discount_satang, total_satang, credit_value_satang, wallet_satang, money_satang, quote_hash, priced_at)
       values ($1,$2,'online','open','{}'::jsonb,$3,0,$3,0,0,$3,repeat('a',64), app.now()) returning id`, [A, PLAYER, money]);
    await c.query('commit');
    return r.rows[0].id as string;
  } finally {
    c.release();
  }
}
const coachOf = async (b: string) => (await tdb.query(`select coach_id from public.occupancy where booking_id = $1`, [b])).rows[0]?.coach_id as string | null | undefined;
const coachRows = async (coach: string, h: number) => (await tdb.query(`select count(*)::int as n from public.occupancy where coach_id = $1 and start_at = $2`, [coach, H(h)])).rows[0].n as number;

it('F07-T20 two substitutions in opposite directions at once (coach 1 to 2, coach 2 to 1) never deadlock: both finish and the coaches swap', async () => {
  for (let round = 0; round < ROUNDS; round++) {
    const x = await solo(8 + round * 2, COACH, C1);
    const y = await solo(9 + round * 2, COACH2, C2);
    const out = await raceAll([
      () => db.withClubTx(owner(), async (tx) => tx.query(`select app.substitute_coach($1, $2, 'leave')`, [x, COACH2])),
      () => db.withClubTx(owner(), async (tx) => tx.query(`select app.substitute_coach($1, $2, 'leave')`, [y, COACH])),
    ], { jitterMs: 3 });
    expect(out.filter((o) => o.status === 'error').map((o) => String((o as { error: unknown }).error)), `round ${round}`).toEqual([]);
    expect([await coachOf(x), await coachOf(y)], `round ${round}`).toEqual([COACH2, COACH]);
  }
}, 300_000);

it('F07-T20 a player adding a coach and staff booking the same coach for the same hour at once: exactly one wins, the coach is never held twice', async () => {
  for (let round = 0; round < 8; round++) {
    const h = 8 + round * 2;
    const own = await court(h, C1);                                            // the player's court booking
    const add = await addOrder();
    const staffOrder = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, OWNER])).rows[0].id as string;
    const out = await raceAll([
      () => db.withClubTx(player(), async (tx) => tx.query(`select app.add_coach_to_booking($1, $2, $3)`, [own, COACH, add])),
      () => db.withClubTx(owner(), async (tx) => tx.query(`select app.reserve_court($1, $2, $3::timestamptz[], $4, null)`, [staffOrder, C2, [H(h)], COACH])),
    ], { jitterMs: 3 });
    const wins = out.filter((o) => o.status === 'ok').length;
    const losses = out.filter((o) => o.status === 'error') as Array<{ status: 'error'; error: unknown }>;
    for (const l of losses) expect(String(l.error), `round ${round}: a loser answers a business refusal, not a deadlock or a crash`).toMatch(/slot_unavailable|coach_unavailable|BK001/);
    expect(wins, `round ${round}: exactly one side wins`).toBe(1);
    expect(await coachRows(COACH, h), `round ${round}: the coach is held once`).toBe(1);
  }
}, 120_000);

// The order of the two coach locks cannot be seen by racing (the window is microseconds: 80 rounds with a wrong order still pass), so it is shown deterministically:
// a test connection holds the HIGHER coach id (COACH2) while the substitution COACH2 to COACH runs. With the id order it locks COACH first and then waits on COACH2, so
// COACH is already held while it waits; with a wrong order (from coach first) it waits on COACH2 holding nothing.
it('F07-T20 a substitution locks the two coaches in id order: the lower id is already held while it waits for the higher (mutation: from coach first)', async () => {
  const y = await solo(9, COACH2, C2);
  const holder = await tdb.pool.connect();
  const probe = await tdb.pool.connect();
  try {
    await holder.query('begin');
    await holder.query(`select id from public.coach where id = $1 for update`, [COACH2]);
    const sub = db.withClubTx(owner(), async (tx) => tx.query(`select app.substitute_coach($1, $2, 'leave')`, [y, COACH]));
    const settled = sub.then(() => 'done', (e) => String(e));
    // wait until the substitution is blocked on a lock
    let blocked = false;
    for (let i = 0; i < 100 && !blocked; i++) {
      blocked = (await tdb.query(`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()`)).rows[0].n > 0;
      if (!blocked) await new Promise((r) => setTimeout(r, 50));
    }
    expect(blocked, 'the substitution should be waiting for the held coach').toBe(true);
    await probe.query('begin');
    const err = await probe.query(`select id from public.coach where id = $1 for update nowait`, [COACH]).then(() => null, (e: { code?: string }) => e.code ?? 'error');
    await probe.query('rollback');
    expect(err, 'the lower coach id is already held by the waiting substitution').toBe('55P03');
    await holder.query('commit');
    expect(await settled).toBe('done');
  } finally {
    await holder.query('rollback').catch(() => undefined);
    holder.release();
    probe.release();
  }
}, 60_000);
