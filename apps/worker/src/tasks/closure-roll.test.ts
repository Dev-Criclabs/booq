import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db, type ClubContext } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { listClubIds } from '../club-list';
import { CLOSURE_ROLL, runClosureRoll } from './closure-roll';
import { closeTestDatabase } from '../testing/teardown';

// F09-T10 closure_roll (CANCEL-03-AC9, A-8; F09 design 8): once a day, per Live or Paused club, each repeat closure gains the
// occurrences the booking window now reaches, one closure per transaction (app.closures_due_roll, app.roll_closure), and a
// booking found there is cancelled with the same routine. Time is the database's test clock.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURT = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT_B = 'c1c1c1c1-0000-4000-8000-0000000000b2';
const courtOf = (club: string) => (club === A ? COURT : COURT_B);
const P1 = '11111111-1111-4111-8111-111111111111';
const DESK = '33333333-3333-4333-8333-333333333333';
const H = (h: number, day = 0) => new Date(Date.parse('2026-12-03T00:00:00+07:00') + (day * 24 + h) * 3_600_000).toISOString();

let tdb: TestDatabase;
let app: Db;
let worker: Db;
const desk = (club = A): ClubContext => ({ clubId: club, userId: DESK, roles: ['front_desk', 'player'], requestId: 'r', source: 'admin' });
const player = (): ClubContext => ({ clubId: A, userId: P1, roles: ['player'], requestId: 'r', source: 'player_app' });
const closedSlots = async (club: string) => (await tdb.query(`select count(*)::int n from public.occupancy where club_id = $1 and kind = 'closure'`, [club])).rows[0].n as number;
const deps = () => ({ listClubIds: () => listClubIds(worker) });

async function club(id: string, slug: string) {
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,$2,'ก','A','live')`, [id, slug]);
  for (const [u, roles] of [[P1, ['player']], [DESK, ['front_desk', 'player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [id, u, 'L' + u + slug]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [id, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main')`, [id, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [id, courtOf(id), LOC]);
  for (let d = 1; d <= 7; d += 1) await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [id, d]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15'), ($1,'cancel_window_hours','12')`, [id]);
}
const weekly = (c = A) =>
  app.withClubTx(desk(c), async (tx) => (await tx.query(`select app.create_closure($1::uuid[], $2, $3, '{"kind":"weekly","weekdays":[4]}'::jsonb, 'maintenance') as r`, [[courtOf(c)], H(17), H(21)])).rows[0]!.r.closure as string);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await club(A, 'a');
  await club(B, 'b');
  app = createDb({ connectionString: tdb.url, max: 2 });
  worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await app.end();
  await worker.end();
  await closeTestDatabase(tdb);
});

describe('closure_roll (F09-T10)', () => {
  it('a repeat closure gains its next occurrence once as the window reaches it, in every club', async () => {
    await weekly(A);
    await weekly(B);
    expect(await closedSlots(A)).toBe(5);
    expect(await runClosureRoll(worker, deps())).toMatchObject({ due: 0, rolled: 0, failed: 0 });
    await tdb.setNow('2026-12-08T03:00:00Z');   // the window now reaches Thursday 7 January 2027
    expect(await runClosureRoll(worker, deps())).toMatchObject({ clubs: 2, due: 2, rolled: 2, failed: 0 });
    expect(await closedSlots(A)).toBe(6);
    expect(await closedSlots(B)).toBe(6);
    expect(await runClosureRoll(worker, deps())).toMatchObject({ due: 0, rolled: 0 });
    expect(await closedSlots(A)).toBe(6);
  });

  it('a booking beyond the window found in a new occurrence is cancelled with the same routine (A-8)', async () => {
    const closure = await weekly(A);
    await tdb.query(`update public.club_setting set value = '40' where club_id = $1 and key = 'booking_window_days'`, [A]);
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id as string;
    const r = await app.withClubTx(player(), async (tx) => (await tx.query(`select app.reserve_court($1, $2, $3::timestamptz[]) as r`, [order, COURT, [H(18, 35)]])).rows[0]!.r);
    await app.withClubTx(desk(), (tx) => tx.query(`select app.confirm_booking($1)`, [order]));
    expect(await runClosureRoll(worker, deps())).toMatchObject({ due: 1, rolled: 1 });
    const b = (await tdb.query(`select status from public.booking where id = $1`, [r.booking_ids[0]])).rows[0].status;
    expect(b).toBe('cancelled');
    expect((await tdb.query(`select kind, closure_id, by_user from public.booking_cancel where booking_id = $1`, [r.booking_ids[0]])).rows)
      .toEqual([{ kind: 'closure', closure_id: closure, by_user: null }]);
  });

  it('records the run in the heartbeat under its name', async () => {
    await runClosureRoll(worker, deps());
    expect((await tdb.query(`select count(*)::int n from platform.worker_heartbeat where task_name = $1`, [CLOSURE_ROLL])).rows[0].n).toBe(1);
  });
});
