import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F03-T30 / migration 0411: the release reason offer_ended, for a waitlist offer that ended (declined,
// expired or passed on). CLASS-02-AC2, AC14, WAIT-01-AC3; D155 (F08 design C-1, A-3); D159 numbering.
// The player of the offer (declining), staff and the worker (offer expiry, pass on) may end it.
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

describe('release reason offer_ended (F03-T30)', () => {
  it('releases a live hold and calls every release handler with offer_ended', async () => {
    const { order } = await holdOrder({ hours: 2 });
    expect(await release(worker, order, 'offer_ended')).toBe(true);
    expect(await status(order)).toEqual([
      { status: 'released', release_reason: 'offer_ended', hold_expires_at: null },
      { status: 'released', release_reason: 'offer_ended', hold_expires_at: null },
    ]);
    expect(await occupancyCount()).toBe(0);
    expect((await tdb.query('select order_id, reason from public.t_handler_calls')).rows).toEqual([{ order_id: order, reason: 'offer_ended' }]);
  });

  it('the player of the offer may decline it; another player may not', async () => {
    const { order } = await holdOrder();
    await expect(release(player(P2), order, 'offer_ended')).rejects.toThrow(/release not allowed/);
    expect((await status(order))[0].status).toBe('awaiting_payment');
    expect(await release(player(P1), order, 'offer_ended')).toBe(true);
  });

  it('staff may pass an offer on', async () => {
    const { order } = await holdOrder();
    expect(await release(staff, order, 'offer_ended')).toBe(true);
  });

  it('the existing reasons are unchanged; an unknown reason is still refused', async () => {
    const a = await holdOrder({ first: 0 });
    const b = await holdOrder({ first: 1 });
    expect(await release(player(P1), a.order, 'player')).toBe(true);
    expect(await release(worker, b.order, 'payment_unavailable')).toBe(true);
    const c = await holdOrder({ first: 2 });
    await expect(release(player(P1), c.order, 'staff')).rejects.toThrow(/release not allowed/);
    await expect(release(worker, c.order, 'offer_gone')).rejects.toThrow(/unknown release reason/);
    expect(await release(worker, c.order, 'expired')).toBe(false);   // a live hold does not end as expired
  });

  it('the booking table accepts offer_ended and nothing new besides', async () => {
    const { bookings } = await holdOrder();
    await expect(tdb.query(`update public.booking set status = 'released', release_reason = 'nope', released_at = now(), hold_expires_at = null where id = $1`, [bookings[0]])).rejects.toThrow(/booking_release_reason_values/);
  });
});
