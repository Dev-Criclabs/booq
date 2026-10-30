import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F03-T06 / migration 0210: app.release_hold, the app.release_handlers registry and the lazy
// release of expired holds. BOOK-03-AC5, AC6, BOOK-04-AC6; decisions D45, D48.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const P1 = '11111111-2222-4333-8444-555555555555';
const P2 = '22222222-2222-4333-8444-555555555555';
const STAFF = '33333333-2222-4333-8444-555555555555';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const LOC_B = 'bbbbbbbb-0000-4000-8000-000000000001';
const COURT = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT_B = 'cbcbcbcb-0000-4000-8000-000000000003';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';

let tdb: TestDatabase;
let db: Db;
let dbw: Db; // the worker's connection role

const ctx = (clubId: string, userId: string | null, roles: string[]) => ({ clubId, userId, roles, requestId: 'r1', source: 'player_app' as const });
const player = (u = P1) => ctx(A, u, ['player']);
const staff = ctx(A, STAFF, ['front_desk']);
const worker = ctx(A, null, []);

// 18:00 Bangkok on 2 Dec 2026 is 11:00Z. Now is 1 Dec 03:00Z.
const hour = (n: number) => [`2026-12-02T${String(11 + n).padStart(2, '0')}:00:00Z`, `2026-12-02T${String(12 + n).padStart(2, '0')}:00:00Z`];

/** An order of `hours` consecutive hours on COURT, each with a booking and a held occupancy row. */
async function holdOrder(opts: { club?: string; court?: string; customer?: string; hours?: number; first?: number; expires?: string; coach?: string } = {}) {
  const club = opts.club ?? A;
  const court = opts.court ?? COURT;
  const customer = opts.customer ?? P1;
  const expires = opts.expires ?? '2026-12-01T03:15:00Z';
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [club, customer])).rows[0].id as string;
  const bookings: string[] = [];
  for (let i = 0; i < (opts.hours ?? 1); i += 1) {
    const [s, e] = hour((opts.first ?? 0) + i);
    const b = (
      await tdb.query(
        `insert into public.booking (club_id, order_id, type, resource_id, coach_id, start_at, end_at, customer_id, status, source, created_by, hold_expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'awaiting_payment','online',$8,$9) returning id`,
        [club, order, opts.coach ? 'solo_class' : 'court', court, opts.coach ?? null, s, e, customer, expires],
      )
    ).rows[0].id as string;
    await tdb.query(
      `insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, hold_expires_at, booking_id)
       values ($1,$2,$3,$4,$5,$6,'held',$7,$8)`,
      [club, opts.coach ? 'solo_class' : 'court_booking', court, opts.coach ?? null, s, e, expires, b],
    );
    bookings.push(b);
  }
  return { order, bookings };
}

const status = async (order: string) => (await tdb.query('select status, release_reason, hold_expires_at from public.booking where order_id = $1 order by start_at', [order])).rows;
const occupancyCount = async () => (await tdb.query('select count(*)::int as n from public.occupancy')).rows[0].n as number;
const release = (c: ReturnType<typeof ctx>, order: string, reason: string) =>
  (c === worker ? dbw : db).withClubTx(c, async (tx) => (await tx.query('select app.release_hold($1, $2) as released', [order, reason])).rows[0]?.released as boolean);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'club-a','ก','A'), ($2,'club-b','ข','B')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main'), ($3,$4,'Main')`, [A, LOC, B, LOC_B]);
  await tdb.query(
    `insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($4,$5,$6,'1','tennis')`,
    [A, COURT, LOC, B, COURT_B, LOC_B],
  );
  // A recording handler, as F06, F08 and F10 will register theirs.
  await tdb.query(`create table public.t_handler_calls (order_id uuid, reason text)`);
  await tdb.query(`grant all on public.t_handler_calls to booq_owner`);
  await tdb.query(`create function public.t_handler(p_order uuid, p_reason text) returns void language sql as $$ insert into public.t_handler_calls values (p_order, p_reason) $$`);
  await tdb.query(`select app.register_release_handler('test', 'public.t_handler'::regproc, 100)`);
  db = createDb({ connectionString: tdb.url, max: 4 });
  dbw = createDb({ connectionString: tdb.url, max: 4, role: 'booq_worker' });
});
afterEach(async () => {
  await db.end();
  await dbw.end();
  await tdb.close();
});

describe('release_hold (BOOK-03-AC5)', () => {
  it('releases every hour of the order together, deletes the held rows and clears the hold', async () => {
    const { order } = await holdOrder({ hours: 3 });
    expect(await release(player(), order, 'player')).toBe(true);
    const rows = await status(order);
    expect(rows.map((r) => r.status)).toEqual(['released', 'released', 'released']);
    expect(rows.map((r) => r.release_reason)).toEqual(['player', 'player', 'player']);
    expect(rows.every((r) => r.hold_expires_at === null)).toBe(true);
    expect(await occupancyCount()).toBe(0);
  });

  it('runs each registered handler once per order, not once per hour (D45)', async () => {
    const { order } = await holdOrder({ hours: 3 });
    await release(player(), order, 'player');
    const calls = await tdb.query('select order_id, reason from public.t_handler_calls');
    expect(calls.rows).toEqual([{ order_id: order, reason: 'player' }]);
  });

  it('a second release does nothing and does not run the handler again', async () => {
    const { order } = await holdOrder({ hours: 2 });
    expect(await release(player(), order, 'player')).toBe(true);
    expect(await release(player(), order, 'player')).toBe(false);
    expect((await tdb.query('select count(*)::int as n from public.t_handler_calls')).rows[0].n).toBe(1);
  });

  it('two releases in parallel give exactly one outcome and one handler run', async () => {
    const { order } = await holdOrder({ hours: 2 });
    const results = await Promise.all([release(player(), order, 'player'), release(worker, order, 'closed')]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await tdb.query('select count(*)::int as n from public.t_handler_calls')).rows[0].n).toBe(1);
  });

  it('a failing handler undoes the release', async () => {
    await tdb.query(`create function public.t_bad(p_order uuid, p_reason text) returns void language plpgsql as $$ begin raise exception 'handler failed'; end $$`);
    await tdb.query(`select app.register_release_handler('bad', 'public.t_bad'::regproc, 200)`);
    const { order } = await holdOrder();
    await expect(release(player(), order, 'player')).rejects.toThrow(/handler failed/);
    expect((await status(order))[0].status).toBe('awaiting_payment');
    expect(await occupancyCount()).toBe(1);
  });

  it('handlers run in their order', async () => {
    await tdb.query(`create function public.t_first(p_order uuid, p_reason text) returns void language sql as $$ insert into public.t_handler_calls values (p_order, 'first') $$`);
    await tdb.query(`select app.register_release_handler('first', 'public.t_first'::regproc, 50)`);
    const { order } = await holdOrder();
    await release(player(), order, 'player');
    const calls = await tdb.query('select reason from public.t_handler_calls');
    expect(calls.rows.map((r) => r.reason)).toEqual(['first', 'player']);
  });

  it('leaves a confirmed order alone', async () => {
    const { order } = await holdOrder();
    await tdb.query(`update public.booking set status = 'confirmed', hold_expires_at = null, confirmed_at = now() where order_id = $1`, [order]);
    await tdb.query(`update public.occupancy set state = 'confirmed', hold_expires_at = null`);
    expect(await release(staff, order, 'staff')).toBe(false);
    expect((await status(order))[0].status).toBe('confirmed');
    expect(await occupancyCount()).toBe(1);
  });
});

describe('who may release, by reason', () => {
  it("a player releases only their own order, with reason 'player'", async () => {
    const { order } = await holdOrder();
    await expect(release(player(P2), order, 'player')).rejects.toThrow(/not allowed/i);
    expect((await status(order))[0].status).toBe('awaiting_payment');
    expect(await release(player(), order, 'player')).toBe(true);
  });

  it('a player cannot use the staff or closed reasons', async () => {
    const { order } = await holdOrder();
    await expect(release(player(), order, 'staff')).rejects.toThrow(/not allowed/i);
    await expect(release(player(), order, 'closed')).rejects.toThrow(/not allowed/i);
  });

  it('a guest cannot release anything', async () => {
    const { order } = await holdOrder();
    await expect(release(ctx(A, null, ['guest']), order, 'player')).rejects.toThrow(/not allowed/i);
    await expect(release(ctx(A, null, ['guest']), order, 'closed')).rejects.toThrow(/not allowed/i);
  });

  it('front desk releases with staff or closed; the worker with closed (D48)', async () => {
    const one = await holdOrder();
    const two = await holdOrder({ first: 3 });
    expect(await release(staff, one.order, 'staff')).toBe(true);
    expect(await release(worker, two.order, 'closed')).toBe(true);
    expect((await status(two.order))[0].release_reason).toBe('closed');
  });

  it("'expired' only releases a hold that has ended", async () => {
    const live = await holdOrder({ expires: '2026-12-01T03:15:00Z' });
    expect(await release(worker, live.order, 'expired')).toBe(false);
    expect((await status(live.order))[0].status).toBe('awaiting_payment');
    await tdb.setNow('2026-12-01T03:15:00Z');
    expect(await release(worker, live.order, 'expired')).toBe(true);
    expect((await status(live.order))[0].release_reason).toBe('expired');
  });

  it('an unknown reason is refused', async () => {
    const { order } = await holdOrder();
    await expect(release(staff, order, 'because')).rejects.toThrow(/reason/i);
  });

  it("another club's order is not found (CC-1)", async () => {
    const other = await holdOrder({ club: B, court: COURT_B });
    expect(await release(ctx(A, STAFF, ['front_desk']), other.order, 'staff')).toBe(false);
    expect((await status(other.order))[0].status).toBe('awaiting_payment');
  });
});

describe('lazy release inside the claim (BOOK-03-AC6, BOOK-04-AC6, FA T8)', () => {
  const lazy = (resource: string, coach: string | null, hours: number[]) =>
    dbw.withClubTx(worker, async (tx) => {
      const [s] = hour(hours[0]!);
      const [, e] = hour(hours[hours.length - 1]!);
      return (await tx.query('select app.release_expired_overlapping($1, $2, $3, $4) as n', [resource, coach, s, e])).rows[0]?.n as number;
    });

  it('an expired hold with the job not run does not block the next claim, and ends released', async () => {
    const old = await holdOrder({ expires: '2026-12-01T03:15:00Z' });
    await tdb.setNow('2026-12-01T03:16:00Z');
    expect(await lazy(COURT, null, [0])).toBe(1);
    // The constraint now lets the next claim in.
    await tdb.query(
      `insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, closure_id) values ($1,'closure',$2,$3,$4,'confirmed',gen_random_uuid())`,
      [A, COURT, ...hour(0)],
    );
    expect((await status(old.order))[0]).toMatchObject({ status: 'released', release_reason: 'expired' });
    expect((await tdb.query('select count(*)::int as n from public.t_handler_calls')).rows[0].n).toBe(1);
  });

  it('a live hold is not released', async () => {
    const live = await holdOrder({ expires: '2026-12-01T03:15:00Z' });
    expect(await lazy(COURT, null, [0])).toBe(0);
    expect((await status(live.order))[0].status).toBe('awaiting_payment');
  });

  it('only holds that overlap the range are released', async () => {
    const near = await holdOrder({ first: 0 });
    const far = await holdOrder({ first: 5 });
    await tdb.setNow('2026-12-01T03:16:00Z');
    expect(await lazy(COURT, null, [0])).toBe(1);
    expect((await status(near.order))[0].status).toBe('released');
    expect((await status(far.order))[0].status).toBe('awaiting_payment');
  });

  it('a multi hour expired order is released whole when one of its hours overlaps', async () => {
    const old = await holdOrder({ hours: 3 });
    await tdb.setNow('2026-12-01T03:16:00Z');
    expect(await lazy(COURT, null, [1])).toBe(1);
    expect((await status(old.order)).map((r) => r.status)).toEqual(['released', 'released', 'released']);
    expect(await occupancyCount()).toBe(0);
  });

  it("a coach's expired hold on another court is released too", async () => {
    const solo = await holdOrder({ coach: COACH });
    await tdb.setNow('2026-12-01T03:16:00Z');
    const other = 'c2c2c2c2-0000-4000-8000-000000000002';
    await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'2','tennis')`, [A, other, LOC]);
    expect(await lazy(other, COACH, [0])).toBe(1);
    expect((await status(solo.order))[0].status).toBe('released');
  });
});
