import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F03-T13 / migration 0217: app.confirm_booking and the PAY-07 path. BOOK-03-AC7, AC9,
// BOOK-04-AC8; SR-07; FA T10. Confirm is a guarded status change in one transaction.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const LOC_B = 'bbbbbbbb-0000-4000-8000-000000000001';
const COURT = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT_B = 'cbcbcbcb-0000-4000-8000-000000000003';
const STAFF = '33333333-2222-4333-8444-555555555555';
const P1 = '00000000-0000-4000-8000-000000000001';
const P2 = '00000000-0000-4000-8000-000000000002';

let tdb: TestDatabase;
let db: Db; // booq_app
let dbw: Db; // booq_worker: where the payment callback runs
const at = (time: string) => new Date(`2026-12-02T${time}+07:00`).toISOString();
const H = (h: number) => at(`${String(h).padStart(2, '0')}:00:00`);
type Who = { id: string | null; roles: string[]; worker?: boolean; club?: string };
const player: Who = { id: P1, roles: ['player'] };
const front: Who = { id: STAFF, roles: ['front_desk', 'player'] };
const worker: Who = { id: null, roles: [], worker: true };

const run = <T>(who: Who, fn: (tx: { query: (q: string, p?: unknown[]) => Promise<{ rows: any[] }> }) => Promise<T>) =>
  (who.worker ? dbw : db).withClubTx({ clubId: who.club ?? A, userId: who.id, roles: who.roles, requestId: 'r', source: who.worker ? 'job' : 'player_app' }, fn);

const newOrder = async (customer: string, club = A) =>
  (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [club, customer])).rows[0].id as string;
async function hold(customer: string, hours: string[], orderIn?: string) {
  const order = orderIn ?? (await newOrder(customer));
  await run({ id: customer, roles: ['player'] }, (tx) => tx.query(`select app.reserve_court($1, $2, $3::timestamptz[])`, [order, COURT, hours]));
  return order;
}
const confirm = (who: Who, order: string) => run(who, async (tx) => (await tx.query(`select app.confirm_booking($1) as ok`, [order])).rows[0]?.ok as boolean);
const rows = async (order: string) => (await tdb.query(`select status, hold_expires_at, confirmed_at from public.booking where order_id = $1 order by start_at`, [order])).rows;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main'), ($3,$4,'Main')`, [A, LOC, B, LOC_B]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($4,$5,$6,'1','tennis')`, [A, COURT, LOC, B, COURT_B, LOC_B]);
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

describe('confirm_booking (BOOK-03-AC7)', () => {
  it('confirms every hour of the order: status, no hold, a confirmed time, occupancy confirmed', async () => {
    const order = await hold(P1, [H(18), H(19)]);
    await tdb.setNow('2026-12-01T03:05:00Z');
    expect(await confirm(worker, order)).toBe(true);
    const b = await rows(order);
    expect(b.map((r) => r.status)).toEqual(['confirmed', 'confirmed']);
    expect(b.every((r) => r.hold_expires_at === null && r.confirmed_at.toISOString() === '2026-12-01T03:05:00.000Z')).toBe(true);
    expect((await tdb.query('select state, hold_expires_at from public.occupancy')).rows).toEqual([
      { state: 'confirmed', hold_expires_at: null },
      { state: 'confirmed', hold_expires_at: null },
    ]);
  });

  it('a second confirm does nothing', async () => {
    const order = await hold(P1, [H(18)]);
    expect(await confirm(worker, order)).toBe(true);
    expect(await confirm(worker, order)).toBe(false);
  });

  it('front desk may confirm (slip or cash by staff); a player may not confirm their own order (SR-07)', async () => {
    const order = await hold(P1, [H(18)]);
    await expect(confirm(player, order)).rejects.toThrow(/forbidden/);
    await expect(confirm({ id: null, roles: ['guest'] }, order)).rejects.toThrow(/forbidden/);
    expect((await rows(order))[0].status).toBe('awaiting_payment');
    expect(await confirm(front, order)).toBe(true);
  });

  it("another club's order finds nothing (CC-1)", async () => {
    const order = await hold(P1, [H(18)]);
    expect(await confirm({ ...worker, club: B }, order)).toBe(false);
    expect((await rows(order))[0].status).toBe('awaiting_payment');
  });
});

describe('confirm and expiry at the same instant: exactly one outcome (BOOK-04-AC8, FA T10)', () => {
  it('a hold that has ended is not confirmed, even before the job has run', async () => {
    const order = await hold(P1, [H(18)]);
    await tdb.setNow('2026-12-01T03:15:00Z'); // exactly hold_expires_at
    expect(await confirm(worker, order)).toBe(false);
    expect((await rows(order))[0].status).toBe('awaiting_payment');
    expect(await run(worker, async (tx) => (await tx.query(`select app.release_hold($1, 'expired') as ok`, [order])).rows[0].ok)).toBe(true);
    expect((await rows(order))[0].status).toBe('released');
  });

  it('one second before the end it is confirmed', async () => {
    const order = await hold(P1, [H(18)]);
    await tdb.setNow('2026-12-01T03:14:59Z');
    expect(await confirm(worker, order)).toBe(true);
  });

  it('confirm and release racing in parallel: one wins, never both, never neither', async () => {
    for (let round = 0; round < 8; round += 1) {
      await tdb.query('delete from public.occupancy');
      await tdb.query('delete from public.booking');
      const order = await hold(P1, [H(8 + round)]);
      const [c, r] = await Promise.all([
        confirm(worker, order),
        run(worker, async (tx) => (await tx.query(`select app.release_hold($1, 'closed') as ok`, [order])).rows[0].ok as boolean),
      ]);
      expect([c, r].filter(Boolean)).toHaveLength(1);
      const status = (await rows(order))[0].status;
      expect(status).toBe(c ? 'confirmed' : 'released');
      expect((await tdb.query('select count(*)::int as n from public.occupancy')).rows[0].n).toBe(c ? 1 : 0);
    }
  });
});

describe('the PAY-07 path: nothing left to pay (BOOK-03-AC9)', () => {
  const needsNoPayment = () => tdb.query(`create or replace function app.order_needs_payment(p_order uuid) returns boolean language sql as $$ select false $$`);
  const reserveNow = (customer: string, order: string, hours: string[]) =>
    run({ id: customer, roles: ['player'] }, async (tx) => (await tx.query(`select app.reserve_court($1, $2, $3::timestamptz[]) as res`, [order, COURT, hours])).rows[0].res);

  it('by default an order needs payment, so bookings wait for it', async () => {
    const order = await hold(P1, [H(18)]);
    expect((await rows(order))[0].status).toBe('awaiting_payment');
  });

  it('with nothing due the bookings and occupancy are confirmed at once, with no hold', async () => {
    await needsNoPayment();
    const res = await reserveNow(P1, await newOrder(P1), [H(18), H(19)]);
    expect(res.hold_expires_at).toBeNull();
    const b = (await tdb.query(`select status, hold_expires_at, confirmed_at from public.booking`)).rows;
    expect(b.map((r) => r.status)).toEqual(['confirmed', 'confirmed']);
    expect(b.every((r) => r.hold_expires_at === null && r.confirmed_at !== null)).toBe(true);
    expect((await tdb.query(`select state, hold_expires_at from public.occupancy`)).rows.every((r) => r.state === 'confirmed' && r.hold_expires_at === null)).toBe(true);
  });

  it('does not need the hold setting', async () => {
    await needsNoPayment();
    await tdb.query(`delete from public.club_setting where club_id = $1 and key = 'hold_minutes'`, [A]);
    const res = await reserveNow(P1, await newOrder(P1), [H(18)]);
    expect(res.hold_expires_at).toBeNull();
  });

  it('a taken slot refuses the order and uses nothing up (BOOK-04-AC4)', async () => {
    await needsNoPayment();
    await reserveNow(P1, await newOrder(P1), [H(18)]);
    await expect(reserveNow(P2, await newOrder(P2), [H(18)])).rejects.toThrow(/slot_unavailable/);
    expect((await tdb.query('select count(*)::int as n from public.booking')).rows[0].n).toBe(1);
  });

  it('confirm_now cannot be forced: there is no parameter for it and a payment-due order cannot skip payment', async () => {
    const args = (await tdb.query(`select pg_get_function_arguments(p.oid) as a from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'reserve_court'`)).rows;
    expect(args).toHaveLength(1);
    expect(args[0].a).not.toMatch(/confirm/i);
    await expect(run(player, (tx) => tx.query(`select app.reserve_court($1, $2, $3::timestamptz[], null, null, true)`, [crypto.randomUUID(), COURT, [H(18)]]))).rejects.toThrow();
    const order = await hold(P1, [H(18)]);
    expect((await rows(order))[0].status).toBe('awaiting_payment');
  });

  it("a player cannot change a booking's status directly", async () => {
    const order = await hold(P1, [H(18)]);
    await expect(run(player, (tx) => tx.query(`update public.booking set status = 'confirmed', hold_expires_at = null where order_id = $1`, [order]))).rejects.toThrow(/permission denied/i);
  });
});
