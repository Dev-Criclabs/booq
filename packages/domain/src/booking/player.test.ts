import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db, type ClubContext } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { BookingError } from './errors';
import { getBooking, releaseOwnHold } from './player';

// F03-T21: the reads and the release behind GET /bookings/{id} and POST /bookings/{id}/release
// (BOOK-03-AC14, ROLE-01-AC4; design 4.5, 5.2, 8). A player sees and releases only their own; another
// player's booking is not found, never forbidden, so its existence is not revealed.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const LOC_B = 'bbbbbbbb-0000-4000-8000-000000000001';
const COURT1 = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT_B = 'cbcbcbcb-0000-4000-8000-000000000009';
const P1 = '00000000-0000-4000-8000-000000000001';
const P2 = '00000000-0000-4000-8000-000000000002';
const DESK = '00000000-0000-4000-8000-0000000000d1';
const ACC = '00000000-0000-4000-8000-0000000000a1';
const at = (date: string, h: number) => new Date(`${date}T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();

let tdb: TestDatabase;
let db: Db;
const ctx = (userId: string, roles: string[], club = A): ClubContext => ({ clubId: club, userId, roles, requestId: 'r', source: roles.includes('front_desk') ? 'admin' : 'player_app' });
const as = <T>(c: ClubContext, fn: Parameters<Db['withClubTx']>[1]) => db.withClubTx(c, fn) as Promise<T>;
const player = (u = P1) => ctx(u, ['player']);
const viewer = (c: ClubContext) => ({ userId: c.userId, roles: c.roles as readonly string[] });

async function reserve(starts: string[], opts: { club?: string; court?: string; customer?: string; confirm?: boolean } = {}) {
  const club = opts.club ?? A;
  const customer = opts.customer ?? P1;
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [club, customer])).rows[0].id as string;
  const r = await db.withClubTx(ctx(customer, ['player'], club), (tx) =>
    tx.query<{ r: { booking_ids: string[] } }>(`select app.reserve_court($1, $2, $3::timestamptz[]) as r`, [order, opts.court ?? COURT1, starts]));
  if (opts.confirm) await db.withClubTx(ctx(DESK, ['front_desk', 'player'], club), (tx) => tx.query(`select app.confirm_booking($1)`, [order]));
  return { order, ids: r.rows[0]!.r.booking_ids };
}
const statusOf = async (id: string | undefined) => (await tdb.query(`select status, release_reason from public.booking where id = $1`, [id])).rows[0];

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main'), ($3,$4,'Main')`, [A, LOC, B, LOC_B]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($4,$5,$6,'1','tennis')`, [A, COURT1, LOC, B, COURT_B, LOC_B]);
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

describe('getBooking (GET /bookings/{id})', () => {
  it('the player reads their own hold with its end time for the countdown (C11, C12)', async () => {
    const { order, ids } = await reserve([at('2026-12-02', 18)]);
    const b = await as(player(), (tx) => getBooking(tx, viewer(player()), ids[0]));
    expect(b).toEqual({
      id: ids[0],
      orderId: order,
      type: 'court',
      status: 'awaiting_payment',
      court: { id: COURT1, name: '1' },
      start: '2026-12-02T18:00:00+07:00',
      end: '2026-12-02T19:00:00+07:00',
      holdExpiresAt: '2026-12-01T10:15:00+07:00',
      holdEnded: false,
    });
  });

  it('when the hold has ended the booking says so, before the release job runs (BOOK-03-AC14)', async () => {
    const { ids } = await reserve([at('2026-12-02', 18)]);
    await tdb.setNow('2026-12-01T03:15:00Z');
    expect(await as(player(), (tx) => getBooking(tx, viewer(player()), ids[0]))).toMatchObject({ status: 'awaiting_payment', holdEnded: true });
  });

  it('a confirmed booking has no hold', async () => {
    const { ids } = await reserve([at('2026-12-02', 18)], { confirm: true });
    expect(await as(player(), (tx) => getBooking(tx, viewer(player()), ids[0]))).toMatchObject({ status: 'confirmed', holdExpiresAt: null, holdEnded: false });
  });

  it("another player's booking is not found; so is another club's and an unknown id", async () => {
    const { ids } = await reserve([at('2026-12-02', 18)]);
    await expect(as(player(P2), (tx) => getBooking(tx, viewer(player(P2)), ids[0]))).rejects.toEqual(new BookingError('not_found'));
    const other = await reserve([at('2026-12-02', 18)], { club: B, court: COURT_B });
    await expect(as(player(), (tx) => getBooking(tx, viewer(player()), other.ids[0]))).rejects.toEqual(new BookingError('not_found'));
    await expect(as(player(), (tx) => getBooking(tx, viewer(player()), 'ffffffff-0000-4000-8000-000000000000'))).rejects.toEqual(new BookingError('not_found'));
  });

  it('front desk reads any booking of the club; the accountant does not through this route (D35)', async () => {
    const { ids } = await reserve([at('2026-12-02', 18)]);
    const desk = ctx(DESK, ['front_desk', 'player']);
    expect(await as(desk, (tx) => getBooking(tx, viewer(desk), ids[0]))).toMatchObject({ id: ids[0] });
    const acc = ctx(ACC, ['accountant', 'player']);
    await expect(as(acc, (tx) => getBooking(tx, viewer(acc), ids[0]))).rejects.toEqual(new BookingError('not_found'));
  });
});

describe('releaseOwnHold (POST /bookings/{id}/release)', () => {
  it('the player leaves C11: every hour of the order is released with reason player (design 4.5, A-6)', async () => {
    const { order, ids } = await reserve([at('2026-12-02', 18), at('2026-12-02', 19)]);
    expect(await as(player(), (tx) => releaseOwnHold(tx, viewer(player()), ids[1]))).toEqual({ orderId: order, status: 'released' });
    expect(await statusOf(ids[0])).toEqual({ status: 'released', release_reason: 'player' });
    expect(await statusOf(ids[1])).toEqual({ status: 'released', release_reason: 'player' });
    expect((await tdb.query(`select count(*)::int n from public.occupancy where booking_id = any($1)`, [ids])).rows[0].n).toBe(0);
  });

  it('releasing a confirmed booking is refused and nothing changes', async () => {
    const { ids } = await reserve([at('2026-12-02', 18)], { confirm: true });
    await expect(as(player(), (tx) => releaseOwnHold(tx, viewer(player()), ids[0]))).rejects.toEqual(new BookingError('not_releasable'));
    expect((await statusOf(ids[0])).status).toBe('confirmed');
  });

  it('a hold already released is refused the second time', async () => {
    const { ids } = await reserve([at('2026-12-02', 18)]);
    await as(player(), (tx) => releaseOwnHold(tx, viewer(player()), ids[0]));
    await expect(as(player(), (tx) => releaseOwnHold(tx, viewer(player()), ids[0]))).rejects.toEqual(new BookingError('not_releasable'));
  });

  it("another player's hold is not found and stays held", async () => {
    const { ids } = await reserve([at('2026-12-02', 18)]);
    await expect(as(player(P2), (tx) => releaseOwnHold(tx, viewer(player(P2)), ids[0]))).rejects.toEqual(new BookingError('not_found'));
    expect((await statusOf(ids[0])).status).toBe('awaiting_payment');
  });

  it('staff use the staff route: their own player route does not release a customer hold', async () => {
    const { ids } = await reserve([at('2026-12-02', 18)]);
    const desk = ctx(DESK, ['front_desk', 'player']);
    await expect(as(desk, (tx) => releaseOwnHold(tx, viewer(desk), ids[0]))).rejects.toEqual(new BookingError('not_found'));
    expect((await statusOf(ids[0])).status).toBe('awaiting_payment');
  });
});
