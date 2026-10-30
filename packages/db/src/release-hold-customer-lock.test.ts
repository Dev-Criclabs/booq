import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// migration 0413: app.release_hold takes the order's customer lock first (FA 3.4 step 0), before the booking rows.
// The cycle it removes: the hold release job locked the order's bookings and then a release handler took the
// customer lock (F06's wallet and credit returns do, through lock_wallet and credit_return), while a Pay of the
// same customer held the customer lock (create_priced_order, 0318) and, inside reserve_court's lazy release,
// waited for those same booking rows. Both connections here have deadlock retries off, so a cycle fails the test.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURT = 'c1c1c1c1-0000-4000-8000-000000000001';
const X = '00000000-0000-4000-8000-000000000001';
const ROUNDS = 20;

let tdb: TestDatabase;
let db: Db;   // the app (Pay)
let dbw: Db;  // the worker (hold release job)
const slot = (n: number) => new Date(Date.parse('2026-12-02T08:00:00+07:00') + (Math.floor(n / 15) * 24 + (n % 15)) * 3_600_000).toISOString();

async function newOrder() {
  return (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, X])).rows[0].id as string;
}
const hold = async (order: string, start: string) =>
  db.withClubTx({ clubId: A, userId: X, roles: ['player'], requestId: 'r', source: 'player_app' }, (tx) =>
    tx.query(`select app.reserve_court($1, $2, $3::timestamptz[])`, [order, COURT, [start]]));

/** Pay as F04 runs it: the customer lock first (create_priced_order does this, 0318), then the claim. */
async function pay(order: string, start: string): Promise<string> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role booq_owner');   // Pay's functions are definers owned by booq_owner
    await c.query(`select set_config('app.club_id', $1, true), set_config('app.user_id', $2, true), set_config('app.roles', 'player', true), set_config('app.source', 'player_app', true), set_config('app.request_id', 'r', true)`, [A, X]);
    await c.query('select app.lock_customer($1)', [X]);
    await c.query(`select pg_sleep(0.01)`);       // Pay prices the order here; the job's release starts meanwhile
    await c.query(`select app.reserve_court($1, $2, $3::timestamptz[])`, [order, COURT, [start]]);
    await c.query('commit');
    return 'ok';
  } catch (e) {
    await c.query('rollback');
    return `${(e as { code?: string }).code}: ${(e as Error).message}`;
  } finally {
    c.release();
  }
}
const release = async (order: string): Promise<string> => {
  try {
    await dbw.withClubTx({ clubId: A, userId: null, roles: [], source: 'job', actorLabel: 'hold_release' }, (tx) => tx.query(`select app.release_hold($1, 'expired')`, [order]));
    return 'ok';
  } catch (e) {
    return `${(e as { code?: string }).code}: ${(e as Error).message}`;
  }
};

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live')`, [A]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, COURT, LOC]);
  for (let d = 1; d <= 7; d += 1) await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [A, d]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [A]);
  // A release handler that takes the customer lock, as F06's wallet and credit returns do (0505, 0506).
  await tdb.query(`create function public.t_customer_handler(p_order uuid, p_reason text) returns void language plpgsql as $$
    begin perform app.lock_customer((select customer_id from public.orders where id = p_order)); perform pg_sleep(0.01); end $$`);
  await tdb.query(`select app.register_release_handler('t_customer', 'public.t_customer_handler'::regproc, 99)`);
  db = createDb({ connectionString: tdb.url, max: 4, maxRetries: 0 });
  dbw = createDb({ connectionString: tdb.url, max: 4, role: 'booq_worker', maxRetries: 0 });
});
afterEach(async () => {
  await db.end();
  await dbw.end();
  await tdb.close();
});

describe('release_hold takes the customer lock first (FA 3.4)', () => {
  it(`${ROUNDS} rounds: the job releasing an expired hold and a Pay of the same customer for that slot never deadlock`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await tdb.setNow('2026-12-01T03:00:00Z');
      const old = await newOrder();
      await hold(old, slot(round));
      await tdb.setNow('2026-12-01T03:16:00Z');   // the old hold has ended; the job has not run
      const fresh = await newOrder();
      const [r, p] = await Promise.all([release(old), pay(fresh, slot(round))]);
      expect({ round, release: r, pay: p }).toEqual({ round, release: 'ok', pay: 'ok' });
      expect((await tdb.query(`select status from public.booking where order_id = $1`, [old])).rows[0].status).toBe('released');
      expect((await tdb.query(`select status from public.booking where order_id = $1`, [fresh])).rows[0].status).toBe('awaiting_payment');
    }
  }, 120_000);
});
