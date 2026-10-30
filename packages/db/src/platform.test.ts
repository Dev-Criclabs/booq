import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { checkTableClasses } from './registry/check';
import { collectRegistry } from './registry';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F01-T16 / migration 0004: the platform schema (PLAT-02-AC10, AC11, PLAT-04-AC5; F01 design 3.2, 6.3).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const USER = '11111111-2222-4333-8444-555555555555';
const AUTH = '99999999-0000-4000-8000-000000000001';

let tdb: TestDatabase;
let db: Db;
const ctx = (clubId: string | null, roles: string[] = ['player']) => ({ clubId: clubId as string, userId: USER, roles });

async function staff(email = 'a@booq.example', role = 'platform_admin', auth = AUTH): Promise<string> {
  const r = await tdb.query(
    `insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1, $2, 'Staff', $3) returning id`,
    [auth, email, role],
  );
  return r.rows[0].id;
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(
    `insert into public.club (id, slug, name_th, name_en, status) values ($1, 'club-a', 'ก', 'Club A', 'live'), ($2, 'club-b', 'ข', 'Club B', 'testing')`,
    [A, B],
  );
  db = createDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('platform staff and assignments (ROLE-02)', () => {
  it('a staff row is an admin or a specialist, with a unique auth user and a unique email', async () => {
    await staff();
    await expect(staff('b@booq.example', 'owner', '99999999-0000-4000-8000-000000000002')).rejects.toThrow(/check/i);
    await expect(staff('c@booq.example', 'platform_admin', AUTH)).rejects.toThrow(/duplicate key/i);
    await expect(staff('A@BOOQ.EXAMPLE', 'platform_admin', '99999999-0000-4000-8000-000000000003')).rejects.toThrow(/duplicate key/i);
    const r = await tdb.query(`select active from platform.platform_staff`);
    expect(r.rows).toEqual([{ active: true }]);
  });

  it('holds no password or secret column (identity is Supabase Auth, FA 4.4)', async () => {
    const r = await tdb.query(`select column_name from information_schema.columns where table_schema = 'platform' and table_name = 'platform_staff'`);
    expect(r.rows.map((c) => c.column_name).filter((c) => /pass|secret|token|hash/.test(c))).toEqual([]);
  });

  it('a specialist is assigned to a club once; the club and staff must exist', async () => {
    const s = await staff('s@booq.example', 'onboarding_specialist');
    await tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1, $2)`, [s, A]);
    await expect(tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1, $2)`, [s, A])).rejects.toThrow(/duplicate key/i);
    await expect(tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1, gen_random_uuid())`, [s])).rejects.toThrow(/foreign key/i);
  });

  it('club.created_by_staff and club.template_id now point at real rows', async () => {
    await expect(tdb.query(`update public.club set created_by_staff = gen_random_uuid() where id = $1`, [A])).rejects.toThrow(/foreign key/i);
    await expect(tdb.query(`update public.club set template_id = gen_random_uuid() where id = $1`, [A])).rejects.toThrow(/foreign key/i);
    const s = await staff();
    await tdb.query(`update public.club set created_by_staff = $2 where id = $1`, [A, s]);
  });
});

describe('support sessions, launch checks, exports, templates, config', () => {
  it('a support session is edit or look and cannot close before it opened', async () => {
    const s = await staff();
    await tdb.query(`insert into platform.support_session (staff_id, club_id, mode) values ($1, $2, 'look')`, [s, A]);
    await expect(tdb.query(`insert into platform.support_session (staff_id, club_id, mode) values ($1, $2, 'root')`, [s, A])).rejects.toThrow(/check/i);
    await expect(
      tdb.query(`insert into platform.support_session (staff_id, club_id, mode, opened_at, closed_at) values ($1, $2, 'edit', now(), now() - interval '1 hour')`, [s, A]),
    ).rejects.toThrow(/check/i);
  });

  it('a launch check is pass, fail or pending and one per club and key; it has no test content column', async () => {
    await tdb.query(`insert into platform.launch_check (club_id, check_key, result) values ($1, 'line_test', 'pending')`, [A]);
    await expect(tdb.query(`insert into platform.launch_check (club_id, check_key, result) values ($1, 'line_test', 'pass')`, [A])).rejects.toThrow(/duplicate key/i);
    await expect(tdb.query(`insert into platform.launch_check (club_id, check_key, result) values ($1, 'x', 'maybe')`, [A])).rejects.toThrow(/check/i);
    const cols = await tdb.query(`select column_name from information_schema.columns where table_schema = 'platform' and table_name = 'launch_check' order by 1`);
    expect(cols.rows.map((c) => c.column_name)).toEqual(['check_key', 'checked_at', 'checked_by', 'club_id', 'result']);
  });

  it('an export request starts as requested and is for one club (D14)', async () => {
    const s = await staff();
    const r = await tdb.query(`insert into platform.export_request (club_id, requested_by_staff) values ($1, $2) returning status`, [A, s]);
    expect(r.rows[0].status).toBe('requested');
    await expect(tdb.query(`insert into platform.export_request (club_id, requested_by_staff, status) values ($1, $2, 'deleted')`, [A, s])).rejects.toThrow(/check/i);
  });

  it('templates carry a to_build flag and unique items; config keys are unique', async () => {
    const t = await tdb.query(`insert into platform.template (key, name, to_build) values ('padel', 'Padel', true) returning id, to_build`);
    expect(t.rows[0].to_build).toBe(true);
    const d = await tdb.query(`insert into platform.template (key, name) values ('tennis', 'Tennis') returning to_build`);
    expect(d.rows[0].to_build).toBe(false);
    await expect(tdb.query(`insert into platform.template (key, name) values ('tennis', 'Again')`)).rejects.toThrow(/duplicate key/i);
    await tdb.query(`insert into platform.template_item (template_id, kind, key, value) values ($1, 'setting', 'hold_minutes', '15')`, [t.rows[0].id]);
    await expect(tdb.query(`insert into platform.template_item (template_id, kind, key, value) values ($1, 'setting', 'hold_minutes', '20')`, [t.rows[0].id])).rejects.toThrow(/duplicate key/i);
    await tdb.query(`insert into platform.config (key, value) values ('support_window_hours', '24')`);
    await expect(tdb.query(`insert into platform.config (key, value) values ('support_window_hours', '12')`)).rejects.toThrow(/duplicate key/i);
  });

  it('the platform log has the P6 columns and cannot be rewritten (PLAT-04-AC5, AC6)', async () => {
    const s = await staff();
    await tdb.query(
      `insert into platform.audit_log (staff_id, staff_name_at_time, action, club_id, detail) values ($1, 'Staff', 'club.created', $2, '{}')`,
      [s, A],
    );
    await expect(tdb.query(`update platform.audit_log set action = 'x'`)).rejects.toThrow(/append-only/i);
    await expect(tdb.query(`delete from platform.audit_log`)).rejects.toThrow(/append-only/i);
    const r = await tdb.query(`select occurred_at from platform.audit_log`);
    expect(r.rows).toHaveLength(1);
  });
});

describe('bump_usage (PLAT-02-AC10, AC11)', () => {
  const bump = (clubId: string | null, metric: string, by?: number) =>
    db.withClubTx(ctx(clubId), (tx) => tx.query(`select app.bump_usage($1, $2) as counted`, [metric, by ?? 1]));

  it('counts per club per day per metric and adds up', async () => {
    await tdb.setNow('2026-12-29T03:00:00Z');
    expect((await bump(A, 'bookings_confirmed')).rows[0]?.counted).toBe(true);
    await bump(A, 'bookings_confirmed', 2);
    await bump(A, 'line_messages_sent');
    const r = await tdb.query(`select club_id, day::text, metric, value from platform.club_usage_daily order by metric`);
    expect(r.rows).toEqual([
      { club_id: A, day: '2026-12-29', metric: 'bookings_confirmed', value: 3 },
      { club_id: A, day: '2026-12-29', metric: 'line_messages_sent', value: 1 },
    ]);
  });

  it('the day is the Bangkok day (17:00 UTC is already tomorrow)', async () => {
    await tdb.setNow('2026-12-29T16:59:59Z');
    await bump(A, 'bookings_confirmed');
    await tdb.setNow('2026-12-29T17:00:01Z');
    await bump(A, 'bookings_confirmed');
    const r = await tdb.query(`select day::text from platform.club_usage_daily order by day`);
    expect(r.rows.map((x) => x.day)).toEqual(['2026-12-29', '2026-12-30']);
  });

  it('refuses test activity: a club in Testing or Draft is not counted', async () => {
    expect((await bump(B, 'bookings_confirmed')).rows[0]?.counted).toBe(false);
    await tdb.query(`update public.club set status = 'draft' where id = $1`, [B]);
    expect((await bump(B, 'bookings_confirmed')).rows[0]?.counted).toBe(false);
    const r = await tdb.query(`select count(*)::int as n from platform.club_usage_daily where club_id = $1`, [B]);
    expect(r.rows[0].n).toBe(0);
  });

  it('a paused club is still counted (real bookings continue)', async () => {
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    expect((await bump(A, 'bookings_confirmed')).rows[0]?.counted).toBe(true);
  });

  it('takes the club from the context only: no club argument, and no context fails', async () => {
    const args = await tdb.query(`select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'bump_usage'`);
    expect(args.rows).toEqual([{ args: 'metric text, by integer' }]);
    await expect(bump(null, 'bookings_confirmed')).rejects.toThrow();
  });

  it('refuses an unknown metric and a count of zero or less', async () => {
    await expect(bump(A, 'revenue')).rejects.toThrow(/metric/i);
    await expect(bump(A, 'bookings_confirmed', 0)).rejects.toThrow(/by/i);
    await expect(bump(A, 'bookings_confirmed', -1)).rejects.toThrow(/by/i);
  });

  it('is the only writer: the app roles cannot insert, update or delete usage rows', async () => {
    await expect(db.withClubTx(ctx(A), (tx) => tx.query(`insert into platform.club_usage_daily (club_id, day, metric, value) values ($1, current_date, 'bookings_confirmed', 99)`, [A]))).rejects.toThrow(/permission denied/i);
    await expect(db.withClubTx(ctx(A), (tx) => tx.query(`update platform.club_usage_daily set value = 0`))).rejects.toThrow(/permission denied/i);
  });

  it('stores counts only: the table has no column that could name a person or a booking', async () => {
    const r = await tdb.query(`select column_name from information_schema.columns where table_schema = 'platform' and table_name = 'club_usage_daily' order by 1`);
    expect(r.rows.map((c) => c.column_name)).toEqual(['club_id', 'day', 'metric', 'value']);
  });

  it('the platform role and the public roles cannot execute it', async () => {
    const q = (role: string) => tdb.query(`select has_function_privilege($1, 'app.bump_usage(text, integer)', 'execute') as ok`, [role]);
    expect((await q('booq_platform')).rows[0].ok).toBe(false);
    expect((await q('anon')).rows[0].ok).toBe(false);
    expect((await q('authenticated')).rows[0].ok).toBe(false);
    expect((await q('booq_app')).rows[0].ok).toBe(true);
    expect((await q('booq_worker')).rows[0].ok).toBe(true);
  });
});

describe('blindness and classification', () => {
  it('booq_platform has no privilege on a club data (D) table, and anon/authenticated none on platform tables', async () => {
    const priv = async (role: string, table: string) =>
      (await tdb.query(`select has_table_privilege($1, $2, 'select,insert,update,delete') as ok`, [role, table])).rows[0].ok;
    expect(await priv('booq_platform', 'public.club_status_change')).toBe(false); // D table: never (the full sweep is platform-grants.test.ts)
    const tables = (await tdb.query(`select table_name from information_schema.tables where table_schema = 'platform'`)).rows.map((r) => r.table_name);
    expect(tables.sort()).toEqual(['audit_log', 'club_usage_daily', 'config', 'export_request', 'launch_check', 'platform_staff', 'staff_assignment', 'support_session', 'template', 'template_item']);
    for (const t of tables) for (const role of ['anon', 'authenticated', 'booq_app', 'booq_worker']) {
      expect(await priv(role, `platform.${t}`), `${role} ${t}`).toBe(false);
    }
  });

  it('anon and authenticated hold no privilege on any table, view, sequence or function outside pg_catalog, extension functions aside (SR-06)', async () => {
    const r = await tdb.query(`
      select n.nspname, c.relname, c.relkind, r.rolname
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        cross join (values ('anon'), ('authenticated')) as r(rolname)
       where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast') and c.relkind in ('r','v','m','S','p')
         and (case when c.relkind = 'S' then has_sequence_privilege(r.rolname, c.oid, 'usage,select,update')
                   else has_table_privilege(r.rolname, c.oid, 'select,insert,update,delete,truncate,references,trigger') end)`);
    expect(r.rows).toEqual([]);
    const f = await tdb.query(`
      select n.nspname, p.proname, r.rolname
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        cross join (values ('anon'), ('authenticated')) as r(rolname)
       where n.nspname in ('app', 'platform', 'audit', 'public') and has_function_privilege(r.rolname, p.oid, 'execute')
         and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`);
    expect(f.rows).toEqual([]);
  });

  it('every platform table is registered as class P and passes the structure check', async () => {
    const registry = await collectRegistry();
    for (const t of ['platform_staff', 'staff_assignment', 'support_session', 'audit_log', 'club_usage_daily', 'config', 'template', 'template_item', 'launch_check', 'export_request']) {
      expect(registry[`platform.${t}`]?.class, t).toBe('P');
    }
    const result = await checkTableClasses(tdb.pool, registry);
    expect(result.problems.filter((p) => p.table !== 'app.test_clock')).toEqual([]);
  });
});
