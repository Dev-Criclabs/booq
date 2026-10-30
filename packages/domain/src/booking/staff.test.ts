import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db, type ClubContext } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { BookingError } from './errors';
import { moveStaffBooking, releaseStaffHold } from './staff';

// F03-T22 (move and release): PUT /staff/bookings/{id}/move and POST /staff/bookings/{id}/release
// (BOOK-04-AC7; decisions D43, D60; design 4.3, 4.5, 5.3). The move is app.move_booking, so the exclusion
// constraints refuse a conflict and nothing changes. In a Paused club front desk is refused and the owner
// may still move and release existing bookings (D60).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const LOC_B = 'bbbbbbbb-0000-4000-8000-000000000001';
const COURT1 = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT2 = 'c2c2c2c2-0000-4000-8000-000000000002';
const COURT_B = 'cbcbcbcb-0000-4000-8000-000000000009';
const P1 = '00000000-0000-4000-8000-000000000001';
const P2 = '00000000-0000-4000-8000-000000000002';
const DESK = '00000000-0000-4000-8000-0000000000d1';
const OWNER = '00000000-0000-4000-8000-0000000000e1';
const at = (date: string, h: number) => new Date(`${date}T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();

let tdb: TestDatabase;
let db: Db;
const ctx = (userId: string, roles: string[], club = A): ClubContext => ({ clubId: club, userId, roles, requestId: 'r', source: 'admin' });
const desk = ctx(DESK, ['front_desk', 'player']);
const owner = ctx(OWNER, ['owner', 'player']);
const as = <T>(c: ClubContext, fn: Parameters<Db['withClubTx']>[1]) => db.withClubTx(c, fn) as Promise<T>;
const who = (c: ClubContext) => ({ userId: c.userId, roles: c.roles as readonly string[] });

async function reserve(hour: number, opts: { club?: string; court?: string; customer?: string; confirm?: boolean } = {}) {
  const club = opts.club ?? A;
  const customer = opts.customer ?? P1;
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [club, customer])).rows[0].id as string;
  const r = await db.withClubTx({ clubId: club, userId: customer, roles: ['player'], requestId: 'r', source: 'player_app' }, (tx) =>
    tx.query<{ r: { booking_ids: string[] } }>(`select app.reserve_court($1, $2, $3::timestamptz[]) as r`, [order, opts.court ?? COURT1, [at('2026-12-02', hour)]]));
  if (opts.confirm) await db.withClubTx(ctx(DESK, ['front_desk', 'player'], club), (tx) => tx.query(`select app.confirm_booking($1)`, [order]));
  return { order, id: r.rows[0]!.r.booking_ids[0]! };
}
const row = async (id: string) => (await tdb.query(`select resource_id, start_at, status, release_reason from public.booking where id = $1`, [id])).rows[0];
const pause = () => tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main'), ($3,$4,'Main')`, [A, LOC, B, LOC_B]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($1,$4,$3,'2','tennis'), ($5,$6,$7,'1','tennis')`, [A, COURT1, LOC, COURT2, B, COURT_B, LOC_B]);
  for (const club of [A, B]) {
    for (let d = 1; d <= 7; d += 1) await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [club, d]);
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [club]);
  }
  db = createDb({ connectionString: tdb.url, max: 4 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('moveStaffBooking (PUT /staff/bookings/{id}/move)', () => {
  it('front desk moves a confirmed booking to another court and hour; the booking comes back moved', async () => {
    const { id } = await reserve(18, { confirm: true });
    const b = await as(desk, (tx) => moveStaffBooking(tx, who(desk), id, { courtId: COURT2, start: '2026-12-02T20:00:00+07:00' }));
    expect(b).toMatchObject({ id, status: 'confirmed', court: { id: COURT2, name: '2' }, start: '2026-12-02T20:00:00+07:00', end: '2026-12-02T21:00:00+07:00' });
    expect(await row(id)).toMatchObject({ resource_id: COURT2, start_at: new Date(at('2026-12-02', 20)) });
  });

  it('a move onto a taken slot is refused by the uniqueness rule and nothing changes (BOOK-04-AC7)', async () => {
    const { id } = await reserve(18, { confirm: true });
    await reserve(19, { customer: P2, confirm: true });
    await expect(as(desk, (tx) => moveStaffBooking(tx, who(desk), id, { courtId: COURT1, start: '2026-12-02T19:00:00+07:00' }))).rejects.toMatchObject({ code: 'BK001', message: 'slot_unavailable' });
    expect(await row(id)).toMatchObject({ resource_id: COURT1, start_at: new Date(at('2026-12-02', 18)) });
  });

  it('a move onto a live hold is refused too', async () => {
    const { id } = await reserve(18, { confirm: true });
    await reserve(19, { customer: P2 });
    await expect(as(desk, (tx) => moveStaffBooking(tx, who(desk), id, { courtId: COURT1, start: '2026-12-02T19:00:00+07:00' }))).rejects.toMatchObject({ message: 'slot_unavailable' });
  });

  it('bad input and an unknown or other club booking are refused', async () => {
    const { id } = await reserve(18, { confirm: true });
    await expect(as(desk, (tx) => moveStaffBooking(tx, who(desk), id, { courtId: COURT2 }))).rejects.toEqual(new BookingError('bad_input'));
    await expect(as(desk, (tx) => moveStaffBooking(tx, who(desk), id, { courtId: 'x', start: '2026-12-02T20:00:00+07:00' }))).rejects.toEqual(new BookingError('bad_input'));
    await expect(as(desk, (tx) => moveStaffBooking(tx, who(desk), id, { courtId: COURT2, start: 'tomorrow' }))).rejects.toEqual(new BookingError('bad_input'));
    const other = await reserve(18, { club: B, court: COURT_B, confirm: true });
    await expect(as(desk, (tx) => moveStaffBooking(tx, who(desk), other.id, { courtId: COURT2, start: '2026-12-02T20:00:00+07:00' }))).rejects.toEqual(new BookingError('not_found'));
  });

  it('in a Paused club front desk is refused and the owner can move (D60)', async () => {
    const { id } = await reserve(18, { confirm: true });
    await pause();
    await expect(as(desk, (tx) => moveStaffBooking(tx, who(desk), id, { courtId: COURT2, start: '2026-12-02T20:00:00+07:00' }))).rejects.toEqual(new BookingError('club_paused'));
    expect(await as(owner, (tx) => moveStaffBooking(tx, who(owner), id, { courtId: COURT2, start: '2026-12-02T20:00:00+07:00' }))).toMatchObject({ court: { id: COURT2 } });
  });
});

describe('releaseStaffHold (POST /staff/bookings/{id}/release)', () => {
  it('front desk abandons an awaiting booking: the whole order is released with reason staff', async () => {
    const { order, id } = await reserve(18);
    expect(await as(desk, (tx) => releaseStaffHold(tx, who(desk), id))).toEqual({ orderId: order, status: 'released' });
    expect(await row(id)).toMatchObject({ status: 'released', release_reason: 'staff' });
  });

  it('a confirmed booking is not released through this route', async () => {
    const { id } = await reserve(18, { confirm: true });
    await expect(as(desk, (tx) => releaseStaffHold(tx, who(desk), id))).rejects.toEqual(new BookingError('not_releasable'));
    expect((await row(id)).status).toBe('confirmed');
  });

  it('a player cannot use the staff release, even on their own hold', async () => {
    const { id } = await reserve(18);
    const p = ctx(P1, ['player']);
    await expect(as(p, (tx) => releaseStaffHold(tx, who(p), id))).rejects.toEqual(new BookingError('forbidden'));
    expect((await row(id)).status).toBe('awaiting_payment');
  });

  it('in a Paused club front desk is refused and the owner can release (D60)', async () => {
    const { id } = await reserve(18);
    await pause();
    await expect(as(desk, (tx) => releaseStaffHold(tx, who(desk), id))).rejects.toEqual(new BookingError('club_paused'));
    expect((await row(id)).status).toBe('awaiting_payment');
    expect(await as(owner, (tx) => releaseStaffHold(tx, who(owner), id))).toMatchObject({ status: 'released' });
  });
});
