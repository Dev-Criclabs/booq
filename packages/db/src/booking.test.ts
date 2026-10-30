import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkTableClasses } from './registry/check';
import { collectRegistry } from './registry';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F03-T01 / migrations 0201 and 0202: the orders shell and booking (BOOK-06, BOOK-01-AC1,
// AC2, CC-1). Direct SQL, bypassing the app, so the database itself is what refuses.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const USER = '11111111-2222-4333-8444-555555555555';
const LOC_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const LOC_B = 'bbbbbbbb-0000-4000-8000-000000000001';
const COURT_A = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT_B = 'cbcbcbcb-0000-4000-8000-000000000003';
const ORDER_A = 'd1d1d1d1-0000-4000-8000-000000000001';
const ORDER_B = 'dbdbdbdb-0000-4000-8000-000000000002';

let tdb: TestDatabase;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'club-a','ก','A'), ($2,'club-b','ข','B')`, [A, B]);
  await tdb.seedCoach(A, 'e0e0e0e0-0000-4000-8000-000000000009');   // a solo class needs a coach row (F07, migration 0801)
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main'), ($3,$4,'Main')`, [A, LOC_A, B, LOC_B]);
  await tdb.query(
    `insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($4,$5,$6,'1','tennis')`,
    [A, COURT_A, LOC_A, B, COURT_B, LOC_B],
  );
  await tdb.query(`insert into public.orders (club_id, id, customer_id, source) values ($1,$2,$3,'online'), ($4,$5,$3,'online')`, [A, ORDER_A, USER, B, ORDER_B]);
});
afterEach(async () => {
  await tdb.close();
});

// 18:00 to 19:00 Bangkok on 2 Dec 2026 is 11:00Z to 12:00Z.
const insertBooking = (over: Record<string, unknown> = {}) => {
  const row: Record<string, unknown> = {
    club_id: A,
    order_id: ORDER_A,
    type: 'court',
    resource_id: COURT_A,
    coach_id: null,
    start_at: '2026-12-02T11:00:00Z',
    end_at: '2026-12-02T12:00:00Z',
    customer_id: USER,
    status: 'confirmed',
    source: 'online',
    created_by: USER,
    hold_expires_at: null,
    confirmed_at: '2026-12-01T03:00:00Z',
    released_at: null,
    release_reason: null,
    ...over,
  };
  const cols = Object.keys(row);
  return tdb.query(
    `insert into public.booking (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    cols.map((c) => row[c]),
  );
};

describe('one hour, on the hour in Bangkok (BOOK-01-AC1, AC2)', () => {
  it('accepts a 60 minute booking at 18:00 Bangkok', async () => {
    expect((await insertBooking()).rowCount).toBe(1);
  });

  it('rejects a 90 minute row', async () => {
    await expect(insertBooking({ end_at: '2026-12-02T12:30:00Z' })).rejects.toThrow(/booking_one_hour/);
  });

  it('rejects a 120 minute row: a selection is one row per hour', async () => {
    await expect(insertBooking({ end_at: '2026-12-02T13:00:00Z' })).rejects.toThrow(/booking_one_hour/);
  });

  it('rejects an 18:30 Bangkok row', async () => {
    await expect(insertBooking({ start_at: '2026-12-02T11:30:00Z', end_at: '2026-12-02T12:30:00Z' })).rejects.toThrow(/booking_on_the_hour/);
  });

  it('rejects a row with seconds', async () => {
    await expect(insertBooking({ start_at: '2026-12-02T11:00:01Z', end_at: '2026-12-02T12:00:01Z' })).rejects.toThrow(/booking_on_the_hour/);
  });
});

describe('one order, one booking per hour (BOOK-06, D40)', () => {
  it('two hours of one order are two rows', async () => {
    await insertBooking();
    await insertBooking({ start_at: '2026-12-02T12:00:00Z', end_at: '2026-12-02T13:00:00Z' });
    const r = await tdb.query('select count(*)::int as n from public.booking where order_id = $1', [ORDER_A]);
    expect(r.rows[0].n).toBe(2);
  });
});

describe('club scope (CC-1)', () => {
  it("another club's order cannot be referenced", async () => {
    await expect(insertBooking({ order_id: ORDER_B })).rejects.toThrow(/foreign key/i);
  });

  it("another club's court cannot be referenced", async () => {
    await expect(insertBooking({ resource_id: COURT_B })).rejects.toThrow(/foreign key/i);
  });

  it('an order is unique per club and id', async () => {
    await expect(tdb.query(`insert into public.orders (club_id, id, source) values ($1,$2,'online')`, [A, ORDER_A])).rejects.toThrow(/duplicate key/i);
  });
});

describe('statuses and shape (design 3.2)', () => {
  it.each(['awaiting_payment', 'confirmed', 'released', 'cancelled', 'no_show', 'late_cancelled'])('status %s is a value', async (status) => {
    const extra: Record<string, unknown> =
      status === 'awaiting_payment'
        ? { hold_expires_at: '2026-12-01T03:15:00Z', confirmed_at: null }
        : status === 'released'
          ? { release_reason: 'expired', released_at: '2026-12-01T03:15:00Z', confirmed_at: null }
          : {};
    await insertBooking({ status, ...extra });
  });

  it('refuses an unknown status, type and source', async () => {
    await expect(insertBooking({ status: 'paid' })).rejects.toThrow(/check/i);
    await expect(insertBooking({ type: 'group' })).rejects.toThrow(/check/i);
    await expect(insertBooking({ source: 'phone' })).rejects.toThrow(/check/i);
    await expect(tdb.query(`insert into public.orders (club_id, source) values ($1,'phone')`, [A])).rejects.toThrow(/check/i);
    await expect(tdb.query(`insert into public.orders (club_id, source, status) values ($1,'online','paid_late')`, [A])).rejects.toThrow(/check/i);
  });

  it('a hold ends at hold_expires_at while awaiting payment and is cleared once confirmed', async () => {
    await expect(insertBooking({ status: 'awaiting_payment', confirmed_at: null })).rejects.toThrow(/booking_hold_matches_status/);
    await expect(insertBooking({ hold_expires_at: '2026-12-01T03:15:00Z' })).rejects.toThrow(/booking_hold_matches_status/);
  });

  it('a released booking carries its reason', async () => {
    await expect(insertBooking({ status: 'released', confirmed_at: null, released_at: '2026-12-01T03:15:00Z' })).rejects.toThrow(/booking_release_has_reason/);
    await expect(insertBooking({ status: 'released', confirmed_at: null, release_reason: 'nobody', released_at: '2026-12-01T03:15:00Z' })).rejects.toThrow(/check/i);
  });

  it('a solo class has a coach and a court booking has none', async () => {
    const coach = 'e0e0e0e0-0000-4000-8000-000000000009';
    await expect(insertBooking({ type: 'solo_class' })).rejects.toThrow(/booking_coach_matches_type/);
    await expect(insertBooking({ coach_id: coach })).rejects.toThrow(/booking_coach_matches_type/);
    await insertBooking({ type: 'solo_class', coach_id: coach });
  });

  it('a walk in may have no customer', async () => {
    await insertBooking({ customer_id: null, source: 'staff' });
  });
});

describe('test mode and the registry', () => {
  it('is_test follows the club status at insert and cannot change', async () => {
    await tdb.query(`update public.club set status = 'testing' where id = $1`, [A]);
    const id = (await insertBooking()).rows[0].id;
    expect((await tdb.query('select is_test from public.booking where id = $1', [id])).rows[0].is_test).toBe(true);
    await expect(tdb.query('update public.booking set is_test = false where id = $1', [id])).rejects.toThrow(/is_test cannot be changed/);
  });

  it('both tables are registered for the purge, children first', async () => {
    const r = await tdb.query(`select table_name, delete_order from app.test_tables where table_name in ('booking','orders')`);
    const order = Object.fromEntries(r.rows.map((x) => [x.table_name, x.delete_order]));
    expect(order.booking).toBeLessThan(order.orders);
  });

  it('the table class check passes with the F03 registry', async () => {
    const result = await checkTableClasses(tdb.pool, await collectRegistry());
    // app.test_clock exists only in test databases (the harness installs it).
    expect(result.problems.filter((p) => p.table !== 'app.test_clock')).toEqual([]);
  });
});
