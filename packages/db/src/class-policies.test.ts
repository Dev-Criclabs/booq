import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F08-T09 / migration 0911: reads and writes of the F08 tables, the roster view, and the blind suite (CC-1, CC-3, PLAT-02).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const COACH2 = 'e1e1e1e1-0000-4000-8000-000000000008';
const OWNER = '44444444-4444-4444-8444-444444444444';
const DESK = '33333333-3333-4333-8333-333333333333';
const ACC = '66666666-6666-4666-8666-666666666666';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
let tdb: TestDatabase;
let db: Db;
let session: string;
let session2: string;

const who = {
  owner: [OWNER, ['owner', 'player']], desk: [DESK, ['front_desk', 'player']], accountant: [ACC, ['accountant', 'player']], p1: [P1, ['player']], p2: [P2, ['player']],
  guest: [null, ['guest']], coach: [COACH, ['coach', 'player']], coach2: [COACH2, ['coach', 'player']],
} as const;
type Who = keyof typeof who;
const q = <T = Record<string, unknown>>(w: Who, sql: string, params: unknown[] = [], club = A) =>
  db.withClubTx({ clubId: club, userId: who[w][0], roles: who[w][1] as never, source: 'player_app' }, async (tx) => (await tx.query(sql, params)).rows as T[]);
const count = async (w: Who, table: string) => (await q<{ n: number }>(w, `select count(*)::int as n from public.${table}`))[0]!.n;

async function person(id: string, roles: string[]) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, display_name, date_of_birth) values ($1,$2,$3,$4,'1990-01-01')`, [A, id, 'L' + id, 'Name ' + id.slice(0, 2)]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [A, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-11-30T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($1,$4,$3,'2','tennis')`, [A, C1, LOC, C2]);
  await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) select $1, d, '06:00', '24:00' from generate_series(1, 7) d`, [A]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30')`, [A]);
  for (const [id, roles] of [[OWNER, ['owner', 'player']], [DESK, ['front_desk', 'player']], [ACC, ['accountant', 'player']], [P1, ['player']], [P2, ['player']]] as const) await person(id, [...roles]);
  await tdb.seedCoach(A, COACH);
  await tdb.seedCoach(A, COACH2);
  const t1 = (await tdb.query(`insert into public.class_template (club_id, name_th, name_en, audience, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by) values ($1,'ก','One','adult',$2,$3,3,'18:00',2,3,$4) returning id`, [A, COACH, C1, OWNER])).rows[0].id;
  const t2 = (await tdb.query(`insert into public.class_template (club_id, name_th, name_en, audience, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by) values ($1,'ก','Two','adult',$2,$3,4,'18:00',2,3,$4) returning id`, [A, COACH2, C2, OWNER])).rows[0].id;
  db = createDb({ connectionString: tdb.url, max: 4 });
  await db.withClubTx({ clubId: A, userId: OWNER, roles: ['owner'] as never, source: 'admin' }, async (tx) => tx.query(`select app.generate_sessions('2026-11-30'::date, '2026-12-31'::date)`));
  session = (await tdb.query(`select id from public.class_session where template_id = $1 order by start_at limit 1`, [t1])).rows[0].id;
  session2 = (await tdb.query(`select id from public.class_session where template_id = $1 order by start_at limit 1`, [t2])).rows[0].id;
  for (const [sess, p] of [[session, P1], [session2, P2]] as const) {
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, p])).rows[0].id;
    const s = (await tdb.query(`select start_at, end_at, resource_id from public.class_session where id = $1`, [sess])).rows[0];
    await tdb.query(`insert into public.booking (club_id, order_id, type, resource_id, class_session_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at) values ($1,$2,'class_seat',$3,$4,$5,$6,$7,'confirmed','online',$7, app.now())`, [A, order, s.resource_id, sess, s.start_at, s.end_at, p]);
  }
  await tdb.query(`insert into public.waitlist_entry (club_id, customer_id, subject_kind, class_session_id, seq) values ($1,$2,'class_session',$3,1), ($1,$4,'class_session',$3,2)`, [A, P1, session2, P2]);
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('reads by role (design 8)', () => {
  it('the owner and the front desk read templates, sessions and entries of the club', async () => {
    for (const w of ['owner', 'desk'] as Who[]) {
      expect(await count(w, 'class_template'), w).toBe(2);
      expect(await count(w, 'class_session'), w).toBeGreaterThan(5);
      expect(await count(w, 'waitlist_entry'), w).toBe(2);
    }
  });

  it('a coach reads only the template and sessions they teach, and no waitlist', async () => {
    expect(await count('coach', 'class_template')).toBe(1);
    expect((await q<{ coach_id: string }>('coach', `select distinct coach_id from public.class_session`)).map((r) => r.coach_id)).toEqual([COACH]);
    expect(await count('coach', 'waitlist_entry')).toBe(0);
  });

  it('the Accountant reads no template, session or waitlist entry', async () => {
    for (const t of ['class_template', 'class_session', 'waitlist_entry']) expect(await count('accountant', t), t).toBe(0);
  });

  it('a player reads their own entries only, and no template or session table (they use the public view)', async () => {
    expect(await count('p1', 'waitlist_entry')).toBe(1);
    expect((await q<{ customer_id: string }>('p1', `select customer_id from public.waitlist_entry`))[0]!.customer_id).toBe(P1);
    expect(await count('p2', 'waitlist_entry')).toBe(1);
    for (const t of ['class_template', 'class_session']) expect(await count('p1', t), t).toBe(0);
    for (const t of ['class_template', 'class_session', 'waitlist_entry']) expect(await count('guest', t), t).toBe(0);
  });

  it('nobody reads another club’s rows', async () => {
    for (const t of ['class_template', 'class_session', 'waitlist_entry']) {
      expect((await q<{ n: number }>('owner', `select count(*)::int as n from public.${t}`, [], B))[0]!.n, t).toBe(0);
    }
  });

  it('waitlist_seq is not readable by any application role', async () => {
    await expect(q('owner', `select * from public.waitlist_seq`)).rejects.toThrow(/permission denied/);
  });
});

describe('writes', () => {
  const tpl = (w: Who, name: string) => q(w, `insert into public.class_template (club_id, name_th, name_en, audience, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by) values ($1,'ก',$2,'adult',$3,$4,5,'19:00',2,4,$5)`, [A, name, COACH, C1, who[w][0]]);

  it('only the owner creates, edits and ends a template; nobody deletes one', async () => {
    await tpl('owner', 'New');
    await expect(tpl('desk', 'No')).rejects.toThrow(/row-level security|permission denied/);
    await expect(tpl('coach', 'No')).rejects.toThrow(/row-level security|permission denied/);
    await q('owner', `update public.class_template set max_players = 5, ended_on = '2026-12-30' where name_en = 'New'`);
    expect((await tdb.query(`select max_players from public.class_template where name_en = 'New'`)).rows[0].max_players).toBe(5);
    await q('desk', `update public.class_template set max_players = 6 where name_en = 'New'`);
    expect((await tdb.query(`select max_players from public.class_template where name_en = 'New'`)).rows[0].max_players).toBe(5);   // the front desk's update touched no row
    await expect(q('owner', `delete from public.class_template where name_en = 'New'`)).rejects.toThrow(/permission denied/);
  });

  it('sessions, entries and seats are written only through the functions: no direct insert, update or delete', async () => {
    for (const t of ['class_session', 'waitlist_entry']) {
      for (const priv of ['insert', 'update', 'delete']) {
        expect((await tdb.query(`select has_table_privilege('booq_app', $1, $2) as ok`, [`public.${t}`, priv])).rows[0].ok, `${t} ${priv}`).toBe(false);
      }
    }
  });
});

describe('public.class_roster (design 8: roster with names)', () => {
  it('the owner and the front desk see every roster with names; a coach only their own sessions; nobody else', async () => {
    for (const w of ['owner', 'desk'] as Who[]) expect((await q(w, `select * from public.class_roster`)).length, w).toBe(2);
    const own = await q<{ session_id: string; customer_id: string; display_name: string }>('coach', `select session_id, customer_id, display_name from public.class_roster`);
    expect(own.map((r) => [r.session_id, r.customer_id])).toEqual([[session, P1]]);
    expect(own[0]!.display_name).toMatch(/^Name /);
    for (const w of ['accountant', 'p1', 'p2', 'guest'] as Who[]) expect(await q(w, `select * from public.class_roster`), w).toEqual([]);
  });

  it('never carries a date of birth or a phone', async () => {
    const cols = Object.keys((await q('owner', `select * from public.class_roster`))[0]!).sort();
    expect(cols).toEqual(['booking_id', 'customer_id', 'display_name', 'hold_expires_at', 'session_id', 'status']);
  });

  it('a cancelled seat leaves the roster', async () => {
    await tdb.query(`update public.booking set status = 'cancelled' where class_session_id = $1`, [session]);
    expect((await q('owner', `select * from public.class_roster`)).length).toBe(1);
  });
});

describe('BOOQ staff read nothing of F08 (PLAT-02)', () => {
  it('the platform role has no privilege on any F08 table or view, nor execute on any F08 function', async () => {
    for (const t of ['class_template', 'class_session', 'waitlist_entry', 'waitlist_seq', 'class_roster', 'public_class_state', 'waitlist_position']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        expect((await tdb.query(`select has_table_privilege('booq_platform', $1, $2) as ok`, [`public.${t}`, priv])).rows[0].ok, `${t} ${priv}`).toBe(false);
      }
    }
    const fns = (await tdb.query(`select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and (p.proname ~ '(waitlist|offer|seat|class_visible|class_hour|class_dates|class_session|check_template|generate_sessions|cancel_session|edit_session|apply_template_edit|f08_|slot_taken|return_seat)')`)).rows;
    expect(fns.length).toBeGreaterThan(15);
    for (const f of fns) expect((await tdb.query(`select has_function_privilege('booq_platform', $1::regprocedure, 'execute') as ok`, [f.sig])).rows[0].ok, f.sig).toBe(false);
  });
});
