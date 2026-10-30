import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F07-T08 / migration 0808: who reads the F07 tables (CC-1, CC-3, PDPA-01, R2-AC6, CC-2; design 10).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER = '44444444-4444-4444-8444-444444444444';
const DESK = '33333333-3333-4333-8333-333333333333';
const ACC = '66666666-6666-4666-8666-666666666666';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const COACH2 = 'e1e1e1e1-0000-4000-8000-000000000008';
const BCOACH = 'e2e2e2e2-0000-4000-8000-000000000007';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const RES = '00000000-0000-4000-8000-0000000000c1';
let tdb: TestDatabase;
let db: Db;

const TABLES = ['coach', 'coach_availability_rule', 'coach_leave', 'coach_price_override', 'coach_pay', 'booking_coach_add', 'coach_substitution'];
const who = {
  owner: [OWNER, ['owner', 'player']], desk: [DESK, ['front_desk', 'player']], accountant: [ACC, ['accountant', 'player']],
  player: [PLAYER, ['player']], guest: [null, ['guest']], coach: [COACH, ['coach', 'player']], coach2: [COACH2, ['coach', 'player']],
} as const;
type Who = keyof typeof who;
const count = (w: Who, table: string, club = A) =>
  db.withClubTx({ clubId: club, userId: who[w][0], roles: who[w][1] as never, source: 'player_app' }, async (tx) => (await tx.query(`select count(*)::int as n from public.${table}`)).rows[0]!.n as number);

async function person(club: string, id: string, roles: string[]) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [club, id, 'L' + id.slice(0, 4)]);
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
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, RES, LOC]);
  await person(A, OWNER, ['owner', 'player']);
  await person(A, DESK, ['front_desk', 'player']);
  await person(A, ACC, ['accountant', 'player']);
  await person(A, PLAYER, ['player']);
  await tdb.seedCoach(A, COACH);
  await tdb.seedCoach(A, COACH2);
  await tdb.seedCoach(B, BCOACH);
  const g = (await tdb.query(`insert into public.price_group (club_id, name_th, name_en, rule) values ($1,'ก','Adult','{"min_age": 18}') returning id`, [A])).rows[0].id;
  await tdb.query(`insert into public.coach_price_override (club_id, coach_id, price_group_id, price_satang) values ($1,$2,$3,90000)`, [A, COACH, g]);
  await tdb.query(`insert into public.coach_pay (club_id, coach_id, monthly_base_satang) values ($1,$2,1000000)`, [A, COACH]);
  for (const c of [COACH, COACH2]) {
    await tdb.query(`insert into public.coach_leave (club_id, coach_id, start_date, end_date, type, note) values ($1,$2,'2026-12-10','2026-12-10','sick','private note')`, [A, c]);
  }
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, PLAYER])).rows[0].id;
  const b = (await tdb.query(`insert into public.booking (club_id, order_id, type, resource_id, coach_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at) values ($1,$2,'solo_class',$3,$4,'2026-12-05T03:00:00Z','2026-12-05T04:00:00Z',$5,'confirmed','online',$5, app.now()) returning id`, [A, order, RES, COACH, PLAYER])).rows[0].id;
  await tdb.query(`insert into public.booking_coach_add (club_id, order_id, booking_id, coach_id, status, hold_expires_at) values ($1,$2,$3,$4,'pending',app.now() + interval '5 minutes')`, [A, order, b, COACH]);
  await tdb.query(`insert into public.coach_substitution (club_id, booking_id, from_coach_id, to_coach_id, by_staff_id, reason) values ($1,$2,$3,$4,$5,'leave')`, [A, b, COACH, COACH2, OWNER]);
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('F07 table reads by role (design 10)', () => {
  it('the owner reads everything of the club', async () => {
    expect(await count('owner', 'coach')).toBe(2);
    expect(await count('owner', 'coach_availability_rule')).toBe(14);
    expect(await count('owner', 'coach_leave')).toBe(2);
    expect(await count('owner', 'coach_price_override')).toBe(1);
    expect(await count('owner', 'coach_pay')).toBe(1);
    expect(await count('owner', 'booking_coach_add')).toBe(1);
    expect(await count('owner', 'coach_substitution')).toBe(1);
  });

  it('the front desk reads coaches, rules, adds and substitutions, but not leave notes, prices or pay', async () => {
    expect(await count('desk', 'coach')).toBe(2);
    expect(await count('desk', 'coach_availability_rule')).toBe(14);
    expect(await count('desk', 'booking_coach_add')).toBe(1);
    expect(await count('desk', 'coach_substitution')).toBe(1);
    for (const t of ['coach_leave', 'coach_price_override', 'coach_pay']) expect(await count('desk', t), t).toBe(0);
  });

  it('the front desk sees when a coach is away through the calendar view, without the type or the note', async () => {
    const rows = await db.withClubTx({ clubId: A, userId: DESK, roles: ['front_desk', 'player'] as never, source: 'player_app' }, async (tx) => (await tx.query(`select * from public.coach_leave_calendar`)).rows);
    expect(rows).toHaveLength(2);
    expect(Object.keys(rows[0]!).sort()).toEqual(['coach_id', 'end_date', 'from_hour', 'id', 'start_date', 'status', 'to_hour']);
    for (const w of ['player', 'accountant', 'coach', 'guest'] as Who[]) {
      const r = await db.withClubTx({ clubId: A, userId: who[w][0], roles: who[w][1] as never, source: 'player_app' }, async (tx) => (await tx.query(`select * from public.coach_leave_calendar`)).rows);
      expect(r, w).toEqual([]);
    }
  });

  it('the Accountant reads no F07 table, and no pay', async () => {
    for (const t of TABLES) expect(await count('accountant', t), t).toBe(0);
  });

  it('a player and a guest read no F07 table', async () => {
    for (const w of ['player', 'guest'] as Who[]) for (const t of TABLES) expect(await count(w, t), `${w} ${t}`).toBe(0);
  });

  it('a coach reads only their own row, rules, leave (with the note) and the substitutions of their own sessions; never pay or prices', async () => {
    expect(await count('coach', 'coach')).toBe(1);
    expect(await count('coach', 'coach_availability_rule')).toBe(7);
    expect(await count('coach', 'coach_leave')).toBe(1);
    expect(await count('coach', 'coach_substitution')).toBe(1);        // from COACH
    expect(await count('coach2', 'coach_substitution')).toBe(1);       // to COACH2
    for (const t of ['coach_price_override', 'coach_pay', 'booking_coach_add']) expect(await count('coach', t), t).toBe(0);
    const note = await db.withClubTx({ clubId: A, userId: COACH, roles: ['coach', 'player'] as never, source: 'player_app' }, async (tx) => (await tx.query(`select note from public.coach_leave`)).rows);
    expect(note).toEqual([{ note: 'private note' }]);
  });

  it('nobody reads another club’s rows', async () => {
    expect(await count('owner', 'coach', B)).toBe(1);   // the owner of A has the owner role only in A; in context B the policy sees club B's single coach
    expect((await db.withClubTx({ clubId: B, userId: OWNER, roles: ['owner'] as never, source: 'player_app' }, async (tx) => (await tx.query(`select id from public.coach`)).rows)).map((r) => r.id)).toEqual([BCOACH]);
  });

  it('no application role can write the F07 tables directly', async () => {
    for (const t of TABLES) {
      for (const priv of ['insert', 'update', 'delete']) {
        const ok = (await tdb.query(`select has_table_privilege('booq_app', $1, $2) as ok`, [`public.${t}`, priv])).rows[0].ok;
        expect(ok, `${t} ${priv}`).toBe(t === 'coach_pay' && priv !== 'delete');   // coach_pay: the owner's own form writes it (0802)
      }
    }
  });
});

describe('BOOQ staff read nothing of F07 (PLAT-02)', () => {
  it('the platform role has no privilege on any F07 table or view, nor on the F07 functions', async () => {
    for (const t of [...TABLES, 'coach_leave_calendar', 'coach_flagged_session', 'public_coach_card']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        expect((await tdb.query(`select has_table_privilege('booq_platform', $1, $2) as ok`, [`public.${t}`, priv])).rows[0].ok, `${t} ${priv}`).toBe(false);
      }
    }
    const fns = (await tdb.query(`select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('app','public') and (p.proname like '%coach%' or p.proname in ('f07_release', 'public_coach_times'))`)).rows;
    expect(fns.length).toBeGreaterThan(10);
    for (const f of fns) expect((await tdb.query(`select has_function_privilege('booq_platform', $1::regprocedure, 'execute') as ok`, [f.sig])).rows[0].ok, f.sig).toBe(false);
  });
});
