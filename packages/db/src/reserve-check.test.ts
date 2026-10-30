import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F03-T07 / migration 0211: reserve_court part 1, the checks before anything is claimed.
// BOOK-01, BOOK-03-AC2, BOOK-06; decisions D39, D42, D60; SR-07. Every check runs in the
// database inside the transaction and returns a typed code (no text, CC-5).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const P1 = '11111111-2222-4333-8444-555555555555';
const P2 = '22222222-2222-4333-8444-555555555555';
const STAFF = '33333333-2222-4333-8444-555555555555';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const LOC_B = 'bbbbbbbb-0000-4000-8000-000000000001';
const COURT = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT2 = 'c2c2c2c2-0000-4000-8000-000000000002';
const COURT_B = 'cbcbcbcb-0000-4000-8000-000000000003';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';

let tdb: TestDatabase;
let db: Db;
let order: string;

type Ctx = { userId: string | null; roles: string[] };
const player: Ctx = { userId: P1, roles: ['player'] };
const staff: Ctx = { userId: STAFF, roles: ['front_desk', 'player'] };
const owner: Ctx = { userId: STAFF, roles: ['owner', 'player'] };
const guest: Ctx = { userId: null, roles: ['guest'] };

const at = (date: string, time: string) => new Date(`${date}T${time}+07:00`).toISOString();

/** Runs the check and returns {ok, source, ...} or {code} for a typed refusal. */
async function check(
  c: Ctx,
  starts: string[],
  over: { resource?: string; coach?: string | null; override?: string | null; orderId?: string; club?: string } = {},
) {
  try {
    return await db.withClubTx({ clubId: over.club ?? A, userId: c.userId, roles: c.roles, requestId: 'r', source: 'player_app' }, async (tx) => {
      const r = await tx.query(`select app.reserve_court_check($1, $2, $3::timestamptz[], $4, $5) as res`, [
        over.orderId ?? order,
        over.resource ?? COURT,
        starts,
        over.coach ?? null,
        over.override ?? null,
      ]);
      return { ok: true as const, ...(r.rows[0]?.res as Record<string, unknown>) };
    });
  } catch (e) {
    const err = e as { code?: string; message: string };
    if (err.code === 'BK001') return { ok: false as const, code: err.message };
    throw e;
  }
}

const setStatus = (club: string, status: string) => tdb.query(`update public.club set status = $2 where id = $1`, [club, status]);

beforeEach(async () => {
  tdb = await createTestDatabase();
  // Now is 1 Dec 2026 10:00 Bangkok (03:00Z).
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main'), ($3,$4,'Main')`, [A, LOC, B, LOC_B]);
  await tdb.query(
    `insert into public.resource (club_id, id, location_id, name, sport, active) values
     ($1,$2,$3,'1','tennis',true), ($1,$4,$3,'2','tennis',false), ($5,$6,$7,'1','tennis',true)`,
    [A, COURT, LOC, COURT2, B, COURT_B, LOC_B],
  );
  for (let d = 1; d <= 7; d += 1) {
    await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [A, d]);
  }
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [A]);
  order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id;
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('context (BOOK-03-AC2, BOOK-01-AC10, D60)', () => {
  const slot = [at('2026-12-02', '18:00:00')];

  it('a guest and a signed out session are refused', async () => {
    expect(await check(guest, slot)).toEqual({ ok: false, code: 'sign_in_required' });
    expect(await check({ userId: null, roles: [] }, slot)).toEqual({ ok: false, code: 'sign_in_required' });
  });

  it('a Live club accepts a player', async () => {
    expect(await check(player, slot)).toMatchObject({ ok: true });
  });

  it('Paused refuses everyone, staff too (D60)', async () => {
    await setStatus(A, 'paused');
    expect(await check(player, slot)).toEqual({ ok: false, code: 'club_paused' });
    expect(await check(staff, slot)).toEqual({ ok: false, code: 'club_paused' });
    expect(await check(owner, slot)).toEqual({ ok: false, code: 'club_paused' });
  });

  it('Draft and Testing refuse a player who is not a tester', async () => {
    await setStatus(A, 'draft');
    expect(await check(player, slot)).toEqual({ ok: false, code: 'club_not_available' });
    await setStatus(A, 'testing');
    expect(await check(player, slot)).toEqual({ ok: false, code: 'club_not_available' });
  });

  it('Testing lets the owner in (a tester)', async () => {
    await setStatus(A, 'testing');
    expect(await check(owner, slot)).toMatchObject({ ok: true });
  });

  it("an order of another club finds nothing (SR-07)", async () => {
    const other = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [B, P1])).rows[0].id;
    expect(await check(player, slot, { orderId: other })).toEqual({ ok: false, code: 'order_not_found' });
  });
});

describe('who is the customer, and the source (SR-07)', () => {
  const slot = [at('2026-12-02', '18:00:00')];

  it("a player cannot use another customer's order", async () => {
    expect(await check({ userId: P2, roles: ['player'] }, slot)).toEqual({ ok: false, code: 'order_not_found' });
  });

  it('a player gets their own customer id and the online source', async () => {
    expect(await check(player, slot)).toMatchObject({ ok: true, customer_id: P1, source: 'online', staff: false });
  });

  it('a player cannot use a staff order', async () => {
    await tdb.query(`update public.orders set source = 'staff' where id = $1`, [order]);
    expect(await check(player, slot)).toEqual({ ok: false, code: 'order_not_found' });
  });

  it("staff may book for the order's customer, and the source is staff", async () => {
    await tdb.query(`update public.orders set source = 'staff' where id = $1`, [order]);
    expect(await check(staff, slot)).toMatchObject({ ok: true, customer_id: P1, source: 'staff', staff: true });
  });

  it('only staff may give an override reason', async () => {
    expect(await check(player, slot, { override: 'regular' })).toEqual({ ok: false, code: 'forbidden' });
    await tdb.query(`update public.orders set source = 'staff' where id = $1`, [order]);
    expect(await check(staff, slot, { override: 'regular' })).toMatchObject({ ok: true });
  });

  it('a direct insert into booking as a player fails', async () => {
    await expect(
      db.withClubTx({ clubId: A, userId: P1, roles: ['player'], source: 'player_app' }, (tx) =>
        tx.query(
          `insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, hold_expires_at)
           values ($1,$2,'court',$3,$4,$5,$6,'awaiting_payment','online',$6,now())`,
          [A, order, COURT, at('2026-12-02', '18:00:00'), at('2026-12-02', '19:00:00'), P1],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('selection shape (BOOK-01-AC1, AC2, AC11, BOOK-06)', () => {
  it('accepts one hour and consecutive hours', async () => {
    expect(await check(player, [at('2026-12-02', '18:00:00')])).toMatchObject({ ok: true });
    expect(await check(player, [at('2026-12-02', '18:00:00'), at('2026-12-02', '19:00:00'), at('2026-12-02', '20:00:00')])).toMatchObject({ ok: true });
    // order of the list does not matter
    expect(await check(player, [at('2026-12-02', '19:00:00'), at('2026-12-02', '18:00:00')])).toMatchObject({ ok: true });
  });

  it.each(['18:30:00', '18:01:00', '18:00:01'])('refuses %s', async (t) => {
    expect(await check(player, [at('2026-12-02', t)])).toEqual({ ok: false, code: 'not_on_the_hour' });
  });

  it('refuses non-consecutive hours, a repeated hour and an empty selection', async () => {
    expect(await check(player, [at('2026-12-02', '18:00:00'), at('2026-12-02', '20:00:00')])).toEqual({ ok: false, code: 'not_consecutive' });
    expect(await check(player, [at('2026-12-02', '18:00:00'), at('2026-12-02', '18:00:00')])).toEqual({ ok: false, code: 'not_consecutive' });
    expect(await check(player, [])).toEqual({ ok: false, code: 'not_consecutive' });
  });

  it('refuses hours that run across midnight (one Bangkok date)', async () => {
    expect(await check(player, [at('2026-12-02', '23:00:00'), at('2026-12-03', '00:00:00')])).toEqual({ ok: false, code: 'not_consecutive' });
  });
});

describe('opening hours (BOOK-01-AC3, D39)', () => {
  it('06:00 and 23:00 are starts; 05:00 and 24:00 are not', async () => {
    expect(await check(player, [at('2026-12-02', '06:00:00')])).toMatchObject({ ok: true });
    expect(await check(player, [at('2026-12-02', '23:00:00')])).toMatchObject({ ok: true });
    expect(await check(player, [at('2026-12-02', '05:00:00')])).toEqual({ ok: false, code: 'outside_hours' });
    expect(await check(player, [at('2026-12-03', '00:00:00')])).toEqual({ ok: false, code: 'outside_hours' });
  });

  it('an hour may not end after closing; a closed weekday is outside hours', async () => {
    await tdb.query(`update public.opening_hours set close = '22:00' where club_id = $1`, [A]);
    expect(await check(player, [at('2026-12-02', '21:00:00')])).toMatchObject({ ok: true });
    expect(await check(player, [at('2026-12-02', '22:00:00')])).toEqual({ ok: false, code: 'outside_hours' });
    await tdb.query(`delete from public.opening_hours where club_id = $1 and weekday = 3`, [A]); // Wednesday, 2 Dec 2026
    expect(await check(player, [at('2026-12-02', '18:00:00')])).toEqual({ ok: false, code: 'outside_hours' });
  });
});

describe('booking window by Bangkok date, day 30 inclusive (BOOK-01-AC4, AC12, D42)', () => {
  it('day 30 accepted and day 31 refused at 23:59 Bangkok', async () => {
    await tdb.setNow(at('2026-12-01', '23:59:00'));
    expect(await check(player, [at('2026-12-31', '18:00:00')])).toMatchObject({ ok: true });
    expect(await check(player, [at('2027-01-01', '18:00:00')])).toEqual({ ok: false, code: 'outside_window' });
  });

  it('at 00:01 the next Bangkok day, day 31 is inside', async () => {
    await tdb.setNow(at('2026-12-02', '00:01:00'));
    expect(await check(player, [at('2027-01-01', '18:00:00')])).toMatchObject({ ok: true });
    expect(await check(player, [at('2027-01-02', '18:00:00')])).toEqual({ ok: false, code: 'outside_window' });
  });

  it('follows the setting, and an unset window refuses (no default)', async () => {
    await tdb.query(`update public.club_setting set value = '7' where club_id = $1 and key = 'booking_window_days'`, [A]);
    expect(await check(player, [at('2026-12-08', '18:00:00')])).toMatchObject({ ok: true });
    expect(await check(player, [at('2026-12-09', '18:00:00')])).toEqual({ ok: false, code: 'outside_window' });
    await tdb.query(`delete from public.club_setting where club_id = $1 and key = 'booking_window_days'`, [A]);
    expect(await check(player, [at('2026-12-02', '18:00:00')])).toEqual({ ok: false, code: 'outside_window' });
  });
});

describe('past and started hours (BOOK-01-AC5, D39)', () => {
  it('at 18:10 a player cannot book 18:00 and staff can', async () => {
    await tdb.setNow(at('2026-12-01', '18:10:00'));
    await tdb.query(`update public.orders set source = 'staff' where id = $1`, [order]);
    const slot = [at('2026-12-01', '18:00:00')];
    expect(await check(player, slot)).toEqual({ ok: false, code: 'order_not_found' }); // staff order, player caller
    await tdb.query(`update public.orders set source = 'online' where id = $1`, [order]);
    expect(await check(player, slot)).toEqual({ ok: false, code: 'hour_started' });
    await tdb.query(`update public.orders set source = 'staff' where id = $1`, [order]);
    expect(await check(staff, slot)).toMatchObject({ ok: true });
    expect(await check(player, [at('2026-12-01', '19:00:00')])).toEqual({ ok: false, code: 'order_not_found' });
  });

  it('at 19:00 nobody can book 18:00', async () => {
    await tdb.setNow(at('2026-12-01', '19:00:00'));
    await tdb.query(`update public.orders set source = 'staff' where id = $1`, [order]);
    expect(await check(staff, [at('2026-12-01', '18:00:00')])).toEqual({ ok: false, code: 'in_the_past' });
    await tdb.query(`update public.orders set source = 'online' where id = $1`, [order]);
    expect(await check(player, [at('2026-12-01', '18:00:00')])).toEqual({ ok: false, code: 'in_the_past' });
  });

  it('a started hour inside a multi hour selection refuses the whole selection', async () => {
    await tdb.setNow(at('2026-12-01', '18:10:00'));
    expect(await check(player, [at('2026-12-01', '18:00:00'), at('2026-12-01', '19:00:00')])).toEqual({ ok: false, code: 'hour_started' });
  });
});

describe('court (BOOK-01-AC9)', () => {
  it('an inactive court, another club\'s court and an unknown court are refused', async () => {
    const slot = [at('2026-12-02', '18:00:00')];
    expect(await check(player, slot, { resource: COURT2 })).toEqual({ ok: false, code: 'resource_inactive' });
    expect(await check(player, slot, { resource: COURT_B })).toEqual({ ok: false, code: 'resource_inactive' });
    expect(await check(player, slot, { resource: 'deadbeef-0000-4000-8000-000000000000' })).toEqual({ ok: false, code: 'resource_inactive' });
  });
});

describe('a coach (design 4.2 step 9, assumption A-8)', () => {
  it('is refused with coach_rules_not_installed until F07 registers the check', async () => {
    expect(await check(player, [at('2026-12-02', '18:00:00')], { coach: COACH })).toEqual({ ok: false, code: 'coach_rules_not_installed' });
  });
});

describe('app.hold_minutes (F03-T05, D52)', () => {
  const read = () => db.withClubTx({ clubId: A, userId: P1, roles: ['player'] }, async (tx) => (await tx.query('select app.hold_minutes() as m')).rows[0]?.m as number | null);

  it('reads back 10, 15 or 20', async () => {
    for (const m of [10, 15, 20]) {
      await tdb.query(`update public.club_setting set value = to_jsonb($2::int) where club_id = $1 and key = 'hold_minutes'`, [A, m]);
      expect(await read()).toBe(m);
    }
  });

  it('unset reads as null; 12 is refused', async () => {
    // The table now refuses a hold time of 12 itself (migration 0041); drop that check to prove the reader refuses a bad stored value too.
    await tdb.query(`alter table public.club_setting drop constraint club_setting_hold_minutes`);
    await tdb.query(`update public.club_setting set value = '12' where club_id = $1 and key = 'hold_minutes'`, [A]);
    await expect(read()).rejects.toThrow(/hold_minutes/);
    await tdb.query(`delete from public.club_setting where club_id = $1 and key = 'hold_minutes'`, [A]);
    expect(await read()).toBeNull();
  });
});
