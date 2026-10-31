import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { staffCoachRoutes } from './routes';

// F07-T12: owner and coach routes (COACH-02, R2-AC1 to AC7, R4, R6, CC-2, CC-3; D120, D156).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const COACH2 = 'e1e1e1e1-0000-4000-8000-000000000008';
const NEWBIE = 'e4e4e4e4-0000-4000-8000-000000000005';
const BCOACH = 'e2e2e2e2-0000-4000-8000-000000000007';
const OWNER = '44444444-4444-4444-8444-444444444444';
const DESK = '33333333-3333-4333-8333-333333333333';
const PLAYER = '22222222-2222-4222-8222-222222222222';
const TIER = '66666666-6666-4666-8666-666666666661';
const GROUP = '77777777-7777-4777-8777-777777777771';
const deps = { hasFeature: async () => true };
const SLUGS: Record<string, string> = { 'club-a': A, 'club-b': B };
let tdb: TestDatabase;
let db: Db;
let routes: ReturnType<typeof staffCoachRoutes>;

type Roles = ('owner' | 'front_desk' | 'coach' | 'player')[];
const as = (userId: string, roles: Roles) => ({ clubId: A, userId, roles });
const owner = () => as(OWNER, ['owner', 'player']);
const desk = () => as(DESK, ['front_desk', 'player']);
const coach = (id = COACH) => as(id, ['coach', 'player']);
const call = (method: string, path: string, session: ReturnType<typeof as> | null, input: Record<string, unknown> = {}, body?: unknown) =>
  routes.find((r) => r.def.method === method && r.def.path === path)!.handle({ session, input: { slug: 'club-a', ...input }, body }, deps);
const ok = async <T>(p: Promise<{ ok: boolean; body?: unknown; code?: string }>): Promise<T> => {
  const r = await p;
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.body as T;
};
const refused = async (p: Promise<{ ok: boolean; status: number; code?: string }>) => {
  const r = await p;
  return r.ok ? null : { status: r.status, code: r.code };
};
const H = (h: number, day = 3) => new Date(`2026-12-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();

async function person(id: string, roles: string[], name: string) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, display_name, date_of_birth) values ($1,$2,$3,$4,'1990-01-01')`, [A, id, 'L' + id, name]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [A, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
async function soloBooking(h: number, coachId = COACH, court = C1) {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, PLAYER])).rows[0].id as string;
  const b = (await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, coach_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
     values ($1,$2,'solo_class',$3,$4,$5,$6,$7,'confirmed','online',$7, app.now()) returning id`, [A, order, court, coachId, H(h), H(h + 1), PLAYER])).rows[0].id as string;
  await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, booking_id) values ($1,'solo_class',$2,$3,$4,$5,'confirmed',$6)`, [A, court, coachId, H(h), H(h + 1), b]);
  return b;
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($1,$4,$3,'2','tennis')`, [A, C1, LOC, C2]);
  await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) select $1, d, '06:00', '24:00' from generate_series(1, 7) d`, [A]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [A]);
  await person(OWNER, ['owner', 'player'], 'Owner');
  await person(DESK, ['front_desk', 'player'], 'Desk');
  await person(PLAYER, ['player'], 'Player');
  await person(NEWBIE, ['player'], 'Newbie');
  await tdb.query(`insert into public.price_group (club_id, id, name_th, name_en, rule) values ($1,$2,'ผู้ใหญ่','Adult','{"min_age":18}')`, [A, GROUP]);
  await tdb.query(`insert into public.coach_tier (club_id, id, name_th, name_en) values ($1,$2,'ท','Tier')`, [A, TIER]);
  await tdb.seedCoach(A, COACH);
  await tdb.seedCoach(A, COACH2);
  await tdb.seedCoach(B, BCOACH);
  await tdb.query(`update public.app_user set display_name = 'Coach One' where id = $1`, [COACH]);
  await tdb.query(`update public.app_user set display_name = 'Coach Two' where id = $1`, [COACH2]);
  db = createDb({ connectionString: tdb.url, max: 6 });
  routes = staffCoachRoutes({ db, clubBySlug: async (slug) => (SLUGS[slug] ? { clubId: SLUGS[slug]! } : null) });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('who may use which route (A-6, CC-2)', () => {
  it('front desk reads the coach list and nothing else; a player and a guest nothing', async () => {
    expect((await ok<{ coachId: string }[]>(call('GET', '/staff/coaches', desk()))).map((c) => c.coachId).sort()).toEqual([COACH, COACH2].sort());
    for (const [m, p] of [['GET', '/staff/coaches/:id'], ['PUT', '/staff/coaches/:id'], ['GET', '/staff/coaches/:id/pay'], ['PUT', '/staff/coaches/:id/pay'],
      ['GET', '/staff/leave'], ['POST', '/staff/leave/:id/decision'], ['GET', '/staff/flagged-sessions'], ['GET', '/staff/bookings/:id/substitutes'], ['POST', '/staff/bookings/:id/substitute']] as const) {
      expect(await refused(call(m, p, desk(), { id: COACH })), `${m} ${p}`).toMatchObject({ status: 403 });
    }
    expect(await refused(call('GET', '/staff/coaches', as(PLAYER, ['player'])))).toMatchObject({ status: 403 });
    expect(await refused(call('GET', '/staff/coaches', null))).toMatchObject({ status: 401 });
  });
  it('another club slug is not found', async () => {
    expect(await refused(call('GET', '/staff/coaches', owner(), { slug: 'club-b' }))).toMatchObject({ status: 404 });
  });
});

describe('coach profile (owner)', () => {
  it('saves profile, tier, consent and publish, and an override; removing it with null', async () => {
    const r = await ok<{ published: boolean; tierId: string; overrides: unknown[]; profile: { bioEn: string; specialtiesEn: string[] } }>(call('PUT', '/staff/coaches/:id', owner(), { id: COACH }, {
      profile: { bio_en: 'Bio', specialties_en: ['serve'], languages: ['en'] }, tierId: TIER, consent: true, published: true, overrides: [{ priceGroupId: GROUP, priceSatang: 150000 }],
    }));
    expect(r).toMatchObject({ published: true, tierId: TIER, overrides: [{ priceGroupId: GROUP, priceSatang: 150000 }], profile: { bioEn: 'Bio', specialtiesEn: ['serve'] } });
    const r2 = await ok<{ overrides: unknown[] }>(call('PUT', '/staff/coaches/:id', owner(), { id: COACH }, { overrides: [{ priceGroupId: GROUP, priceSatang: null }] }));
    expect(r2.overrides).toEqual([]);
  });
  it('publishing without consent is consent_required; unknown profile key is bad input', async () => {
    expect(await refused(call('PUT', '/staff/coaches/:id', owner(), { id: COACH }, { published: true }))).toMatchObject({ status: 409, code: 'consent_required' });
    expect(await refused(call('PUT', '/staff/coaches/:id', owner(), { id: COACH }, { profile: { pay: 1 } }))).toMatchObject({ status: 400, code: 'bad_input' });
  });
  it('a person becomes a coach on first save', async () => {
    await ok(call('PUT', '/staff/coaches/:id', owner(), { id: NEWBIE }, { profile: { bio_en: 'New' } }));
    expect((await tdb.query(`select 1 from public.app_user_role where user_id = $1 and role = 'coach'`, [NEWBIE])).rowCount).toBe(1);
  });
  it('deactivating with a future session is coach_has_future_sessions', async () => {
    await soloBooking(10);
    expect(await refused(call('PUT', '/staff/coaches/:id', owner(), { id: COACH }, { active: false }))).toMatchObject({ status: 409, code: 'coach_has_future_sessions' });
  });
  it("another club's coach is not found", async () => {
    expect(await refused(call('GET', '/staff/coaches/:id', owner(), { id: BCOACH }))).toMatchObject({ status: 404 });
  });
});

describe('coach pay (owner only)', () => {
  it('returns nulls for unset values and saves the set', async () => {
    expect(await ok(call('GET', '/staff/coaches/:id/pay', owner(), { id: COACH }))).toEqual({ monthlyBaseSatang: null, soloPayKind: null, soloPayValue: null, groupPayKind: null, groupPayValue: null });
    const r = await ok(call('PUT', '/staff/coaches/:id/pay', owner(), { id: COACH }, { monthlyBaseSatang: 2000000, soloPayKind: 'percent', soloPayValue: 5000 }));
    expect(r).toEqual({ monthlyBaseSatang: 2000000, soloPayKind: 'percent', soloPayValue: 5000, groupPayKind: null, groupPayValue: null });
  });
  it('a bad pair, a percent above 100 or a bad kind is bad input', async () => {
    for (const body of [{ soloPayKind: 'fixed' }, { soloPayKind: 'percent', soloPayValue: 10001 }, { soloPayKind: 'cash', soloPayValue: 1 }, { monthlyBaseSatang: -1 }, { monthlyBaseSatang: 1.5 }]) {
      expect(await refused(call('PUT', '/staff/coaches/:id/pay', owner(), { id: COACH }, body)), JSON.stringify(body)).toMatchObject({ status: 400, code: 'bad_input' });
    }
  });
  it('a coach cannot read pay, not even their own', async () => {
    expect(await refused(call('GET', '/staff/coaches/:id/pay', coach(), { id: COACH }))).toMatchObject({ status: 403 });
  });
});

describe('availability and leave (coach, owner)', () => {
  it('a coach replaces their own rules; the rules read back', async () => {
    const rules = [{ kind: 'weekly', weekday: 1, startTime: '09:00', endTime: '12:00' }, { kind: 'closed', onDate: '2026-12-10', startTime: '10:00', endTime: '11:00' }];
    const r = await ok<{ kind: string; weekday: number | null; onDate: string | null; startTime: string; endTime: string }[]>(call('PUT', '/coach/availability', coach(), {}, { rules }));
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.kind === 'weekly')).toMatchObject({ weekday: 1, startTime: '09:00', endTime: '12:00', onDate: null });
    expect(r.find((x) => x.kind === 'closed')).toMatchObject({ onDate: '2026-12-10' });
  });
  it('a half hour or a bad rule is bad input', async () => {
    expect(await refused(call('PUT', '/coach/availability', coach(), {}, { rules: [{ kind: 'weekly', weekday: 1, startTime: '09:30', endTime: '12:00' }] }))).toMatchObject({ status: 400 });
    expect(await refused(call('PUT', '/coach/availability', coach(), {}, { rules: 'x' }))).toMatchObject({ status: 400 });
  });
  it('a coach cannot edit or read another coach; the owner can name one', async () => {
    expect(await refused(call('PUT', '/coach/availability', coach(), { coachId: COACH2 }, { rules: [] }))).toMatchObject({ status: 403 });
    expect(await refused(call('GET', '/coach/leave', coach(), { coachId: COACH2 }))).toMatchObject({ status: 403 });
    expect(await ok(call('PUT', '/coach/availability', owner(), { coachId: COACH2 }, { rules: [] }))).toEqual([]);
  });
  it('a coach requests leave in whole hours of a day and sees it pending; another coach does not', async () => {
    const { leaveId } = await ok<{ leaveId: string }>(call('POST', '/coach/leave', coach(), {}, { startDate: '2026-12-03', endDate: '2026-12-03', fromHour: 10, toHour: 12, type: 'sick', note: 'private' }));
    const mine = await ok<{ leaveId: string; status: string; fromHour: number; type: string }[]>(call('GET', '/coach/leave', coach()));
    expect(mine).toEqual([expect.objectContaining({ leaveId, status: 'pending', fromHour: 10, type: 'sick' })]);
    expect(await ok(call('GET', '/coach/leave', coach(COACH2)))).toEqual([]);
  });
  it('a past date or a half-day on several dates is bad input', async () => {
    expect(await refused(call('POST', '/coach/leave', coach(), {}, { startDate: '2026-11-01', endDate: '2026-11-01' }))).toMatchObject({ status: 400 });
    expect(await refused(call('POST', '/coach/leave', coach(), {}, { startDate: '2026-12-03', endDate: '2026-12-05', fromHour: 10, toHour: 12 }))).toMatchObject({ status: 400 });
    expect(await refused(call('POST', '/coach/leave', coach(), {}, { startDate: 'x', endDate: 'y' }))).toMatchObject({ status: 400 });
  });
  it('a player is refused', async () => {
    expect(await refused(call('GET', '/coach/leave', as(PLAYER, ['player'])))).toMatchObject({ status: 403 });
  });
});

describe("GET /staff/bookings/:id/coaches (the desk's picker, priced for the customer)", () => {
  const JUNIOR = '77777777-7777-4777-8777-777777777772';
  async function courtFor(customer: string | null, h = 10) {
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'staff') returning id`, [A, customer])).rows[0].id as string;
    const b = (await tdb.query(
      `insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
       values ($1,$2,'court',$3,$4,$5,$6,'confirmed','staff',$7, app.now()) returning id`, [A, order, C1, H(h), H(h + 1), customer, DESK])).rows[0].id as string;
    await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, booking_id) values ($1,'court_booking',$2,$3,$4,'confirmed',$5)`, [A, C1, H(h), H(h + 1), b]);
    return b;
  }
  beforeEach(async () => {
    await tdb.query(`insert into public.price_group (club_id, id, name_th, name_en, rule) values ($1,$2,'เยาวชน','Junior','{"max_age":17}')`, [A, JUNIOR]);
    await tdb.query(`update public.price_group set rule = '{"min_age":18}' where id = $1`, [GROUP]);
    await tdb.query(`update public.coach set tier_id = $1, published = true, profile_consent_at = app.now(), profile_consent_by = $4 where id in ($2,$3) and club_id = $5`, [TIER, COACH, COACH2, OWNER, A]);
    await tdb.query(`insert into public.coach_tier_price (club_id, tier_id, price_group_id, price_satang) values ($1,$2,$3,120000), ($1,$2,$4,80000)`, [A, TIER, GROUP, JUNIOR]);
    await tdb.query(`update public.app_user set date_of_birth = '2015-05-05' where id = $1`, [NEWBIE]);
  });
  const prices = (r: { coachId: string; priceSatang: number | null }[]) => Object.fromEntries(r.map((c) => [c.coachId, c.priceSatang]));
  it("each price is the customer's group price, whoever is at the desk", async () => {
    const adult = await courtFor(PLAYER);
    const junior = await courtFor(NEWBIE, 12);
    for (const s of [desk(), owner()]) {
      expect(prices(await ok(call('GET', '/staff/bookings/:id/coaches', s, { id: adult })))).toEqual({ [COACH]: 120000, [COACH2]: 120000 });
      expect(prices(await ok(call('GET', '/staff/bookings/:id/coaches', s, { id: junior })))).toEqual({ [COACH]: 80000, [COACH2]: 80000 });
    }
  });
  it('a booking with no customer gets the standard price; a busy coach is not offered', async () => {
    const walk = await courtFor(null);
    await soloBooking(10, COACH2, C2);
    expect(prices(await ok(call('GET', '/staff/bookings/:id/coaches', desk(), { id: walk })))).toEqual({ [COACH]: 120000 });
  });
  it('a booking that already has a coach, another club, a bad id; a player, a coach and a guest are refused', async () => {
    const solo = await soloBooking(14);
    expect(await refused(call('GET', '/staff/bookings/:id/coaches', desk(), { id: solo }))).toMatchObject({ status: 404 });
    expect(await refused(call('GET', '/staff/bookings/:id/coaches', desk(), { id: 'nope' }))).toMatchObject({ status: 404 });
    const b = await courtFor(PLAYER);
    expect(await refused(call('GET', '/staff/bookings/:id/coaches', as(PLAYER, ['player']), { id: b }))).toMatchObject({ status: 403 });
    expect(await refused(call('GET', '/staff/bookings/:id/coaches', coach(), { id: b }))).toMatchObject({ status: 403 });
    expect(await refused(call('GET', '/staff/bookings/:id/coaches', null, { id: b }))).toMatchObject({ status: 401 });
    expect(await refused(call('GET', '/staff/bookings/:id/coaches', owner(), { slug: 'club-b', id: b }))).toMatchObject({ status: 404 });
  });
});

describe('GET /staff/leave-calendar (front desk, owner; F11-T10)', () => {
  it('shows dates, hours and status and the coach name, never the type or the note', async () => {
    await ok(call('POST', '/coach/leave', coach(), {}, { startDate: '2026-12-03', endDate: '2026-12-04', type: 'sick', note: 'private' }));
    for (const s of [desk(), owner()]) {
      const r = await ok<{ coachName: string; startDate: string; endDate: string; status: string }[]>(call('GET', '/staff/leave-calendar', s, { from: '2026-12-01', to: '2026-12-31' }));
      expect(r).toEqual([expect.objectContaining({ coachName: 'Coach One', startDate: '2026-12-03', endDate: '2026-12-04', status: 'pending', fromHour: null })]);
      expect(JSON.stringify(r)).not.toMatch(/sick|private|type|note/);
    }
  });
  it('only leave overlapping the range; a bad range is bad input; a coach, a player and another club are refused', async () => {
    await ok(call('POST', '/coach/leave', coach(), {}, { startDate: '2026-12-03', endDate: '2026-12-03' }));
    expect(await ok(call('GET', '/staff/leave-calendar', desk(), { from: '2026-12-10', to: '2026-12-20' }))).toEqual([]);
    expect(await ok<unknown[]>(call('GET', '/staff/leave-calendar', desk(), { from: '2026-12-03', to: '2026-12-03' }))).toHaveLength(1);
    expect(await refused(call('GET', '/staff/leave-calendar', desk(), { from: '2026-12-05', to: '2026-12-01' }))).toMatchObject({ status: 400 });
    expect(await refused(call('GET', '/staff/leave-calendar', desk(), { from: 'x', to: 'y' }))).toMatchObject({ status: 400 });
    expect(await refused(call('GET', '/staff/leave-calendar', coach(), { from: '2026-12-01', to: '2026-12-02' }))).toMatchObject({ status: 403 });
    expect(await refused(call('GET', '/staff/leave-calendar', as(PLAYER, ['player']), { from: '2026-12-01', to: '2026-12-02' }))).toMatchObject({ status: 403 });
    expect(await refused(call('GET', '/staff/leave-calendar', desk(), { slug: 'club-b', from: '2026-12-01', to: '2026-12-02' }))).toMatchObject({ status: 404 });
  });
});

describe('leave decisions, flags and substitution (owner)', () => {
  it('the owner lists requests with the note, decides once; a second decision is bad input', async () => {
    const { leaveId } = await ok<{ leaveId: string }>(call('POST', '/coach/leave', coach(), {}, { startDate: '2026-12-03', endDate: '2026-12-03', type: 'sick', note: 'private' }));
    expect(await ok(call('GET', '/staff/leave', owner(), { status: 'pending' }))).toEqual([expect.objectContaining({ leaveId, note: 'private' })]);
    await ok(call('POST', '/staff/leave/:id/decision', owner(), { id: leaveId }, { approve: true }));
    expect(await ok(call('GET', '/staff/leave', owner(), { status: 'pending' }))).toEqual([]);
    expect(await refused(call('POST', '/staff/leave/:id/decision', owner(), { id: leaveId }, { approve: false }))).toMatchObject({ status: 400 });
    expect(await refused(call('POST', '/staff/leave/:id/decision', owner(), { id: leaveId }, {}))).toMatchObject({ status: 400 });
    expect(await refused(call('GET', '/staff/leave', owner(), { status: 'bogus' }))).toMatchObject({ status: 400 });
  });
  it('approved leave over a solo class flags it, deletes nothing, and the owner substitutes', async () => {
    const b = await soloBooking(10);
    const { leaveId } = await ok<{ leaveId: string }>(call('POST', '/coach/leave', coach(), {}, { startDate: '2026-12-03', endDate: '2026-12-03' }));
    await ok(call('POST', '/staff/leave/:id/decision', owner(), { id: leaveId }, { approve: true }));
    expect(await ok(call('GET', '/staff/flagged-sessions', owner()))).toEqual([expect.objectContaining({ bookingId: b, coachId: COACH, reason: 'leave' })]);
    expect((await tdb.query(`select status from public.booking where id = $1`, [b])).rows[0].status).toBe('confirmed');
    const subs = await ok<{ coachId: string }[]>(call('GET', '/staff/bookings/:id/substitutes', owner(), { id: b }));
    expect(subs.map((s) => s.coachId)).toEqual([COACH2]);
    await ok(call('POST', '/staff/bookings/:id/substitute', owner(), { id: b }, { coachId: COACH2, reason: 'leave' }));
    expect((await tdb.query(`select coach_id from public.booking where id = $1`, [b])).rows[0].coach_id).toBe(COACH2);
    expect(await ok(call('GET', '/staff/flagged-sessions', owner()))).toEqual([]);
  });
  it('a busy substitute or a bad reason is refused and changes nothing', async () => {
    const b = await soloBooking(10);
    await soloBooking(10, COACH2, C2);
    expect(await refused(call('POST', '/staff/bookings/:id/substitute', owner(), { id: b }, { coachId: COACH2, reason: 'leave' }))).toMatchObject({ status: 409 });
    expect(await refused(call('POST', '/staff/bookings/:id/substitute', owner(), { id: b }, { coachId: COACH2, reason: 'because' }))).toMatchObject({ status: 400 });
    expect((await tdb.query(`select coach_id from public.booking where id = $1`, [b])).rows[0].coach_id).toBe(COACH);
  });
  it('front desk cannot substitute or decide leave (checked above); a coach cannot either', async () => {
    const b = await soloBooking(10);
    expect(await refused(call('POST', '/staff/bookings/:id/substitute', coach(), { id: b }, { coachId: COACH2, reason: 'other' }))).toMatchObject({ status: 403 });
    expect(await refused(call('GET', '/staff/flagged-sessions', coach()))).toMatchObject({ status: 403 });
  });
});
