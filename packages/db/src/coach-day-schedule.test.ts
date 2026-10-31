import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F12-T02 / migration 1202: the coach's day and week (CPORT-01, CPORT-02; COACH-01; CC-1, CC-2).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const C1 = '66666666-6666-4666-8666-666666666661';
const C2 = '66666666-6666-4666-8666-666666666662';
const OWNER_B = '77777777-7777-4777-8777-777777777777';
const R1 = '88888888-8888-4888-8888-888888888881';
const R2 = '88888888-8888-4888-8888-888888888882';
const LOC = '99999999-9999-4999-8999-999999999999';

let tdb: TestDatabase;
let web: Db;
const ctx = (user: string, roles: string[], club = A) => ({ clubId: club, userId: user, roles, source: 'coach_portal' as const });
const coach1 = ctx(C1, ['coach', 'player']);
const as = async (c: ReturnType<typeof ctx>, sql: string, args: unknown[] = []) => (await web.withClubTx(c, (tx) => tx.query(sql, args))).rows as Array<Record<string, any>>;
const day = (d: string, c = coach1) => as(c, 'select * from app.coach_day($1::date)', [d]);
const week = (from: string, to: string, c = coach1) => as(c, 'select * from app.coach_schedule($1::date, $2::date)', [from, to]);
const hhmm = (r: Record<string, any>) => new Date(r.start_at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });

async function raw<T>(fn: (c: { query: (s: string, p?: unknown[]) => Promise<{ rows: any[] }> }) => Promise<T>): Promise<T> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } finally {
    c.release();
  }
}
async function solo(coach: string, start: string, over: { status?: string; customer?: string; court?: string; club?: string } = {}) {
  return raw(async (c) => {
    const club = over.club ?? A;
    const o = (await c.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [club, over.customer ?? P1])).rows[0].id as string;
    return (await c.query(
      `insert into public.booking (club_id, order_id, type, resource_id, customer_id, coach_id, start_at, end_at, status, source, created_by, confirmed_at, hold_expires_at, release_reason, released_at)
       values ($1,$2,'solo_class',$3,$4,$5,$6::timestamptz,$6::timestamptz + interval '1 hour',$7,'online',$4, now(),
               case when $7 = 'awaiting_payment' then now() + interval '1 hour' end, case when $7 = 'released' then 'expired' end, case when $7 = 'released' then now() end) returning id`,
      [club, o, over.court ?? R1, over.customer ?? P1, coach, start, over.status ?? 'confirmed'])).rows[0].id as string;
  });
}
async function group(coach: string, start: string, over: { status?: string; seats?: number; court?: string } = {}) {
  return raw(async (c) => {
    const status = over.status ?? 'scheduled';
    const s = (await c.query(
      `insert into public.class_session (club_id, template_id, start_at, end_at, name_th, name_en, audience, level, coach_id, resource_id, min_players, max_players, status, cancel_reason, cancelled_at, attention_reason)
       values ($1, gen_random_uuid(), $2::timestamptz, $2::timestamptz + interval '1 hour', 'กลุ่ม', 'Adult clinic', 'adult', 'beginner', $3, $4, 2, 6, $5, case when $5 = 'cancelled' then 'owner' end, case when $5 = 'cancelled' then now() end, case when $5 = 'needs_attention' then 'coach_clash' end) returning id`,
      [A, start, coach, over.court ?? R1, status])).rows[0].id as string;
    for (let i = 0; i < (over.seats ?? 0); i++) {
      const o = (await c.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id as string;
      await c.query(
        `insert into public.booking (club_id, order_id, type, resource_id, class_session_id, customer_id, start_at, end_at, status, source, created_by, confirmed_at)
         values ($1,$2,'class_seat',$3,$4,gen_random_uuid(),$5::timestamptz,$5::timestamptz + interval '1 hour','confirmed','online',$6, now())`, [A, o, R1, s, start, P1]);
    }
    return s;
  });
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-10T01:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  for (const [club, u, roles, name, level] of [[A, P1, ['player'], 'Ploy Srisuk', 'beginner'], [A, P2, ['player'], 'Nok', 'advanced'], [A, DESK, ['front_desk', 'player'], 'Desk', null],
    [A, OWNER, ['owner', 'player'], 'Owner', null], [A, C1, ['coach', 'player'], 'Coach One', null], [A, C2, ['coach', 'player'], 'Coach Two', null], [B, OWNER_B, ['owner', 'player'], 'Owner B', null]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id, full_name, level, phone, phone_normalized, date_of_birth) values ($1,$2,$3,$4,$5,$6,$7,$8)', [club, u, 'L' + u.slice(-2), name, level, '0812345678', '66812345' + u.slice(-3), '1990-01-01']);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  await raw(async (c) => {
    await c.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main')`, [A, LOC]);
    await c.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'Court 1','tennis'), ($1,$4,$3,'Court 2','tennis')`, [A, R1, LOC, R2]);
    await c.query(`insert into public.coach (club_id, id) values ($1,$2), ($1,$3)`, [A, C1, C2]);
  });
  web = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});

describe('who may call (CC-2)', () => {
  it('only a coach of the club; front desk, the owner who is not a coach, a player and another club are refused', async () => {
    for (const c of [ctx(DESK, ['front_desk', 'player']), ctx(OWNER, ['owner', 'player']), ctx(P1, ['player']), ctx(OWNER_B, ['owner', 'player'], B), ctx(C1, ['coach', 'player'], B)]) {
      await expect(day('2026-12-10', c), c.roles.join()).rejects.toThrow(/portal:forbidden/);
      await expect(week('2026-12-07', '2026-12-13', c), c.roles.join()).rejects.toThrow(/portal:forbidden/);
    }
  });
  it('a coach role without a coach row is refused', async () => {
    await tdb.query(`delete from public.coach where id = $1`, [C2]);
    await expect(day('2026-12-10', ctx(C2, ['coach', 'player']))).rejects.toThrow(/portal:forbidden/);
  });
});

describe('K1 Today (CPORT-01)', () => {
  it('three sessions today: only the coach\'s own, in time order, with court, student and level; another coach\'s never', async () => {
    await solo(C1, '2026-12-10T10:00:00Z', { court: R2 });                  // 17:00
    await group(C1, '2026-12-10T10:00:00Z', { seats: 3 }).then(() => undefined);
    await solo(C1, '2026-12-10T00:00:00Z');                                 // 07:00
    await solo(C2, '2026-12-10T02:00:00Z');
    await solo(C1, '2026-12-11T02:00:00Z');                                 // tomorrow
    const rows = await day('2026-12-10');
    expect(rows).toHaveLength(3);
    expect(rows.map(hhmm)).toEqual(['07:00', '17:00', '17:00']);
    expect(rows[0]).toMatchObject({ kind: 'solo', court: 'Court 1', student_name: 'Ploy Srisuk', level: 'beginner', held: false, status: 'confirmed' });
    const g = rows.find((r) => r.kind === 'group')!;
    expect(g).toMatchObject({ class_name_en: 'Adult clinic', class_name_th: 'กลุ่ม', level: 'beginner', players: 3, capacity: 6, needs_attention: false });
  });
  it('shows held and no show solo classes and needs_attention sessions; never cancelled, late cancelled, released or cancelled sessions', async () => {
    await solo(C1, '2026-12-10T01:00:00Z', { status: 'awaiting_payment' });
    await solo(C1, '2026-12-10T02:00:00Z', { status: 'no_show' });
    await solo(C1, '2026-12-10T03:00:00Z', { status: 'cancelled' });
    await solo(C1, '2026-12-10T04:00:00Z', { status: 'late_cancelled' });
    await solo(C1, '2026-12-10T05:00:00Z', { status: 'released' });
    await group(C1, '2026-12-10T06:00:00Z', { status: 'needs_attention' });
    await group(C1, '2026-12-10T07:00:00Z', { status: 'cancelled' });
    const rows = await day('2026-12-10');
    expect(rows.map((r) => [r.kind, r.status, r.held, r.needs_attention])).toEqual([
      ['solo', 'awaiting_payment', true, false], ['solo', 'no_show', false, false], ['group', 'needs_attention', false, true]]);
  });
  it('a substituted class shows for the substitute only, and the Bangkok day boundary holds (23:00 and 00:00)', async () => {
    const b = await solo(C1, '2026-12-10T05:00:00Z');
    await raw((c) => c.query(`update public.booking set coach_id = $2 where id = $1`, [b, C2]));
    await solo(C1, '2026-12-10T16:00:00Z');                                 // 23:00 on the 10th
    await solo(C1, '2026-12-10T17:00:00Z');                                 // 00:00 on the 11th
    expect((await day('2026-12-10')).map(hhmm)).toEqual(['23:00']);
    expect((await day('2026-12-11')).map(hhmm)).toEqual(['00:00']);
    expect((await day('2026-12-10', ctx(C2, ['coach', 'player']))).map(hhmm)).toEqual(['12:00']);
  });
  it('a null date is today in Bangkok; no phone, date of birth or payment column is returned', async () => {
    await solo(C1, '2026-12-10T05:00:00Z');
    expect(await as(coach1, 'select * from app.coach_day(null)')).toHaveLength(1);
    const cols = Object.keys((await day('2026-12-10'))[0]!);
    expect(cols.sort()).toEqual(['capacity', 'class_name_en', 'class_name_th', 'court', 'end_at', 'held', 'kind', 'level', 'needs_attention', 'players', 'ref_id', 'start_at', 'status', 'student_name']);
    expect(JSON.stringify(await day('2026-12-10'))).not.toMatch(/0812345678|1990-01-01/);
  });
  it("the table policies already keep a coach to their own rows, so another coach's sessions are not reachable by a query either", async () => {
    await solo(C1, '2026-12-10T05:00:00Z');
    await solo(C2, '2026-12-10T06:00:00Z');
    const seen = await as(coach1, 'select coach_id from public.booking');
    expect(seen.every((r) => r.coach_id === C1 || r.coach_id === null)).toBe(true);
    expect(seen.some((r) => r.coach_id === C2)).toBe(false);
  });
});

describe('K2 Schedule (CPORT-02)', () => {
  it('a week of sessions, the coach\'s own leave (pending and approved) and blocked times, in time order', async () => {
    await solo(C1, '2026-12-08T03:00:00Z');
    await group(C1, '2026-12-09T12:00:00Z', { seats: 2 });
    await raw(async (c) => {
      await c.query(`insert into public.coach_leave (club_id, coach_id, start_date, end_date, from_hour, to_hour, type, status, decided_by, decided_at)
                     values ($1,$2,'2026-12-08','2026-12-08',13,17,'Afternoon off','approved',$3,now())`, [A, C1, OWNER]);
      await c.query(`insert into public.coach_leave (club_id, coach_id, start_date, end_date, type, status) values ($1,$2,'2026-12-11','2026-12-12','Trip','pending')`, [A, C1]);
      await c.query(`insert into public.coach_leave (club_id, coach_id, start_date, end_date, status, decided_by, decided_at) values ($1,$2,'2026-12-10','2026-12-10','declined',$3,now())`, [A, C1, OWNER]);
      await c.query(`insert into public.coach_leave (club_id, coach_id, start_date, end_date, type, status, decided_by, decided_at) values ($1,$2,'2026-12-09','2026-12-09','Other coach','approved',$3,now())`, [A, C2, OWNER]);
      await c.query(`insert into public.coach_availability_rule (club_id, coach_id, kind, on_date, start_time, end_time) values ($1,$2,'closed','2026-12-09','06:00','09:00')`, [A, C1]);
      await c.query(`insert into public.coach_availability_rule (club_id, coach_id, kind, on_date, start_time, end_time) values ($1,$2,'closed','2026-12-09','06:00','09:00')`, [A, C2]);
      const cl = (await c.query(`insert into public.closure (club_id, reason, range_start, range_end, created_by) values ($1,'Court 1 maintenance','2026-12-10T03:00:00Z','2026-12-10T05:00:00Z',$2) returning id`, [A, OWNER])).rows[0].id as string;
      await c.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, closure_id) values ($1,'closure',$2,'2026-12-10T03:00:00Z','2026-12-10T05:00:00Z','confirmed',$3)`, [A, R1, cl]);
    });
    const rows = await week('2026-12-07', '2026-12-13');
    expect(rows.map((r) => [r.item, r.kind ?? r.status, r.note ?? null])).toEqual([
      ['session', 'solo', null],                       // 8 Dec 10:00
      ['leave', 'approved', 'Afternoon off'],          // 8 Dec 13:00 to 17:00
      ['blocked', 'closed', null],                     // 9 Dec 06:00 to 09:00 (own rule)
      ['session', 'group', null],                      // 9 Dec 19:00
      ['blocked', 'closed', 'Court 1 maintenance'],    // 10 Dec 10:00 to 12:00
      ['leave', 'pending', 'Trip'],                    // 11 and 12 Dec
    ]);
    const leave = rows.find((r) => r.item === 'leave' && r.status === 'approved')!;
    expect(hhmm(leave)).toBe('13:00');
    expect(new Date(leave.end_at).toISOString()).toBe('2026-12-08T10:00:00.000Z');
    const trip = rows.find((r) => r.note === 'Trip')!;
    expect([new Date(trip.start_at).toISOString(), new Date(trip.end_at).toISOString()]).toEqual(['2026-12-10T17:00:00.000Z', '2026-12-12T17:00:00.000Z']);
    expect(rows.find((r) => r.kind === 'group')).toMatchObject({ players: 2, capacity: 6 });
  });
  it('a leave day shows and no session of the coach is invented on it; a session before the leave stays', async () => {
    await raw((c) => c.query(`insert into public.coach_leave (club_id, coach_id, start_date, end_date, status, decided_by, decided_at) values ($1,$2,'2026-12-09','2026-12-09','approved',$3,now())`, [A, C1, OWNER]));
    await solo(C1, '2026-12-08T03:00:00Z');
    const rows = await week('2026-12-07', '2026-12-13');
    expect(rows.map((r) => r.item)).toEqual(['session', 'leave']);
  });
  it('the range must be 1 to 14 days, from before to; another coach and another club see none of it', async () => {
    await expect(week('2026-12-13', '2026-12-07')).rejects.toThrow(/portal:invalid_range/);
    await expect(week('2026-12-01', '2026-12-15')).rejects.toThrow(/portal:invalid_range/);
    await expect(as(coach1, 'select * from app.coach_schedule(null, null)')).rejects.toThrow(/portal:invalid_range/);
    expect(await week('2026-12-01', '2026-12-14')).toEqual([]);
    await solo(C1, '2026-12-08T03:00:00Z');
    expect(await week('2026-12-07', '2026-12-13', ctx(C2, ['coach', 'player']))).toEqual([]);
  });
});
