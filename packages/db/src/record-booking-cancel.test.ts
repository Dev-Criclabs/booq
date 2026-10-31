import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db, type ClubContext } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// Migration 1012: app.record_booking_cancel, the one writer of booking_cancel rows (F09 design 3.1). cancel_booking and
// the staff marks write through it (their own suites cover their results); F08's cancel_session calls it for each seat.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURT = 'c1c1c1c1-0000-4000-8000-000000000001';
const P1 = '11111111-1111-4111-8111-111111111111';
const DESK = '33333333-3333-4333-8333-333333333333';

let tdb: TestDatabase;
let db: Db;
const player = (): ClubContext => ({ clubId: A, userId: P1, roles: ['player'], requestId: 'r', source: 'player_app' });

/** Calls the helper as a definer would: role booq_owner, the club and the user in the context. */
async function record(booking: string, kind: string, outcome: string, returned: unknown, reason: string | null, closure: string | null = null) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role booq_owner');
    await c.query(`select set_config('app.club_id', $1, true), set_config('app.user_id', $2, true), set_config('app.source', 'admin', true)`, [A, DESK]);
    const id = (await c.query(`select app.record_booking_cancel($1, $2, $3, $4::jsonb, $5, $6) as id`, [booking, kind, outcome, JSON.stringify(returned), reason, closure])).rows[0].id as string;
    await c.query('commit');
    return id;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live')`, [A]);
  for (const [u, roles] of [[P1, ['player']], [DESK, ['front_desk', 'player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [A, u, 'L' + u.slice(0, 2)]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [A, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, COURT, LOC]);
  for (let d = 1; d <= 7; d += 1) await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [A, d]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [A]);
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

async function booking() {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id as string;
  const r = await db.withClubTx(player(), async (tx) => (await tx.query(`select app.reserve_court($1, $2, $3::timestamptz[]) as r`, [order, COURT, ['2026-12-03T11:00:00Z']])).rows[0]!.r);
  return { order, booking: r.booking_ids[0] as string };
}

describe('record_booking_cancel', () => {
  it('writes the next version with the order, who, the trimmed reason, credit_lost and the closure', async () => {
    const b = await booking();
    const closure = await tdb.seedClosure(A);
    await record(b.booking, 'club_cancel', 'returned', { lines: [], creditLost: 0 }, '  owner  ');
    await record(b.booking, 'closure', 'returned', { creditLost: 1 }, 'rain', closure);
    const rows = (await tdb.query(`select order_id, kind, version, reason, by_user, credit_lost, closure_id from public.booking_cancel where booking_id = $1 order by version`, [b.booking])).rows;
    expect(rows).toEqual([
      { order_id: b.order, kind: 'club_cancel', version: 1, reason: 'owner', by_user: DESK, credit_lost: false, closure_id: null },
      { order_id: b.order, kind: 'closure', version: 2, reason: 'rain', by_user: DESK, credit_lost: true, closure_id: closure },
    ]);
  });

  it('a player cancel stores no reason; a staff kind without one is refused by the table', async () => {
    const b = await booking();
    await record(b.booking, 'player_cancel', 'returned', {}, 'ignored');
    expect((await tdb.query(`select reason from public.booking_cancel where booking_id = $1`, [b.booking])).rows).toEqual([{ reason: null }]);
    await expect(record(b.booking, 'club_cancel', 'returned', {}, ' ')).rejects.toThrow(/booking_cancel_reason/);
  });

  it('an unknown booking is refused, and no app role can call it', async () => {
    await expect(record('99999999-9999-4999-8999-999999999999', 'club_cancel', 'returned', {}, 'x')).rejects.toThrow(/cancel:not_found/);
    const b = await booking();
    await expect(db.withClubTx(player(), (tx) => tx.query(`select app.record_booking_cancel($1, 'player_cancel', 'returned', '{}', null)`, [b.booking]))).rejects.toThrow(/permission denied/);
  });
});
