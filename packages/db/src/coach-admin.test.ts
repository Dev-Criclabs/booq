import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F07-T05 / migration 0805: save_coach, record_coach_consent, publish_coach_profile, set_coach_active,
// set_coach_price_override, set_availability, request_leave, decide_leave (COACH-02, R2-AC1 to AC7, R6-AC3, D120).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER = '44444444-4444-4444-8444-444444444444';
const DESK = '33333333-3333-4333-8333-333333333333';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const COACH2 = 'e1e1e1e1-0000-4000-8000-000000000008';
const BPERSON = '55555555-5555-4555-8555-555555555555';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const RES = '00000000-0000-4000-8000-0000000000c1';
let tdb: TestDatabase;
let db: Db;

const ctx = (user: string, roles: string[], club = A) => ({ clubId: club, userId: user, roles: roles as never, source: 'admin' as const });
const owner = () => ctx(OWNER, ['owner', 'player']);
const coach = (id = COACH) => ctx(id, ['coach', 'player']);
const call = async (c: ReturnType<typeof ctx>, sql: string, params: unknown[] = []) => db.withClubTx(c, async (tx) => (await tx.query(sql, params)).rows);
const row = async (sql: string, params: unknown[] = []) => (await tdb.query(sql, params)).rows[0];

async function person(club: string, id: string, roles: string[], active = true) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('insert into public.app_user (club_id, id, line_user_id, active, display_name) values ($1,$2,$3,$4,$5)', [club, id, 'L' + id.slice(0, 4), active, 'P' + id.slice(0, 4)]);
    for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await person(A, OWNER, ['owner', 'player']);
  await person(A, DESK, ['front_desk', 'player']);
  await person(A, PLAYER, ['player']);
  await person(A, COACH, ['player']);
  await person(A, COACH2, ['player']);
  await person(B, BPERSON, ['player']);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, RES, LOC]);
  db = createDb({ connectionString: tdb.url, max: 6 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

const save = (c = owner(), user = COACH, profile: unknown = {}) => call(c, `select app.save_coach($1, $2::jsonb)`, [user, JSON.stringify(profile)]);

describe('app.save_coach (R2-AC1)', () => {
  it('only the owner saves: the coach role and the row go together, nothing is published or consented', async () => {
    await save(owner(), COACH, { bio_en: 'Hi', bio_th: 'สวัสดี', specialties_en: ['serve', 'volley'], languages: ['en'], ages_levels_en: 'Kids' });
    expect(await row(`select bio_en, bio_th, specialties_en, languages, ages_levels_en, published, active, profile_consent_at from public.coach where id = $1`, [COACH]))
      .toEqual({ bio_en: 'Hi', bio_th: 'สวัสดี', specialties_en: ['serve', 'volley'], languages: ['en'], ages_levels_en: 'Kids', published: false, active: true, profile_consent_at: null });
    expect((await tdb.query(`select role from public.app_user_role where user_id = $1 order by role`, [COACH])).rows.map((r) => r.role)).toEqual(['coach', 'player']);
    for (const c of [ctx(DESK, ['front_desk', 'player']), ctx(PLAYER, ['player']), coach()]) {
      await expect(save(c, COACH2, {})).rejects.toThrow(/not allowed/);
    }
    expect((await tdb.query(`select count(*)::int as n from public.coach`)).rows[0].n).toBe(1);
  });

  it('a second save changes only the fields sent; a null clears one', async () => {
    await save(owner(), COACH, { bio_en: 'Hi', bio_th: 'x', certifications_en: 'PTR' });
    await save(owner(), COACH, { bio_en: 'New', certifications_en: null });
    expect(await row(`select bio_en, bio_th, certifications_en from public.coach where id = $1`, [COACH])).toEqual({ bio_en: 'New', bio_th: 'x', certifications_en: null });
    expect((await tdb.query(`select count(*)::int as n from public.app_user_role where user_id = $1 and role = 'coach'`, [COACH])).rows[0].n).toBe(1);
  });

  it('refuses an unknown, inactive or other club’s person, a bad tier, a URL as the photo, a non-object profile', async () => {
    await person(A, '66666666-6666-4666-8666-666666666666', ['player'], false);
    await expect(save(owner(), '99999999-9999-4999-8999-999999999999')).rejects.toThrow(/unknown person/);
    await expect(save(owner(), '66666666-6666-4666-8666-666666666666')).rejects.toThrow(/unknown person/);
    await expect(save(owner(), BPERSON)).rejects.toThrow(/unknown person/);
    await expect(save(owner(), COACH, { tier_id: '99999999-9999-4999-8999-999999999999' })).rejects.toThrow(/invalid profile/);
    await expect(save(owner(), COACH, { photo_path: 'https://x.example/a.jpg' })).rejects.toThrow(/invalid profile/);
    await expect(save(owner(), COACH, { specialties_en: 'not a list' })).rejects.toThrow(/invalid profile/);
    await expect(save(owner(), COACH, [] as never)).rejects.toThrow(/invalid profile/);
    expect((await tdb.query(`select count(*)::int as n from public.coach`)).rows[0].n).toBe(0);   // each refusal undid its coach row and role
    expect((await tdb.query(`select count(*)::int as n from public.app_user_role where role = 'coach'`)).rows[0].n).toBe(0);
  });

  it('sets the tier, and the change is audited with the profile as personal data', async () => {
    const tier = (await tdb.query(`insert into public.coach_tier (club_id, name_th, name_en) values ($1,'ก','Pro') returning id`, [A])).rows[0].id;
    await save(owner(), COACH, { tier_id: tier, bio_en: 'Secret bio' });
    const a = await row(`select actor_type, new_value, pii_new from public.audit_entry where record_type = 'coach' and action = 'update' and pii_new is not null`);
    expect(JSON.stringify(a.new_value)).not.toContain('Secret bio');
    expect(JSON.stringify(a.pii_new)).toContain('Secret bio');
  });
});

describe('consent and publish (R1-AC7, D120, CC-3)', () => {
  beforeEach(async () => {
    await save(owner(), COACH, { bio_en: 'Hi' });
  });

  it('publishing needs the consent record, or consent_required; with it the coach is public', async () => {
    await expect(call(owner(), `select app.publish_coach_profile($1, true)`, [COACH])).rejects.toThrow(/^consent_required$/);
    await call(owner(), `select app.record_coach_consent($1, true)`, [COACH]);
    expect(await row(`select profile_consent_by from public.coach where id = $1`, [COACH])).toEqual({ profile_consent_by: OWNER });
    await call(owner(), `select app.publish_coach_profile($1, true)`, [COACH]);
    expect((await tdb.query(`select count(*)::int as n from public.coach where published`)).rows[0].n).toBe(1);
    await call(owner(), `select app.publish_coach_profile($1, false)`, [COACH]);
    expect((await tdb.query(`select count(*)::int as n from public.coach where published`)).rows[0].n).toBe(0);
  });

  it('withdrawing consent unpublishes and clears the record', async () => {
    await call(owner(), `select app.record_coach_consent($1, true)`, [COACH]);
    await call(owner(), `select app.publish_coach_profile($1, true)`, [COACH]);
    await call(owner(), `select app.record_coach_consent($1, false)`, [COACH]);
    expect(await row(`select published, profile_consent_at, profile_consent_by from public.coach where id = $1`, [COACH])).toEqual({ published: false, profile_consent_at: null, profile_consent_by: null });
    await expect(call(owner(), `select app.publish_coach_profile($1, true)`, [COACH])).rejects.toThrow(/consent_required/);
  });

  it('only the owner records consent and publishes, not the coach themselves nor the front desk; an unknown coach is refused', async () => {
    for (const c of [coach(), ctx(DESK, ['front_desk', 'player'])]) {
      await expect(call(c, `select app.record_coach_consent($1, true)`, [COACH])).rejects.toThrow(/not allowed/);
      await expect(call(c, `select app.publish_coach_profile($1, true)`, [COACH])).rejects.toThrow(/not allowed/);
    }
    await expect(call(owner(), `select app.publish_coach_profile($1, true)`, [COACH2])).rejects.toThrow(/unknown coach/);
  });
});

describe('app.set_coach_active (R6-AC3, D120)', () => {
  beforeEach(async () => {
    await save(owner(), COACH);
  });
  const session = async (day: number, state: 'confirmed' | 'held', expired = false) => {
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, PLAYER])).rows[0].id;
    const start = `2026-12-${String(day).padStart(2, '0')}T03:00:00Z`;
    const end = `2026-12-${String(day).padStart(2, '0')}T04:00:00Z`;
    const hold = state === 'held' ? (expired ? `app.now() - interval '1 minute'` : `app.now() + interval '10 minutes'`) : 'null';
    const b = (await tdb.query(
      `insert into public.booking (club_id, order_id, type, resource_id, coach_id, start_at, end_at, status, source, created_by, confirmed_at, hold_expires_at)
       values ($1,$2,'solo_class',$3,$4,$5,$6,$7,'staff',$8, ${state === 'confirmed' ? 'app.now()' : 'null'}, ${hold}) returning id`,
      [A, order, RES, COACH, start, end, state === 'confirmed' ? 'confirmed' : 'awaiting_payment', OWNER])).rows[0].id;
    await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, hold_expires_at, booking_id) values ($1,'solo_class',$2,$3,$4,$5,$6, ${hold}, $7)`,
      [A, RES, COACH, start, end, state, b]);
  };

  it('deactivates a coach with nothing ahead, and reactivates', async () => {
    await call(owner(), `select app.set_coach_active($1, false)`, [COACH]);
    expect((await row(`select active from public.coach where id = $1`, [COACH])).active).toBe(false);
    await call(owner(), `select app.set_coach_active($1, true)`, [COACH]);
    expect((await row(`select active from public.coach where id = $1`, [COACH])).active).toBe(true);
  });

  it('refuses coach_has_future_sessions with a confirmed or a live held session ahead; the count is readable; past and expired do not count', async () => {
    await session(5, 'confirmed');
    await session(6, 'held');
    await session(7, 'held', true);
    expect((await call(owner(), `select app.coach_future_sessions($1) as n`, [COACH]))[0]!.n).toBe(2);
    await expect(call(owner(), `select app.set_coach_active($1, false)`, [COACH])).rejects.toThrow(/^coach_has_future_sessions$/);
    expect((await row(`select active from public.coach where id = $1`, [COACH])).active).toBe(true);
    await tdb.setNow('2026-12-10T03:00:00Z');   // all of them are in the past now
    await call(owner(), `select app.set_coach_active($1, false)`, [COACH]);
  });

  it('only the owner; an unknown coach is refused', async () => {
    await expect(call(coach(), `select app.set_coach_active($1, false)`, [COACH])).rejects.toThrow(/not allowed/);
    await expect(call(ctx(DESK, ['front_desk', 'player']), `select app.set_coach_active($1, false)`, [COACH])).rejects.toThrow(/not allowed/);
    await expect(call(owner(), `select app.set_coach_active($1, false)`, [COACH2])).rejects.toThrow(/unknown coach/);
  });
});

describe('app.set_coach_price_override (COACH-02-AC3)', () => {
  let g: string;
  beforeEach(async () => {
    await save(owner(), COACH);
    g = (await tdb.query(`insert into public.price_group (club_id, name_th, name_en, rule) values ($1,'ก','Adult','{"min_age": 18}') returning id`, [A])).rows[0].id;
  });
  const set = (price: number | null, c = owner(), group = g) => call(c, `select app.set_coach_price_override($1, $2, $3)`, [COACH, group, price]);

  it('sets, changes and removes an override; zero is a price', async () => {
    await set(90000);
    await set(0);
    expect((await row(`select price_satang from public.coach_price_override where coach_id = $1`, [COACH])).price_satang).toBe(0);
    await set(null);
    expect((await tdb.query(`select count(*)::int as n from public.coach_price_override`)).rows[0].n).toBe(0);
  });

  it('refuses a negative price, an unknown price group and anyone but the owner', async () => {
    await expect(set(-1)).rejects.toThrow(/invalid price/);
    await expect(set(100, owner(), '99999999-9999-4999-8999-999999999999')).rejects.toThrow(/unknown coach or price group/);
    await expect(set(100, coach())).rejects.toThrow(/not allowed/);
    await expect(set(100, ctx(DESK, ['front_desk', 'player']))).rejects.toThrow(/not allowed/);
  });
});

describe('app.set_availability (R2-AC2, R2-AC4, R2-AC6)', () => {
  beforeEach(async () => {
    await save(owner(), COACH);
    await save(owner(), COACH2);
  });
  const rules = [
    { kind: 'weekly', weekday: 3, start_time: '09:00', end_time: '12:00' },
    { kind: 'closed', on_date: '2026-12-09', start_time: '10:00', end_time: '11:00' },
  ];
  const set = (c: ReturnType<typeof ctx>, who: string, r: unknown) => call(c, `select app.set_availability($1, $2::jsonb) as n`, [who, JSON.stringify(r)]);

  it('the coach replaces their own rules; the owner replaces any coach’s', async () => {
    expect((await set(coach(), COACH, rules))[0]!.n).toBe(2);
    expect((await set(coach(), COACH, [rules[0]]))[0]!.n).toBe(1);
    expect((await tdb.query(`select count(*)::int as n from public.coach_availability_rule where coach_id = $1`, [COACH])).rows[0].n).toBe(1);
    await set(owner(), COACH2, rules);
    expect((await tdb.query(`select count(*)::int as n from public.coach_availability_rule where coach_id = $1`, [COACH2])).rows[0].n).toBe(2);
    await set(coach(), COACH, []);
    expect((await tdb.query(`select count(*)::int as n from public.coach_availability_rule where coach_id = $1`, [COACH])).rows[0].n).toBe(0);
  });

  it('a coach cannot change another coach’s rules; the front desk and a player cannot change any', async () => {
    await expect(set(coach(), COACH2, rules)).rejects.toThrow(/not allowed/);
    await expect(set(ctx(DESK, ['front_desk', 'player']), COACH, rules)).rejects.toThrow(/not allowed/);
    await expect(set(ctx(PLAYER, ['player']), COACH, rules)).rejects.toThrow(/not allowed/);
  });

  it('a bad rule refuses the whole list and keeps the old rules', async () => {
    await set(coach(), COACH, rules);
    for (const bad of [
      [{ kind: 'weekly', weekday: 7, start_time: '09:00', end_time: '12:00' }],
      [{ kind: 'weekly', weekday: 3, start_time: '09:30', end_time: '12:00' }],
      [{ kind: 'weekly', weekday: 3, start_time: '12:00', end_time: '09:00' }],
      [{ kind: 'closed', weekday: 3, start_time: '09:00', end_time: '10:00' }],
      [{ kind: 'sometimes', start_time: '09:00', end_time: '10:00' }],
      [{ kind: 'weekly', weekday: 'mon', start_time: '09:00', end_time: '10:00' }],
    ]) await expect(set(coach(), COACH, bad), JSON.stringify(bad)).rejects.toThrow(/invalid rule/);
    await expect(set(coach(), COACH, { not: 'a list' })).rejects.toThrow(/invalid rules/);
    expect((await tdb.query(`select count(*)::int as n from public.coach_availability_rule where coach_id = $1`, [COACH])).rows[0].n).toBe(2);
  });

  it('saving rules never touches a booking (COACH-01-AC8) and each change is audited', async () => {
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, PLAYER])).rows[0].id;
    await tdb.query(`insert into public.booking (club_id, order_id, type, resource_id, coach_id, start_at, end_at, status, source, created_by, confirmed_at) values ($1,$2,'solo_class',$3,$4,'2026-12-09T03:00:00Z','2026-12-09T04:00:00Z','confirmed','staff',$5, app.now())`, [A, order, RES, COACH, OWNER]);
    await set(coach(), COACH, []);
    expect((await tdb.query(`select status from public.booking`)).rows).toEqual([{ status: 'confirmed' }]);
    await set(coach(), COACH, rules);
    expect((await tdb.query(`select count(*)::int as n from public.audit_entry where record_type = 'coach_availability_rule'`)).rows[0].n).toBeGreaterThanOrEqual(2);
  });
});

describe('leave: request_leave and decide_leave (R2-AC3, R2-AC5, D120, D156)', () => {
  beforeEach(async () => {
    await save(owner(), COACH);
    await save(owner(), COACH2);
  });
  const request = (c: ReturnType<typeof ctx>, who: string, start: string, end: string, from: number | null = null, to: number | null = null, type: string | null = null, note: string | null = null) =>
    call(c, `select app.request_leave($1, $2::date, $3::date, $4::smallint, $5::smallint, $6, $7) as id`, [who, start, end, from, to, type, note]).then((r) => r[0]!.id as string);
  const decide = (c: ReturnType<typeof ctx>, id: string, approve: boolean) => call(c, `select app.decide_leave($1, $2)`, [id, approve]);

  it('a coach requests leave for themselves: pending, whole days or part of one day', async () => {
    const id = await request(coach(), COACH, '2026-12-10', '2026-12-12', null, null, 'sick', 'flu');
    expect(await row(`select status, decided_by, type, note from public.coach_leave where id = $1`, [id])).toEqual({ status: 'pending', decided_by: null, type: 'sick', note: 'flu' });
    const part = await request(coach(), COACH, '2026-12-10', '2026-12-10', 9, 12);
    expect(await row(`select from_hour, to_hour from public.coach_leave where id = $1`, [part])).toEqual({ from_hour: 9, to_hour: 12 });
  });

  it('a coach cannot request for another coach; a bad range or a past date is refused', async () => {
    await expect(request(coach(), COACH2, '2026-12-10', '2026-12-10')).rejects.toThrow(/not allowed/);
    await expect(request(ctx(PLAYER, ['player']), COACH, '2026-12-10', '2026-12-10')).rejects.toThrow(/not allowed/);
    await expect(request(coach(), COACH, '2026-12-12', '2026-12-10')).rejects.toThrow(/invalid leave/);
    await expect(request(coach(), COACH, '2026-11-30', '2026-12-02')).rejects.toThrow(/invalid leave/);
    await expect(request(coach(), COACH, '2026-12-10', '2026-12-11', 9, 12)).rejects.toThrow(/invalid leave/);   // part day on one date only
  });

  it('only the owner decides; approval blocks the hours, a decline changes nothing; a decision is final (R2-AC5)', async () => {
    const id = await request(coach(), COACH, '2026-12-10', '2026-12-10');
    await expect(decide(coach(), id, true)).rejects.toThrow(/not allowed/);
    await expect(decide(ctx(DESK, ['front_desk', 'player']), id, true)).rejects.toThrow(/not allowed/);
    await decide(owner(), id, true);
    expect(await row(`select status, decided_by from public.coach_leave where id = $1`, [id])).toEqual({ status: 'approved', decided_by: OWNER });
    await expect(decide(owner(), id, false)).rejects.toThrow(/already decided/);
    const declined = await request(coach(), COACH, '2026-12-11', '2026-12-11');
    await decide(owner(), declined, false);
    expect((await row(`select status from public.coach_leave where id = $1`, [declined])).status).toBe('declined');
    await expect(decide(owner(), '99999999-9999-4999-8999-999999999999', true)).rejects.toThrow(/unknown leave/);
  });

  it('the coach is told through the hook with the leave:{id}:{status} key', async () => {
    await tdb.query(`create table public.__hook (kind text, usr uuid, params jsonb, dedupe text)`);
    await tdb.query(`create or replace function app.coach_message_hook(p_kind text, p_user uuid, p_params jsonb, p_dedupe_key text) returns void language plpgsql security definer as $$ begin insert into public.__hook values (p_kind, p_user, p_params, p_dedupe_key); end $$`);
    await tdb.query(`grant all on public.__hook to public`);
    const id = await request(coach(), COACH, '2026-12-10', '2026-12-10');
    await decide(owner(), id, true);
    expect((await tdb.query(`select * from public.__hook`)).rows).toEqual([{ kind: 'leave_decision', usr: COACH, params: { leave_id: id, status: 'approved' }, dedupe: `leave:${id}:approved` }]);
  });

  it('a pending leave is still offered; an approved one is not (D120)', async () => {
    const id = await request(coach(), COACH, '2026-12-10', '2026-12-10');
    await tdb.query(`insert into public.coach_availability_rule (club_id, coach_id, kind, weekday, start_time, end_time) select $1,$2,'weekly',d,'00:00','24:00' from generate_series(0,6) d`, [A, COACH]);
    const tx = async () => {
      const c = await tdb.pool.connect();
      try {
        await c.query('begin');
        await c.query(`select set_config('app.club_id', $1, true)`, [A]);
        await c.query('set local role booq_owner');
        const r = (await c.query(`select app.coach_check($1,$2,array['2026-12-10T10:00:00+07:00']::timestamptz[]) as r`, [A, COACH])).rows[0].r;
        await c.query('commit');
        return r;
      } finally {
        c.release();
      }
    };
    expect(await tx()).toBeNull();
    await decide(owner(), id, true);
    expect(await tx()).toBe('coach_unavailable');
  });
});

describe('grants', () => {
  it('the functions are for booq_app only', async () => {
    for (const f of ['app.save_coach(uuid, jsonb)', 'app.record_coach_consent(uuid, boolean)', 'app.publish_coach_profile(uuid, boolean)', 'app.set_coach_active(uuid, boolean)',
      'app.set_coach_price_override(uuid, uuid, integer)', 'app.set_availability(uuid, jsonb)', 'app.request_leave(uuid, date, date, smallint, smallint, text, text)', 'app.decide_leave(uuid, boolean)']) {
      expect((await tdb.query(`select has_function_privilege('booq_app', $1, 'execute') as ok`, [f])).rows[0].ok, f).toBe(true);
      for (const r of ['booq_worker', 'booq_platform']) expect((await tdb.query(`select has_function_privilege($1, $2, 'execute') as ok`, [r, f])).rows[0].ok, `${r} ${f}`).toBe(false);
    }
  });
});
