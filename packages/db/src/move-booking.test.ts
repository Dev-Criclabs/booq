import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F03-T15 / migration 0219: app.move_booking (staff). In-place update of the booking and its
// occupancy row; the exclusion constraints re-check the move, coach rules run, one customer
// message is enqueued through the move handlers. BOOK-04-AC7; D60, D107.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const LOC_B = 'bbbbbbbb-0000-4000-8000-000000000001';
const COURT1 = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT2 = 'c2c2c2c2-0000-4000-8000-000000000002';
const COURT3 = 'c3c3c3c3-0000-4000-8000-000000000003';
const COURT_B = 'cbcbcbcb-0000-4000-8000-000000000009';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const STAFF = '33333333-2222-4333-8444-555555555555';
const P1 = '00000000-0000-4000-8000-000000000001';
const P2 = '00000000-0000-4000-8000-000000000002';

let tdb: TestDatabase;
let db: Db;
const at = (time: string) => new Date(`2026-12-02T${time}+07:00`).toISOString();
const H = (h: number) => at(`${String(h).padStart(2, '0')}:00:00`);
type Who = { id: string; roles: string[]; club?: string };
const front: Who = { id: STAFF, roles: ['front_desk', 'player'] };
const owner: Who = { id: STAFF, roles: ['owner', 'player'] };
const player = (id = P1): Who => ({ id, roles: ['player'] });
const run = <T>(who: Who, fn: (tx: { query: (q: string, p?: unknown[]) => Promise<{ rows: any[] }> }) => Promise<T>) =>
  db.withClubTx({ clubId: who.club ?? A, userId: who.id, roles: who.roles, requestId: 'r', source: who.roles.includes('player') && who.roles.length === 1 ? 'player_app' : 'admin' }, fn);

async function book(customer: string, hour: number, o: { court?: string; coach?: string | null; confirm?: boolean } = {}) {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id as string;
  const res = await run(player(customer), async (tx) => (await tx.query(`select app.reserve_court($1, $2, $3::timestamptz[], $4) as r`, [order, o.court ?? COURT1, [H(hour)], o.coach ?? null])).rows[0].r);
  if (o.confirm) await run({ id: STAFF, roles: ['front_desk'] }, (tx) => tx.query(`select app.confirm_booking($1)`, [order]));
  return { order, booking: res.booking_ids[0] as string };
}
type Out = { ok: true; value: boolean } | { ok: false; code: string; detail: string | undefined };
async function move(who: Who, booking: string, court: string, hour: number | string): Promise<Out> {
  try {
    const start = typeof hour === 'number' ? H(hour) : hour;
    return { ok: true, value: await run(who, async (tx) => (await tx.query(`select app.move_booking($1, $2, $3) as ok`, [booking, court, start])).rows[0]?.ok as boolean) };
  } catch (e) {
    const err = e as { code?: string; message: string; detail?: string };
    if (err.code === 'BK001') return { ok: false, code: err.message, detail: err.detail };
    throw e;
  }
}
const where = async (booking: string) => (await tdb.query(`select b.resource_id, b.start_at, b.end_at, b.status, b.hold_expires_at, o.resource_id as o_resource, o.start_at as o_start, o.state from public.booking b join public.occupancy o on o.booking_id = b.id where b.id = $1`, [booking])).rows[0];
const calls = async () => (await tdb.query(`select * from public.t_move_calls order by n`)).rows;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main'), ($3,$4,'Main')`, [A, LOC, B, LOC_B]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport, active) values ($1,$2,$3,'1','tennis',true), ($1,$4,$3,'2','tennis',true), ($1,$5,$3,'3','tennis',false), ($6,$7,$8,'1','tennis',true)`, [A, COURT1, LOC, COURT2, COURT3, B, COURT_B, LOC_B]);
  for (const club of [A, B]) {
    for (let d = 1; d <= 7; d += 1) await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [club, d]);
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [club]);
  }
  // A recording move handler (F10 will register the customer message).
  await tdb.query(`create sequence public.t_move_seq`);
  await tdb.query(`create table public.t_move_calls (n int default nextval('public.t_move_seq'), booking uuid, from_resource uuid, from_start timestamptz, to_resource uuid, to_start timestamptz)`);
  await tdb.query(`grant all on public.t_move_calls, public.t_move_seq to booq_owner`);
  await tdb.query(`create function public.t_move(p_booking uuid, p_from_resource uuid, p_from_start timestamptz, p_to_resource uuid, p_to_start timestamptz) returns void language sql as $$ insert into public.t_move_calls (booking, from_resource, from_start, to_resource, to_start) values ($1,$2,$3,$4,$5) $$`);
  await tdb.query(`select app.register_move_handler('test', 'public.t_move'::regproc, 100)`);
  db = createDb({ connectionString: tdb.url, max: 6 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('a move (BOOK-04-AC7)', () => {
  it('moves booking and occupancy in place to another hour and court, keeping status and hold', async () => {
    const { booking } = await book(P1, 18);
    const before = await where(booking);
    expect(await move(front, booking, COURT2, 20)).toEqual({ ok: true, value: true });
    const after = await where(booking);
    expect(after).toMatchObject({ resource_id: COURT2, o_resource: COURT2, status: 'awaiting_payment', state: 'held' });
    expect(after.start_at.toISOString()).toBe(H(20));
    expect(after.end_at.toISOString()).toBe(H(21));
    expect(after.o_start.toISOString()).toBe(H(20));
    expect(after.hold_expires_at).toEqual(before.hold_expires_at);
    expect((await tdb.query('select count(*)::int as n from public.booking')).rows[0].n).toBe(1);
  });

  it('moves a confirmed booking and keeps it confirmed', async () => {
    const { booking } = await book(P1, 18, { confirm: true });
    expect(await move(owner, booking, COURT1, 19)).toEqual({ ok: true, value: true });
    expect(await where(booking)).toMatchObject({ status: 'confirmed', state: 'confirmed' });
  });

  it('a successful move enqueues exactly one message, with where it came from and where it went', async () => {
    const { booking } = await book(P1, 18);
    await move(front, booking, COURT2, 20);
    const c = await calls();
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ booking, from_resource: COURT1, to_resource: COURT2 });
    expect(c[0].from_start.toISOString()).toBe(H(18));
    expect(c[0].to_start.toISOString()).toBe(H(20));
  });

  it('moving to where it already is changes nothing and sends nothing', async () => {
    const { booking } = await book(P1, 18);
    expect(await move(front, booking, COURT1, 18)).toEqual({ ok: true, value: false });
    expect(await calls()).toHaveLength(0);
  });

  it('back to back with its own old hour works (half open ranges)', async () => {
    const { booking } = await book(P1, 18);
    expect(await move(front, booking, COURT1, 19)).toEqual({ ok: true, value: true });
  });
});

describe('refused moves change nothing', () => {
  it('a move onto a taken slot is refused with slot_unavailable', async () => {
    const { booking } = await book(P1, 18);
    const other = await book(P2, 20, { court: COURT2 });
    const before = await where(booking);
    expect(await move(front, booking, COURT2, 20)).toEqual({ ok: false, code: 'slot_unavailable', detail: 'resource' });
    expect(await where(booking)).toEqual(before);
    expect((await where(other.booking)).resource_id).toBe(COURT2);
    expect(await calls()).toHaveLength(0);
  });

  it('a move onto a closure is refused', async () => {
    const { booking } = await book(P1, 18);
    await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, closure_id) values ($1,'closure',$2,$3,$4,'confirmed',gen_random_uuid())`, [A, COURT2, H(20), H(22)]);
    expect(await move(front, booking, COURT2, 21)).toMatchObject({ ok: false, code: 'slot_unavailable' });
  });

  it("an expired hold of someone else in the way does not block (lazy release)", async () => {
    const { booking } = await book(P1, 18);
    const stale = await book(P2, 20, { court: COURT2 });
    await tdb.setNow('2026-12-01T03:16:00Z'); // both holds have ended; the job has not run
    await tdb.query(`update public.booking set hold_expires_at = '2026-12-01T03:30:00Z' where id = $1`, [booking]);
    await tdb.query(`update public.occupancy set hold_expires_at = '2026-12-01T03:30:00Z' where booking_id = $1`, [booking]);
    expect(await move(front, booking, COURT2, 20)).toEqual({ ok: true, value: true });
    expect((await tdb.query('select status from public.booking where id = $1', [stale.booking])).rows[0].status).toBe('released');
  });

  it('not on the hour, an inactive court, an unknown court and another club\'s court are refused', async () => {
    const { booking } = await book(P1, 18);
    expect(await move(front, booking, COURT2, at('20:30:00'))).toEqual({ ok: false, code: 'not_on_the_hour', detail: undefined });
    expect(await move(front, booking, COURT3, 20)).toEqual({ ok: false, code: 'resource_inactive', detail: undefined });
    expect(await move(front, booking, COURT_B, 20)).toEqual({ ok: false, code: 'resource_inactive', detail: undefined });
    expect((await where(booking)).resource_id).toBe(COURT1);
  });

  it('a released or confirmed-elsewhere booking, an unknown id and another club\'s booking cannot be moved', async () => {
    const { order, booking } = await book(P1, 18);
    expect(await move({ ...front, club: B }, booking, COURT_B, 20)).toEqual({ ok: false, code: 'booking_not_found', detail: undefined });
    expect(await move(front, '00000000-0000-4000-8000-0000000000ff', COURT2, 20)).toEqual({ ok: false, code: 'booking_not_found', detail: undefined });
    await run(front, (tx) => tx.query(`select app.release_hold($1, 'staff')`, [order]));
    expect(await move(front, booking, COURT2, 20)).toEqual({ ok: false, code: 'not_movable', detail: undefined });
  });

  it('two moves to the same slot in parallel: exactly one wins', async () => {
    const a = await book(P1, 18);
    const b = await book(P2, 19);
    const out = await Promise.all([move(front, a.booking, COURT2, 21), move(front, b.booking, COURT2, 21)]);
    expect(out.filter((o) => o.ok)).toHaveLength(1);
    expect(out.find((o) => !o.ok)).toMatchObject({ code: 'slot_unavailable' });
    expect((await tdb.query(`select count(*)::int as n from public.occupancy where resource_id = $1`, [COURT2])).rows[0].n).toBe(1);
    expect(await calls()).toHaveLength(1);
  });
});

describe('coach rules on a move (design 4.3)', () => {
  beforeEach(async () => {
    await tdb.query(`create function public.t_rules(p_club uuid, p_coach uuid, p_resource uuid, p_starts timestamptz[]) returns void language plpgsql as $$ begin if p_starts[1] = '${H(22)}'::timestamptz then perform app.refuse('rest_rule'); end if; end $$`);
    await tdb.query(`select app.register_coach_rules('public.t_rules'::regproc)`);
  });

  it('a solo class is checked by the coach rules at the new time', async () => {
    const { booking } = await book(P1, 18, { coach: COACH });
    expect(await move(front, booking, COURT2, 22)).toEqual({ ok: false, code: 'rest_rule', detail: undefined });
    expect((await where(booking)).start_at.toISOString()).toBe(H(18));
    expect(await move(front, booking, COURT2, 20)).toEqual({ ok: true, value: true });
    expect((await tdb.query(`select coach_id from public.occupancy where booking_id = $1`, [booking])).rows[0].coach_id).toBe(COACH);
  });

  it('a busy coach refuses the move even on a free court, and nothing changes', async () => {
    const { booking } = await book(P1, 18, { coach: COACH });
    await book(P2, 20, { court: COURT2, coach: COACH });
    const before = await where(booking);
    expect(await move(front, booking, COURT1, 20)).toEqual({ ok: false, code: 'slot_unavailable', detail: 'coach' });
    expect(await where(booking)).toEqual(before);
  });
});

describe('who may move (D60, D107)', () => {
  it('a player cannot move, not even their own booking', async () => {
    const { booking } = await book(P1, 18);
    expect(await move(player(), booking, COURT2, 20)).toEqual({ ok: false, code: 'forbidden', detail: undefined });
    expect((await where(booking)).resource_id).toBe(COURT1);
  });

  it('in a Paused club front desk and the owner can still move existing bookings (D107, migration 0225)', async () => {
    const { booking } = await book(P1, 18);
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    expect(await move(front, booking, COURT2, 20)).toEqual({ ok: true, value: true });
    expect(await move(owner, booking, COURT1, 21)).toEqual({ ok: true, value: true });
  });
});
