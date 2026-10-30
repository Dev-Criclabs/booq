import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F03-T10 / migration 0214: the future hours limit. BOOK-05-AC1 to AC8; decisions D49, D59, D110.
// The count and the refusal run inside the booking transaction after the customer's advisory
// lock, so parallel requests from one player cannot both pass at N minus 1.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const LOC_B = 'bbbbbbbb-0000-4000-8000-000000000001';
const COURT1 = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT2 = 'c2c2c2c2-0000-4000-8000-000000000002';
const COURT_B = 'cbcbcbcb-0000-4000-8000-000000000003';
const STAFF = '33333333-2222-4333-8444-555555555555';
const P1 = '00000000-0000-4000-8000-000000000001';
const P2 = '00000000-0000-4000-8000-000000000002';

let tdb: TestDatabase;
let db: Db;
const at = (date: string, time: string) => new Date(`${date}T${time}+07:00`).toISOString();
const H = (h: number, date = '2026-12-02') => at(date, `${String(h).padStart(2, '0')}:00:00`);

const setLimit = (club: string, n: number | null) =>
  n === null
    ? tdb.query(`delete from public.club_setting where club_id = $1 and key = 'max_future_court_hours'`, [club])
    : tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'max_future_court_hours',to_jsonb($2::int)) on conflict (club_id, key) do update set value = excluded.value`, [club, n]);

const newOrder = async (customer: string, source = 'online', club = A) =>
  (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,$3) returning id`, [club, customer, source])).rows[0].id as string;

type Outcome = { ok: true } | { ok: false; code: string; detail: string | undefined };
async function reserve(who: { id: string; roles: string[] }, orderId: string, resource: string, starts: string[], override: string | null = null, club = A): Promise<Outcome> {
  try {
    await db.withClubTx({ clubId: club, userId: who.id, roles: who.roles, requestId: 'r', source: who.roles.includes('front_desk') ? 'admin' : 'player_app' }, (tx) =>
      tx.query(`select app.reserve_court($1, $2, $3::timestamptz[], null, $4)`, [orderId, resource, starts, override]));
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string; message: string; detail?: string };
    if (err.code === 'BK001') return { ok: false, code: err.message, detail: err.detail };
    throw e;
  }
}
const player = (id: string) => ({ id, roles: ['player'] });
const staff = { id: STAFF, roles: ['front_desk', 'player'] };

/** A booking row for the count, made directly (as another path would have left it). */
async function seed(customer: string, o: { status?: string; type?: string; start: string; hold?: string | null; court?: string; coach?: string | null }) {
  const order = await newOrder(customer);
  const status = o.status ?? 'confirmed';
  const start = new Date(o.start);
  await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, coach_id, start_at, end_at, customer_id, status, source, created_by, hold_expires_at, confirmed_at, released_at, release_reason)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'online',$8,$10,$11,$12,$13)`,
    [A, order, o.type ?? 'court', o.court ?? COURT2, o.type === 'solo_class' ? (o.coach ?? 'e0e0e0e0-0000-4000-8000-000000000009') : o.coach ?? null, start, new Date(start.getTime() + 3600_000), customer, status,
      status === 'awaiting_payment' ? (o.hold ?? '2026-12-01T03:15:00Z') : null, status === 'confirmed' ? '2026-12-01T03:00:00Z' : null,
      status === 'released' ? '2026-12-01T03:00:00Z' : null, status === 'released' ? 'expired' : null],
  );
}
const futureHours = (customer: string) =>
  db.withClubTx({ clubId: A, userId: customer, roles: ['player'] }, async (tx) => (await tx.query(`select app.future_hours($1) as n`, [customer])).rows[0]?.n as number);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z'); // 1 Dec 10:00 Bangkok
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  await tdb.seedCoach(A, 'e0e0e0e0-0000-4000-8000-000000000009');   // a solo class needs a coach row (F07, migration 0801)
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main'), ($3,$4,'Main')`, [A, LOC, B, LOC_B]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($1,$4,$3,'2','tennis'), ($5,$6,$7,'1','tennis')`, [A, COURT1, LOC, COURT2, B, COURT_B, LOC_B]);
  for (const club of [A, B]) {
    for (let d = 1; d <= 7; d += 1) await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [club, d]);
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [club]);
  }
  db = createDb({ connectionString: tdb.url, max: 12 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('unset means no limit (BOOK-05-AC1)', () => {
  it('a player may hold many hours when the setting is unset', async () => {
    const hours = Array.from({ length: 10 }, (_, i) => H(8 + i));
    expect(await reserve(player(P1), await newOrder(P1), COURT1, hours)).toEqual({ ok: true });
  });
});

describe('the limit N (BOOK-05-AC2, AC3)', () => {
  beforeEach(() => setLimit(A, 3));

  it('N hours are allowed and N plus 1 is refused whole with limit_reached{hours: N}', async () => {
    expect(await reserve(player(P1), await newOrder(P1), COURT1, [H(18), H(19), H(20)])).toEqual({ ok: true });
    expect(await reserve(player(P1), await newOrder(P1), COURT1, [H(21)])).toEqual({ ok: false, code: 'limit_reached', detail: '3' });
  });

  it('a multi hour selection that would pass N is refused whole and books nothing', async () => {
    await reserve(player(P1), await newOrder(P1), COURT1, [H(18)]);
    expect(await reserve(player(P1), await newOrder(P1), COURT2, [H(8), H(9), H(10)])).toEqual({ ok: false, code: 'limit_reached', detail: '3' });
    expect((await tdb.query('select count(*)::int as n from public.booking')).rows[0].n).toBe(1);
  });

  it('another player is counted on their own', async () => {
    await reserve(player(P1), await newOrder(P1), COURT1, [H(18), H(19), H(20)]);
    expect(await reserve(player(P2), await newOrder(P2), COURT2, [H(18), H(19), H(20)])).toEqual({ ok: true });
  });

  it("another club's setting does not apply", async () => {
    await reserve(player(P1), await newOrder(P1, 'online', B), COURT_B, [H(18), H(19), H(20), H(21)], null, B);
    expect((await tdb.query('select count(*)::int as n from public.booking where club_id = $1', [B])).rows[0].n).toBe(4);
  });

  it('changing the setting leaves existing bookings alone (AC6)', async () => {
    await reserve(player(P1), await newOrder(P1), COURT1, [H(18), H(19), H(20)]);
    await setLimit(A, 1);
    expect((await tdb.query('select count(*)::int as n from public.booking')).rows[0].n).toBe(3);
    expect(await reserve(player(P1), await newOrder(P1), COURT1, [H(21)])).toMatchObject({ ok: false, code: 'limit_reached', detail: '1' });
  });
});

describe('what counts (BOOK-05-AC4, AC5, D49, D59)', () => {
  it('counts unpaid held, confirmed and solo class hours; not group seats, played hours, released ones or expired holds', async () => {
    await seed(P1, { status: 'awaiting_payment', start: H(8) });
    await seed(P1, { status: 'confirmed', start: H(9) });
    await seed(P1, { status: 'confirmed', type: 'solo_class', start: H(10), court: COURT1 });
    expect(await futureHours(P1)).toBe(3);
    await seed(P1, { status: 'confirmed', type: 'class_seat', start: H(11) }); // group seat: not counted (D59)
    await seed(P1, { status: 'confirmed', start: H(11, '2026-11-30') }); // played
    await seed(P1, { status: 'released', start: H(12) });
    await seed(P1, { status: 'cancelled', start: H(13) });
    await seed(P1, { status: 'awaiting_payment', start: H(14), hold: '2026-12-01T02:59:00Z' }); // hold ended
    expect(await futureHours(P1)).toBe(3);
  });

  it('an hour that has not ended is still future: a running hour counts', async () => {
    await tdb.setNow(at('2026-12-01', '18:10:00'));
    await seed(P1, { status: 'confirmed', start: H(18, '2026-12-01') });
    expect(await futureHours(P1)).toBe(1);
    await tdb.setNow(at('2026-12-01', '19:00:00'));
    expect(await futureHours(P1)).toBe(0);
  });

  it('a limit of N with N unpaid held hours refuses the next', async () => {
    await setLimit(A, 2);
    await seed(P1, { status: 'awaiting_payment', start: H(8) });
    await seed(P1, { status: 'confirmed', start: H(9) });
    expect(await reserve(player(P1), await newOrder(P1), COURT1, [H(18)])).toMatchObject({ ok: false, code: 'limit_reached' });
  });

  it('group seats and played hours leave room', async () => {
    await setLimit(A, 2);
    await seed(P1, { status: 'confirmed', type: 'class_seat', start: H(8) });
    await seed(P1, { status: 'confirmed', start: H(9, '2026-11-30') });
    expect(await reserve(player(P1), await newOrder(P1), COURT1, [H(18), H(19)])).toEqual({ ok: true });
  });
});

describe('parallel requests at N minus 1 (BOOK-05-AC4, FA T4)', () => {
  it('exactly one of two parallel requests succeeds', async () => {
    await setLimit(A, 3);
    await seed(P1, { status: 'confirmed', start: H(8) });
    await seed(P1, { status: 'confirmed', start: H(9) });
    for (let round = 0; round < 3; round += 1) {
      // Reset to N minus 1 each round.
      await tdb.query(`delete from public.occupancy`);
      await tdb.query(`delete from public.booking where status = 'awaiting_payment'`);
      const results = await Promise.all([
        reserve(player(P1), await newOrder(P1), COURT1, [H(14 + round)]),
        reserve(player(P1), await newOrder(P1), COURT2, [H(14 + round)]),
        reserve(player(P1), await newOrder(P1), COURT1, [H(18 + round)]),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.code === 'limit_reached')).toBe(true);
    }
  });
});

describe('staff override (BOOK-05-AC7, AC8, D49, D110)', () => {
  beforeEach(async () => {
    await setLimit(A, 2);
    await seed(P1, { status: 'confirmed', start: H(8) });
    await seed(P1, { status: 'confirmed', start: H(9) });
  });

  it('staff over the limit without a reason is refused', async () => {
    const o = await newOrder(P1, 'staff');
    expect(await reserve(staff, o, COURT1, [H(18)])).toEqual({ ok: false, code: 'limit_reached', detail: '2' });
    expect(await reserve(staff, o, COURT1, [H(18)], '   ')).toEqual({ ok: false, code: 'limit_reached', detail: '2' });
  });

  it('staff over the limit with a reason is allowed, stored on the booking and audited', async () => {
    const o = await newOrder(P1, 'staff');
    expect(await reserve(staff, o, COURT1, [H(18)], 'regular, paid annual')).toEqual({ ok: true });
    expect((await tdb.query(`select override_reason from public.booking where order_id = $1`, [o])).rows[0].override_reason).toBe('regular, paid annual');
    const audit = await tdb.query(`select actor_user_id, source from public.audit_entry where record_type = 'booking' and action = 'insert' and new_value ->> 'override_reason' = 'regular, paid annual'`);
    expect(audit.rows).toEqual([{ actor_user_id: STAFF, source: 'admin' }]);
  });

  it('staff within the limit store no reason even if one is given', async () => {
    await setLimit(A, 5);
    const o = await newOrder(P1, 'staff');
    await reserve(staff, o, COURT1, [H(18)], 'not needed');
    expect((await tdb.query(`select override_reason from public.booking where order_id = $1`, [o])).rows[0].override_reason).toBeNull();
  });

  it('a player cannot override', async () => {
    expect(await reserve(player(P1), await newOrder(P1), COURT1, [H(18)], 'please')).toEqual({ ok: false, code: 'forbidden', detail: undefined });
    expect(await reserve(player(P1), await newOrder(P1), COURT1, [H(18)])).toMatchObject({ ok: false, code: 'limit_reached' });
  });

  it("staff bookings count toward the customer's hours (D49)", async () => {
    await setLimit(A, 3);
    expect(await reserve(staff, await newOrder(P1, 'staff'), COURT1, [H(18)])).toEqual({ ok: true });
    expect(await reserve(player(P1), await newOrder(P1), COURT1, [H(19)])).toMatchObject({ ok: false, code: 'limit_reached' });
  });
});
