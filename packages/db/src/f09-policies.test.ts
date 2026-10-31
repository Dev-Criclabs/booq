import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F09-T09 / migration 1011: who reads, writes and runs F09 (design 7; CC-1, CC-3, CANCEL-02, PLAT-02). Front desk and the owner
// read the club's cancels and closures and run the staff functions; a player reads only their own bookings' cancels; the
// Accountant and coaches read none; nobody writes the tables directly; BOOQ staff reach nothing. The route inventory that finds
// no refund route is apps/web/src/api/payments/inventory.test.ts (every mounted route).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURT = 'c1c1c1c1-0000-4000-8000-000000000001';
const OWNER = '44444444-4444-4444-8444-444444444444';
const DESK = '33333333-3333-4333-8333-333333333333';
const ACC = '66666666-6666-4666-8666-666666666666';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const H = (h: number) => new Date(Date.parse('2026-12-03T00:00:00+07:00') + h * 3_600_000).toISOString();

const who = {
  owner: [OWNER, ['owner', 'player']], desk: [DESK, ['front_desk', 'player']], accountant: [ACC, ['accountant', 'player']],
  coach: [COACH, ['coach', 'player']], p1: [P1, ['player']], p2: [P2, ['player']],
} as const;
type Who = keyof typeof who;
let tdb: TestDatabase;
let db: Db;
const ctx = (w: Who, club = A) => ({ clubId: club, userId: who[w][0], roles: who[w][1] as never, requestId: 'r', source: 'admin' as const });
const q = <T = Record<string, unknown>>(w: Who, sql: string, params: unknown[] = [], club = A) =>
  db.withClubTx(ctx(w, club), async (tx) => (await tx.query(sql, params)).rows as T[]);
const count = async (w: Who, table: string, club = A) => (await q<{ n: number }>(w, `select count(*)::int as n from public.${table}`, [], club))[0]!.n;

const TABLES = ['booking_cancel', 'closure', 'closure_resource'];
// Every F09 function and the roles that may run it; any other is internal (executable by no role, no PUBLIC).
const RUN: Record<string, string[]> = {
  'app.cancel_booking(uuid,boolean,boolean,text,uuid)': ['booq_app', 'booq_worker'],
  'app.cancel_outcome(uuid,boolean,boolean)': ['booq_app', 'booq_worker'],
  'app.closure_preview(uuid[],timestamp with time zone,timestamp with time zone,jsonb)': ['booq_app'],
  'app.create_closure(uuid[],timestamp with time zone,timestamp with time zone,jsonb,text,integer)': ['booq_app'],
  'app.end_closure(uuid,timestamp with time zone,text)': ['booq_app'],
  'app.closures_due_roll()': ['booq_app', 'booq_worker'],
  'app.roll_closure(uuid)': ['booq_app', 'booq_worker'],
  'app.closure_unmessaged(uuid)': ['booq_app'],
  'app.mark_no_show(uuid,text)': ['booq_app'],
  'app.mark_late_cancel(uuid,text)': ['booq_app'],
  'app.reverse_mark(uuid,text)': ['booq_app'],
};
const INTERNAL = [
  'app.valid_closure_repeat(jsonb)', 'app.register_cancel_handler(text,regprocedure,integer)', 'app.run_cancel_handlers(uuid,text)',
  'app.return_booking_value(uuid,text)', 'app.cancel_order_effects(uuid,text)', 'app.record_booking_cancel(uuid,text,text,jsonb,text,uuid)',
  'app.mark_lock(uuid,text)', 'app.mark_record(booking,text,text,jsonb,text)',
  'app.closure_occurrences(timestamp with time zone,timestamp with time zone,jsonb)', 'app.closure_span(uuid[],timestamp with time zone,timestamp with time zone,jsonb)',
  'app.closure_person_name(uuid)', 'app.closure_expired_packages(uuid[])', 'app.closure_apply(uuid,uuid[],tstzrange[],text,integer)',
  'app.closure_new_occurrences(closure)', 'app.closure_roll_allowed()',
];
const ROLES = ['booq_app', 'booq_worker', 'booq_platform', 'booq_audit'];
const canRun = async (role: string, sig: string) =>
  (await tdb.query(`select has_function_privilege($1, $2::regprocedure, 'execute') as ok`, [role, sig])).rows[0].ok as boolean;
const publicRuns = async (sig: string) =>
  (await tdb.query(`select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                   where p.oid = $1::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') as ok`, [sig])).rows[0].ok as boolean;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  for (const [club, slug] of [[A, 'club-a'], [B, 'club-b']]) await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,$2,'ก','A','live')`, [club, slug]);
  for (const [id, roles] of Object.values(who)) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [A, id, 'L' + id]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [A, id, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, COURT, LOC]);
  for (let d = 1; d <= 7; d += 1) await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [A, d]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15'), ($1,'cancel_window_hours','12')`, [A]);
  db = createDb({ connectionString: tdb.url, max: 4 });

  // One cancelled booking each for P1 and P2 (club cancels with a staff reason), and a closure.
  for (const [p, hour] of [['p1', 9], ['p2', 10]] as const) {
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, who[p][0]])).rows[0].id;
    const r = (await q<{ r: any }>(p, `select app.reserve_court($1, $2, $3::timestamptz[]) as r`, [order, COURT, [H(hour)]]))[0]!.r;
    await q('desk', `select app.confirm_booking($1)`, [order]);
    await q('desk', `select app.cancel_booking($1, true, true, 'staff note', null)`, [r.booking_ids[0]]);
  }
  await q('desk', `select app.create_closure($1::uuid[], $2, $3, null, 'rain')`, [[COURT], H(17), H(21)]);
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('reads by role (design 7, CC-3)', () => {
  it('front desk and the owner read the club’s cancels, closures and their courts', async () => {
    for (const w of ['owner', 'desk'] as const) {
      expect(await count(w, 'booking_cancel')).toBe(2);
      expect(await count(w, 'closure')).toBe(1);
      expect(await count(w, 'closure_resource')).toBe(1);
    }
  });

  it('a player reads only their own bookings’ cancels and no closure; the Accountant and a coach read none', async () => {
    expect(await q('p1', `select b.customer_id from public.booking_cancel c join public.booking b on b.id = c.booking_id`)).toEqual([{ customer_id: P1 }]);
    for (const w of ['p1', 'p2', 'accountant', 'coach'] as const) {
      expect(await count(w, 'closure')).toBe(0);
      expect(await count(w, 'closure_resource')).toBe(0);
    }
    expect(await count('accountant', 'booking_cancel')).toBe(0);
    expect(await count('coach', 'booking_cancel')).toBe(0);
  });

  it('nobody reads another club’s rows', async () => {
    for (const t of TABLES) expect(await count('owner', t, B)).toBe(0);
  });
});

describe('writes and runs', () => {
  it('no application role inserts, updates or deletes an F09 table directly', async () => {
    for (const t of TABLES) for (const role of ['booq_app', 'booq_worker']) for (const priv of ['insert', 'update', 'delete', 'truncate']) {
      expect((await tdb.query(`select has_table_privilege($1, $2, $3) as ok`, [role, `public.${t}`, priv])).rows[0].ok, `${role} ${priv} ${t}`).toBe(false);
    }
  });

  it('each F09 function runs for exactly its roles; the helpers run for none, and nothing is granted to PUBLIC', async () => {
    for (const [sig, roles] of Object.entries(RUN)) {
      for (const role of ROLES) expect(await canRun(role, sig), `${role} ${sig}`).toBe(roles.includes(role));
      expect(await publicRuns(sig), sig).toBe(false);
    }
    for (const sig of INTERNAL) {
      for (const role of ROLES) expect(await canRun(role, sig), `${role} ${sig}`).toBe(false);
      expect(await publicRuns(sig), sig).toBe(false);
    }
  });

  it('only front desk and the owner preview, create and end closures or mark; others are refused (CANCEL-03-AC17, CANCEL-04-AC10)', async () => {
    const closure = (await q<{ id: string }>('owner', `select id from public.closure`))[0]!.id;
    const booking = (await q<{ id: string }>('owner', `select booking_id as id from public.booking_cancel limit 1`))[0]!.id;
    for (const w of ['accountant', 'coach', 'p1'] as const) {
      await expect(q(w, `select app.closure_preview($1::uuid[], $2, $3)`, [[COURT], H(17), H(21)])).rejects.toThrow(/closure:forbidden/);
      await expect(q(w, `select app.create_closure($1::uuid[], $2, $3, null, 'x')`, [[COURT], H(6), H(7)])).rejects.toThrow(/closure:forbidden/);
      await expect(q(w, `select app.end_closure($1, null, 'x')`, [closure])).rejects.toThrow(/closure:forbidden/);
      await expect(q(w, `select app.roll_closure($1)`, [closure])).rejects.toThrow(/closure:forbidden/);
      await expect(q(w, `select app.reverse_mark($1, 'x')`, [booking])).rejects.toThrow(/mark:forbidden/);
    }
  });
});

describe('BOOQ staff read nothing of F09 (PLAT-02)', () => {
  it('the platform role has no privilege on any F09 table or the booking_state view, nor execute on any F09 function', async () => {
    for (const t of [...TABLES, 'booking_state']) for (const priv of ['select', 'insert', 'update', 'delete']) {
      expect((await tdb.query(`select has_table_privilege('booq_platform', $1, $2) as ok`, [`public.${t}`, priv])).rows[0].ok, `${t} ${priv}`).toBe(false);
    }
    for (const sig of [...Object.keys(RUN), ...INTERNAL]) expect(await canRun('booq_platform', sig), sig).toBe(false);
  });
});
