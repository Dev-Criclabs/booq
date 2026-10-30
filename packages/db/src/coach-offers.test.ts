import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F07-T04 / migration 0804: coaches_offerable, assign_court, public_coach_card, public_coach_times
// (COACH-01, R1-AC1 to AC8, COACH-02-AC1, CC-3; D120).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const C10 = '00000000-0000-4000-8000-0000000000c3';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const COACH2 = 'e1e1e1e1-0000-4000-8000-000000000008';
const BCOACH = 'e2e2e2e2-0000-4000-8000-000000000007';
const OWNER = '44444444-4444-4444-8444-444444444444';
let tdb: TestDatabase;
let db: Db;

/** 2026-12-02 is a Wednesday; the club clock is 2026-12-01 10:00 Bangkok. */
const H = (h: number, day = 2) => new Date(`2026-12-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();
const guest = (club = A) => ({ clubId: club, userId: null, roles: ['guest'] as never, source: 'player_app' as const });
const asGuest = async <T>(sql: string, params: unknown[] = [], club = A): Promise<T[]> =>
  db.withClubTx(guest(club), async (tx) => (await tx.query(sql, params)).rows as T[]);

const court = (starts: string[], coach = COACH, booking: string | null = null) =>
  asGuest<{ r: string | null }>(`select app.assign_court($1, $2::timestamptz[], $3) as r`, [coach, starts, booking]).then((x) => x[0]!.r);
const offerable = (starts: string[], resource: string | null = null) =>
  asGuest<{ id: string }>(`select app.coaches_offerable($1, $2::timestamptz[]) as id`, [resource, starts]).then((x) => x.map((r) => r.id));
const times = (coach = COACH, from = '2026-12-02', to = '2026-12-02', club = A) =>
  asGuest<{ start_at: Date; state: string; court_name: string | null }>(`select * from public.public_coach_times($1, $2::date, $3::date)`, [coach, from, to], club);

/** Occupies a court for one hour: a confirmed court booking or a held one (unexpired / expired). */
async function occupy(resource: string, h: number, o: { state?: 'confirmed' | 'held'; expired?: boolean; closure?: boolean } = {}) {
  const held = o.state === 'held';
  const hold = held ? (o.expired ? `app.now() - interval '5 minutes'` : `app.now() + interval '10 minutes'`) : 'null';
  if (o.closure) {
    const cl = await tdb.seedClosure(A);
    await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, closure_id) values ($1,'closure',$2,$3,$4,'confirmed',$5)`, [A, resource, H(h), H(h + 1), cl]);
    return null;
  }
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, OWNER])).rows[0].id as string;
  const b = (await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, status, source, created_by, confirmed_at, hold_expires_at)
     values ($1,$2,'court',$3,$4,$5,$6,'staff',$7, ${held ? 'null' : 'app.now()'}, ${hold}) returning id`,
    [A, order, resource, H(h), H(h + 1), held ? 'awaiting_payment' : 'confirmed', OWNER])).rows[0].id as string;
  await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, hold_expires_at, booking_id) values ($1,'court_booking',$2,$3,$4,$5, ${hold}, $6)`,
    [A, resource, H(h), H(h + 1), held ? 'held' : 'confirmed', b]);
  return b;
}
const publish = (id = COACH) =>
  tdb.query(`update public.coach set published = true, profile_consent_at = app.now(), profile_consent_by = $2, bio_en = 'Bio', bio_th = 'ประวัติ', certifications_en = 'PTR', specialties_en = array['serve'], languages = array['en','th'] where id = $1`, [id, OWNER]);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) select $1, d, '08:00', '22:00' from generate_series(1, 7) d`, [A]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($1,$4,$3,'2','tennis'), ($1,$5,$3,'10','tennis')`, [A, C1, LOC, C2, C10]);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('insert into public.app_user (club_id, id, line_user_id, display_name) values ($1,$2,$3,$4)', [A, OWNER, 'Lo', 'Owner']);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'owner'), ($1,$2,'player')`, [A, OWNER]);
    await c.query('commit');
  } finally {
    c.release();
  }
  await tdb.seedCoach(A, COACH);
  await tdb.seedCoach(A, COACH2);
  await tdb.seedCoach(B, BCOACH);
  await tdb.query(`update public.app_user set display_name = 'Coach One' where id = $1`, [COACH]);
  db = createDb({ connectionString: tdb.url, max: 6 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('app.assign_court (R1-AC4, D120, A-4)', () => {
  it('the lowest numbered open court; names are compared as numbers (2 before 10)', async () => {
    expect(await court([H(10)])).toBe(C1);
    await occupy(C1, 10);
    expect(await court([H(10)])).toBe(C2);
    await occupy(C2, 10);
    expect(await court([H(10)])).toBe(C10);
  });

  it('one selection keeps one court: a court free for only one of two hours is skipped', async () => {
    await occupy(C1, 11);
    expect(await court([H(10), H(11)])).toBe(C2);
    expect(await court([H(10)])).toBe(C1);
  });

  it('a held hour is busy, an expired hold and a closure over another court are not', async () => {
    await occupy(C1, 10, { state: 'held' });
    expect(await court([H(10)])).toBe(C2);
    await occupy(C2, 12, { state: 'held', expired: true });
    expect(await court([H(12)])).toBe(C1);
    await occupy(C1, 14, { closure: true });
    expect(await court([H(14)])).toBe(C2);
  });

  it('no court open is null: all taken, an inactive court, or an hour outside the opening hours', async () => {
    await occupy(C1, 10); await occupy(C2, 10); await occupy(C10, 10);
    expect(await court([H(10)])).toBeNull();
    await tdb.query(`update public.resource set active = false where id = $1`, [C1]);
    expect(await court([H(11)])).toBe(C2);
    expect(await court([H(7)])).toBeNull();        // opens at 08:00
    expect(await court([H(21)])).toBe(C2);         // the last hour, closing 22:00
    expect(await court([H(22)])).toBeNull();
  });

  it('Add a coach keeps the booking’s own court, whose own row does not count as busy', async () => {
    const b = await occupy(C2, 10);
    expect(await court([H(10)], COACH, b)).toBe(C2);
    expect(await court([H(10)], COACH, null)).toBe(C1);   // without the booking, the lowest open court
    await occupy(C2, 11);
    expect(await court([H(10)], COACH, b)).toBe(C2);   // still its own court
  });

  it('an unknown coach, another club’s coach and an empty selection get nothing', async () => {
    expect(await court([H(10)], '99999999-9999-4999-8999-999999999999')).toBeNull();
    expect(await court([H(10)], BCOACH)).toBeNull();
    expect(await court([])).toBeNull();
  });
});

describe('app.coaches_offerable (COACH-01-AC7)', () => {
  it('offers every active, free coach with a court open', async () => {
    expect((await offerable([H(10)])).sort()).toEqual([COACH, COACH2].sort());
  });

  it('drops a busy coach, an inactive coach, another club’s coach, and a coach on approved leave', async () => {
    await tdb.query(`update public.coach set active = false where id = $1`, [COACH2]);
    expect(await offerable([H(10)])).toEqual([COACH]);
    await tdb.query(`insert into public.coach_leave (club_id, coach_id, start_date, end_date, status, decided_by, decided_at) values ($1,$2,'2026-12-02','2026-12-02','approved',$3,app.now())`, [A, COACH, OWNER]);
    expect(await offerable([H(10)])).toEqual([]);
  });

  it('a pending leave still offers the coach (D120)', async () => {
    await tdb.query(`insert into public.coach_leave (club_id, coach_id, start_date, end_date) values ($1,$2,'2026-12-02','2026-12-02')`, [A, COACH]);
    expect(await offerable([H(10)])).toContain(COACH);
  });

  it('with no court open nobody is offered; with a court asked for, only that court counts', async () => {
    await occupy(C1, 10); await occupy(C2, 10); await occupy(C10, 10);
    expect(await offerable([H(10)])).toEqual([]);
    expect(await offerable([H(11)], C1)).toHaveLength(2);
    await occupy(C1, 11);
    expect(await offerable([H(11)], C1)).toEqual([]);
    expect(await offerable([H(11)])).toHaveLength(2);
  });

  it('every hour of a selection must work, including the rest rule', async () => {
    await tdb.query(`delete from public.coach_availability_rule where coach_id = $1 and weekday = 3`, [COACH2]);
    expect(await offerable([H(10), H(11)])).toEqual([COACH]);
  });
});

describe('public.public_coach_card (R1-AC6, R1-AC7, CC-3)', () => {
  const card = (club = A) => asGuest<Record<string, unknown>>(`select * from public.public_coach_card`, [], club);

  it('shows only active, published coaches, and a guest may read it', async () => {
    expect(await card()).toEqual([]);
    await publish();
    const rows = await card();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: COACH, display_name: 'Coach One', bio_en: 'Bio', bio_th: 'ประวัติ', languages: ['en', 'th'] });
    await tdb.query(`update public.coach set active = false where id = $1`, [COACH]);
    expect(await card()).toEqual([]);
  });

  it('the database refuses publishing without a consent record', async () => {
    await expect(tdb.query(`update public.coach set published = true where id = $1`, [COACH])).rejects.toThrow(/coach_published_needs_consent/);
  });

  it('carries the public profile fields only: no leave, notes, pay, consent or active flag', async () => {
    await publish();
    const cols = Object.keys((await card())[0]!).sort();
    expect(cols).toEqual(['ages_levels_en', 'ages_levels_th', 'bio_en', 'bio_th', 'certifications_en', 'certifications_th', 'display_name', 'id', 'languages', 'photo_path', 'specialties_en', 'specialties_th', 'tier_id', 'tier_name_en', 'tier_name_th'].sort());
  });

  it('is scoped to the club of the context, and hidden in a Draft club and in a Testing club for a guest', async () => {
    await publish();
    expect(await card(B)).toEqual([]);
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    expect(await card()).toHaveLength(1);                                     // Paused still shows; the route answers club_paused
    await tdb.query(`update public.club set status = 'testing' where id = $1`, [A]);
    expect(await card()).toEqual([]);
    await tdb.query(`update public.club set status = 'draft' where id = $1`, [A]);
    expect(await card()).toEqual([]);
  });
});

describe('public.public_coach_times (C6, D120)', () => {
  beforeEach(async () => {
    await publish();
  });

  it('lists every hour of the opening hours as open with the court name, from the lowest court', async () => {
    const t = await times();
    expect(t).toHaveLength(14);                                               // 08:00 to 22:00
    expect(t[0]).toMatchObject({ state: 'open', court_name: '1' });
    expect(new Date(t[0]!.start_at).toISOString()).toBe(H(8));
    await occupy(C1, 10);
    expect((await times()).find((x) => new Date(x.start_at).toISOString() === H(10))).toMatchObject({ state: 'open', court_name: '2' });
  });

  it('no court open shows no_court_open; an hour the coach cannot take is not listed at all', async () => {
    await occupy(C1, 10); await occupy(C2, 10); await occupy(C10, 10);
    await tdb.query(`delete from public.coach_availability_rule where coach_id = $1`, [COACH]);
    await tdb.query(`insert into public.coach_availability_rule (club_id, coach_id, kind, weekday, start_time, end_time) values ($1,$2,'weekly',3,'09:00','12:00')`, [A, COACH]);
    const t = await times();
    expect(t.map((x) => [new Date(x.start_at).toISOString(), x.state])).toEqual([[H(9), 'open'], [H(10), 'no_court_open'], [H(11), 'open']]);
    expect(t.find((x) => x.state === 'no_court_open')!.court_name).toBeNull();
  });

  it('a pending leave still shows the hours; an approved leave does not (D120)', async () => {
    await tdb.query(`insert into public.coach_leave (club_id, coach_id, start_date, end_date) values ($1,$2,'2026-12-02','2026-12-02')`, [A, COACH]);
    expect(await times()).toHaveLength(14);
    await tdb.query(`update public.coach_leave set status = 'approved', decided_by = $1, decided_at = app.now()`, [OWNER]);
    expect(await times()).toEqual([]);
  });

  it('answers nothing for an unpublished, inactive, unknown or other club’s coach, a Draft club, or a day past the window', async () => {
    expect(await times(COACH2)).toEqual([]);
    expect(await times('99999999-9999-4999-8999-999999999999')).toEqual([]);
    expect(await times(COACH, '2026-12-02', '2026-12-02', B)).toEqual([]);
    expect(await times(COACH, '2027-02-01', '2027-02-02')).toEqual([]);   // beyond today + 30
    expect(await times(COACH, '2026-12-01', '2026-12-01')).toHaveLength(12); // today: hours before now (10:00 Bangkok) are past
    await tdb.query(`update public.club set status = 'draft' where id = $1`, [A]);
    expect(await times()).toEqual([]);
    await tdb.query(`update public.club set status = 'live' where id = $1`, [A]);
    await tdb.query(`update public.coach set active = false where id = $1`, [COACH]);
    expect(await times()).toEqual([]);
  });

  it('exposes nothing about why an hour is missing: the result has three columns only', async () => {
    const t = await times();
    expect(Object.keys(t[0]!)).toEqual(['start_at', 'state', 'court_name']);
  });
});

describe('grants', () => {
  it('are for booq_app and booq_worker; the platform role has none', async () => {
    for (const f of ['app.assign_court(uuid, timestamptz[], uuid)', 'app.coaches_offerable(uuid, timestamptz[])', 'public.public_coach_times(uuid, date, date)']) {
      for (const r of ['booq_app', 'booq_worker']) expect((await tdb.query(`select has_function_privilege($1, $2, 'execute') as ok`, [r, f])).rows[0].ok, `${r} ${f}`).toBe(true);
      expect((await tdb.query(`select has_function_privilege('booq_platform', $1, 'execute') as ok`, [f])).rows[0].ok, f).toBe(false);
    }
    expect((await tdb.query(`select has_table_privilege('booq_platform', 'public.public_coach_card', 'select') as ok`)).rows[0].ok).toBe(false);
  });
});
