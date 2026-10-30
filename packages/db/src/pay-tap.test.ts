import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F03-T12 / migration 0228: the limit on repeated Pay taps (decision D61; F03 design 4.2 step 1b, 4.8).
// An attempt is a reserve_court call that creates a new hold; it is written to pay_tap in the same
// transaction. The values are platform config set by Security: none is shipped, and unset means no limit.
// A second tap that returns the existing hold (D47) is not an attempt. A staff booking counts against staff.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const LOC_B = 'bbbbbbbb-0000-4000-8000-000000000001';
const COURT1 = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT2 = 'c2c2c2c2-0000-4000-8000-000000000002';
const COURT_B = 'cbcbcbcb-0000-4000-8000-000000000009';
const P1 = '00000000-0000-4000-8000-000000000001';
const P2 = '00000000-0000-4000-8000-000000000002';
const STAFF = '33333333-2222-4333-8444-555555555555';

let tdb: TestDatabase;
let db: Db;
let dbw: Db;
const H = (h: number) => new Date(`2026-12-02T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();

type Who = { id: string; roles: string[] };
const player = (id = P1): Who => ({ id, roles: ['player'] });
const desk: Who = { id: STAFF, roles: ['front_desk', 'player'] };
type Outcome = { ok: true; reused: boolean } | { ok: false; code: string; detail: string | undefined };

async function reserve(who: Who, customer: string, court: string, starts: string[], club = A): Promise<Outcome> {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,$3) returning id`, [club, customer, who.roles.includes('front_desk') ? 'staff' : 'online'])).rows[0].id as string;
  try {
    const r = await db.withClubTx({ clubId: club, userId: who.id, roles: who.roles, requestId: 'r', source: who.roles.includes('front_desk') ? 'admin' : 'player_app' }, async (tx) =>
      (await tx.query(`select app.reserve_court($1, $2, $3::timestamptz[]) as r`, [order, court, starts])).rows[0]!.r);
    return { ok: true, reused: r.reused === true };
  } catch (e) {
    const err = e as { code?: string; message: string; detail?: string };
    if (err.code === 'BK001') return { ok: false, code: err.message, detail: err.detail };
    throw e;
  }
}
const setLimit = (count: unknown, seconds: unknown) =>
  tdb.query(
    `insert into platform.config (key, value) values ('pay_tap_limit_count', $1::jsonb), ('pay_tap_limit_window_seconds', $2::jsonb)
     on conflict (key) do update set value = excluded.value`,
    [JSON.stringify(count), JSON.stringify(seconds)],
  );
const taps = async (club = A) => (await tdb.query(`select user_id from public.pay_tap where club_id = $1 order by at`, [club])).rows.map((r) => r.user_id);
const bookings = async () => (await tdb.query(`select count(*)::int n from public.booking`)).rows[0].n as number;

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
  dbw = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await db.end();
  await dbw.end();
  await tdb.close();
});

describe('pay tap limit (D61)', () => {
  it('with the platform values unset there is no limit and no value is invented', async () => {
    for (let h = 8; h < 14; h += 1) expect(await reserve(player(), P1, COURT1, [H(h)])).toMatchObject({ ok: true });
    expect(await taps()).toHaveLength(6);   // attempts are still recorded
  });

  it('a value that is not a positive number leaves the limit off', async () => {
    await setLimit(null, 60);
    for (let h = 8; h < 11; h += 1) expect(await reserve(player(), P1, COURT1, [H(h)])).toMatchObject({ ok: true });
    await setLimit(0, 60);
    expect(await reserve(player(), P1, COURT1, [H(12)])).toMatchObject({ ok: true });
  });

  it('at the limit a new hold is refused with too_many_attempts and the seconds to wait; nothing is created', async () => {
    await setLimit(2, 60);
    expect(await reserve(player(), P1, COURT1, [H(8)])).toMatchObject({ ok: true });
    await tdb.setNow('2026-12-01T03:00:20Z');
    expect(await reserve(player(), P1, COURT1, [H(9)])).toMatchObject({ ok: true });
    await tdb.setNow('2026-12-01T03:00:45Z');
    expect(await reserve(player(), P1, COURT1, [H(10)])).toEqual({ ok: false, code: 'too_many_attempts', detail: '15' });
    expect(await bookings()).toBe(2);
    expect(await taps()).toHaveLength(2);
    // Once the first attempt leaves the window, the next one goes through.
    await tdb.setNow('2026-12-01T03:01:00Z');
    expect(await reserve(player(), P1, COURT1, [H(10)])).toMatchObject({ ok: true });
  });

  it('a second tap that returns the existing hold is not an attempt and is never refused (D47)', async () => {
    await setLimit(1, 60);
    expect(await reserve(player(), P1, COURT1, [H(8)])).toEqual({ ok: true, reused: false });
    expect(await reserve(player(), P1, COURT1, [H(8)])).toEqual({ ok: true, reused: true });
    expect(await taps()).toHaveLength(1);
  });

  it('a refused attempt (slot taken) does not count', async () => {
    await setLimit(1, 60);
    expect(await reserve(player(P2), P2, COURT1, [H(8)])).toMatchObject({ ok: true });
    expect(await reserve(player(), P1, COURT1, [H(8)])).toMatchObject({ ok: false, code: 'slot_unavailable' });
    expect(await reserve(player(), P1, COURT1, [H(9)])).toMatchObject({ ok: true });
  });

  it('the limit is per player: another player is not held back', async () => {
    await setLimit(1, 60);
    expect(await reserve(player(), P1, COURT1, [H(8)])).toMatchObject({ ok: true });
    expect(await reserve(player(), P1, COURT1, [H(9)])).toMatchObject({ ok: false, code: 'too_many_attempts' });
    expect(await reserve(player(P2), P2, COURT2, [H(9)])).toMatchObject({ ok: true });
  });

  it('a staff booking for a customer counts against the staff member, not the customer', async () => {
    await setLimit(1, 60);
    expect(await reserve(desk, P1, COURT1, [H(8)])).toMatchObject({ ok: true });
    expect(await taps()).toEqual([STAFF]);
    expect(await reserve(player(), P1, COURT2, [H(9)])).toMatchObject({ ok: true });
    expect(await reserve(desk, P2, COURT2, [H(10)])).toMatchObject({ ok: false, code: 'too_many_attempts' });
  });

  it("another club's attempts do not count (CC-1)", async () => {
    await setLimit(1, 60);
    expect(await reserve(player(), P1, COURT_B, [H(8)], B)).toMatchObject({ ok: true });
    expect(await reserve(player(), P1, COURT1, [H(8)])).toMatchObject({ ok: true });
  });
});

describe('the pay_tap table', () => {
  it('the app role cannot read or write it; only reserve_court writes it', async () => {
    await reserve(player(), P1, COURT1, [H(8)]);
    const ctx = { clubId: A, userId: P1, roles: ['owner', 'player'], requestId: 'r', source: 'admin' as const };
    await expect(db.withClubTx(ctx, (tx) => tx.query('select * from public.pay_tap'))).rejects.toThrow(/permission denied/);
    await expect(db.withClubTx(ctx, (tx) => tx.query(`insert into public.pay_tap (club_id, user_id, at) values ($1,$2,now())`, [A, P1]))).rejects.toThrow(/permission denied/);
  });

  it('the housekeeping prune drops attempts that left the window, for the club in context only; with no limit set it drops them all', async () => {
    const prune = async () => dbw.withClubTx({ clubId: A, userId: null, roles: [] }, async (tx) => (await tx.query('select app.prune_pay_taps() as n')).rows[0]!.n);
    await setLimit(5, 60);
    await reserve(player(), P1, COURT1, [H(8)]);
    await reserve(player(), P1, COURT_B, [H(8)], B);
    await tdb.setNow('2026-12-01T03:01:01Z');
    await reserve(player(), P1, COURT1, [H(9)]);
    expect(await prune()).toBe(1);
    expect(await taps(A)).toHaveLength(1);
    expect(await taps(B)).toHaveLength(1);
    await tdb.query(`delete from platform.config where key like 'pay_tap_limit_%'`);
    expect(await prune()).toBe(1);
    expect(await taps(A)).toHaveLength(0);
  });
});
