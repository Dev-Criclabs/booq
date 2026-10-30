import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectRegistry } from './registry';
import { checkTableClasses } from './registry/check';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F03-T02 / migration 0203: occupancy and the two exclusion constraints (FA 3.1; BOOK-04-AC1, AC2,
// AC3, AC6). Direct SQL on purpose: the database must hold the rule even if the application code is wrong.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const COURT1 = '00000000-0000-4000-8000-0000000000c1';
const COURT2 = '00000000-0000-4000-8000-0000000000c2';
const COURT_B = '00000000-0000-4000-8000-0000000000cb';
const COACH = '00000000-0000-4000-8000-0000000000d1';
const LOC_A = '00000000-0000-4000-8000-0000000000a1';
const LOC_B = '00000000-0000-4000-8000-0000000000b1';

let tdb: TestDatabase;
let seq = 0;

/** 10:00 Bangkok on 2026-12-29 is 03:00 UTC. */
const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 11, 29, hour - 7, minute)).toISOString();

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$3,'Main'), ($2,$4,'Main')`, [A, B, LOC_A, LOC_B]);
  await tdb.query(
    `insert into public.resource (club_id, id, location_id, name, sport) values ($1,$3,$5,'1','tennis'), ($1,$4,$5,'2','tennis'), ($2,$6,$7,'1','tennis')`,
    [A, B, COURT1, COURT2, LOC_A, COURT_B, LOC_B],
  );
});
afterEach(async () => {
  await tdb.close();
});

/** A confirmed booking row (and its order) to hang an occupancy row on. */
async function booking(club = A, resource = COURT1, startHour = 10, type: 'court' | 'solo_class' = 'court'): Promise<string> {
  seq += 1;
  const order = (await tdb.query(`insert into public.orders (club_id, source) values ($1, 'staff') returning id`, [club])).rows[0].id as string;
  const r = await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, coach_id, start_at, end_at, status, source, created_by, confirmed_at)
     values ($1,$2,$3,$4,$5,$6,$7,'confirmed','staff',$8,now()) returning id`,
    [club, order, type, resource, type === 'solo_class' ? COACH : null, at(startHour), at(startHour + 1), '99999999-9999-4999-8999-99999999999' + (seq % 10)],
  );
  return r.rows[0].id as string;
}
async function claim(o: { club?: string; kind?: string; resource?: string | null; coach?: string | null; from?: string; to?: string; state?: string; hold?: string | null; booking?: string | null; closure?: string | null }) {
  const club = o.club ?? A;
  const b = o.booking === undefined && !o.closure ? await booking(club, o.resource ?? COURT1) : o.booking;
  return tdb.query(
    `insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, hold_expires_at, booking_id, closure_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [club, o.kind ?? 'court_booking', o.resource === undefined ? COURT1 : o.resource, o.coach ?? null, o.from ?? at(10), o.to ?? at(11), o.state ?? 'confirmed', o.hold ?? null, b ?? null, o.closure ?? null],
  );
}

describe('no double booking, enforced by the database (BOOK-04-AC1, AC2, AC3)', () => {
  it('an overlapping court row is rejected', async () => {
    await claim({});
    await expect(claim({})).rejects.toThrow(/occupancy_no_overlap_resource/);
  });

  it('the same hour on another court, and the same court in the next hour, both succeed (half-open ranges)', async () => {
    await claim({});
    await claim({ resource: COURT2 });
    await claim({ from: at(11), to: at(12) });
    await claim({ from: at(9), to: at(10) });
  });

  it('an overlapping coach row on another court is rejected', async () => {
    await claim({ kind: 'solo_class', resource: COURT1, coach: COACH, booking: await booking(A, COURT1, 10, 'solo_class') });
    await expect(
      claim({ kind: 'solo_class', resource: COURT2, coach: COACH, booking: await booking(A, COURT2, 10, 'solo_class') }),
    ).rejects.toThrow(/occupancy_no_overlap_coach/);
  });

  it('a held court blocks the same way as a confirmed one', async () => {
    await claim({ state: 'held', hold: at(10, 15) });
    await expect(claim({})).rejects.toThrow(/occupancy_no_overlap_resource/);
  });

  it('a solo class takes court and coach together or not at all (BOOK-04-AC3)', async () => {
    await claim({}); // the court is already booked
    await expect(
      claim({ kind: 'solo_class', resource: COURT1, coach: COACH, booking: await booking(A, COURT2, 10, 'solo_class') }),
    ).rejects.toThrow(/occupancy_no_overlap_resource/);
    const coachRows = await tdb.query(`select count(*)::int as n from public.occupancy where coach_id = $1`, [COACH]);
    expect(coachRows.rows[0].n).toBe(0); // the coach was not claimed either
  });

  it('a solo class row with only a court (or only a coach) is rejected', async () => {
    const b = await booking(A, COURT1, 10, 'solo_class');
    await expect(claim({ kind: 'solo_class', resource: COURT1, coach: null, booking: b })).rejects.toThrow(/check/i);
    await expect(claim({ kind: 'solo_class', resource: null, coach: COACH, booking: b })).rejects.toThrow(/check/i);
  });

  it('a court booking holds no coach; a group class holds both', async () => {
    await expect(claim({ kind: 'court_booking', coach: COACH })).rejects.toThrow(/check/i);
    await expect(claim({ kind: 'group_class', resource: COURT1, coach: null, booking: await booking() })).rejects.toThrow(/check/i);
  });

  it('a released or cancelled booking has no row, so the slot is free again (BOOK-04-AC6)', async () => {
    await claim({});
    await tdb.query('delete from public.occupancy');
    await claim({});
  });

  it('a three hour selection is three rows that do not collide with each other', async () => {
    for (const h of [10, 11, 12]) await claim({ from: at(h), to: at(h + 1) });
    expect((await tdb.query('select count(*)::int as n from public.occupancy')).rows[0].n).toBe(3);
  });

  it('two clubs may each hold their own court in the same hour', async () => {
    await claim({});
    await claim({ club: B, resource: COURT_B });
  });

  it('a move that lands on another booking is refused by the same constraint (BOOK-04-AC7)', async () => {
    await claim({});
    await claim({ from: at(11), to: at(12) });
    await expect(tdb.query(`update public.occupancy set start_at = $1, end_at = $2 where start_at = $3`, [at(10), at(11), at(11)])).rejects.toThrow(/occupancy_no_overlap_resource/);
  });
});

describe('one hour on the hour, except a closure (BOOK-01-AC1)', () => {
  it('a 90 minute row and an 18:30 row are rejected; a two hour row too', async () => {
    await expect(claim({ from: at(10), to: at(11, 30) })).rejects.toThrow(/check/i);
    await expect(claim({ from: at(10, 30), to: at(11, 30) })).rejects.toThrow(/check/i);
    await expect(claim({ from: at(10), to: at(12) })).rejects.toThrow(/check/i);
  });
  it('a closure may be any range and holds no coach', async () => {
    const closure = '00000000-0000-4000-8000-0000000000e1';
    await claim({ kind: 'closure', from: at(8, 30), to: at(17, 45), closure, booking: null });
    await expect(
      claim({ kind: 'closure', resource: COURT2, coach: COACH, from: at(8), to: at(9), closure: '00000000-0000-4000-8000-0000000000e2', booking: null }),
    ).rejects.toThrow(/check/i);
  });
  it('a closure blocks a booking on the same court', async () => {
    await claim({ kind: 'closure', from: at(8), to: at(18), closure: '00000000-0000-4000-8000-0000000000e1', booking: null });
    await expect(claim({})).rejects.toThrow(/occupancy_no_overlap_resource/);
  });
  it('the end is after the start', async () => {
    await expect(claim({ from: at(11), to: at(10) })).rejects.toThrow(/check/i);
  });
});

describe('state, parents and club (CC-1)', () => {
  it('a held row has an expiry and a confirmed row has none', async () => {
    await expect(claim({ state: 'held', hold: null })).rejects.toThrow(/check/i);
    await expect(claim({ state: 'confirmed', hold: at(10, 15) })).rejects.toThrow(/check/i);
    await expect(claim({ state: 'pending' })).rejects.toThrow(/check/i);
  });
  it('exactly one of booking, class session and closure', async () => {
    await expect(claim({ booking: null, closure: null })).rejects.toThrow(/check/i);
    await expect(
      tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, booking_id, closure_id) values ($1,'court_booking',$2,$3,$4,'confirmed',$5,$6)`, [A, COURT1, at(10), at(11), await booking(), '00000000-0000-4000-8000-0000000000e1']),
    ).rejects.toThrow(/check/i);
  });
  it("another club's resource or booking cannot be referenced (composite keys)", async () => {
    await expect(claim({ resource: COURT_B })).rejects.toThrow(/foreign key/i);
    const otherClubBooking = await booking(B, COURT_B);
    await expect(claim({ booking: otherClubBooking })).rejects.toThrow(/foreign key/i);
  });
  it('rows made while the club is Testing carry the test flag (PLAT-07-AC1)', async () => {
    await tdb.query(`update public.club set status = 'testing' where id = $1`, [A]);
    await claim({});
    expect((await tdb.query('select is_test from public.occupancy')).rows).toEqual([{ is_test: true }]);
  });
  it('no role writes the table directly (only the definer functions, SR-07); BOOQ staff cannot even read it; the app roles read it by policy (migration 0221)', async () => {
    for (const priv of ['insert', 'update', 'delete']) {
      for (const role of ['booq_app', 'booq_worker', 'booq_platform']) {
        const r = await tdb.query('select has_table_privilege($1, $2, $3) as ok', [role, 'public.occupancy', priv]);
        expect(r.rows[0].ok, `${role} ${priv}`).toBe(false);
      }
    }
    expect((await tdb.query(`select has_table_privilege('booq_platform', 'public.occupancy', 'select') as ok`)).rows[0].ok).toBe(false);
  });
  it('is registered as club data and passes the structure check', async () => {
    const reg = await collectRegistry();
    expect(reg['public.occupancy']?.class).toBe('D');
    expect((await checkTableClasses(tdb.pool, reg)).problems.filter((p) => p.table !== 'app.test_clock')).toEqual([]);
  });
});
