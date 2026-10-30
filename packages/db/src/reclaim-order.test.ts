import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F03-T14 / migration 0218: app.reclaim_order for a late payment. BOOK-03-AC7, AC8; D25, A-7, D109.
// It re-inserts the occupancy of a released order and confirms it, or raises slot_unavailable and
// leaves nothing partial. It repeats no window, limit or hour check: the player already paid.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const LOC_B = 'bbbbbbbb-0000-4000-8000-000000000001';
const COURT1 = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT2 = 'c2c2c2c2-0000-4000-8000-000000000002';
const COURT_B = 'cbcbcbcb-0000-4000-8000-000000000003';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const STAFF = '33333333-2222-4333-8444-555555555555';
const P1 = '00000000-0000-4000-8000-000000000001';
const P2 = '00000000-0000-4000-8000-000000000002';

let tdb: TestDatabase;
let db: Db;
let dbw: Db;
const at = (time: string) => new Date(`2026-12-02T${time}+07:00`).toISOString();
const H = (h: number) => at(`${String(h).padStart(2, '0')}:00:00`);
type Who = { id: string | null; roles: string[]; worker?: boolean; club?: string };
const player = (id = P1): Who => ({ id, roles: ['player'] });
const worker: Who = { id: null, roles: [], worker: true };
const run = <T>(who: Who, fn: (tx: { query: (q: string, p?: unknown[]) => Promise<{ rows: any[] }> }) => Promise<T>) =>
  (who.worker ? dbw : db).withClubTx({ clubId: who.club ?? A, userId: who.id, roles: who.roles, requestId: 'r', source: who.worker ? 'job' : 'player_app' }, fn);

const newOrder = async (customer: string, club = A) =>
  (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [club, customer])).rows[0].id as string;
async function hold(customer: string, hours: string[], opts: { court?: string; coach?: string | null } = {}) {
  const order = await newOrder(customer);
  await run(player(customer), (tx) => tx.query(`select app.reserve_court($1, $2, $3::timestamptz[], $4)`, [order, opts.court ?? COURT1, hours, opts.coach ?? null]));
  return order;
}
/** The order lapses (the hold ends and the lazy or job release runs). */
async function expire(order: string) {
  await tdb.setNow('2026-12-01T03:16:00Z');
  await run(worker, (tx) => tx.query(`select app.release_hold($1, 'expired')`, [order]));
}
type Out = { ok: true; value: boolean } | { ok: false; code: string; detail: string | undefined };
async function reclaim(who: Who, order: string): Promise<Out> {
  try {
    return { ok: true, value: await run(who, async (tx) => (await tx.query(`select app.reclaim_order($1) as ok`, [order])).rows[0]?.ok as boolean) };
  } catch (e) {
    const err = e as { code?: string; message: string; detail?: string };
    if (err.code === 'BK001') return { ok: false, code: err.message, detail: err.detail };
    throw e;
  }
}
const statuses = async (order: string) => (await tdb.query(`select status, release_reason, released_at, hold_expires_at, confirmed_at from public.booking where order_id = $1 order by start_at`, [order])).rows;
const occupancy = async () => (await tdb.query(`select resource_id, coach_id, start_at, state, hold_expires_at, kind from public.occupancy order by start_at`)).rows;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  await tdb.seedCoach(A, COACH);   // a solo class needs a coach row (F07, migration 0801)
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main'), ($3,$4,'Main')`, [A, LOC, B, LOC_B]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($1,$4,$3,'2','tennis'), ($5,$6,$7,'1','tennis')`, [A, COURT1, LOC, COURT2, B, COURT_B, LOC_B]);
  for (const club of [A, B]) {
    for (let d = 1; d <= 7; d += 1) await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [club, d]);
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [club]);
  }
  db = createDb({ connectionString: tdb.url, max: 6 });
  dbw = createDb({ connectionString: tdb.url, max: 6, role: 'booq_worker' });
});
afterEach(async () => {
  await db.end();
  await dbw.end();
  await tdb.close();
});

describe('slot still open (BOOK-03-AC7)', () => {
  it('reclaims and confirms every hour; the occupancy rows come back confirmed with no hold', async () => {
    const order = await hold(P1, [H(18), H(19), H(20)]);
    await expire(order);
    expect(await occupancy()).toHaveLength(0);
    expect(await reclaim(worker, order)).toEqual({ ok: true, value: true });
    const b = await statuses(order);
    expect(b.map((r) => r.status)).toEqual(['confirmed', 'confirmed', 'confirmed']);
    expect(b.every((r) => r.hold_expires_at === null && r.release_reason === null && r.released_at === null && r.confirmed_at !== null)).toBe(true);
    const o = await occupancy();
    expect(o.map((r) => r.state)).toEqual(['confirmed', 'confirmed', 'confirmed']);
    expect(o.every((r) => r.hold_expires_at === null && r.kind === 'court_booking' && r.resource_id === COURT1)).toBe(true);
  });

  it('an order released by the player leaving the page can be reclaimed too', async () => {
    const order = await hold(P1, [H(18)]);
    await run(player(), (tx) => tx.query(`select app.release_hold($1, 'player')`, [order]));
    expect(await reclaim(worker, order)).toEqual({ ok: true, value: true });
  });

  it("an expired hold of another player in the way does not block the paying player", async () => {
    const order = await hold(P1, [H(18)]);
    await expire(order); // 03:16, P1 released
    await tdb.setNow('2026-12-01T03:20:00Z');
    const other = await hold(P2, [H(18)]);
    await tdb.setNow('2026-12-01T03:40:00Z'); // P2's hold has ended too, the job has not run
    expect(await reclaim(worker, order)).toEqual({ ok: true, value: true });
    expect((await statuses(other))[0]).toMatchObject({ status: 'released', release_reason: 'expired' });
  });

  it('repeats no hour check: the hour may have started already (A-7)', async () => {
    const order = await hold(P1, [H(18)]);
    await expire(order);
    await tdb.setNow(at('18:10:00')); // the booked hour 18:00 has started
    expect(await reclaim(worker, order)).toEqual({ ok: true, value: true });
  });

  it('repeats no future hours limit', async () => {
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'max_future_court_hours','1')`, [A]);
    const order = await hold(P1, [H(18)]);
    await expire(order);
    await hold(P1, [H(21)]); // takes the player's one allowed hour while they were away
    expect(await reclaim(worker, order)).toEqual({ ok: true, value: true });
  });
});

describe('slot not open: slot_unavailable and nothing partial (BOOK-03-AC8, D25)', () => {
  it('a slot held by another player', async () => {
    const order = await hold(P1, [H(18)]);
    await expire(order);
    await tdb.setNow('2026-12-01T03:17:00Z');
    await hold(P2, [H(18)]);
    expect(await reclaim(worker, order)).toEqual({ ok: false, code: 'slot_unavailable', detail: 'resource' });
    expect((await statuses(order))[0].status).toBe('released');
  });

  it('a slot confirmed for another player, and a closed slot', async () => {
    const o1 = await hold(P1, [H(18)]);
    const o2 = await hold(P1, [H(20)], { court: COURT2 });
    await expire(o1);
    await run(worker, (tx) => tx.query(`select app.release_hold($1, 'expired')`, [o2]));
    await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, closure_id) values ($1,'closure',$2,$3,$4,'confirmed',gen_random_uuid())`, [A, COURT1, H(18), H(19)]);
    expect(await reclaim(worker, o1)).toMatchObject({ ok: false, code: 'slot_unavailable' });
    await tdb.setNow('2026-12-01T03:17:00Z');
    const t = await hold(P2, [H(20)], { court: COURT2 });
    await run(worker, (tx) => tx.query(`select app.confirm_booking($1)`, [t]));
    expect(await reclaim(worker, o2)).toMatchObject({ ok: false, code: 'slot_unavailable' });
  });

  it('a three hour order where hour two is taken reclaims nothing', async () => {
    const order = await hold(P1, [H(18), H(19), H(20)]);
    await expire(order);
    await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, closure_id) values ($1,'closure',$2,$3,$4,'confirmed',gen_random_uuid())`, [A, COURT1, H(19), H(20)]);
    expect(await reclaim(worker, order)).toMatchObject({ ok: false, code: 'slot_unavailable' });
    expect((await statuses(order)).map((r) => r.status)).toEqual(['released', 'released', 'released']);
    expect(await occupancy()).toHaveLength(1); // only the closure
  });

  it('a solo class with the coach busy raises it and leaves nothing partial', async () => {
    await tdb.query(`create function public.t_rules(p_club uuid, p_coach uuid, p_resource uuid, p_starts timestamptz[]) returns void language sql as 'select'`);
    await tdb.query(`select app.register_coach_rules('public.t_rules'::regproc)`);
    const order = await hold(P1, [H(18)], { coach: COACH });
    await expire(order);
    await tdb.setNow('2026-12-01T03:17:00Z');
    await hold(P2, [H(18)], { court: COURT2, coach: COACH }); // the coach is taken on the other court
    const out = await reclaim(worker, order);
    expect(out).toEqual({ ok: false, code: 'slot_unavailable', detail: 'coach' });
    expect((await statuses(order))[0].status).toBe('released');
    expect((await occupancy()).filter((r) => r.resource_id === COURT1)).toHaveLength(0);
  });
});

describe('who and when (SR-07, D109)', () => {
  it('a player, a guest and front desk cannot call it; only the payment path (worker)', async () => {
    const order = await hold(P1, [H(18)]);
    await expire(order);
    for (const who of [player(), { id: null, roles: ['guest'] }, { id: STAFF, roles: ['front_desk'] }, { id: STAFF, roles: ['owner'] }]) {
      expect(await reclaim(who, order)).toEqual({ ok: false, code: 'forbidden', detail: undefined });
    }
    expect((await statuses(order))[0].status).toBe('released');
  });

  it('a Paused club never confirms a late payment (D109)', async () => {
    const order = await hold(P1, [H(18)]);
    await expire(order);
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    expect(await reclaim(worker, order)).toEqual({ ok: false, code: 'club_paused', detail: undefined });
    expect((await statuses(order))[0].status).toBe('released');
  });

  it("another club's order and an order that is not released do nothing", async () => {
    const order = await hold(P1, [H(18)]);
    expect(await reclaim(worker, order)).toEqual({ ok: true, value: false }); // still awaiting payment
    await expire(order);
    expect(await reclaim({ ...worker, club: B }, order)).toEqual({ ok: true, value: false });
    expect(await reclaim(worker, order)).toEqual({ ok: true, value: true });
    expect(await reclaim(worker, order)).toEqual({ ok: true, value: false }); // already confirmed
  });

  it('two reclaims in parallel give exactly one outcome', async () => {
    const order = await hold(P1, [H(18), H(19)]);
    await expire(order);
    const out = await Promise.all([reclaim(worker, order), reclaim(worker, order)]);
    expect(out.filter((o) => o.ok && o.value)).toHaveLength(1);
    expect(await occupancy()).toHaveLength(2);
  });
});
