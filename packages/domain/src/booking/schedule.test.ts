import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { BookingError } from './errors';
import { courtsFor, scheduleDays, scheduleFor, type Viewer } from './schedule';

// F03-T20: the reads behind GET /courts, /schedule/days and /schedule (BOOK-01-AC6, AC7, AC14,
// BOOK-02-AC1, AC2, AC5; design 4.6 and 5.1). Guests and players read only the public views (0220,
// 0224); a player's own bookings come through the booking_own_read policy.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const LOC_B = 'bbbbbbbb-0000-4000-8000-000000000001';
const COURT1 = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT2 = 'c2c2c2c2-0000-4000-8000-000000000002';
const COURT3 = 'c3c3c3c3-0000-4000-8000-000000000003';
const COURT_B = 'cbcbcbcb-0000-4000-8000-000000000009';
const P1 = '00000000-0000-4000-8000-000000000001';
const P2 = '00000000-0000-4000-8000-000000000002';
const DESK = '00000000-0000-4000-8000-0000000000d1';

const guest: Viewer = { userId: null, roles: ['guest'] };
const player = (userId = P1): Viewer => ({ userId, roles: ['player'] });
const desk: Viewer = { userId: DESK, roles: ['front_desk', 'player'] };
// "Today" is Tuesday 1 Dec 2026, 10:00 in Bangkok.
const at = (date: string, h: number) => new Date(`${date}T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();

let tdb: TestDatabase;
let db: Db;
const read = <T>(v: Viewer, fn: Parameters<Db['withClubTx']>[1], club = A) =>
  db.withClubTx({ clubId: club, userId: v.userId, roles: v.roles }, fn) as Promise<T>;

async function reserve(starts: string[], opts: { club?: string; court?: string; customer?: string; confirm?: boolean } = {}) {
  const club = opts.club ?? A;
  const customer = opts.customer ?? P1;
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [club, customer])).rows[0].id as string;
  await db.withClubTx({ clubId: club, userId: customer, roles: ['player'], requestId: 'r', source: 'player_app' }, (tx) =>
    tx.query(`select app.reserve_court($1, $2, $3::timestamptz[])`, [order, opts.court ?? COURT1, starts]));
  if (opts.confirm) {
    await db.withClubTx({ clubId: club, userId: DESK, roles: ['front_desk', 'player'], requestId: 'r', source: 'admin' }, (tx) => tx.query(`select app.confirm_booking($1)`, [order]));
  }
  return order;
}
const closure = async (court: string, from: string, to: string) =>
  tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, closure_id) values ($1,'closure',$2,$3,$4,'confirmed',$5)`, [A, court, from, to, await tdb.seedClosure(A)]);
const hourOf = (day: Awaited<ReturnType<typeof scheduleFor>>, court: string, h: number) =>
  day.courts.find((c) => c.id === court)!.hours.find((x) => x.start === `${day.date}T${String(h).padStart(2, '0')}:00:00+07:00`)!;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main'), ($3,$4,'Main')`, [A, LOC, B, LOC_B]);
  await tdb.query(
    `insert into public.resource (club_id, id, location_id, name, sport, active) values ($1,$2,$3,'1','tennis',true), ($1,$4,$3,'2','tennis',true), ($1,$5,$3,'3','tennis',false), ($6,$7,$8,'1','tennis',true)`,
    [A, COURT1, LOC, COURT2, COURT3, B, COURT_B, LOC_B],
  );
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

describe('courtsFor (GET /courts)', () => {
  it('a guest gets the active courts, the opening hours of every weekday and the window; an inactive court is not offered', async () => {
    const r = await read<Awaited<ReturnType<typeof courtsFor>>>(guest, (tx) => courtsFor(tx));
    expect(r.courts).toEqual([
      { id: COURT1, name: '1', sport: 'tennis' },
      { id: COURT2, name: '2', sport: 'tennis' },
    ]);
    expect(r.openingHours).toHaveLength(7);
    expect(r.openingHours[0]).toEqual({ weekday: 1, open: '06:00', close: '24:00' });
    expect(r.bookingWindowDays).toBe(30);
    expect(r.today).toBe('2026-12-01');
    expect(r.status).toBe('live');
  });

  it('a club in Draft, or in Testing for someone who is not a tester, is not found (CC-1)', async () => {
    await tdb.query(`update public.club set status = 'draft' where id = $1`, [A]);
    await expect(read(guest, (tx) => courtsFor(tx))).rejects.toEqual(new BookingError('not_found'));
    await tdb.query(`update public.club set status = 'testing' where id = $1`, [A]);
    await expect(read(player(), (tx) => courtsFor(tx))).rejects.toEqual(new BookingError('not_found'));
  });

  it('a Paused club still shows its courts, with the status, so C4 can show Paused (BOOK-02-AC4)', async () => {
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    expect((await read<{ status: string }>(guest, (tx) => courtsFor(tx))).status).toBe('paused');
  });

  it('an unset window is reported as null, not a default', async () => {
    await tdb.query(`delete from public.club_setting where club_id = $1 and key = 'booking_window_days'`, [A]);
    expect((await read<{ bookingWindowDays: number | null }>(guest, (tx) => courtsFor(tx))).bookingWindowDays).toBeNull();
  });
});

describe('scheduleFor (GET /schedule)', () => {
  it('a guest sees every court hour by hour across the opening hours; started hours are Past, the rest Open (BOOK-01-AC6, AC7)', async () => {
    const day = await read<Awaited<ReturnType<typeof scheduleFor>>>(guest, (tx) => scheduleFor(tx, guest, '2026-12-01'));
    expect(day.date).toBe('2026-12-01');
    expect(day.courts.map((c) => c.id)).toEqual([COURT1, COURT2]);
    const c1 = day.courts[0]!;
    expect(c1.hours).toHaveLength(18);
    expect(c1.hours[0]).toEqual({ start: '2026-12-01T06:00:00+07:00', state: 'past', waitlist: false });
    expect(hourOf(day, COURT1, 10).state).toBe('past');   // the hour that has started cannot be booked by a player (D39)
    expect(hourOf(day, COURT1, 11)).toEqual({ start: '2026-12-01T11:00:00+07:00', state: 'open', waitlist: false });
    expect(hourOf(day, COURT1, 23).state).toBe('open');
    expect(day.dayFull).toBe(false);
  });

  it('a live hold is Held, a confirmed booking Taken, both with the waitlist flag; nothing says who', async () => {
    await reserve([at('2026-12-02', 18)]);
    await reserve([at('2026-12-02', 19)], { customer: P2, confirm: true });
    const day = await read<Awaited<ReturnType<typeof scheduleFor>>>(guest, (tx) => scheduleFor(tx, guest, '2026-12-02'));
    expect(hourOf(day, COURT1, 18)).toEqual({ start: '2026-12-02T18:00:00+07:00', state: 'held', waitlist: true });
    expect(hourOf(day, COURT1, 19)).toEqual({ start: '2026-12-02T19:00:00+07:00', state: 'taken', waitlist: true });
    expect(hourOf(day, COURT2, 18).state).toBe('open');
    expect(JSON.stringify(day)).not.toContain(P1);
    expect(JSON.stringify(day)).not.toContain(P2);
  });

  it('a hold that has run out shows Open before the release job runs (BOOK-03-AC6)', async () => {
    await reserve([at('2026-12-02', 18)]);
    await tdb.setNow('2026-12-01T03:16:00Z');
    const day = await read<Awaited<ReturnType<typeof scheduleFor>>>(guest, (tx) => scheduleFor(tx, guest, '2026-12-02'));
    expect(hourOf(day, COURT1, 18).state).toBe('open');
  });

  it('My booking only for the signed in player who owns it; another player and a guest see Taken', async () => {
    await reserve([at('2026-12-02', 18), at('2026-12-02', 19)], { confirm: true });
    await reserve([at('2026-12-02', 20)]);
    const mine = await read<Awaited<ReturnType<typeof scheduleFor>>>(player(), (tx) => scheduleFor(tx, player(), '2026-12-02'));
    expect(hourOf(mine, COURT1, 18)).toEqual({ start: '2026-12-02T18:00:00+07:00', state: 'mine', waitlist: false });
    expect(hourOf(mine, COURT1, 19).state).toBe('mine');
    expect(hourOf(mine, COURT1, 20).state).toBe('mine');   // the player's own live hold
    const other = await read<Awaited<ReturnType<typeof scheduleFor>>>(player(P2), (tx) => scheduleFor(tx, player(P2), '2026-12-02'));
    expect(hourOf(other, COURT1, 18).state).toBe('taken');
    expect(hourOf(other, COURT1, 20).state).toBe('held');
    // Staff read every booking of the club, but My booking is still only their own.
    const staff = await read<Awaited<ReturnType<typeof scheduleFor>>>(desk, (tx) => scheduleFor(tx, desk, '2026-12-02'));
    expect(hourOf(staff, COURT1, 18).state).toBe('taken');
  });

  it('a closure is Closed and not waitlisted', async () => {
    await closure(COURT2, at('2026-12-02', 8), at('2026-12-02', 10));
    const day = await read<Awaited<ReturnType<typeof scheduleFor>>>(guest, (tx) => scheduleFor(tx, guest, '2026-12-02'));
    expect(hourOf(day, COURT2, 8)).toEqual({ start: '2026-12-02T08:00:00+07:00', state: 'closed', waitlist: false });
    expect(hourOf(day, COURT2, 9).state).toBe('closed');
    expect(hourOf(day, COURT2, 10).state).toBe('open');
  });

  it('staff see the hour that has started as Open until it ends (walk in, D39)', async () => {
    const day = await read<Awaited<ReturnType<typeof scheduleFor>>>(desk, (tx) => scheduleFor(tx, desk, '2026-12-01'));
    expect(hourOf(day, COURT1, 9).state).toBe('past');
    expect(hourOf(day, COURT1, 10).state).toBe('open');
  });

  it('a day with no open hour reports Day full, with the waitlist when a booking fills it (BOOK-01-AC14)', async () => {
    const all = Array.from({ length: 18 }, (_, i) => at('2026-12-03', 6 + i));
    await reserve(all, { court: COURT1, confirm: true });
    await reserve(all, { court: COURT2, customer: P2, confirm: true });
    const day = await read<Awaited<ReturnType<typeof scheduleFor>>>(guest, (tx) => scheduleFor(tx, guest, '2026-12-03'));
    expect(day.dayFull).toBe(true);
    expect(day.waitlist).toBe(true);
    const half = await read<Awaited<ReturnType<typeof scheduleFor>>>(guest, (tx) => scheduleFor(tx, guest, '2026-12-04'));
    expect(half.dayFull).toBe(false);
    expect(half.waitlist).toBe(false);
  });

  it('a day closed by closures is Day full without the waitlist', async () => {
    await closure(COURT1, at('2026-12-05', 0), at('2026-12-06', 0));
    await closure(COURT2, at('2026-12-05', 0), at('2026-12-06', 0));
    const day = await read<Awaited<ReturnType<typeof scheduleFor>>>(guest, (tx) => scheduleFor(tx, guest, '2026-12-05'));
    expect(day).toMatchObject({ dayFull: true, waitlist: false });
  });

  it('a weekday with no opening hours is Day full with no hours', async () => {
    await tdb.query(`delete from public.opening_hours where club_id = $1 and weekday = 3`, [A]);   // Wednesday 2 Dec
    const day = await read<Awaited<ReturnType<typeof scheduleFor>>>(guest, (tx) => scheduleFor(tx, guest, '2026-12-02'));
    expect(day.courts.every((c) => c.hours.length === 0)).toBe(true);
    expect(day).toMatchObject({ dayFull: true, waitlist: false });
  });

  it('day 30 is shown, day 31 and yesterday are refused, and a bad date is bad input (BOOK-01-AC4, D42)', async () => {
    expect((await read<{ date: string }>(guest, (tx) => scheduleFor(tx, guest, '2026-12-31'))).date).toBe('2026-12-31');
    await expect(read(guest, (tx) => scheduleFor(tx, guest, '2027-01-01'))).rejects.toEqual(new BookingError('outside_window'));
    await expect(read(guest, (tx) => scheduleFor(tx, guest, '2026-11-30'))).rejects.toEqual(new BookingError('in_the_past'));
    await expect(read(guest, (tx) => scheduleFor(tx, guest, '2026-02-30'))).rejects.toEqual(new BookingError('bad_input'));
    await expect(read(guest, (tx) => scheduleFor(tx, guest, 'tomorrow'))).rejects.toEqual(new BookingError('bad_input'));
  });

  it("another club's bookings never show (CC-1)", async () => {
    await reserve([at('2026-12-02', 18)], { club: B, court: COURT_B, confirm: true });
    const day = await read<Awaited<ReturnType<typeof scheduleFor>>>(guest, (tx) => scheduleFor(tx, guest, '2026-12-02'));
    expect(day.courts.flatMap((c) => c.hours).every((h) => h.state === 'open')).toBe(true);
  });

  it('a Draft club is not found', async () => {
    await tdb.query(`update public.club set status = 'draft' where id = $1`, [A]);
    await expect(read(guest, (tx) => scheduleFor(tx, guest, '2026-12-02'))).rejects.toEqual(new BookingError('not_found'));
  });
});

describe('scheduleDays (GET /schedule/days)', () => {
  it('counts open hours per court and day; today leaves out the hours already started; a full day is Day full', async () => {
    const all = Array.from({ length: 18 }, (_, i) => at('2026-12-03', 6 + i));
    await reserve(all, { court: COURT1, confirm: true });
    await reserve(all, { court: COURT2, customer: P2, confirm: true });
    await reserve([at('2026-12-02', 18)]);
    const r = await read<Awaited<ReturnType<typeof scheduleDays>>>(guest, (tx) => scheduleDays(tx, guest, '2026-12-01', '2026-12-03'));
    expect(r.days).toEqual([
      { date: '2026-12-01', courts: [{ id: COURT1, openHours: 13 }, { id: COURT2, openHours: 13 }], dayFull: false, waitlist: false },
      { date: '2026-12-02', courts: [{ id: COURT1, openHours: 17 }, { id: COURT2, openHours: 18 }], dayFull: false, waitlist: false },
      { date: '2026-12-03', courts: [{ id: COURT1, openHours: 0 }, { id: COURT2, openHours: 0 }], dayFull: true, waitlist: true },
    ]);
  });

  it('defaults to today through the window; a range past the window or before today is refused', async () => {
    const r = await read<Awaited<ReturnType<typeof scheduleDays>>>(guest, (tx) => scheduleDays(tx, guest));
    expect(r.days).toHaveLength(31);
    expect(r.days[30]!.date).toBe('2026-12-31');
    await expect(read(guest, (tx) => scheduleDays(tx, guest, '2026-12-01', '2027-01-01'))).rejects.toEqual(new BookingError('outside_window'));
    await expect(read(guest, (tx) => scheduleDays(tx, guest, '2026-11-30', '2026-12-02'))).rejects.toEqual(new BookingError('in_the_past'));
    await expect(read(guest, (tx) => scheduleDays(tx, guest, '2026-12-03', '2026-12-02'))).rejects.toEqual(new BookingError('bad_input'));
  });

  it('a weekday with no opening hours counts zero on every court', async () => {
    await tdb.query(`delete from public.opening_hours where club_id = $1 and weekday = 3`, [A]);
    const r = await read<Awaited<ReturnType<typeof scheduleDays>>>(guest, (tx) => scheduleDays(tx, guest, '2026-12-02', '2026-12-02'));
    expect(r.days).toEqual([{ date: '2026-12-02', courts: [{ id: COURT1, openHours: 0 }, { id: COURT2, openHours: 0 }], dayFull: true, waitlist: false }]);
  });
});
