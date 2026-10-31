import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F08-T08 / migration 0910: public_class_state and waitlist_position (CLASS-01-AC5 to AC8, CLASS-02-AC8, AC14, CC-3).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const OWNER = '44444444-4444-4444-8444-444444444444';
const P = Array.from({ length: 5 }, (_, i) => `00000000-0000-4000-8000-0000000004${String(i).padStart(2, '0')}`);
let tdb: TestDatabase;
let db: Db;
let tpl: string;
let session: string;

const ctx = (user: string | null, roles: string[] = ['player'], club = A) => ({ clubId: club, userId: user, roles: roles as never, source: 'player_app' as const });
const state = (c = ctx(null, ['guest'])) => db.withClubTx(c, async (tx) => (await tx.query(`select * from public.public_class_state order by start_at`)).rows);
const position = (user: string) => db.withClubTx(ctx(user), async (tx) => (await tx.query(`select * from public.waitlist_position order by position`)).rows);
async function person(id: string, roles: string[] = ['player']) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, display_name) values ($1,$2,$3,$4)`, [A, id, 'L' + id, 'Name ' + id.slice(-3)]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [A, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
async function seat(customer: string, status: 'confirmed' | 'awaiting_payment' = 'confirmed', hold = '2026-11-30T03:10:00Z') {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id;
  const s = (await tdb.query(`select start_at, end_at, resource_id from public.class_session where id = $1`, [session])).rows[0];
  await tdb.query(`insert into public.booking (club_id, order_id, type, resource_id, class_session_id, start_at, end_at, customer_id, status, source, created_by, hold_expires_at, confirmed_at)
                   values ($1,$2,'class_seat',$3,$4,$5,$6,$7,$8,'online',$7, $9, $10)`,
    [A, order, s.resource_id, session, s.start_at, s.end_at, customer, status, status === 'awaiting_payment' ? hold : null, status === 'confirmed' ? '2026-11-30T03:00:00Z' : null]);
}
const wait = async (customer: string, sess = session) =>
  (await tdb.query(`insert into public.waitlist_entry (club_id, customer_id, subject_kind, class_session_id, seq) values ($1,$2,'class_session',$3,(select coalesce(max(seq), 0) + 1 from public.waitlist_entry)) returning id`, [A, customer, sess])).rows[0].id as string;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-11-30T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'Court 1','tennis')`, [A, C1, LOC]);
  await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) select $1, d, '06:00', '24:00' from generate_series(1, 7) d`, [A]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30')`, [A]);
  await person(OWNER, ['owner', 'player']);
  for (const p of P) await person(p);
  await tdb.seedCoach(A, COACH);
  await tdb.query(`update public.app_user set display_name = 'Coach Kim' where id = $1`, [COACH]);
  tpl = (await tdb.query(`insert into public.class_template (club_id, name_th, name_en, audience, level, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by) values ($1,'ตีกลุ่ม','Group','adult','Beginner',$2,$3,3,'18:00',2,3,$4) returning id`, [A, COACH, C1, OWNER])).rows[0].id;
  db = createDb({ connectionString: tdb.url, max: 4 });
  await db.withClubTx(ctx(OWNER, ['owner', 'player']), async (tx) => tx.query(`select app.generate_sessions('2026-11-30'::date, '2026-12-31'::date)`));
  session = (await tdb.query(`select id from public.class_session where template_id = $1 order by start_at limit 1`, [tpl])).rows[0].id;
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('public.public_class_state (CLASS-01-AC5 to AC8)', () => {
  it('a guest sees the scheduled future sessions with counts, the coach’s display name and the court’s name', async () => {
    const rows = await state();
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ session_id: session, name_en: 'Group', level: 'Beginner', audience: 'adult', coach_name: 'Coach Kim', court_name: 'Court 1', min_players: 2, max_players: 3, spots_left: 3, full: false, waitlist: false });
  });

  it('shows counts only: no player, order, entry, coach or court id, and none of the template’s money', async () => {
    const cols = Object.keys((await state())[0]!).sort();
    expect(cols).toEqual(['audience', 'coach_name', 'court_name', 'drop_in_price_satang', 'end_at', 'full', 'level', 'max_players', 'min_players', 'name_en', 'name_th', 'session_id', 'spots_left', 'start_at', 'waitlist']);
  });

  it('spots_left counts confirmed seats and unexpired holds; full and waitlist follow', async () => {
    await seat(P[0]!); await seat(P[1]!, 'awaiting_payment'); await seat(P[2]!, 'awaiting_payment', '2026-11-30T02:00:00Z');   // the last hold has ended
    expect((await state())[0]).toMatchObject({ spots_left: 1, full: false, waitlist: false });
    await seat(P[3]!);
    expect((await state())[0]).toMatchObject({ spots_left: 0, full: true });
    await wait(P[4]!);
    expect((await state())[0]).toMatchObject({ waitlist: true });
  });

  it('hides a cancelled session, a needs-attention session and a past one', async () => {
    const second = (await tdb.query(`select id from public.class_session where template_id = $1 order by start_at offset 1 limit 1`, [tpl])).rows[0].id;
    const third = (await tdb.query(`select id from public.class_session where template_id = $1 order by start_at offset 2 limit 1`, [tpl])).rows[0].id;
    await tdb.query(`update public.class_session set status = 'cancelled', cancel_reason = 'owner', cancelled_at = now() where id = $1`, [second]);
    await tdb.query(`update public.class_session set status = 'needs_attention', attention_reason = 'court_clash' where id = $1`, [third]);
    expect((await state()).length).toBe(3);
    await tdb.setNow('2026-12-02T11:00:01Z');                                      // the first session has started
    expect((await state()).find((r) => r.session_id === session)).toBeUndefined();
  });

  it('is scoped to the club; a Draft club shows nothing, a Testing club only to its testers, a Paused club to everyone', async () => {
    expect(await state(ctx(null, ['guest'], B))).toEqual([]);
    await tdb.query(`update public.club set status = 'draft' where id = $1`, [A]);
    expect(await state()).toEqual([]);
    await tdb.query(`update public.club set status = 'testing' where id = $1`, [A]);
    expect(await state()).toEqual([]);
    expect((await state(ctx(OWNER, ['owner', 'player']))).length).toBe(5);
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    expect((await state()).length).toBe(5);
  });

  it('is readable by every role of the app and not by the platform role', async () => {
    const can = (r: string, v: string) => tdb.query(`select has_table_privilege($1, $2, 'select') as ok`, [r, `public.${v}`]).then((x) => x.rows[0].ok);
    expect([await can('booq_app', 'public_class_state'), await can('booq_worker', 'public_class_state'), await can('booq_platform', 'public_class_state')]).toEqual([true, true, false]);
  });
});

describe('public.waitlist_position (CLASS-02-AC8, CC-3)', () => {
  it('a player sees their own place in line, and only their own', async () => {
    await wait(P[0]!); await wait(P[1]!); await wait(P[2]!);
    expect((await position(P[0]!)).map((r) => r.position)).toEqual([1]);
    expect((await position(P[2]!)).map((r) => r.position)).toEqual([3]);
    expect((await position(P[3]!))).toEqual([]);
    const r = (await position(P[1]!))[0]!;
    expect(Object.keys(r).sort()).toEqual(['class_session_id', 'entry_id', 'offer_expires_at', 'position', 'resource_id', 'slot_start_at', 'status', 'subject_kind']);
  });

  it('positions move up when an entry ahead leaves; an entry that is over is not listed; an offered entry counts', async () => {
    const e0 = await wait(P[0]!); await wait(P[1]!); await wait(P[2]!);
    await tdb.query(`update public.waitlist_entry set status = 'left', ended_reason = 'left' where id = $1`, [e0]);
    expect((await position(P[1]!)).map((r) => r.position)).toEqual([1]);
    expect((await position(P[0]!))).toEqual([]);
    expect((await position(P[2]!)).map((r) => r.position)).toEqual([2]);
  });

  it('a court slot position is counted among the entries of that hour only; a guest sees nothing', async () => {
    const slot = '2026-12-05T20:00:00+07:00';
    for (const p of [P[0]!, P[1]!]) await tdb.query(`insert into public.waitlist_entry (club_id, customer_id, subject_kind, resource_id, slot_start_at, seq) values ($1,$2,'court_slot',$3,$4,(select coalesce(max(seq), 0) + 1 from public.waitlist_entry))`, [A, p, C1, slot]);
    await wait(P[2]!);
    expect((await position(P[1]!)).map((r) => [r.subject_kind, r.position])).toEqual([['court_slot', 2]]);
    expect(await db.withClubTx(ctx(null, ['guest']), async (tx) => (await tx.query(`select * from public.waitlist_position`)).rows)).toEqual([]);
  });
});
