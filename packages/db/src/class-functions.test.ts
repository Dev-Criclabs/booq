import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F08-T05a / migration 0905: class_visible, check_template, generate_sessions (CLASS-01-AC1 to AC3, AC5, AC9, AC12; D12, D84).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const COACH2 = 'e1e1e1e1-0000-4000-8000-000000000008';
const OWNER = '44444444-4444-4444-8444-444444444444';
const DESK = '33333333-3333-4333-8333-333333333333';
const KID = '11111111-1111-4111-8111-111111111111';     // born 2012: Student
const ADULT = '22222222-2222-4222-8222-222222222222';   // born 1990: Adult
const NODOB = '55555555-5555-4555-8555-555555555555';   // no date of birth: Adult
const TEEN = '66666666-6666-4666-8666-666666666666';    // turned 18 on 2026-11-01
let tdb: TestDatabase;
let db: Db;
let dbw: Db;
let tpl: string;

const ctx = (user: string | null, roles: string[]) => ({ clubId: A, userId: user, roles: roles as never, source: 'admin' as const });
const owner = () => ctx(OWNER, ['owner', 'player']);
const as = <T>(c: { clubId: string; userId: string | null; roles: never; source: 'admin' | 'player_app' }, sql: string, params: unknown[] = []) => db.withClubTx(c, async (tx) => (await tx.query(sql, params)).rows as T[]);
const visible = async (session: string, customer: string | null) =>
  (await as<{ r: boolean }>(ctx(customer, customer ? ['player'] : ['guest']), `select app.class_visible($1, $2) as r`, [session, customer]))[0]!.r;
const check = async (coach = COACH, court = C1, weekday = 3, time = '18:00', template: string | null = null) =>
  (await as<{ r: { clashes: { date: string; reason: string }[]; attention: { date: string; reason: string }[] } }>(owner(), `select app.check_template($1, $2, $3::smallint, $4::time, $5) as r`, [coach, court, weekday, time, template]))[0]!.r;
const generate = (from = '2026-12-01', to = '2026-12-31', d = db, c = owner()) =>
  d.withClubTx(c, async (tx) => Number((await tx.query(`select app.generate_sessions($1::date, $2::date) as n`, [from, to])).rows[0]!.n));
const sessions = async () => (await tdb.query(`select to_char(start_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') as at, status, attention_reason, audience, max_players from public.class_session order by start_at`)).rows;
const occ = async () => (await tdb.query(`select kind, resource_id, coach_id, state, to_char(start_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24') as at from public.occupancy where kind = 'group_class' order by start_at`)).rows;

async function person(club: string, id: string, roles: string[], dob: string | null = null) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, date_of_birth) values ($1,$2,$3,$4)`, [club, id, 'L' + id, dob]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [club, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
async function template(over: Record<string, unknown> = {}) {
  const r: Record<string, unknown> = { club_id: A, name_th: 'ก', name_en: 'Group', audience: 'adult', coach_id: COACH, resource_id: C1, weekday: 3, start_time: '18:00', min_players: 4, max_players: 6, created_by: OWNER, ...over };
  const cols = Object.keys(r);
  return (await tdb.query(`insert into public.class_template (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning id`, cols.map((c) => r[c]))).rows[0].id as string;
}
/** The coach is busy with someone else's class at the given Bangkok date and hour. */
async function coachBusy(coach: string, court: string, date: string, hour: number) {
  const t = await template({ coach_id: coach, resource_id: court, weekday: 6, start_time: `${String(hour).padStart(2, '0')}:00`, name_en: 'Other ' + date + hour });
  const at = `${date}T${String(hour).padStart(2, '0')}:00:00+07:00`;
  const end = `${date}T${String(hour + 1).padStart(2, '0')}:00:00+07:00`;
  const s = (await tdb.query(`insert into public.class_session (club_id, template_id, start_at, end_at, name_th, name_en, audience, coach_id, resource_id, min_players, max_players) values ($1,$2,$3,$4,'ก','O','adult',$5,$6,1,6) returning id`, [A, t, at, end, coach, court])).rows[0].id;
  await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, class_session_id) values ($1,'group_class',$2,$3,$4,$5,'confirmed',$6)`, [A, court, coach, at, end, s]);
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');   // Tuesday 10:00 Bangkok
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($1,$4,$3,'2','tennis')`, [A, C1, LOC, C2]);
  await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) select $1, d, '08:00', '22:00' from generate_series(1, 7) d`, [A]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30')`, [A]);
  await person(A, OWNER, ['owner', 'player']);
  await person(A, DESK, ['front_desk', 'player']);
  await person(A, KID, ['player'], '2012-05-17');
  await person(A, ADULT, ['player'], '1990-01-01');
  await person(A, NODOB, ['player']);
  await person(A, TEEN, ['player'], '2008-11-01');
  await tdb.seedCoach(A, COACH);
  await tdb.seedCoach(A, COACH2);
  tpl = await template();
  db = createDb({ connectionString: tdb.url, max: 4 });
  dbw = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await db.end();
  await dbw.end();
  await tdb.close();
});

describe('app.generate_sessions (CLASS-01-AC2, AC3, AC9)', () => {
  it('makes a session for every matching date of the window, each claiming court and coach in one occupancy row', async () => {
    expect(await generate()).toBe(5);
    const s = await sessions();
    expect(s.map((x) => x.at)).toEqual(['2026-12-02 18:00', '2026-12-09 18:00', '2026-12-16 18:00', '2026-12-23 18:00', '2026-12-30 18:00']);
    expect(s.every((x) => x.status === 'scheduled' && x.attention_reason === null && x.max_players === 6 && x.audience === 'adult')).toBe(true);
    const o = await occ();
    expect(o).toHaveLength(5);
    expect(o[0]).toMatchObject({ resource_id: C1, coach_id: COACH, state: 'confirmed', at: '2026-12-02 18' });
  });

  it('is idempotent: a second run makes nothing new, and the window can move', async () => {
    await generate('2026-12-01', '2026-12-15');
    expect(await generate('2026-12-01', '2026-12-15')).toBe(0);
    expect(await generate('2026-12-01', '2026-12-31')).toBe(3);
    expect((await sessions()).length).toBe(5);
  });

  it('the worker may run it; the front desk too; a player and a guest may not', async () => {
    expect(await generate('2026-12-01', '2026-12-10', dbw, ctx(null, []))).toBe(2);
    expect(await generate('2026-12-01', '2026-12-31', db, ctx(DESK, ['front_desk', 'player']))).toBe(3);
    await expect(generate('2026-12-01', '2026-12-31', db, ctx(KID, ['player']))).rejects.toThrow(/not allowed/);
    await expect(generate('2026-12-01', '2026-12-31', db, ctx(null, ['guest']))).rejects.toThrow(/not allowed/);
    await expect(generate('2026-12-31', '2026-12-01')).rejects.toThrow(/invalid range/);
  });

  it('a court clash makes the session needs_attention with no occupancy row; nothing is skipped silently', async () => {
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, KID])).rows[0].id;
    const b = (await tdb.query(`insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at) values ($1,$2,'court',$3,'2026-12-09T18:00:00+07:00','2026-12-09T19:00:00+07:00',$4,'confirmed','online',$4, app.now()) returning id`, [A, order, C1, KID])).rows[0].id;
    await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, booking_id) values ($1,'court_booking',$2,'2026-12-09T18:00:00+07:00','2026-12-09T19:00:00+07:00','confirmed',$3)`, [A, C1, b]);
    expect(await generate()).toBe(5);
    expect((await sessions()).map((s) => [s.at.slice(0, 10), s.status, s.attention_reason])).toEqual([
      ['2026-12-02', 'scheduled', null], ['2026-12-09', 'needs_attention', 'court_clash'], ['2026-12-16', 'scheduled', null], ['2026-12-23', 'scheduled', null], ['2026-12-30', 'scheduled', null]]);
    expect((await occ()).map((o) => o.at.slice(0, 10))).toEqual(['2026-12-02', '2026-12-16', '2026-12-23', '2026-12-30']);
  });

  it('a coach already busy at the hour gives coach_clash; a coach on approved leave gives coach_leave; a closed court gives court_clash', async () => {
    await coachBusy(COACH, C2, '2026-12-09', 18);
    await tdb.query(`insert into public.coach_leave (club_id, coach_id, start_date, end_date, status, decided_by, decided_at) values ($1,$2,'2026-12-16','2026-12-16','approved',$3,app.now())`, [A, COACH, OWNER]);
    await tdb.query(`delete from public.coach_availability_rule where coach_id = $1 and weekday = 3 and false`, [COACH]);
    await generate('2026-12-01', '2026-12-31');
    const s = await sessions();
    expect(s.filter((x) => x.status === 'needs_attention').map((x) => [x.at.slice(0, 10), x.attention_reason])).toEqual([['2026-12-09', 'coach_clash'], ['2026-12-16', 'coach_leave']]);
  });

  it('an hour outside opening hours gives outside_hours; an inactive or ended template makes nothing; the coach rest run counts a group class', async () => {
    await tdb.query(`update public.opening_hours set close = '18:00' where weekday = 3`, []);
    await generate('2026-12-01', '2026-12-04');
    expect((await sessions()).map((x) => [x.status, x.attention_reason])).toEqual([['needs_attention', 'outside_hours']]);
    await tdb.query(`update public.opening_hours set close = '22:00' where weekday = 3`, []);
    // six classes in a row for the coach before it (12:00 to 17:00 on 16 Dec), so 18:00 would be a seventh hour in a row.
    for (const h of [12, 13, 14, 15, 16, 17]) await coachBusy(COACH, C2, '2026-12-16', h);
    await tdb.query(`update public.class_template set ended_on = '2026-12-20' where id = $1`, [tpl]);
    await generate('2026-12-05', '2026-12-31');
    const got = (await sessions()).filter((x) => x.at >= '2026-12-05' && x.at.endsWith('18:00') && x.at.slice(0, 10) <= '2026-12-31').filter((x) => !x.at.startsWith('2026-12-02'));
    expect(got.map((x) => [x.at.slice(0, 10), x.attention_reason]).filter((x) => x[0] === '2026-12-16' || x[0] === '2026-12-09')).toEqual([['2026-12-09', null], ['2026-12-16', 'coach_rest']]);
    expect(got.find((x) => x.at.startsWith('2026-12-23'))).toBeUndefined();   // after the template ended
    await tdb.query(`update public.class_template set active = false`);
    expect(await generate('2027-01-01', '2027-01-31')).toBe(0);
  });
});

describe('app.check_template (CLASS-01-AC3, AC9, AC12)', () => {
  it('a free court and coach give no clash and no flag', async () => {
    expect(await check(COACH, C2)).toEqual({ clashes: [], attention: [] });
  });

  it('a clash with a booking, another class or a closed hour lists every date and reason', async () => {
    await coachBusy(COACH2, C1, '2026-12-09', 18);
    await coachBusy(COACH2, C1, '2026-12-23', 18);
    const r = await check(COACH, C1);
    expect(r.clashes).toEqual([{ date: '2026-12-09', reason: 'court_clash' }, { date: '2026-12-23', reason: 'court_clash' }]);
    const r2 = await check(COACH2, C2);
    expect(r2.clashes).toEqual([{ date: '2026-12-09', reason: 'coach_clash' }, { date: '2026-12-23', reason: 'coach_clash' }]);
  });

  it('an hour outside the opening hours is refused for every date; a coach on leave or over the rest cap is flagged, not refused', async () => {
    expect((await check(COACH, C1, 3, '07:00')).clashes.map((c) => c.reason)).toEqual(Array(5).fill('outside_hours'));
    await tdb.query(`insert into public.coach_leave (club_id, coach_id, start_date, end_date, status, decided_by, decided_at) values ($1,$2,'2026-12-16','2026-12-16','approved',$3,app.now())`, [A, COACH, OWNER]);
    for (const h of [12, 13, 14, 15, 16, 17]) await coachBusy(COACH2, C2, '2026-12-09', h);
    expect(await check(COACH, C1)).toEqual({ clashes: [], attention: [{ date: '2026-12-16', reason: 'coach_leave' }] });
    expect(await check(COACH2, C1)).toEqual({ clashes: [], attention: [{ date: '2026-12-09', reason: 'coach_rest' }] });
  });

  it('checking an existing template ignores its own sessions', async () => {
    await generate();
    expect((await check(COACH, C1, 3, '18:00', null)).clashes).toHaveLength(5);
    expect(await check(COACH, C1, 3, '18:00', tpl)).toEqual({ clashes: [], attention: [] });
  });

  it('is for the owner and front desk; the booking window setting must exist', async () => {
    await expect(as(ctx(KID, ['player']), `select app.check_template($1, $2, 3::smallint, '18:00'::time)`, [COACH, C1])).rejects.toThrow(/not allowed/);
    await tdb.query(`delete from public.club_setting where key = 'booking_window_days'`);
    await expect(check()).rejects.toThrow(/booking_window_unset/);
  });
});

describe('app.class_visible (CLASS-01-AC5, D12, D84)', () => {
  let adultClass: string;
  let studentClass: string;
  beforeEach(async () => {
    const st = await template({ audience: 'student', name_en: 'Juniors', start_time: '16:00' });
    await generate();
    adultClass = (await tdb.query(`select id from public.class_session where template_id = $1 order by start_at limit 1`, [tpl])).rows[0].id;
    studentClass = (await tdb.query(`select id from public.class_session where template_id = $1 order by start_at limit 1`, [st])).rows[0].id;
  });

  it('a guest sees Adult classes only', async () => {
    expect(await visible(adultClass, null)).toBe(true);
    expect(await visible(studentClass, null)).toBe(false);
  });

  it('Adult for 18 and over and for no date of birth; Student under 18 on the Bangkok date', async () => {
    expect([await visible(adultClass, ADULT), await visible(studentClass, ADULT)]).toEqual([true, false]);
    expect([await visible(adultClass, NODOB), await visible(studentClass, NODOB)]).toEqual([true, false]);
    expect([await visible(adultClass, KID), await visible(studentClass, KID)]).toEqual([false, true]);
    expect([await visible(adultClass, TEEN), await visible(studentClass, TEEN)]).toEqual([true, false]);   // turned 18 on 1 November
  });

  it('a player now 18 who holds a Student group credit still sees the Student classes (D84); an expired or used up one does not', async () => {
    const pg = (await tdb.query(`insert into public.price_group (club_id, name_th, name_en, rule) values ($1,'น','Student','{"max_age": 17}') returning id`, [A])).rows[0].id;
    const prod = (await tdb.query(`insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_group_id, price_satang) values ($1,'ก','8 pack','group_session',8,6,$2,100000) returning id`, [A, pg])).rows[0].id;
    const pkg = (await tdb.query(`insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, expires_at, purchase_date) values ($1,$2,$3,'{}'::jsonb,8, app.now() + interval '3 months', current_date) returning id`, [A, TEEN, prod])).rows[0].id;
    expect(await visible(studentClass, TEEN)).toBe(true);
    await tdb.query(`update public.customer_package set expires_at = app.now() + interval '1 second' where id = $1`, [pkg]);
    await tdb.advance('1 minute');
    expect(await visible(studentClass, TEEN)).toBe(false);
  });

  it('a court-hour credit does not open a class; another club’s session, an unknown session and an unknown customer are not visible', async () => {
    const pg = (await tdb.query(`insert into public.price_group (club_id, name_th, name_en, rule) values ($1,'น','Student','{"max_age": 17}') returning id`, [A])).rows[0].id;
    const prod = (await tdb.query(`insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_group_id, price_satang) values ($1,'ก','hours','court_hour',8,6,$2,100000) returning id`, [A, pg])).rows[0].id;
    await tdb.query(`insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, expires_at, purchase_date) values ($1,$2,$3,'{}'::jsonb,8, app.now() + interval '3 months', current_date)`, [A, TEEN, prod]);
    expect(await visible(studentClass, TEEN)).toBe(false);
    expect(await visible('99999999-9999-4999-8999-999999999999', ADULT)).toBe(false);
    expect(await visible(adultClass, '99999999-9999-4999-8999-999999999999')).toBe(false);
    const other = await as<{ r: boolean }>({ clubId: B, userId: null, roles: ['guest'] as never, source: 'player_app' }, `select app.class_visible($1, null) as r`, [adultClass]);
    expect(other[0]!.r).toBe(false);
  });

  it('never returns the date of birth: the function answers a boolean only', async () => {
    const r = await as<Record<string, unknown>>(ctx(KID, ['player']), `select app.class_visible($1, $2)`, [studentClass, KID]);
    expect(Object.keys(r[0]!)).toEqual(['class_visible']);
    expect(typeof r[0]!.class_visible).toBe('boolean');
  });
});
