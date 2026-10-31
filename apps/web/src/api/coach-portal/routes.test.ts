import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { coachPortalRoutes } from './routes';

// F12-T07, T08: the coach portal routes (CPORT-01 to CPORT-06; D118; CC-2).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER_NOT_COACH = '99999999-0000-4999-8999-000000000009';
const OWNER = '44444444-4444-4444-8444-444444444444';
const ACC = '55555555-5555-4555-8555-555555555555';
const C1 = '66666666-6666-4666-8666-666666666661';
const C2 = '66666666-6666-4666-8666-666666666662';
const R1 = '88888888-8888-4888-8888-888888888881';
const LOC = '99999999-9999-4999-8999-999999999999';
const deps = { hasFeature: async () => true };

let tdb: TestDatabase;
let db: Db;
const sess = (userId: string, roles: string[]) => ({ clubId: A, userId, roles: roles as never });
const coach1 = sess(C1, ['coach', 'player']);
const routes = () => coachPortalRoutes({ db });
const find = (m: string, p: string) => routes().find((r) => r.def.method === m && r.def.path === p)!;
const run = (m: string, p: string, session: ReturnType<typeof sess> | null, input: Record<string, unknown> = {}, body?: unknown) =>
  find(m, p).handle({ session, input, ...(body === undefined ? {} : { body }) }, deps);
const bodyOf = (r: unknown) => (r as { body: any }).body;

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
const solo = (coach: string, start: string, customer = P1) =>
  raw(async (c) => {
    const o = (await c.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id as string;
    return (await c.query(
      `insert into public.booking (club_id, order_id, type, resource_id, customer_id, coach_id, start_at, end_at, status, source, created_by, confirmed_at)
       values ($1,$2,'solo_class',$3,$4,$5,$6::timestamptz,$6::timestamptz + interval '1 hour','confirmed','online',$4, now()) returning id`, [A, o, R1, customer, coach, start])).rows[0].id as string;
  });
const group = (coach: string, start: string, customers: string[]) =>
  raw(async (c) => {
    const s = (await c.query(
      `insert into public.class_session (club_id, template_id, start_at, end_at, name_th, name_en, audience, level, coach_id, resource_id, min_players, max_players)
       values ($1, gen_random_uuid(), $2::timestamptz, $2::timestamptz + interval '1 hour', 'กลุ่ม', 'Clinic', 'adult', 'beginner', $3, $4, 2, 6) returning id`, [A, start, coach, R1])).rows[0].id as string;
    const seats: string[] = [];
    for (const cu of customers) {
      const o = (await c.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, cu])).rows[0].id as string;
      seats.push((await c.query(
        `insert into public.booking (club_id, order_id, type, resource_id, class_session_id, customer_id, start_at, end_at, status, source, created_by, confirmed_at)
         values ($1,$2,'class_seat',$3,$4,$5,$6::timestamptz,$6::timestamptz + interval '1 hour','confirmed','online',$5, now()) returning id`, [A, o, R1, s, cu, start])).rows[0].id as string);
    }
    return { session: s, seats };
  });

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-10T08:00:00Z');                                 // 15:00 Bangkok on 10 December
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  for (const [u, roles, name] of [[P1, ['player'], 'Ploy'], [P2, ['player'], 'Ann'], [DESK, ['front_desk', 'player'], 'Desk'], [OWNER, ['owner', 'coach', 'player'], 'Owner Coach'],
    [ACC, ['accountant', 'player'], 'Acc'], [OWNER_NOT_COACH, ['owner', 'player'], 'Owner only'], [C1, ['coach', 'player'], 'Coach One'], [C2, ['coach', 'player'], 'Coach Two']] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id, full_name) values ($1,$2,$3,$4)', [A, u, 'L' + u.slice(-2), name]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [A, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  await raw(async (c) => {
    await c.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main')`, [A, LOC]);
    await c.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'Court 1','tennis')`, [A, R1, LOC]);
    await c.query(`insert into public.coach (club_id, id) values ($1,$2), ($1,$3), ($1,$4)`, [A, C1, C2, OWNER]);
  });
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('route table', () => {
  it('declares who may call each route, and sends no-store', () => {
    expect(routes().map((r) => `${r.def.method} ${r.def.path} ${r.def.permission}`).sort()).toEqual([
      'GET /coach/earnings coach.portal',
      'GET /coach/earnings/history coach.portal',
      'GET /coach/rest-cap coach.portal',
      'GET /coach/schedule coach.portal',
      'GET /coach/sessions/group/:id coach.portal',
      'GET /coach/sessions/solo/:id coach.portal',
      'GET /coach/today coach.portal',
      'GET /staff/bookings/:id/attendance attendance.read',
      'PUT /coach/sessions/group/:id/attendance coach.portal',
      'PUT /coach/sessions/group/:id/note coach.portal',
      'PUT /coach/sessions/solo/:id/attendance coach.portal',
      'PUT /coach/sessions/solo/:id/note coach.portal',
    ]);
    expect(routes().every((r) => (r as { headers?: Record<string, string> }).headers?.['Cache-Control'] === 'no-store')).toBe(true);
  });
  it('no coach, club or customer id is a parameter of a coach route (only the session and the seat)', () => {
    for (const r of routes()) expect(r.def.path).not.toMatch(/coachId|clubId|:coach|:club/i);
  });
});

describe('who may call (CC-2)', () => {
  it('front desk, the accountant and a player are refused with 403, a guest with 401; a coach and an owner who is a coach read their own', async () => {
    for (const s of [sess(DESK, ['front_desk', 'player']), sess(ACC, ['accountant', 'player']), sess(P1, ['player'])]) {
      expect(await run('GET', '/coach/today', s)).toMatchObject({ ok: false, status: 403 });
      expect(await run('GET', '/coach/earnings', s, { month: '2026-12' })).toMatchObject({ ok: false, status: 403 });
      expect(await run('PUT', '/coach/sessions/solo/:id/note', s, { id: P1 }, { customerId: null, body: 'x' })).toMatchObject({ ok: false, status: 403 });
    }
    expect(await run('GET', '/coach/today', null)).toMatchObject({ ok: false, status: 401 });
    expect(await run('GET', '/coach/today', sess(OWNER_NOT_COACH, ['owner', 'player']))).toMatchObject({ ok: false, status: 403 });   // the route lets the owner in, the function wants a coach
    expect(await run('GET', '/coach/today', coach1)).toMatchObject({ ok: true });
    await solo(OWNER, '2026-12-10T05:00:00Z');
    expect(bodyOf(await run('GET', '/coach/today', sess(OWNER, ['owner', 'coach', 'player']), { date: '2026-12-10' })).count).toBe(1);
    expect(bodyOf(await run('GET', '/coach/today', coach1, { date: '2026-12-10' })).count).toBe(0);
  });
});

describe('K3', () => {
  it('the rest cap is the club setting or 6, for a coach only', async () => {
    expect(await run('GET', '/coach/rest-cap', coach1)).toMatchObject({ ok: true, body: { restCapHours: 6 } });
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'rest_cap_hours','5')`, [A]);
    expect(bodyOf(await run('GET', '/coach/rest-cap', coach1)).restCapHours).toBe(5);
    expect(await run('GET', '/coach/rest-cap', sess(DESK, ['front_desk', 'player']))).toMatchObject({ ok: false, status: 403 });
  });
});

describe('K1 and K2', () => {
  it('today: the sessions, the count and the hours; the date is validated; the default is today', async () => {
    await solo(C1, '2026-12-10T05:00:00Z');
    await group(C1, '2026-12-10T10:00:00Z', [P1, P2]);
    await solo(C2, '2026-12-10T06:00:00Z');
    const r = bodyOf(await run('GET', '/coach/today', coach1, { date: '2026-12-10' }));
    expect([r.date, r.count, r.hours, r.sessions.map((x: any) => x.kind)]).toEqual(['2026-12-10', 2, 2, ['solo', 'group']]);
    expect(bodyOf(await run('GET', '/coach/today', coach1)).count).toBe(2);
    for (const bad of ['2026-02-30', 'x', '10/12/2026', '']) expect(await run('GET', '/coach/today', coach1, { date: bad }), bad).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
  });
  it('schedule: the counts of solo, group and leave; the range is validated and at most 14 days', async () => {
    await solo(C1, '2026-12-08T05:00:00Z');
    await group(C1, '2026-12-09T10:00:00Z', [P1]);
    await raw((c) => c.query(`insert into public.coach_leave (club_id, coach_id, start_date, end_date, status) values ($1,$2,'2026-12-11','2026-12-11','pending')`, [A, C1]));
    const r = bodyOf(await run('GET', '/coach/schedule', coach1, { from: '2026-12-07', to: '2026-12-13' }));
    expect(r.counts).toEqual({ solo: 1, group: 1, leave: 1 });
    expect(r.items.map((x: any) => x.item)).toEqual(['session', 'session', 'leave']);
    expect(await run('GET', '/coach/schedule', coach1, { from: '2026-12-07' })).toMatchObject({ ok: false, status: 400 });
    expect(await run('GET', '/coach/schedule', coach1, { from: '2026-12-13', to: '2026-12-07' })).toMatchObject({ ok: false, status: 400, code: 'invalid_range' });
    expect(await run('GET', '/coach/schedule', coach1, { from: '2026-12-01', to: '2026-12-20' })).toMatchObject({ ok: false, status: 400, code: 'invalid_range' });
  });
});

describe('K5 session, attendance and notes (CPORT-05, D118)', () => {
  it('opens a session of the coach and a group session, 404 for another coach\'s, a bad id or the wrong kind', async () => {
    const b = await solo(C1, '2026-12-10T00:00:00Z');
    const g = await group(C1, '2026-12-10T00:00:00Z', [P1, P2]);
    expect(bodyOf(await run('GET', '/coach/sessions/solo/:id', coach1, { id: b }))).toMatchObject({ kind: 'solo', listed: 1, can_mark: 'ok' });
    expect(bodyOf(await run('GET', '/coach/sessions/group/:id', coach1, { id: g.session }))).toMatchObject({ kind: 'group', listed: 2, players: 2, capacity: 6 });
    expect(await run('GET', '/coach/sessions/solo/:id', sess(C2, ['coach', 'player']), { id: b })).toMatchObject({ ok: false, status: 404, code: 'not_found' });
    expect(await run('GET', '/coach/sessions/solo/:id', coach1, { id: 'nope' })).toMatchObject({ ok: false, status: 404 });
    expect(await run('GET', '/coach/sessions/group/:id', coach1, { id: b })).toMatchObject({ ok: false, status: 404 });
  });
  it('marks a solo class and a group seat; typed refusals before the end, for a bad mark, a seat of another session; the staff hint', async () => {
    const early = await solo(C1, '2026-12-10T09:00:00Z');
    expect(await run('PUT', '/coach/sessions/solo/:id/attendance', coach1, { id: early }, { mark: 'present' })).toMatchObject({ ok: false, status: 409, code: 'not_ended' });
    const b = await solo(C1, '2026-12-10T00:00:00Z');
    expect(await run('PUT', '/coach/sessions/solo/:id/attendance', coach1, { id: b }, { mark: 'maybe' })).toMatchObject({ ok: false, status: 400, code: 'invalid_mark' });
    expect(await run('PUT', '/coach/sessions/solo/:id/attendance', coach1, { id: b }, { mark: 'absent' })).toMatchObject({ ok: true, body: { mark: 'absent', changed: true } });
    expect(await run('PUT', '/coach/sessions/solo/:id/attendance', coach1, { id: b }, { mark: 'absent' })).toMatchObject({ ok: true, body: { changed: false } });
    for (const body of [undefined, {}, { mark: 1 }, { mark: 'present', extra: 1 }, { bookingId: b, mark: 'present' }]) {
      expect(await run('PUT', '/coach/sessions/solo/:id/attendance', coach1, { id: b }, body), JSON.stringify(body)).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
    }
    const g = await group(C1, '2026-12-10T00:00:00Z', [P1, P2]);
    const other = await group(C1, '2026-12-10T01:00:00Z', [P1]);
    expect(await run('PUT', '/coach/sessions/group/:id/attendance', coach1, { id: g.session }, { bookingId: g.seats[0], mark: 'present' })).toMatchObject({ ok: true, body: { mark: 'present' } });
    expect(await run('PUT', '/coach/sessions/group/:id/attendance', coach1, { id: g.session }, { bookingId: other.seats[0], mark: 'present' })).toMatchObject({ ok: false, status: 404 });
    expect(await run('PUT', '/coach/sessions/group/:id/attendance', coach1, { id: g.session }, { bookingId: 'nope', mark: 'present' })).toMatchObject({ ok: false, status: 400 });
    expect(await run('PUT', '/coach/sessions/group/:id/attendance', sess(C2, ['coach', 'player']), { id: g.session }, { bookingId: g.seats[1], mark: 'present' })).toMatchObject({ ok: false, status: 404 });
    expect(bodyOf(await run('GET', '/coach/sessions/group/:id', coach1, { id: g.session })).marked).toBe(1);
    for (const s of [sess(OWNER, ['owner', 'coach', 'player']), sess(DESK, ['front_desk', 'player'])]) {
      expect(await run('GET', '/staff/bookings/:id/attendance', s, { id: b })).toMatchObject({ ok: true, body: { mark: 'absent', coach_name: 'Coach One' } });
    }
    expect(await run('GET', '/staff/bookings/:id/attendance', sess(DESK, ['front_desk', 'player']), { id: early })).toMatchObject({ ok: true, body: { mark: null, coach_name: null } });
    for (const s of [sess(ACC, ['accountant', 'player']), coach1, sess(P1, ['player'])]) expect(await run('GET', '/staff/bookings/:id/attendance', s, { id: b })).toMatchObject({ ok: false, status: 403 });
  });
  it('a paid month refuses a change with 409 month_paid', async () => {
    const b = await solo(C1, '2026-12-10T00:00:00Z');
    await run('PUT', '/coach/sessions/solo/:id/attendance', coach1, { id: b }, { mark: 'present' });
    await raw((c) => c.query(`insert into public.coach_payout (club_id, coach_id, month, status, amount_satang, paid_by, paid_at) values ($1,$2,'2026-12-01','paid',0,$3,now())`, [A, C1, DESK]));
    expect(await run('PUT', '/coach/sessions/solo/:id/attendance', coach1, { id: b }, { mark: 'absent' })).toMatchObject({ ok: false, status: 409, code: 'month_paid' });
  });
  it('notes: saved, shown, replaced, deleted by a blank body; bodies are validated; another coach cannot write', async () => {
    const b = await solo(C1, '2026-12-10T00:00:00Z');
    expect(await run('PUT', '/coach/sessions/solo/:id/note', coach1, { id: b }, { customerId: null, body: 'rally drills' })).toMatchObject({ ok: true, body: { saved: true } });
    expect(await run('PUT', '/coach/sessions/solo/:id/note', coach1, { id: b }, { customerId: P1, body: 'split step' })).toMatchObject({ ok: true });
    expect(bodyOf(await run('GET', '/coach/sessions/solo/:id', coach1, { id: b }))).toMatchObject({ session_note: 'rally drills', roster: [{ note: 'split step' }] });
    expect(await run('PUT', '/coach/sessions/solo/:id/note', coach1, { id: b }, { customerId: P1, body: '  ' })).toMatchObject({ ok: true, body: { deleted: true } });
    expect(await run('PUT', '/coach/sessions/solo/:id/note', coach1, { id: b }, { customerId: P2, body: 'x' })).toMatchObject({ ok: false, status: 400, code: 'invalid_customer' });
    expect(await run('PUT', '/coach/sessions/solo/:id/note', coach1, { id: b }, { customerId: null, body: 'x'.repeat(2001) })).toMatchObject({ ok: false, status: 400, code: 'body_too_long' });
    expect(await run('PUT', '/coach/sessions/solo/:id/note', sess(C2, ['coach', 'player']), { id: b }, { customerId: null, body: 'x' })).toMatchObject({ ok: false, status: 404 });
    const future = await solo(C1, '2026-12-10T09:00:00Z');
    expect(await run('PUT', '/coach/sessions/solo/:id/note', coach1, { id: future }, { customerId: null, body: 'x' })).toMatchObject({ ok: false, status: 409, code: 'not_started' });
    for (const body of [undefined, {}, { body: 'x' }, { customerId: null }, { customerId: 'nope', body: 'x' }, { customerId: null, body: 5 }, { customerId: null, body: 'x', extra: 1 }]) {
      expect(await run('PUT', '/coach/sessions/solo/:id/note', coach1, { id: b }, body), JSON.stringify(body)).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
    }
  });
});

describe('K6 earnings (CPORT-06)', () => {
  it('the month with its adjustments, past payouts, a null amount stays null, bad months are 400, no coach is a parameter', async () => {
    await tdb.query(`insert into public.coach_pay (club_id, coach_id, monthly_base_satang, solo_pay_kind, solo_pay_value) values ($1,$2,100000,'fixed',30000), ($1,$3,555555,'fixed',999)`, [A, C1, C2]);
    await solo(C1, '2026-12-05T05:00:00Z');
    const e = bodyOf(await run('GET', '/coach/earnings', coach1, { month: '2026-12' }));
    expect(e.earnings).toMatchObject({ month: '2026-12-01', status: 'open', solo_sessions: 1, amount_satang: 130000, total_satang: 130000, solo_rate: { kind: 'fixed', value: 30000 } });
    expect(e.adjustments).toEqual([]);
    expect(JSON.stringify(e)).not.toMatch(/555555|999/);
    await tdb.query(`delete from public.coach_pay where coach_id = $1`, [C1]);
    expect(bodyOf(await run('GET', '/coach/earnings', coach1, { month: '2026-12-01' })).earnings).toMatchObject({ amount_satang: null, total_satang: null, flags: ['solo_pay_unset'] });
    for (const bad of [{}, { month: '2026-13' }, { month: 'x' }, { month: '2026-12-15' }]) expect(await run('GET', '/coach/earnings', coach1, bad), JSON.stringify(bad)).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
    expect(bodyOf(await run('GET', '/coach/earnings', coach1, { month: '2026-12', coachId: C2 })).earnings.solo_rate).toBeNull();   // a coachId is ignored
    expect(bodyOf(await run('GET', '/coach/earnings/history', coach1))).toEqual([]);
  });
});
