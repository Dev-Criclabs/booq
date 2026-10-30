import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F03-T08 / migration 0212: reserve_court part 2, the claim. One booking and one occupancy row
// per hour in one transaction, all or nothing, typed slot_unavailable{by}.
// BOOK-04-AC1, AC4, AC5, AC12, BOOK-06; SR-07; FA T1 to T4.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const LOC_B = 'bbbbbbbb-0000-4000-8000-000000000001';
const COURT = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT_B = 'cbcbcbcb-0000-4000-8000-000000000003';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let tdb: TestDatabase;
let db: Db;

const at = (date: string, time: string) => new Date(`${date}T${time}+07:00`).toISOString();
const H = (h: number) => at('2026-12-02', `${String(h).padStart(2, '0')}:00:00`);

async function newOrder(customer: string, club = A) {
  return (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [club, customer])).rows[0].id as string;
}

type Outcome = { ok: true; res: { order_id: string; booking_ids: string[]; hold_expires_at: string } } | { ok: false; code: string; detail: string | undefined };

async function reserve(customer: string, orderId: string, starts: string[], over: { club?: string; resource?: string } = {}): Promise<Outcome> {
  try {
    const res = await db.withClubTx(
      { clubId: over.club ?? A, userId: customer, roles: ['player'], requestId: 'r', source: 'player_app' },
      async (tx) => (await tx.query(`select app.reserve_court($1, $2, $3::timestamptz[], null, null) as res`, [orderId, over.resource ?? COURT, starts])).rows[0]?.res,
    );
    return { ok: true, res };
  } catch (e) {
    const err = e as { code?: string; message: string; detail?: string };
    if (err.code === 'BK001') return { ok: false, code: err.message, detail: err.detail };
    throw e;
  }
}

const count = async (table: string) => (await tdb.query(`select count(*)::int as n from public.${table}`)).rows[0].n as number;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z'); // 1 Dec 10:00 Bangkok
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main'), ($3,$4,'Main')`, [A, LOC, B, LOC_B]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($4,$5,$6,'1','tennis')`, [A, COURT, LOC, B, COURT_B, LOC_B]);
  for (const club of [A, B]) {
    for (let d = 1; d <= 7; d += 1) await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [club, d]);
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [club]);
  }
  db = createDb({ connectionString: tdb.url, max: 24 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('the claim (BOOK-04-AC1, BOOK-06)', () => {
  it('books one hour: one booking, one held occupancy row, hold ends at now plus the setting', async () => {
    const o = await newOrder(uid(1));
    const r = await reserve(uid(1), o, [H(18)]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.res.order_id).toBe(o);
    expect(r.res.booking_ids).toHaveLength(1);
    expect(new Date(r.res.hold_expires_at).toISOString()).toBe('2026-12-01T03:15:00.000Z');
    const b = (await tdb.query('select status, source, customer_id, created_by, resource_id, coach_id, type, hold_expires_at from public.booking')).rows[0];
    expect(b).toMatchObject({ status: 'awaiting_payment', source: 'online', customer_id: uid(1), created_by: uid(1), resource_id: COURT, coach_id: null, type: 'court' });
    const occ = (await tdb.query('select kind, state, resource_id, booking_id, hold_expires_at from public.occupancy')).rows[0];
    expect(occ).toMatchObject({ kind: 'court_booking', state: 'held', resource_id: COURT, booking_id: r.res.booking_ids[0] });
    expect(occ.hold_expires_at.toISOString()).toBe('2026-12-01T03:15:00.000Z');
  });

  it('a three hour selection is one order, three bookings, three occupancy rows with the same hold end (BOOK-06, D40)', async () => {
    const o = await newOrder(uid(1));
    const r = await reserve(uid(1), o, [H(19), H(18), H(20)]);
    expect(r).toMatchObject({ ok: true });
    expect(await count('booking')).toBe(3);
    expect(await count('occupancy')).toBe(3);
    expect((await tdb.query('select count(distinct order_id)::int as n, count(distinct hold_expires_at)::int as h from public.booking')).rows[0]).toEqual({ n: 1, h: 1 });
    expect((await tdb.query('select start_at from public.booking order by start_at')).rows.map((x) => x.start_at.toISOString())).toEqual([H(18), H(19), H(20)]);
  });

  it('back to back hours both succeed (half open ranges)', async () => {
    expect(await reserve(uid(1), await newOrder(uid(1)), [H(18)])).toMatchObject({ ok: true });
    expect(await reserve(uid(2), await newOrder(uid(2)), [H(19)])).toMatchObject({ ok: true });
    expect(await reserve(uid(3), await newOrder(uid(3)), [H(17)])).toMatchObject({ ok: true });
  });

  it('refuses a held or confirmed hour with slot_unavailable by the court (BOOK-04-AC4)', async () => {
    await reserve(uid(1), await newOrder(uid(1)), [H(18)]);
    const r = await reserve(uid(2), await newOrder(uid(2)), [H(18)]);
    expect(r).toEqual({ ok: false, code: 'slot_unavailable', detail: 'resource' });
    expect(await count('booking')).toBe(1);
  });

  it('a clash on a closure refuses the same way', async () => {
    await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, closure_id) values ($1,'closure',$2,$3,$4,'confirmed',gen_random_uuid())`, [A, COURT, H(17), H(20)]);
    expect(await reserve(uid(1), await newOrder(uid(1)), [H(18)])).toEqual({ ok: false, code: 'slot_unavailable', detail: 'resource' });
  });

  it('a three hour selection where hour two is taken books nothing (BOOK-04-AC5, FA T3)', async () => {
    await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, closure_id) values ($1,'closure',$2,$3,$4,'confirmed',gen_random_uuid())`, [A, COURT, H(19), H(20)]);
    const o = await newOrder(uid(1));
    expect(await reserve(uid(1), o, [H(18), H(19), H(20)])).toEqual({ ok: false, code: 'slot_unavailable', detail: 'resource' });
    expect(await count('booking')).toBe(0);
    expect(await count('occupancy')).toBe(1); // only the closure
  });

  it('an expired hold with the job not run does not block, and the old booking ends released (BOOK-03-AC6, FA T8)', async () => {
    const o1 = await newOrder(uid(1));
    await reserve(uid(1), o1, [H(18)]);
    await tdb.setNow('2026-12-01T03:16:00Z');
    const r = await reserve(uid(2), await newOrder(uid(2)), [H(18)]);
    expect(r).toMatchObject({ ok: true });
    expect((await tdb.query('select status, release_reason from public.booking where order_id = $1', [o1])).rows[0]).toEqual({ status: 'released', release_reason: 'expired' });
    expect(await count('occupancy')).toBe(1);
  });

  it('a live hold still blocks one second before it ends', async () => {
    await reserve(uid(1), await newOrder(uid(1)), [H(18)]);
    await tdb.setNow('2026-12-01T03:14:59Z');
    expect(await reserve(uid(2), await newOrder(uid(2)), [H(18)])).toMatchObject({ ok: false, code: 'slot_unavailable' });
  });

  it('an unset hold setting refuses a payment hold and leaves nothing (BOOK-03-AC3)', async () => {
    await tdb.query(`delete from public.club_setting where club_id = $1 and key = 'hold_minutes'`, [A]);
    expect(await reserve(uid(1), await newOrder(uid(1)), [H(18)])).toEqual({ ok: false, code: 'hold_setting_unset', detail: undefined });
    expect(await count('booking')).toBe(0);
  });

  it('a later setting change leaves an existing hold end untouched (D46)', async () => {
    await reserve(uid(1), await newOrder(uid(1)), [H(18)]);
    await tdb.query(`update public.club_setting set value = '20' where club_id = $1 and key = 'hold_minutes'`, [A]);
    expect((await tdb.query('select hold_expires_at from public.booking')).rows[0].hold_expires_at.toISOString()).toBe('2026-12-01T03:15:00.000Z');
  });

  it("another club's order id from club A's context finds nothing (SR-07)", async () => {
    const other = await newOrder(uid(1), B);
    expect(await reserve(uid(1), other, [H(18)])).toEqual({ ok: false, code: 'order_not_found', detail: undefined });
    expect(await count('booking')).toBe(0);
  });

  it('the same hour in two clubs does not collide (CC-1, BOOK-04-AC11)', async () => {
    expect(await reserve(uid(1), await newOrder(uid(1)), [H(18)])).toMatchObject({ ok: true });
    expect(await reserve(uid(1), await newOrder(uid(1), B), [H(18)], { club: B, resource: COURT_B })).toMatchObject({ ok: true });
  });
});

describe('parallel requests for one slot (BOOK-04-AC1, AC12; FA T1)', () => {
  for (const n of [2, 20]) {
    it(`${n} requests: exactly one success, the rest slot_unavailable, no half created rows`, async () => {
      const orders = await Promise.all(Array.from({ length: n }, async (_, i) => ({ customer: uid(100 + i), order: await newOrder(uid(100 + i)) })));
      const results = await Promise.all(orders.map((x) => reserve(x.customer, x.order, [H(18)])));
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const failed = results.filter((r): r is Extract<Outcome, { ok: false }> => !r.ok);
      expect(failed).toHaveLength(n - 1);
      expect(failed.every((r) => r.code === 'slot_unavailable' && r.detail === 'resource')).toBe(true);
      expect(await count('booking')).toBe(1);
      expect(await count('occupancy')).toBe(1);
    }, 90_000);   // 20 parallel transactions take far longer under full-suite load
  }

  it('overlapping multi hour selections: each hour has at most one claim and no order is half booked (FA T3)', async () => {
    const sets = [[H(18), H(19)], [H(19), H(20)], [H(18), H(19), H(20)], [H(20), H(21)]];
    const orders = await Promise.all(sets.map(async (s, i) => ({ s, customer: uid(200 + i), order: await newOrder(uid(200 + i)) })));
    const results = await Promise.all(orders.map((x) => reserve(x.customer, x.order, x.s)));
    const won = orders.filter((_, i) => results[i]!.ok);
    // Whatever won, every winning order has all its hours and no hour is held twice.
    const rows = (await tdb.query('select order_id, count(*)::int as n from public.booking group by order_id')).rows;
    expect(rows.length).toBe(won.length);
    for (const w of won) expect(rows.find((r) => r.order_id === w.order)?.n).toBe(w.s.length);
    expect((await tdb.query('select count(*)::int as n from (select start_at from public.occupancy group by start_at having count(*) > 1) d')).rows[0].n).toBe(0);
    expect(await count('occupancy')).toBe(await count('booking'));
  });
});

describe('the only write path (SR-07)', () => {
  it('a player cannot insert into occupancy or booking directly', async () => {
    await expect(
      db.withClubTx({ clubId: A, userId: uid(1), roles: ['player'], source: 'player_app' }, (tx) =>
        tx.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, closure_id) values ($1,'closure',$2,$3,$4,'confirmed',gen_random_uuid())`, [A, COURT, H(18), H(19)]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
