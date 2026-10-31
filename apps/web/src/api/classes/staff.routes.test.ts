import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { staffClassRoutes } from './routes';

// F08-T13: staff class routes (CLASS-01-AC1, AC3, AC9 to AC13; CC-2; design 5.2, 8).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const COACH2 = 'e1e1e1e1-0000-4000-8000-000000000008';
const BCOACH = 'e2e2e2e2-0000-4000-8000-000000000007';
const OWNER = '44444444-4444-4444-8444-444444444444';
const DESK = '33333333-3333-4333-8333-333333333333';
const ACC = '66666666-6666-4666-8666-666666666666';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const deps = { hasFeature: async () => true };
const SLUGS: Record<string, string> = { 'club-a': A, 'club-b': B };
let tdb: TestDatabase;
let db: Db;
let routes: ReturnType<typeof staffClassRoutes>;

type Role = 'owner' | 'front_desk' | 'coach' | 'player' | 'accountant';
const as = (userId: string, ...roles: Role[]) => ({ clubId: A, userId, roles: [...roles, 'player' as const] });
const owner = () => as(OWNER, 'owner');
const desk = () => as(DESK, 'front_desk');
const find = (method: string, path: string) => routes.find((r) => r.def.method === method && r.def.path === path)!;
const call = (method: string, path: string, session: ReturnType<typeof owner> | null, input: Record<string, unknown> = {}, body?: unknown) =>
  find(method, path).handle({ session, input: { slug: 'club-a', ...input }, body }, deps);
const tplBody = (over: Record<string, unknown> = {}) => ({ nameTh: 'กลุ่ม', nameEn: 'Group', audience: 'adult', level: 'Beginner', coachId: COACH, resourceId: C1, weekday: 3, startTime: '18:00', minPlayers: 2, maxPlayers: 3, dropInPriceSatang: null, ...over });
const body = (r: Awaited<ReturnType<typeof call>>) => {
  if (!r.ok) throw new Error(`${r.status} ${r.code}`);
  return r.body as Record<string, any>;
};

async function person(id: string, roles: string[], name?: string) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, display_name, date_of_birth) values ($1,$2,$3,$4,'1990-01-01')`, [A, id, 'L' + id, name ?? 'N' + id.slice(0, 4)]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [A, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
async function seat(customer: string, sess: string) {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id;
  const s = (await tdb.query(`select start_at, end_at, resource_id from public.class_session where id = $1`, [sess])).rows[0];
  return (await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, class_session_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at) values ($1,$2,'class_seat',$3,$4,$5,$6,$7,'confirmed','online',$7,app.now()) returning id`,
    [A, order, s.resource_id, sess, s.start_at, s.end_at, customer])).rows[0].id as string;
}
const sessionsOf = async (tpl: string) => (await tdb.query(`select id, status, to_char(start_at at time zone 'Asia/Bangkok', 'MM-DD HH24:MI') as at from public.class_session where template_id = $1 order by start_at`, [tpl])).rows;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-11-30T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($1,$4,$3,'2','tennis')`, [A, C1, LOC, C2]);
  await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) select $1, d, '06:00', '24:00' from generate_series(1, 7) d`, [A]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','14'), ($1,'hold_minutes','15')`, [A]);
  await person(OWNER, ['owner', 'player'], 'Olive Owner');
  await person(DESK, ['front_desk', 'player']);
  await person(ACC, ['accountant', 'player']);
  await person(P1, ['player'], 'Pat One');
  await person(P2, ['player'], 'Pim Two');
  await tdb.seedCoach(A, COACH);
  await tdb.seedCoach(A, COACH2);
  await tdb.seedCoach(B, BCOACH);
  db = createDb({ connectionString: tdb.url, max: 6 });
  routes = staffClassRoutes({ db, now: () => new Date('2026-11-30T03:00:00Z'), clubBySlug: async (slug) => (SLUGS[slug] ? { clubId: SLUGS[slug]! } : null) });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('who may call what (design 8)', () => {
  it('declares each route with its permission', () => {
    expect(routes.map((r) => `${r.def.method} ${r.def.path} ${r.def.permission}`)).toEqual([
      'GET /staff/class-templates class.session.read', 'POST /staff/class-templates class.template', 'PUT /staff/class-templates/:id class.template',
      'GET /staff/class-sessions class.session.read', 'PUT /staff/class-sessions/:id class.session.edit', 'POST /staff/class-sessions/:id/cancel class.session.cancel',
      'POST /staff/class-sessions/:id/resolve class.session.edit', 'GET /staff/class-sessions/:id/roster class.roster.read', 'GET /staff/waitlist class.session.read',
      'GET /coach/sessions/:id/roster class.roster.read',
    ]);
  });

  it('only the owner writes templates and edits or resolves a session; a player, the Accountant, a coach and the front desk are refused', async () => {
    for (const who of [desk(), as(ACC, 'accountant'), as(COACH, 'coach'), as(P1)]) {
      expect(await call('POST', '/staff/class-templates', who, {}, tplBody()), JSON.stringify(who.roles)).toMatchObject({ ok: false, status: 403 });
      expect(await call('PUT', '/staff/class-sessions/:id', who, { id: '99999999-9999-4999-8999-999999999999' }, { nameEn: 'x' })).toMatchObject({ ok: false, status: 403 });
    }
    expect(await call('POST', '/staff/class-sessions/:id/resolve', desk(), { id: '99999999-9999-4999-8999-999999999999' })).toMatchObject({ ok: false, status: 403 });
    expect(await call('GET', '/staff/class-sessions', null)).toMatchObject({ ok: false, status: 401 });
    expect(await call('GET', '/staff/class-sessions', as(P1))).toMatchObject({ ok: false, status: 403 });
  });
});

describe('templates (CLASS-01-AC1, AC3, AC9, AC10)', () => {
  it('the owner creates a template: sessions are made for the window and listed; the front desk reads the list', async () => {
    const made = body(await call('POST', '/staff/class-templates', owner(), {}, tplBody()));
    expect(made).toMatchObject({ made: 2, needsAttention: 0 });
    const list = body(await call('GET', '/staff/class-templates', desk()));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: made['id'], nameEn: 'Group', weekday: 3, startTime: '18:00', durationMinutes: 60, minPlayers: 2, maxPlayers: 3, dropInPriceSatang: null, active: true });
    const sessions = body(await call('GET', '/staff/class-sessions', desk(), { from: '2026-11-30', to: '2026-12-31' }));
    expect(sessions.map((s: { status: string }) => s.status)).toEqual(['scheduled', 'scheduled']);
  });

  it('a template that clashes is refused with the dates and reasons, and nothing is saved (CLASS-01-AC3)', async () => {
    body(await call('POST', '/staff/class-templates', owner(), {}, tplBody({ nameEn: 'First' })));
    const r = await call('POST', '/staff/class-templates', owner(), {}, tplBody({ nameEn: 'Second', coachId: COACH2 }));
    expect(r).toEqual({ ok: false, status: 409, code: 'template_clash', params: { dates: '2026-12-02,2026-12-09', reasons: 'court_clash' } });
    expect((await tdb.query(`select count(*)::int as n from public.class_template`)).rows[0].n).toBe(1);
  });

  it('a coach on leave is saved and the session is flagged, not removed (CLASS-01-AC9)', async () => {
    await tdb.query(`insert into public.coach_leave (club_id, coach_id, start_date, end_date, status, decided_by, decided_at) values ($1,$2,'2026-12-09','2026-12-09','approved',$3,app.now())`, [A, COACH, OWNER]);
    const made = body(await call('POST', '/staff/class-templates', owner(), {}, tplBody()));
    expect(made).toMatchObject({ made: 2, needsAttention: 1 });
    const flagged = body(await call('GET', '/staff/class-sessions', desk(), { status: 'needs_attention', from: '2026-11-30', to: '2026-12-31' }));
    expect(flagged).toMatchObject([{ attentionReason: 'coach_leave' }]);
  });

  it('refuses 90 minutes, an unknown field, a half hour, a bad weekday, min over max, and a coach or court of another club', async () => {
    for (const bad of [{ durationMinutes: 90 }, { surprise: 1 }, { startTime: '18:30' }, { weekday: 7 }, { minPlayers: 5, maxPlayers: 3 }, { audience: 'kids' }, { nameEn: '' }, { dropInPriceSatang: -5 }]) {
      expect(await call('POST', '/staff/class-templates', owner(), {}, tplBody(bad)), JSON.stringify(bad)).toEqual({ ok: false, status: 400, code: 'bad_input' });
    }
    expect(await call('POST', '/staff/class-templates', owner(), {}, tplBody({ coachId: BCOACH }))).toEqual({ ok: false, status: 400, code: 'bad_input' });
    expect(await call('POST', '/staff/class-templates', owner(), {}, 'nope')).toEqual({ ok: false, status: 400, code: 'bad_input' });
    expect((await tdb.query(`select count(*)::int as n from public.class_template`)).rows[0].n).toBe(0);
  });

  it('editing a template rewrites the future sessions with no seat and leaves one with players (CLASS-01-AC10)', async () => {
    const id = body(await call('POST', '/staff/class-templates', owner(), {}, tplBody()))['id'] as string;
    const [first] = await sessionsOf(id);
    await seat(P1, first.id);
    const r = body(await call('PUT', '/staff/class-templates/:id', owner(), { id }, { nameEn: 'Renamed', maxPlayers: 5 }));
    expect(r).toMatchObject({ rewritten: 1 });
    expect((await tdb.query(`select id, name_en, max_players from public.class_session where template_id = $1 order by start_at`, [id])).rows.map((x) => [x.name_en, x.max_players])).toEqual([['Group', 3], ['Renamed', 5]]);
  });

  it('ending a template cancels its future sessions one by one and makes no more', async () => {
    const id = body(await call('POST', '/staff/class-templates', owner(), {}, tplBody()))['id'] as string;
    const [first] = await sessionsOf(id);
    await seat(P1, first.id);
    const r = body(await call('PUT', '/staff/class-templates/:id', owner(), { id }, { end: true }));
    expect(r).toMatchObject({ ended: true, cancelled: 2, failed: 0 });
    expect((await sessionsOf(id)).map((s) => s.status)).toEqual(['cancelled', 'cancelled']);
    expect((await tdb.query(`select active, ended_on::text as d from public.class_template where id = $1`, [id])).rows[0]).toEqual({ active: false, d: '2026-11-30' });
    expect(await call('PUT', '/staff/class-templates/:id', owner(), { id }, { end: true })).toEqual({ ok: false, status: 404, code: 'not_found' });
  });
});

describe('sessions (CLASS-01-AC10 to AC13)', () => {
  let tpl: string;
  let s1: string;
  beforeEach(async () => {
    tpl = body(await call('POST', '/staff/class-templates', owner(), {}, tplBody()))['id'] as string;
    s1 = (await sessionsOf(tpl))[0].id;
  });

  it('the list shows seats taken and the waiting count; the range and the status are checked', async () => {
    await seat(P1, s1); await seat(P2, s1);
    const r = body(await call('GET', '/staff/class-sessions', desk(), { from: '2026-11-30', to: '2026-12-06' }));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: s1, taken: 2, waiting: 0, status: 'scheduled', maxPlayers: 3, edited: false });
    expect(await call('GET', '/staff/class-sessions', desk(), { from: 'x' })).toEqual({ ok: false, status: 400, code: 'bad_input' });
    expect(await call('GET', '/staff/class-sessions', desk(), { status: 'weird' })).toEqual({ ok: false, status: 400, code: 'bad_input' });
  });

  it('the owner edits a session: it is marked edited; a clash or a cut below the seats taken is refused with its code', async () => {
    await seat(P1, s1); await seat(P2, s1);
    expect(await call('PUT', '/staff/class-sessions/:id', owner(), { id: s1 }, { nameEn: 'Special' })).toMatchObject({ ok: true, body: { edited: true } });
    expect((await tdb.query(`select name_en, edited from public.class_session where id = $1`, [s1])).rows[0]).toEqual({ name_en: 'Special', edited: true });
    expect(await call('PUT', '/staff/class-sessions/:id', owner(), { id: s1 }, { maxPlayers: 1, minPlayers: 1 })).toEqual({ ok: false, status: 409, code: 'below_taken' });
    expect(await call('PUT', '/staff/class-sessions/:id', owner(), { id: s1 }, { startAt: '2026-12-02T05:00:00+07:00' })).toEqual({ ok: false, status: 400, code: 'outside_hours' });
    expect(await call('PUT', '/staff/class-sessions/:id', owner(), { id: s1 }, { audience: 'student' })).toEqual({ ok: false, status: 400, code: 'bad_input' });
    expect(await call('PUT', '/staff/class-sessions/:id', owner(), { id: s1 }, {})).toEqual({ ok: false, status: 400, code: 'bad_input' });
  });

  it('the front desk cancels with a reason; the seats are returned and the court is free; a missing reason is bad input', async () => {
    await seat(P1, s1);
    expect(await call('POST', '/staff/class-sessions/:id/cancel', desk(), { id: s1 }, {})).toEqual({ ok: false, status: 400, code: 'bad_input' });
    expect(await call('POST', '/staff/class-sessions/:id/cancel', desk(), { id: s1 }, { reason: 'template' })).toEqual({ ok: false, status: 400, code: 'bad_input' });
    const r = await call('POST', '/staff/class-sessions/:id/cancel', desk(), { id: s1 }, { reason: 'owner' });
    expect(r).toMatchObject({ ok: true, body: { seats: 1, entries: 0 } });
    expect((await tdb.query(`select status, cancel_reason from public.class_session where id = $1`, [s1])).rows[0]).toEqual({ status: 'cancelled', cancel_reason: 'owner' });
    expect((await tdb.query(`select count(*)::int as n from public.occupancy where class_session_id = $1`, [s1])).rows[0].n).toBe(0);
    expect(await call('POST', '/staff/class-sessions/:id/cancel', desk(), { id: '99999999-9999-4999-8999-999999999999' }, { reason: 'owner' })).toEqual({ ok: false, status: 404, code: 'session_not_available' });
  });

  it('the owner resolves a flagged session once the cause is gone', async () => {
    const leave = (await tdb.query(`insert into public.coach_leave (club_id, coach_id, start_date, end_date, status, decided_by, decided_at) values ($1,$2,'2026-12-09','2026-12-09','approved',$3,app.now()) returning id`, [A, COACH, OWNER])).rows[0].id;
    const second = (await sessionsOf(tpl))[1].id;
    await tdb.query(`delete from public.occupancy where class_session_id = $1`, [second]);
    await tdb.query(`update public.class_session set status = 'needs_attention', attention_reason = 'coach_leave' where id = $1`, [second]);
    expect(await call('POST', '/staff/class-sessions/:id/resolve', owner(), { id: second })).toMatchObject({ ok: true, body: { resolved: false, reason: 'coach_leave' } });
    await tdb.query(`update public.coach_leave set status = 'declined' where id = $1`, [leave]);
    expect(await call('POST', '/staff/class-sessions/:id/resolve', owner(), { id: second })).toMatchObject({ ok: true, body: { resolved: true, reason: null } });
  });
});

describe('rosters and the waitlist (design 8; CC-3)', () => {
  let s1: string;
  let s2: string;
  beforeEach(async () => {
    const t1 = body(await call('POST', '/staff/class-templates', owner(), {}, tplBody()))['id'] as string;
    const t2 = body(await call('POST', '/staff/class-templates', owner(), {}, tplBody({ nameEn: 'Other', coachId: COACH2, resourceId: C2, weekday: 4 })))['id'] as string;
    s1 = (await sessionsOf(t1))[0].id;
    s2 = (await sessionsOf(t2))[0].id;
    await seat(P1, s1); await seat(P2, s2);
  });

  it('the owner and the front desk read a roster with names and never a date of birth or contact', async () => {
    for (const who of [owner(), desk()]) {
      const r = body(await call('GET', '/staff/class-sessions/:id/roster', who, { id: s1 }));
      expect(r).toEqual([{ bookingId: expect.any(String), customerId: P1, displayName: 'Pat One', status: 'confirmed', holdExpiresAt: null }]);
    }
  });

  it('a coach reads the roster of the sessions they teach only; the Accountant and a player read none', async () => {
    expect(body(await call('GET', '/staff/class-sessions/:id/roster', as(COACH, 'coach'), { id: s1 }))).toHaveLength(1);
    expect(await call('GET', '/staff/class-sessions/:id/roster', as(COACH, 'coach'), { id: s2 })).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(body(await call('GET', '/coach/sessions/:id/roster', as(COACH2, 'coach'), { id: s2 }))[0]).toMatchObject({ displayName: 'Pim Two' });
    expect(await call('GET', '/coach/sessions/:id/roster', as(COACH2, 'coach'), { id: s1 })).toEqual({ ok: false, status: 404, code: 'not_found' });
    for (const who of [as(ACC, 'accountant'), as(P1)]) expect(await call('GET', '/staff/class-sessions/:id/roster', who, { id: s1 })).toMatchObject({ ok: false, status: 403 });
  });

  it('the staff waitlist shows names and positions of a class; a player and a coach are refused', async () => {
    await tdb.query(`insert into public.waitlist_entry (club_id, customer_id, subject_kind, class_session_id, seq) values ($1,$2,'class_session',$3,1), ($1,$4,'class_session',$3,2)`, [A, P1, s2, P2]);
    const r = body(await call('GET', '/staff/waitlist', desk(), { sessionId: s2 }));
    expect(r.map((e: { displayName: string; position: number }) => [e.displayName, e.position])).toEqual([['Pat One', 1], ['Pim Two', 2]]);
    for (const who of [as(P1), as(COACH, 'coach')]) expect(await call('GET', '/staff/waitlist', who, { sessionId: s2 })).toMatchObject({ ok: false, status: 403 });
  });

  it('another club’s slug is not found', async () => {
    expect(await find('GET', '/staff/class-sessions').handle({ session: owner(), input: { slug: 'club-b' } }, deps)).toEqual({ ok: false, status: 404, code: 'not_found' });
  });
});
