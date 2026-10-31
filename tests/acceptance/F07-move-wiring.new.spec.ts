// F07-T09 (QA): app.move_booking is wired to app.coach_rules_check_move, so a moved solo class ignores its own row (COACH-01-AC11, R3-AC7; design A-3).
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createDb, type Db } from '../../packages/db/src/tx';
import { createTestDatabase, type TestDatabase } from '../../packages/db/src/testing/harness';

const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
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
const H = (h: number) => new Date(`2026-12-02T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();

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
  db = createDb({ connectionString: tdb.url, max: 3 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

const owner = () => ({ clubId: A, userId: OWNER, roles: ['owner', 'player'] as never, source: 'admin' as never });
/** A confirmed solo class of the player with COACH at hour h on court C1, as payment leaves it. */
async function solo(h: number): Promise<string> {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, PLAYER])).rows[0].id;
  const b = (await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at, coach_id)
     values ($1,$2,'solo_class',$3,$4,$5,$6,'confirmed','online',$6, app.now(), $7) returning id`, [A, order, C1, H(h), H(h + 1), PLAYER, COACH])).rows[0].id as string;
  await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, booking_id) values ($1,'solo_class',$2,$3,$4,$5,'confirmed',$6)`, [A, C1, COACH, H(h), H(h + 1), b]);
  return b;
}
const move = (b: string, h: number) => db.withClubTx(owner(), async (tx) => (await tx.query(`select app.move_booking($1, $2, $3) as r`, [b, C1, H(h)])).rows[0]!.r as boolean);

it('F07-T09 the move hook is the move version of the rest rule check, not the plain one', async () => {
  const r = (await tdb.query(`select handler::text as h from app.coach_rules_move_hook`)).rows;
  expect(r.map((x) => x.h)).toEqual(['app.coach_rules_check_move']);
});

it('F07-T09 COACH-01-AC11 a solo class moved inside its own run is not counted twice: six in a row, move the last to the hour before the run', async () => {
  const ids: string[] = [];
  for (const h of [10, 11, 12, 13, 14, 15]) ids.push(await solo(h));
  expect(await move(ids[5]!, 9)).toBe(true);   // the run is 9 to 14: six, with its old hour (15) not counted
  const occ = (await tdb.query(`select start_at from public.occupancy where booking_id = $1`, [ids[5]])).rows[0].start_at as Date;
  expect(occ.toISOString()).toBe(H(9));
});

it('F07-T09 R3 a move that does make a seventh hour in a row is refused with rest_rule and nothing moves', async () => {
  const ids: string[] = [];
  for (const h of [10, 11, 12, 13, 14, 15]) ids.push(await solo(h));
  const lone = await solo(18);
  await expect(move(lone, 16)).rejects.toThrow(/rest_rule/);   // 10 to 16 is seven
  expect(((await tdb.query(`select start_at from public.occupancy where booking_id = $1`, [lone])).rows[0].start_at as Date).toISOString()).toBe(H(18));
  expect(await move(lone, 17)).toBe(true);   // 10 to 15 is six, 17 is on its own: a free hour 16 breaks the run
});
