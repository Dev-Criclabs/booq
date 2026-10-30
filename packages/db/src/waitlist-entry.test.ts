import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F08-T04 / migration 0904: waitlist_entry and waitlist_seq (CLASS-02-AC1, AC8, AC16; WAIT-01-AC1; D157).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const RES = '00000000-0000-4000-8000-0000000000c1';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const SLOT = '2026-12-05T18:00:00+07:00';
let tdb: TestDatabase;
let db: Db;
let s1: string;
let s2: string;

/** The sequence is internal (the waitlist functions of 0908 call it), so the test runs it as the function owner in the club's context. */
async function next(club = A): Promise<number> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.club_id', $1, true)`, [club]);
    await c.query('set local role booq_owner');
    const n = Number((await c.query(`select app.next_waitlist_seq() as n`)).rows[0].n);
    await c.query('commit');
    return n;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
async function join(customer: string, subject: { session?: string; resource?: string; slot?: string }, over: Record<string, unknown> = {}) {
  const r: Record<string, unknown> = {
    club_id: A, customer_id: customer, subject_kind: subject.session ? 'class_session' : 'court_slot', class_session_id: subject.session ?? null,
    resource_id: subject.resource ?? null, slot_start_at: subject.slot ?? null, seq: await next(), ...over,
  };
  const cols = Object.keys(r);
  return tdb.query(`insert into public.waitlist_entry (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, cols.map((c) => r[c]));
}
async function person(club: string, id: string) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)`, [club, id, 'L' + id]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [club, id]);
    await c.query('commit');
  } finally {
    c.release();
  }
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, RES, LOC]);
  await person(A, P1);
  await person(A, P2);
  s1 = await tdb.seedClassSession(A, RES, '2027-03-03T18:00:00+07:00');
  s2 = await tdb.seedClassSession(A, RES, '2027-03-10T18:00:00+07:00');
  db = createDb({ connectionString: tdb.url, max: 8 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('waitlist_seq (CLASS-02-AC8)', () => {
  it('is strictly increasing per club, and a club has its own counter', async () => {
    expect([await next(), await next(), await next()]).toEqual([1, 2, 3]);
    expect(await next(B)).toBe(1);
    expect(await next()).toBe(4);
  });

  it('gives different numbers to parallel callers', async () => {
    const got = await Promise.all(Array.from({ length: 12 }, () => next()));
    expect(new Set(got).size).toBe(12);
    expect(Math.max(...got)).toBe(12);
  });

  it('no application role can call it or read the table', async () => {
    await expect(db.withClubTx({ clubId: A, userId: null, roles: [] }, async (tx) => tx.query(`select app.next_waitlist_seq()`))).rejects.toThrow(/permission denied/);
    await expect(db.withClubTx({ clubId: A, userId: null, roles: [] }, async (tx) => tx.query(`select * from public.waitlist_seq`))).rejects.toThrow(/permission denied/);
  });
});

describe('waitlist_entry (CLASS-02-AC1, AC16; WAIT-01-AC1)', () => {
  it('a player joins a class and a court slot; positions come from seq, in join order', async () => {
    const a = (await join(P1, { session: s1 })).rows[0];
    const b = (await join(P2, { session: s1 })).rows[0];
    const c = (await join(P1, { resource: RES, slot: SLOT })).rows[0];
    expect(a).toMatchObject({ status: 'waiting', offer_no: 0, offered_at: null, offer_booking_id: null, ended_reason: null, is_test: false });
    expect([a.seq, b.seq, c.seq].map(Number)).toEqual([1, 2, 3]);
  });

  it('a player joins several waitlists (D157) but not the same one twice', async () => {
    await join(P1, { session: s1 });
    await join(P1, { session: s2 });
    await join(P1, { resource: RES, slot: SLOT });
    await join(P1, { resource: RES, slot: '2026-12-06T18:00:00+07:00' });
    await expect(join(P1, { session: s1 })).rejects.toThrow(/waitlist_entry_one_live_session/);
    await expect(join(P1, { resource: RES, slot: SLOT })).rejects.toThrow(/waitlist_entry_one_live_slot/);
    expect((await join(P2, { session: s1 })).rowCount).toBe(1);
  });

  it('after an entry is finished the player may join again; an offered entry still counts as in the list', async () => {
    const e = (await join(P1, { session: s1 })).rows[0].id as string;
    await tdb.query(`update public.waitlist_entry set status = 'ended', ended_reason = 'joined_seat' where id = $1`, [e]);
    const again = (await join(P1, { session: s1 })).rows[0].id as string;
    await tdb.query(`update public.waitlist_entry set status = 'declined' where id = $1`, [again]);
    const third = (await join(P1, { session: s1 })).rows[0].id as string;
    const bk = await heldBooking(P1, third);   // the offer's own booking names the entry
    await tdb.query(`update public.waitlist_entry set status = 'offered', offer_no = 1, offered_at = app.now(), offer_expires_at = app.now() + interval '30 minutes', offer_booking_id = $2 where id = $1`, [third, bk]);
    await expect(join(P1, { session: s1 })).rejects.toThrow(/waitlist_entry_one_live_session/);
  });

  it('has no maximum: fifty players in one list', async () => {
    for (let i = 0; i < 50; i += 1) {
      const id = `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`;
      await person(A, id);
      await join(id, { session: s1 });
    }
    expect((await tdb.query(`select count(*)::int as n from public.waitlist_entry where class_session_id = $1`, [s1])).rows[0].n).toBe(50);
  });

  it('the subject has the right shape: a session or a slot, never both or neither; the slot is on the hour', async () => {
    await expect(join(P1, { session: s1, resource: RES, slot: SLOT })).rejects.toThrow(/waitlist_entry_subject_shape/);
    await expect(join(P1, {}, { subject_kind: 'court_slot' })).rejects.toThrow(/waitlist_entry_subject_shape/);
    await expect(join(P1, { resource: RES, slot: SLOT }, { subject_kind: 'class_session' })).rejects.toThrow(/waitlist_entry_subject_shape/);
    await expect(join(P1, { resource: RES, slot: '2026-12-05T18:30:00+07:00' })).rejects.toThrow(/waitlist_entry_slot_on_the_hour/);
    await expect(join(P1, { session: s1 }, { subject_kind: 'lesson' })).rejects.toThrow(/waitlist_entry_subject_(values|shape)/);
  });

  it('status values, the offer fields and the ended reason follow the design', async () => {
    await expect(join(P1, { session: s1 }, { status: 'open' })).rejects.toThrow(/waitlist_entry_status_values/);
    await expect(join(P1, { session: s1 }, { status: 'offered', offer_no: 1 })).rejects.toThrow(/waitlist_entry_offer_shape/);
    await expect(join(P1, { session: s1 }, { status: 'ended' })).rejects.toThrow(/waitlist_entry_ended_matches/);
    await expect(join(P1, { session: s1 }, { ended_reason: 'left' })).rejects.toThrow(/waitlist_entry_ended_matches/);
    await expect(join(P1, { session: s1 }, { status: 'ended', ended_reason: 'because' })).rejects.toThrow(/waitlist_entry_ended_values/);
    for (const [i, r] of ['session_cancelled', 'closure', 'slot_passed', 'joined_seat', 'left'].entries()) {
      const st = r === 'left' ? 'left' : 'ended';
      expect((await join(i % 2 ? P1 : P2, { session: i < 3 ? s1 : s2 }, { status: st, ended_reason: r })).rows[0].ended_reason).toBe(r);
    }
  });

  it('a seat and an entry point at each other: the booking keeps the entry it came from', async () => {
    const e = (await join(P1, { session: s1 })).rows[0].id as string;
    const b = await heldBooking(P1, e);
    expect((await tdb.query(`select waitlist_entry_id from public.booking where id = $1`, [b])).rows[0].waitlist_entry_id).toBe(e);
    await tdb.query(`delete from public.waitlist_entry where id = $1`, [e]);   // what the test data purge does
    expect((await tdb.query(`select waitlist_entry_id from public.booking where id = $1`, [b])).rows[0].waitlist_entry_id).toBeNull();
  });

  it('is club data: forced row security, no grant to the application roles yet', async () => {
    for (const t of ['waitlist_entry', 'waitlist_seq']) {
      expect((await tdb.query(`select relforcerowsecurity from pg_class where oid = $1::regclass`, [`public.${t}`])).rows[0].relforcerowsecurity, t).toBe(true);
      for (const role of ['booq_app', 'booq_worker', 'booq_platform']) expect((await tdb.query(`select has_table_privilege($1, $2, 'select') as ok`, [role, `public.${t}`])).rows[0].ok, `${role} ${t}`).toBe(false);
    }
  });
});

/** A held seat in s1 for the customer (an offer is a held booking, design 4.9). */
async function heldBooking(customer: string, entry: string | null = null) {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id;
  return (await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, class_session_id, waitlist_entry_id, start_at, end_at, customer_id, status, source, created_by, hold_expires_at)
     values ($1,$2,'class_seat',$3,$4,$5,'2027-03-03T18:00:00+07:00','2027-03-03T19:00:00+07:00',$6,'awaiting_payment','online',$6, app.now() + interval '30 minutes') returning id`,
    [A, order, RES, s1, entry, customer])).rows[0].id as string;
}
