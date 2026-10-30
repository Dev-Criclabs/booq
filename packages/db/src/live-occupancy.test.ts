import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F03-T16 / migration 0222: the guard behind PUT /hours and PUT /resources/{id}. Decision D50;
// BOOK-01-AC16. Changing opening hours or deactivating a court is refused while live bookings or
// holds sit on the affected hours; the owner uses a closure (F09) instead.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const LOC_B = 'bbbbbbbb-0000-4000-8000-000000000001';
const COURT1 = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT2 = 'c2c2c2c2-0000-4000-8000-000000000002';
const COURT_B = 'cbcbcbcb-0000-4000-8000-000000000009';
const OWNER = '33333333-2222-4333-8444-555555555555';
const P1 = '00000000-0000-4000-8000-000000000001';

let tdb: TestDatabase;
let db: Db;
// 2 Dec 2026 is a Wednesday (ISO weekday 3). 1 Dec is "today".
const at = (date: string, time: string) => new Date(`${date}T${time}+07:00`).toISOString();
const wed = (h: number) => at('2026-12-02', `${String(h).padStart(2, '0')}:00:00`);
type Who = { id: string; roles: string[]; club?: string };
const owner: Who = { id: OWNER, roles: ['owner', 'player'] };
const run = <T>(who: Who, fn: (tx: { query: (q: string, p?: unknown[]) => Promise<{ rows: any[] }> }) => Promise<T>) =>
  db.withClubTx({ clubId: who.club ?? A, userId: who.id, roles: who.roles, requestId: 'r', source: 'admin' }, fn);

async function book(hour: number, o: { court?: string; date?: string; confirm?: boolean } = {}) {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id as string;
  await run({ id: P1, roles: ['player'] }, (tx) => tx.query(`select app.reserve_court($1, $2, $3::timestamptz[])`, [order, o.court ?? COURT1, [at(o.date ?? '2026-12-02', `${String(hour).padStart(2, '0')}:00:00`)]]));
  if (o.confirm) await run(owner, (tx) => tx.query(`select app.confirm_booking($1)`, [order]));
  return order;
}
type Out = { ok: true } | { ok: false; code: string };
async function call(who: Who, sql: string, params: unknown[]): Promise<Out> {
  try {
    await run(who, (tx) => tx.query(sql, params));
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string; message: string };
    if (err.code === 'BK001') return { ok: false, code: err.message };
    throw e;
  }
}
const hoursChange = (who: Who, weekday: number, open: string | null, close: string | null) =>
  call(who, `select app.assert_hours_change_allowed($1, $2::time, $3::time)`, [weekday, open, close]);
const courtChange = (who: Who, court: string, active: boolean) => call(who, `select app.assert_resource_change_allowed($1, $2)`, [court, active]);
const count = (who: Who, court: string | null) => run(who, async (tx) => (await tx.query(`select app.count_live_occupancy($1) as n`, [court])).rows[0]?.n as number);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z'); // 1 Dec 10:00 Bangkok
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

describe('count_live_occupancy (D50)', () => {
  it('counts held and confirmed bookings in the future, per court or for the club', async () => {
    await book(18);
    await book(19, { confirm: true });
    await book(18, { court: COURT2 });
    expect(await count(owner, COURT1)).toBe(2);
    expect(await count(owner, COURT2)).toBe(1);
    expect(await count(owner, null)).toBe(3);
  });

  it('does not count a hold that has ended, a released booking, a closure or an hour already played', async () => {
    const o = await book(18);
    await book(19);
    await run(owner, (tx) => tx.query(`select app.release_hold($1, 'staff')`, [o]));
    await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, closure_id) values ($1,'closure',$2,$3,$4,'confirmed',gen_random_uuid())`, [A, COURT1, wed(20), wed(22)]);
    expect(await count(owner, COURT1)).toBe(1); // only the 19:00 hold
    await tdb.setNow('2026-12-01T03:16:00Z'); // the 19:00 hold has ended
    expect(await count(owner, COURT1)).toBe(0);
    await book(14, { confirm: true, date: '2026-12-01' }); // later today, confirmed
    expect(await count(owner, COURT1)).toBe(1);
    await tdb.setNow('2026-12-01T08:00:01Z'); // 15:00:01 Bangkok: the 14:00 hour has ended
    expect(await count(owner, COURT1)).toBe(0);
  });

  it("never counts another club's bookings, and only owner and front desk may ask", async () => {
    await book(18);
    expect(await run({ ...owner, club: B }, async (tx) => (await tx.query(`select app.count_live_occupancy(null) as n`)).rows[0].n)).toBe(0);
    await expect(run({ id: P1, roles: ['player'] }, (tx) => tx.query(`select app.count_live_occupancy(null)`))).rejects.toThrow(/forbidden/);
  });
});

describe('opening hours change (BOOK-01-AC16)', () => {
  it('shortening hours over a live booking is refused with the closure hint code', async () => {
    await book(21, { confirm: true });
    expect(await hoursChange(owner, 3, '06:00', '21:00')).toEqual({ ok: false, code: 'live_bookings_exist' });
    expect(await hoursChange(owner, 3, '22:00', '24:00')).toEqual({ ok: false, code: 'live_bookings_exist' });
  });

  it('a held booking blocks it too', async () => {
    await book(21);
    expect(await hoursChange(owner, 3, '06:00', '21:00')).toEqual({ ok: false, code: 'live_bookings_exist' });
  });

  it('with no bookings in the cut part it succeeds', async () => {
    await book(18);
    expect(await hoursChange(owner, 3, '06:00', '22:00')).toEqual({ ok: true });
    expect(await hoursChange(owner, 3, '18:00', '19:00')).toEqual({ ok: true });
    expect(await hoursChange(owner, 3, '06:00', '24:00')).toEqual({ ok: true });
  });

  it('only the weekday being changed matters', async () => {
    await book(21, { confirm: true }); // Wednesday
    expect(await hoursChange(owner, 1, '06:00', '12:00')).toEqual({ ok: true });
    expect(await hoursChange(owner, 4, '06:00', '12:00')).toEqual({ ok: true });
  });

  it('closing a weekday altogether is refused while it has a live booking', async () => {
    await book(18);
    expect(await hoursChange(owner, 3, null, null)).toEqual({ ok: false, code: 'live_bookings_exist' });
    expect(await hoursChange(owner, 5, null, null)).toEqual({ ok: true });
  });

  it('a booking in the past or a ended hold does not block', async () => {
    await book(21);
    await tdb.setNow('2026-12-01T03:16:00Z');
    expect(await hoursChange(owner, 3, '06:00', '12:00')).toEqual({ ok: true });
  });

  it('a closure does not block', async () => {
    await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, closure_id) values ($1,'closure',$2,$3,$4,'confirmed',gen_random_uuid())`, [A, COURT1, wed(21), wed(22)]);
    expect(await hoursChange(owner, 3, '06:00', '12:00')).toEqual({ ok: true });
  });

  it('a player cannot ask', async () => {
    expect(await hoursChange({ id: P1, roles: ['player'] }, 3, '06:00', '12:00')).toEqual({ ok: false, code: 'forbidden' });
  });
});

describe('court change (BOOK-01-AC16)', () => {
  it('deactivating a court over a live booking is refused', async () => {
    await book(18);
    expect(await courtChange(owner, COURT1, false)).toEqual({ ok: false, code: 'live_bookings_exist' });
  });

  it('deactivating a court with no bookings succeeds, and other courts are not affected by it', async () => {
    await book(18);
    expect(await courtChange(owner, COURT2, false)).toEqual({ ok: true });
  });

  it('activating a court, or leaving it active, is always allowed', async () => {
    await book(18);
    expect(await courtChange(owner, COURT1, true)).toEqual({ ok: true });
  });

  it("another club's court is not found as busy, and an unknown court is allowed through to the route's own 404", async () => {
    await book(18);
    expect(await courtChange({ ...owner, club: B }, COURT_B, false)).toEqual({ ok: true });
  });
});
