import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db, type ClubContext } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F09-T06b / migration 1007: app.cancel_booking(booking, by_staff, club_cancel, reason, closure) (F09 design 4.2;
// CANCEL-01-AC13, AC14, AC16, AC17, AC19, AC21, AC22; CC-4). One transaction: locks, outcome, the value back or
// forfeited (1005), the status, the occupancy row gone (court and coach together), the order effects (1006), the
// booking_cancel row (1001), the cancel handlers (1003) and the booking's reminders voided. All of it or none of it.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURT1 = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT2 = 'c2c2c2c2-0000-4000-8000-000000000002';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const NOW = '2026-12-01T03:00:00Z';   // 1 Dec 10:00 Bangkok
const H = (h: number) => new Date(Date.parse('2026-12-03T00:00:00+07:00') + h * 3_600_000).toISOString();   // 3 Dec, two days ahead

let tdb: TestDatabase;
let db: Db;
let db2: Db;
const player = (u = P1): ClubContext => ({ clubId: A, userId: u, roles: ['player'], requestId: 'r', source: 'player_app' });
const desk = (reason?: string): ClubContext => ({ clubId: A, userId: DESK, roles: ['front_desk', 'player'], requestId: 'r', source: 'admin', ...(reason ? { reason } : {}) });

/** A confirmed booking through the real claim and confirm, with one line paid by money. */
async function book(starts: number[], o: { coach?: string; customer?: string; court?: string } = {}) {
  const customer = o.customer ?? P1;
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id as string;
  const r = await db.withClubTx(player(customer), async (tx) =>
    (await tx.query(`select app.reserve_court($1, $2, $3::timestamptz[], $4) as r`, [order, o.court ?? COURT1, starts.map(H), o.coach ?? null])).rows[0]!.r);
  await db.withClubTx(desk(), (tx) => tx.query(`select app.confirm_booking($1)`, [order]));
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    for (const [i, b] of (r.booking_ids as string[]).entries()) {
      await c.query(
        `insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, net_satang, money_satang)
         values ($1,$2,$3,'court_hour',$4,'k','ก','x',40000,40000,40000)`, [A, order, i + 1, b]);
    }
    await c.query(`update public.orders set status = 'paid' where id = $1`, [order]);
    await c.query('commit');
  } finally {
    c.release();
  }
  return { order, ids: r.booking_ids as string[] };
}
const cancel = (c: ClubContext, booking: string, o: { byStaff?: boolean; club?: boolean; reason?: string | null; via?: Db } = {}) =>
  (o.via ?? db).withClubTx(c, async (tx) =>
    (await tx.query(`select app.cancel_booking($1, $2, $3, $4) as r`, [booking, o.byStaff ?? false, o.club ?? false, o.reason ?? null])).rows[0]!.r as Record<string, any>);
const row = async (id: string) => (await tdb.query(`select status from public.booking where id = $1`, [id])).rows[0].status as string;
const occupancy = async (id: string) => (await tdb.query(`select resource_id, coach_id from public.occupancy where booking_id = $1`, [id])).rows;
const cancels = async (id: string) => (await tdb.query(`select kind, outcome, version, reason, by_user, credit_lost, returned from public.booking_cancel where booking_id = $1 order by version`, [id])).rows;
const refunds = async () => (await tdb.query(`select change_satang, dedupe_key from public.wallet_ledger where reason = 'refund' order by dedupe_key`)).rows;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow(NOW);
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live')`, [A]);
  for (const [u, roles] of [[P1, ['player']], [P2, ['player']], [DESK, ['front_desk', 'player']]] as const) {
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
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($1,$4,$3,'2','tennis')`, [A, COURT1, LOC, COURT2]);
  for (let d = 1; d <= 7; d += 1) await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [A, d]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15'), ($1,'cancel_window_hours','12')`, [A]);
  db = createDb({ connectionString: tdb.url, max: 4 });
  db2 = createDb({ connectionString: tdb.url, max: 4 });
});
afterEach(async () => {
  await db.end();
  await db2.end();
  await tdb.close();
});

describe('a player cancels in time', () => {
  it('the booking is cancelled, its slot is free, the money is in the wallet and the cancel is recorded', async () => {
    const b = await book([18]);
    const r = await cancel(player(), b.ids[0]!);
    expect(r).toMatchObject({ outcome: 'in_time', kind: 'player_cancel', version: 1, repeated: false });
    expect(await row(b.ids[0]!)).toBe('cancelled');
    expect(await occupancy(b.ids[0]!)).toEqual([]);
    expect(await refunds()).toEqual([{ change_satang: '40000', dedupe_key: expect.stringMatching(/^refund:.*:1$/) }]);
    expect(await cancels(b.ids[0]!)).toEqual([{ kind: 'player_cancel', outcome: 'returned', version: 1, reason: null, by_user: P1, credit_lost: false,
      returned: expect.objectContaining({ moneyToWalletSatang: 40000 }) }]);
    expect((await tdb.query(`select status from public.orders where id = $1`, [b.order])).rows[0].status).toBe('cancelled');
  });

  it('a second tap and a second device return the same cancel: value returns once (AC14)', async () => {
    const b = await book([18]);
    const [one, two] = await Promise.all([cancel(player(), b.ids[0]!), cancel(player(), b.ids[0]!, { via: db2 })]);
    expect([one.repeated, two.repeated].sort()).toEqual([false, true]);
    expect(one.bookingCancel).toBe(two.bookingCancel);
    expect(await cancels(b.ids[0]!)).toHaveLength(1);
    expect(await refunds()).toHaveLength(1);
    expect((await cancel(player(), b.ids[0]!)).repeated).toBe(true);
  });

  it('cancelling one hour of a two hour order frees only that hour (AC9, BOOK-06)', async () => {
    const b = await book([18, 19]);
    await cancel(player(), b.ids[1]!);
    expect(await row(b.ids[0]!)).toBe('confirmed');
    expect(await occupancy(b.ids[0]!)).toHaveLength(1);
    expect(await occupancy(b.ids[1]!)).toEqual([]);
    expect((await tdb.query(`select status from public.orders where id = $1`, [b.order])).rows[0].status).toBe('paid');
  });

  it('a solo class frees the court and the coach together (CC-4)', async () => {
    await tdb.seedCoach(A, COACH);
    const b = await book([18], { coach: COACH });
    expect(await occupancy(b.ids[0]!)).toEqual([{ resource_id: COURT1, coach_id: COACH }]);
    await cancel(player(), b.ids[0]!);
    expect(await occupancy(b.ids[0]!)).toEqual([]);
    // Both are free: another player can take the court and the coach at that hour.
    expect(await book([18], { coach: COACH, customer: P2 })).toMatchObject({ ids: [expect.any(String)] });
  });

  it("the booking's pending reminders are voided as cancelled", async () => {
    const b = await book([30]);   // 4 Dec 06:00: both reminders are ahead
    const pending = async () => (await tdb.query(`select status, void_reason from public.message_outbox where dedupe_key like 'reminder:' || $1 || ':%' order by status`, [b.ids[0]])).rows;
    expect((await pending()).map((x) => x.status)).toEqual(['pending', 'pending']);
    await cancel(player(), b.ids[0]!);
    expect(await pending()).toEqual([{ status: 'void', void_reason: 'cancelled' }, { status: 'void', void_reason: 'cancelled' }]);
  });
});

describe('late, staff and club cancels', () => {
  it('a late cancel frees the slot, keeps the money and records the forfeit (AC10)', async () => {
    const b = await book([18]);
    await tdb.setNow(new Date(Date.parse(H(18)) - 2 * 3_600_000).toISOString());   // two hours before the start
    const r = await cancel(player(), b.ids[0]!);
    expect(r).toMatchObject({ outcome: 'late', kind: 'player_cancel' });
    expect(await row(b.ids[0]!)).toBe('late_cancelled');
    expect(await occupancy(b.ids[0]!)).toEqual([]);
    expect(await refunds()).toEqual([]);
    expect((await cancels(b.ids[0]!))[0]).toMatchObject({ outcome: 'forfeited' });
  });

  it('staff cancel for a player with a reason; a club cancel returns in full whatever the time (AC20)', async () => {
    const b = await book([18, 19]);
    await expect(cancel(desk(), b.ids[0]!, { byStaff: true })).rejects.toThrow(/cancel:reason_required/);
    expect(await cancel(desk('player asked'), b.ids[0]!, { byStaff: true, reason: 'player asked' })).toMatchObject({ kind: 'staff_cancel', outcome: 'in_time' });
    await tdb.setNow(new Date(Date.parse(H(19)) - 3_600_000).toISOString());
    expect(await cancel(desk('rain'), b.ids[1]!, { byStaff: true, club: true, reason: 'rain' })).toMatchObject({ kind: 'club_cancel', outcome: 'full' });
    expect((await cancels(b.ids[1]!))[0]).toMatchObject({ kind: 'club_cancel', outcome: 'returned', reason: 'rain', by_user: DESK });
  });

  it('a Paused club still lets a player cancel an existing booking (AC21)', async () => {
    const b = await book([18]);
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    expect((await cancel(player(), b.ids[0]!)).outcome).toBe('in_time');
  });
});

describe('what cancel_booking will not do', () => {
  it('a booking awaiting payment is released through release_hold, not cancelled here (AC16)', async () => {
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id;
    const r = await db.withClubTx(player(), async (tx) => (await tx.query(`select app.reserve_court($1, $2, $3::timestamptz[]) as r`, [order, COURT2, [H(20)]])).rows[0]!.r);
    await expect(cancel(player(), r.booking_ids[0])).rejects.toThrow(/cancel:hold/);
    expect(await row(r.booking_ids[0])).toBe('awaiting_payment');
  });

  it("another player's booking is not found; nothing changes", async () => {
    const b = await book([18]);
    await expect(cancel(player(P2), b.ids[0]!)).rejects.toThrow(/cancel:not_found/);
    expect(await row(b.ids[0]!)).toBe('confirmed');
  });

  it('a failing cancel handler rolls everything back (AC22)', async () => {
    const b = await book([18]);
    await tdb.query(`create function public.t_fail(p_club uuid, p_booking uuid, p_kind text) returns void language plpgsql as $$ begin raise exception 'handler failed'; end $$`);
    await tdb.query(`select app.register_cancel_handler('broken', 'public.t_fail(uuid, uuid, text)'::regprocedure, 99)`);
    await expect(cancel(player(), b.ids[0]!)).rejects.toThrow(/handler failed/);
    expect(await row(b.ids[0]!)).toBe('confirmed');
    expect(await occupancy(b.ids[0]!)).toHaveLength(1);
    expect(await refunds()).toEqual([]);
    expect(await cancels(b.ids[0]!)).toEqual([]);
  });
});
