import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { playerClassRoutes, publicClassRoutes } from './routes';

// F08-T12: public and player class routes (CLASS-01-AC5 to AC8; CLASS-02-AC1, AC3, AC7, AC8, AC12; WAIT-01-AC1; D84).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const COACH2 = 'e1e1e1e1-0000-4000-8000-000000000008';
const OWNER = '44444444-4444-4444-8444-444444444444';
const ADULT = '22222222-2222-4222-8222-222222222222';
const KID = '11111111-1111-4111-8111-111111111111';
const P = Array.from({ length: 4 }, (_, i) => `00000000-0000-4000-8000-0000000006${String(i).padStart(2, '0')}`);
const deps = { hasFeature: async () => true };
const SLUGS: Record<string, string> = { 'club-a': A, 'club-b': B };
let tdb: TestDatabase;
let db: Db;
let pub: ReturnType<typeof publicClassRoutes>;
let player: ReturnType<typeof playerClassRoutes>;
let adultClass: string;
let studentClass: string;
const find = (list: { def: { method: string; path: string } }[], method: string, path: string) => list.find((r) => r.def.method === method && r.def.path === path)! as ReturnType<typeof publicClassRoutes>[number];
const me = (userId: string) => ({ clubId: A, userId, roles: ['player' as const] });
const call = (list: typeof pub, method: string, path: string, session: ReturnType<typeof me> | null, input: Record<string, unknown> = {}, body?: unknown) =>
  find(list, method, path).handle({ session, input: { slug: 'club-a', ...input }, body }, deps);

async function person(id: string, roles: string[], dob: string | null = '1990-01-01') {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, date_of_birth) values ($1,$2,$3,$4)`, [A, id, 'L' + id, dob]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [A, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
async function seat(customer: string, sess = adultClass) {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id;
  const s = (await tdb.query(`select start_at, end_at, resource_id from public.class_session where id = $1`, [sess])).rows[0];
  return (await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, class_session_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at) values ($1,$2,'class_seat',$3,$4,$5,$6,$7,'confirmed','online',$7,app.now()) returning id`,
    [A, order, s.resource_id, sess, s.start_at, s.end_at, customer])).rows[0].id as string;
}
const advance = async (sess: string) => {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.club_id', $1, true)`, [A]);
    await c.query('set local role booq_owner');
    await c.query(`select app.waitlist_advance($1, null, null)`, [sess]);
    await c.query('commit');
  } finally {
    c.release();
  }
};

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-11-30T03:00:00Z');   // Monday 10:00 Bangkok
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'Court 1','tennis'), ($1,$4,$3,'Court 2','tennis')`, [A, C1, LOC, C2]);
  await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) select $1, d, '06:00', '24:00' from generate_series(1, 7) d`, [A]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15'), ($1,'waitlist_claim_minutes','30'), ($1,'waitlist_no_offer_hours','2')`, [A]);
  await person(OWNER, ['owner', 'player'], null);
  await person(ADULT, ['player']);
  await person(KID, ['player'], '2012-05-17');
  for (const p of P) await person(p, ['player']);
  await tdb.seedCoach(A, COACH);
  await tdb.seedCoach(A, COACH2);
  const t1 = (await tdb.query(`insert into public.class_template (club_id, name_th, name_en, audience, level, coach_id, resource_id, weekday, start_time, min_players, max_players, drop_in_price_satang, created_by) values ($1,'ผู้ใหญ่','Adults','adult','Beginner',$2,$3,3,'18:00',2,2,30000,$4) returning id`, [A, COACH, C1, OWNER])).rows[0].id;
  const t2 = (await tdb.query(`insert into public.class_template (club_id, name_th, name_en, audience, level, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by) values ($1,'เยาวชน','Juniors','student','Advanced',$2,$3,4,'16:00',2,4,$4) returning id`, [A, COACH2, C2, OWNER])).rows[0].id;
  db = createDb({ connectionString: tdb.url, max: 6 });
  await db.withClubTx({ clubId: A, userId: OWNER, roles: ['owner'] as never, source: 'admin' }, (tx) => tx.query(`select app.generate_sessions('2026-11-30'::date, '2026-12-31'::date)`));
  adultClass = (await tdb.query(`select id from public.class_session where template_id = $1 order by start_at limit 1`, [t1])).rows[0].id;
  studentClass = (await tdb.query(`select id from public.class_session where template_id = $1 order by start_at limit 1`, [t2])).rows[0].id;
  const d = { db, now: () => new Date('2026-11-30T03:00:00Z'), clubBySlug: async (slug: string) => (SLUGS[slug] ? { clubId: SLUGS[slug]! } : null) };
  pub = publicClassRoutes(d);
  player = playerClassRoutes(d);
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('GET /classes and /classes/:id (CLASS-01-AC5 to AC8, D84)', () => {
  it('are public and answered with no-store', () => {
    expect(pub.map((r) => `${r.def.method} ${r.def.path}`)).toEqual(['GET /classes', 'GET /classes/:id']);
    for (const r of pub) {
      expect(r.def.public).toBe(true);
      expect(r.headers).toEqual({ 'Cache-Control': 'no-store' });
    }
  });

  it('a guest sees the Adult classes of the week with counts and the drop in price, and no Student class', async () => {
    const r = await call(pub, 'GET', '/classes', null, { from: '2026-11-30', to: '2026-12-06' });
    if (!r.ok) throw new Error(r.code);
    const rows = r.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionId: adultClass, nameEn: 'Adults', audience: 'adult', level: 'Beginner', coachName: expect.any(String), courtName: 'Court 1', minPlayers: 2, maxPlayers: 2, spotsLeft: 2, full: false, waitlist: false, dropInPriceSatang: 30000 });
    expect(Object.keys(rows[0]!).sort()).toEqual(['audience', 'coachName', 'courtName', 'dropInPriceSatang', 'endAt', 'full', 'level', 'maxPlayers', 'minPlayers', 'nameEn', 'nameTh', 'sessionId', 'spotsLeft', 'startAt', 'waitlist']);
  });

  it('a player under 18 sees the Student classes; an adult does not; a level filter narrows', async () => {
    const kid = await call(pub, 'GET', '/classes', me(KID), { from: '2026-11-30', to: '2026-12-06' });
    expect(((kid.ok ? kid.body : []) as Array<{ audience: string }>).map((c) => c.audience)).toEqual(['student']);
    const adult = await call(pub, 'GET', '/classes', me(ADULT), { from: '2026-11-30', to: '2026-12-06' });
    expect(((adult.ok ? adult.body : []) as Array<{ audience: string }>).map((c) => c.audience)).toEqual(['adult']);
    const lvl = await call(pub, 'GET', '/classes', me(ADULT), { from: '2026-11-30', to: '2026-12-13', level: 'Advanced' });
    expect(lvl).toMatchObject({ ok: true, body: [] });
  });

  it('detail: a class outside the caller’s audience is not found, the same as an unknown id; the caller’s own place is shown', async () => {
    expect(await call(pub, 'GET', '/classes/:id', null, { id: studentClass })).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(await call(pub, 'GET', '/classes/:id', me(ADULT), { id: studentClass })).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(await call(pub, 'GET', '/classes/:id', me(ADULT), { id: '99999999-9999-4999-8999-999999999999' })).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(await call(pub, 'GET', '/classes/:id', me(KID), { id: studentClass })).toMatchObject({ ok: true, body: { sessionId: studentClass, myEntry: null } });
    await seat(P[0]!); await seat(P[1]!);
    await call(player, 'POST', '/classes/:id/waitlist', me(ADULT), { id: adultClass });
    expect(await call(pub, 'GET', '/classes/:id', me(ADULT), { id: adultClass })).toMatchObject({ ok: true, body: { full: true, waitlist: true, myEntry: { status: 'waiting', position: 1 } } });
    expect(await call(pub, 'GET', '/classes/:id', null, { id: adultClass })).toMatchObject({ ok: true, body: { full: true, myEntry: null } });
  });

  it('a bad range or level is bad input; another club’s slug and an unknown slug are not found', async () => {
    expect(await call(pub, 'GET', '/classes', null, { from: 'x' })).toEqual({ ok: false, status: 400, code: 'bad_input' });
    expect(await call(pub, 'GET', '/classes', null, { from: '2026-12-06', to: '2026-12-01' })).toEqual({ ok: false, status: 400, code: 'bad_input' });
    expect(await call(pub, 'GET', '/classes', null, { from: '2026-12-01', to: '2027-02-01' })).toEqual({ ok: false, status: 400, code: 'bad_input' });
    expect(await find(pub, 'GET', '/classes').handle({ session: null, input: { slug: 'nope' } }, deps)).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(await find(pub, 'GET', '/classes').handle({ session: me(ADULT), input: { slug: 'club-b' } }, deps)).toEqual({ ok: false, status: 404, code: 'not_found' });
  });
});

describe('the waitlist routes (CLASS-02-AC1, AC8, AC12; WAIT-01-AC1)', () => {
  it('join: a full class adds the player with a position, a free one answers not_full, a seat holder already_seated, a guest signs in first', async () => {
    expect(await call(player, 'POST', '/classes/:id/waitlist', me(ADULT), { id: adultClass })).toEqual({ ok: false, status: 409, code: 'not_full' });
    await seat(P[0]!); await seat(P[1]!);
    const joined = await call(player, 'POST', '/classes/:id/waitlist', me(ADULT), { id: adultClass });
    expect(joined).toMatchObject({ ok: true, body: { entryId: expect.any(String) } });
    expect(await call(player, 'POST', '/classes/:id/waitlist', me(P[0]!), { id: adultClass })).toEqual({ ok: false, status: 409, code: 'already_seated' });
    expect(await call(player, 'POST', '/classes/:id/waitlist', me(KID), { id: adultClass })).toEqual({ ok: false, status: 403, code: 'class_not_for_you' });
    expect(await find(player, 'POST', '/classes/:id/waitlist').handle({ session: null, input: { slug: 'club-a', id: adultClass } }, deps)).toMatchObject({ ok: false, status: 401 });
  });

  it('My waitlist shows only the caller’s own entries with their own place, no other player', async () => {
    await seat(P[0]!); await seat(P[1]!);
    await call(player, 'POST', '/classes/:id/waitlist', me(ADULT), { id: adultClass });
    await call(player, 'POST', '/classes/:id/waitlist', me(P[2]!), { id: adultClass });
    const mine = await call(player, 'GET', '/me/waitlist', me(P[2]!));
    expect(mine).toMatchObject({ ok: true, body: [{ kind: 'class_session', sessionId: adultClass, status: 'waiting', position: 2, className: { en: 'Adults' }, courtName: 'Court 1', offerExpiresAt: null }] });
    expect(JSON.stringify(mine)).not.toContain(ADULT);
    expect(await call(player, 'GET', '/me/waitlist', me(P[3]!))).toMatchObject({ ok: true, body: [] });
  });

  it('a court slot: join a taken hour, see it in My waitlist, not_taken for a free hour', async () => {
    const slot = '2026-12-05T20:00:00+07:00';
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P[0]])).rows[0].id;
    const b = (await tdb.query(`insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at) values ($1,$2,'court',$3,$4::timestamptz,$4::timestamptz + interval '1 hour',$5,'confirmed','online',$5, app.now()) returning id`, [A, order, C2, slot, P[0]])).rows[0].id;
    await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, booking_id) values ($1,'court_booking',$2,$3::timestamptz,$3::timestamptz + interval '1 hour','confirmed',$4)`, [A, C2, slot, b]);
    expect(await call(player, 'POST', '/schedule/waitlist', me(ADULT), {}, { resourceId: C1, startAt: slot })).toEqual({ ok: false, status: 409, code: 'not_taken' });
    expect(await call(player, 'POST', '/schedule/waitlist', me(ADULT), {}, { resourceId: C2, startAt: slot })).toMatchObject({ ok: true });
    expect(await call(player, 'GET', '/me/waitlist', me(ADULT))).toMatchObject({ ok: true, body: [{ kind: 'court_slot', resourceId: C2, courtName: 'Court 2', status: 'waiting', position: 1 }] });
    expect(await call(player, 'POST', '/schedule/waitlist', me(ADULT), {}, { resourceId: 'x', startAt: slot })).toEqual({ ok: false, status: 400, code: 'bad_input' });
  });

  it('leave: the player’s own entry ends; another player’s is not found', async () => {
    await seat(P[0]!); await seat(P[1]!);
    const j = await call(player, 'POST', '/classes/:id/waitlist', me(ADULT), { id: adultClass });
    const entryId = (j.ok && (j.body as { entryId: string }).entryId)!;
    expect(await call(player, 'DELETE', '/me/waitlist/:id', me(P[2]!), { id: entryId })).toEqual({ ok: false, status: 404, code: 'entry_not_found' });
    expect(await call(player, 'DELETE', '/me/waitlist/:id', me(ADULT), { id: entryId })).toMatchObject({ ok: true, body: { left: true } });
    expect(await call(player, 'GET', '/me/waitlist', me(ADULT))).toMatchObject({ ok: true, body: [] });
  });
});

describe('an open offer: detail, claim, decline (CLASS-02-AC2, AC3, AC4, AC7)', () => {
  let entryId: string;
  let freed: string;
  beforeEach(async () => {
    freed = await seat(P[0]!); await seat(P[1]!);
    const j = await call(player, 'POST', '/classes/:id/waitlist', me(ADULT), { id: adultClass });
    entryId = j.ok ? (j.body as { entryId: string }).entryId : '';
    await call(player, 'POST', '/classes/:id/waitlist', me(P[2]!), { id: adultClass });
    await tdb.query(`update public.booking set status = 'cancelled' where id = $1`, [freed]);
    await advance(adultClass);
  });

  it('the offer shows its end time and the held booking and order Pay takes', async () => {
    const r = await call(player, 'GET', '/me/waitlist/:id', me(ADULT), { id: entryId });
    expect(r).toMatchObject({ ok: true, body: { status: 'offered', position: 1, offerExpiresAt: '2026-11-30T03:30:00.000Z', offer: { orderId: expect.any(String), bookingId: expect.any(String), holdExpiresAt: '2026-11-30T03:30:00.000Z' } } });
  });

  it('claim returns the offer’s order and booking and takes no second seat; it is the owner’s alone', async () => {
    const before = (await tdb.query(`select count(*)::int as n from public.booking`)).rows[0].n;
    const r = await call(player, 'POST', '/me/waitlist/:id/claim', me(ADULT), { id: entryId });
    expect(r).toMatchObject({ ok: true, body: { orderId: expect.any(String), bookingId: expect.any(String) } });
    expect((await tdb.query(`select count(*)::int as n from public.booking`)).rows[0].n).toBe(before);
    expect(await call(player, 'POST', '/me/waitlist/:id/claim', me(P[2]!), { id: entryId })).toEqual({ ok: false, status: 404, code: 'not_found' });
  });

  it('after the offer ends the claim answers spot_gone, for the one who lost it and for a declined offer', async () => {
    await tdb.advance('31 minutes');
    await db.withClubTx({ clubId: A, userId: null, roles: [], source: 'job' }, (tx) => tx.query(`select 1`));
    const worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
    await worker.withClubTx({ clubId: A, userId: null, roles: [], source: 'job' }, (tx) => tx.query(`select app.offer_expire($1)`, [entryId]));
    await worker.end();
    expect(await call(player, 'POST', '/me/waitlist/:id/claim', me(ADULT), { id: entryId })).toEqual({ ok: false, status: 409, code: 'spot_gone' });
  });

  it('decline ends the offer and the next in line gets it; a second decline is not found', async () => {
    expect(await call(player, 'POST', '/me/waitlist/:id/decline', me(ADULT), { id: entryId })).toMatchObject({ ok: true, body: { declined: true } });
    expect(await call(player, 'GET', '/me/waitlist', me(P[2]!))).toMatchObject({ ok: true, body: [{ status: 'offered' }] });
    expect(await call(player, 'POST', '/me/waitlist/:id/decline', me(ADULT), { id: entryId })).toEqual({ ok: false, status: 404, code: 'entry_not_found' });
    expect(await call(player, 'POST', '/me/waitlist/:id/claim', me(ADULT), { id: entryId })).toEqual({ ok: false, status: 409, code: 'spot_gone' });
  });
});

describe('no route takes a seat on its own', () => {
  it('declares no route that creates a booking: the player routes only join, leave, read, claim and decline', () => {
    expect(player.map((r) => `${r.def.method} ${r.def.path}`)).toEqual([
      'POST /classes/:id/waitlist', 'POST /schedule/waitlist', 'GET /me/waitlist', 'GET /me/waitlist/:id', 'DELETE /me/waitlist/:id', 'POST /me/waitlist/:id/claim', 'POST /me/waitlist/:id/decline',
    ]);
    for (const r of player) expect(r.def.needsPerson).toBe(true);
  });
});
