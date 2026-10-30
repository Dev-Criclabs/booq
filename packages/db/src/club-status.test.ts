import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createPlatformDb, type PlatformDb } from './platform-tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';
import { completeSetup, recordLaunchChecks } from './setup-fixture';

// F01-T20 / migration 0032: app.set_club_status and the transition table
// (PLAT-01-AC1 to AC4, AC7, AC10; review SR-02: Go live, pause and resume clear the window).
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const USER = '11111111-2222-4333-8444-555555555555';

let tdb: TestDatabase;
let db: Db;
let pdb: PlatformDb;
let admin: string;
let spec: string;
let loner: string;

async function staff(email: string, role: string, auth: string, name: string): Promise<string> {
  return (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1, $2, $3, $4) returning id`, [auth, email, name, role])).rows[0].id;
}
const setStatus = async (staffId: string, to: string, reason?: string, club = CLUB) =>
  pdb.withPlatformTx({ staffId, staffLabel: 'x', clubId: club }, async (tx) => (await tx.query(`select app.set_club_status($1, $2) as status`, [to, reason ?? null])).rows[0]?.status as string);
/** The internal function, called as the database owner with the staff context set by hand. */
async function apply(staffId: string | null, to: string, reason: string | null, viaPause = true, club = CLUB): Promise<string> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.club_id', $1, true), set_config('app.actor_platform_staff_id', $2, true)`, [club, staffId ?? '']);
    const r = await c.query(`select app.apply_status_change($1, $2, $3) as status`, [to, reason, viaPause]);
    await c.query('commit');
    return r.rows[0].status;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const statusOf = async (club = CLUB) => (await tdb.query(`select status from public.club where id = $1`, [club])).rows[0].status as string;
const changes = async (club = CLUB) =>
  (await tdb.query(`select from_status, to_status, reason, actor_staff_id from public.club_status_change where club_id = $1 order by occurred_at, id`, [club])).rows;
/** Records results for the first required checks and a pass for the rest of the configured list. */
const addChecks = (first: string[]) => recordLaunchChecks(tdb, CLUB, first);
const openWindow = () => tdb.query(`update public.club set allow_booq_changes_set_at = app.now(), allow_booq_changes_until = app.now() + interval '24 hours' where id = $1`, [CLUB]);
const windowCleared = async () => {
  const w = (await tdb.query(`select allow_booq_changes_until as u, allow_booq_changes_set_at as s from public.club where id = $1`, [CLUB])).rows[0];
  return w.u === null && w.s === null;
};

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1, 'a', 'ก', 'A'), ($2, 'b', 'ข', 'B')`, [CLUB, OTHER]);
  admin = await staff('admin@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000001', 'Ada Admin');
  spec = await staff('spec@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000002', 'Sam Specialist');
  loner = await staff('loner@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000003', 'Lee Loner');
  await tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1, $2)`, [spec, CLUB]);
  await completeSetup(tdb, CLUB);
  await completeSetup(tdb, OTHER);
  db = createDb({ connectionString: tdb.url, max: 1 });
  pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await db.end();
  await pdb.end();
  await tdb.close();
});

describe('club.status is writable only through the function', () => {
  it('the app role and the platform role cannot update it, and neither can the others', async () => {
    await expect(db.withClubTx({ clubId: CLUB, userId: USER, roles: ['owner'], source: 'admin' }, (tx) => tx.query(`update public.club set status = 'live'`))).rejects.toThrow(/permission denied/i);
    for (const role of ['booq_app', 'booq_worker', 'booq_platform', 'anon', 'authenticated']) {
      const r = await tdb.query(`select has_column_privilege($1, 'public.club', 'status', 'update') as ok`, [role]);
      expect(r.rows[0].ok, role).toBe(false);
    }
  });

  it('set_club_status is executable by booq_platform only; the internal function by nobody', async () => {
    const q = (fn: string, role: string) => tdb.query(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn]).then((r) => r.rows[0].ok);
    expect(await q('app.set_club_status(text, text)', 'booq_platform')).toBe(true);
    for (const role of ['booq_app', 'booq_worker', 'anon', 'authenticated']) expect(await q('app.set_club_status(text, text)', role), role).toBe(false);
    for (const role of ['booq_platform', 'booq_app', 'booq_worker', 'anon', 'authenticated']) expect(await q('app.apply_status_change(text, text, boolean)', role), role).toBe(false);
  });

  it('takes the club from the context, never as an argument', async () => {
    const r = await tdb.query(`select p.proname, pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname in ('set_club_status', 'apply_status_change') order by 1`);
    expect(r.rows).toEqual([{ proname: 'apply_status_change', args: 'p_to text, p_reason text, p_via_pause boolean' }, { proname: 'set_club_status', args: 'p_to text, p_reason text' }]);
  });
});

describe('the transition table (PLAT-01-AC1 to AC4)', () => {
  it('a new club is Draft; Draft to Testing by an admin writes the history and one audit entry naming the staff member', async () => {
    expect(await statusOf()).toBe('draft');
    expect(await setStatus(admin, 'testing', 'setup_done')).toBe('testing');
    expect(await statusOf()).toBe('testing');
    expect(await changes()).toEqual([{ from_status: 'draft', to_status: 'testing', reason: 'setup_done', actor_staff_id: admin }]);
    const a = await tdb.query(`select actor_type, actor_platform_staff_id as staff, old_value, new_value from public.audit_entry where club_id = $1 and record_type = 'club' and action = 'update' and actor_type = 'platform_staff'`, [CLUB]);
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0]).toMatchObject({ actor_type: 'platform_staff', staff: admin });
    expect(JSON.stringify(a.rows[0].new_value)).toContain('testing');
  });

  it('a change without a reason records a code for the move, not an empty value', async () => {
    await setStatus(spec, 'testing');
    expect((await changes())[0]?.reason).toBe('draft_to_testing');
  });

  it('the change is stamped with the clock', async () => {
    await tdb.setNow('2026-12-29T03:00:00Z');
    await setStatus(spec, 'testing');
    const r = await tdb.query(`select occurred_at from public.club_status_change`);
    expect(new Date(r.rows[0].occurred_at).toISOString()).toBe('2026-12-29T03:00:00.000Z');
  });

  it('Testing to Live is refused until every launch check passes, and says which are missing', async () => {
    await setStatus(admin, 'testing');
    await expect(setStatus(admin, 'live')).rejects.toThrow(/blocked/);
    const keys = await addChecks(['pass', 'fail', 'pending']);
    const err = await setStatus(admin, 'live').catch((e) => e as Error & { detail?: string });
    expect((err as Error).message).toMatch(/blocked/);
    expect(JSON.parse((err as { detail: string }).detail)).toEqual([{ item: keys[1], owed_by: 'booq', result: 'pending' }, { item: keys[2], owed_by: 'booq', result: 'pending' }]);
    expect(await statusOf()).toBe('testing');
    expect(await changes()).toHaveLength(1);
    await addChecks([]);
    expect(await setStatus(spec, 'live')).toBe('live');
    expect(await statusOf()).toBe('live');
  });

  it('every other move is refused and changes nothing: skipping, backward, same status, unknown and Delete', async () => {
    const refuse = async (from: string, to: string) => {
      await tdb.query(`alter table public.club disable trigger user`);
      await tdb.query(`update public.club set status = $1 where id = $2`, [from, CLUB]);
      await tdb.query(`alter table public.club enable trigger user`);
      await expect(setStatus(admin, to), `${from} to ${to}`).rejects.toThrow(/transition_not_allowed|use_pause/);
      expect(await statusOf()).toBe(from);
    };
    await refuse('draft', 'live');
    await refuse('draft', 'draft');
    await refuse('draft', 'closed');
    await refuse('testing', 'draft');
    await refuse('testing', 'testing');
    await refuse('live', 'testing');
    await refuse('live', 'draft');
    await refuse('paused', 'testing');
    await refuse('paused', 'draft');
    expect(await changes()).toEqual([]);
  });

  it('pause and resume are not done here: set_club_status points to the pause functions', async () => {
    await tdb.query(`update public.club set status = 'live' where id = $1`, [CLUB]);
    await expect(setStatus(admin, 'paused', 'because')).rejects.toThrow(/use_pause/);
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [CLUB]);
    await expect(setStatus(admin, 'live', 'because')).rejects.toThrow(/use_pause/);
  });
});

describe('who may change status (PLAT-01-AC8, ROLE-AC5)', () => {
  it('a specialist works only on assigned clubs; an unassigned club is not found', async () => {
    await expect(setStatus(loner, 'testing')).rejects.toThrow(/not_found/);
    await expect(setStatus(spec, 'testing', undefined, OTHER)).rejects.toThrow(/not_found/);
    expect(await statusOf()).toBe('draft');
    expect(await statusOf(OTHER)).toBe('draft');
    expect(await setStatus(admin, 'testing', undefined, OTHER)).toBe('testing');
  });

  it('a deactivated account, an unknown staff id and a missing actor are refused', async () => {
    await tdb.query(`update platform.platform_staff set active = false where id = $1`, [spec]);
    await expect(setStatus(spec, 'testing')).rejects.toThrow(/actor_required/);
    await expect(setStatus('aaaaaaaa-1111-4111-8111-111111111111', 'testing')).rejects.toThrow(/actor_required/);
    await expect(apply(null, 'testing', null, false)).rejects.toThrow(/actor_required/);
    expect(await statusOf()).toBe('draft');
  });

  it('no club context fails', async () => {
    await expect(tdb.query(`select app.apply_status_change('testing', null, false)`)).rejects.toThrow(/no_club_context/);
  });
});

describe('pause, resume and the window (PLAT-01-AC7, AC10; SR-02)', () => {
  it('through the pause path: only an admin, with a reason, and the history keeps who, when and why', async () => {
    await tdb.query(`update public.club set status = 'live' where id = $1`, [CLUB]);
    await expect(apply(spec, 'paused', 'because')).rejects.toThrow(/admin_only/);
    await expect(apply(admin, 'paused', null)).rejects.toThrow(/reason_required/);
    await expect(apply(admin, 'paused', '   ')).rejects.toThrow(/reason_required/);
    expect(await apply(admin, 'paused', 'payment problem')).toBe('paused');
    await expect(apply(spec, 'live', 'fixed')).rejects.toThrow(/admin_only/);
    await expect(apply(admin, 'live', '')).rejects.toThrow(/reason_required/);
    expect(await apply(admin, 'live', 'fixed')).toBe('live');
    expect(await changes()).toEqual([
      { from_status: 'live', to_status: 'paused', reason: 'payment problem', actor_staff_id: admin },
      { from_status: 'paused', to_status: 'live', reason: 'fixed', actor_staff_id: admin },
    ]);
  });

  it('the internal function itself refuses pause moves when not called from the pause path', async () => {
    await tdb.query(`update public.club set status = 'live' where id = $1`, [CLUB]);
    await expect(apply(admin, 'paused', 'x', false)).rejects.toThrow(/use_pause/);
  });

  it('Go live, pause and resume each clear the owner window', async () => {
    await setStatus(admin, 'testing');
    await addChecks(['pass']);
    await openWindow();
    expect(await windowCleared()).toBe(false);
    await setStatus(admin, 'live');
    expect(await windowCleared()).toBe(true);
    await openWindow();
    await apply(admin, 'paused', 'r');
    expect(await windowCleared()).toBe(true);
    await openWindow();
    await apply(admin, 'live', 'r');
    expect(await windowCleared()).toBe(true);
  });

  it('a refused change leaves the window and the history alone', async () => {
    await tdb.query(`update public.club set status = 'live' where id = $1`, [CLUB]);
    await openWindow();
    await expect(setStatus(admin, 'testing')).rejects.toThrow();
    expect(await windowCleared()).toBe(false);
    expect(await changes()).toEqual([]);
  });

  it('a failed history write rolls the status change back', async () => {
    await tdb.query(`create or replace function public.__boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$`);
    await tdb.query(`create trigger boom before insert on public.club_status_change for each row execute function public.__boom()`);
    await expect(setStatus(admin, 'testing')).rejects.toThrow(/boom/);
    expect(await statusOf()).toBe('draft');
  });
});

describe('Go live runs the purge in the same transaction (review T20 R1; PLAT-01-AC6, PLAT-07-AC4)', () => {
  const OWNER_USER = '11111111-1111-4111-8111-111111111111';
  const TESTER_USER = '22222222-2222-4222-8222-222222222222';
  const purgeEntries = async () => (await tdb.query(`select count(*)::int as n from public.audit_entry where club_id = $1 and action = 'go_live.purge'`, [CLUB])).rows[0].n as number;

  async function person(id: string, line: string, roles: string[], test = false) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id, is_test) values ($1,$2,$3,$4)', [CLUB, id, line, test]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [CLUB, id, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  async function ledger(name: string, body = '') {
    await tdb.query(`
      create table public.${name} (club_id uuid not null references public.club (id), id uuid not null default gen_random_uuid(), amount integer not null, is_test boolean not null default false, primary key (club_id, id));
      alter table public.${name} enable row level security; alter table public.${name} force row level security;
      grant all on public.${name} to booq_owner, booq_purge;
      ${body}
      select app.register_test_table('public.${name}', 150);`);
  }

  it('a Testing club with test rows and a tester goes Live: the test rows and tester are gone; the owner, its roles and a setting\'s audit entry stay', async () => {
    await ledger('t_ledger');
    await setStatus(admin, 'testing');
    await person(OWNER_USER, 'L1', ['owner', 'player']);
    await person(TESTER_USER, 'L2', ['player'], true);
    await tdb.query(`insert into public.t_ledger (club_id, amount) values ($1, 5), ($1, 7)`, [CLUB]);
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1, 'cancel_window_hours', '15')`, [CLUB]);
    await addChecks(['pass']);
    expect((await tdb.query(`select count(*)::int as n from public.t_ledger where is_test`)).rows[0].n).toBe(2);

    expect(await setStatus(admin, 'live')).toBe('live');

    expect((await tdb.query(`select count(*)::int as n from public.t_ledger`)).rows[0].n).toBe(0);
    expect((await tdb.query('select id from public.app_user order by id')).rows.map((r) => r.id)).toEqual([OWNER_USER]);
    expect((await tdb.query(`select count(*)::int as n from public.app_user_role where club_id = $1`, [CLUB])).rows[0].n).toBe(2);
    expect((await tdb.query(`select count(*)::int as n from public.audit_entry where club_id = $1 and record_type = 'club_setting'`, [CLUB])).rows[0].n).toBeGreaterThan(0);
    expect(await purgeEntries()).toBe(1);
    expect(await changes()).toHaveLength(2);
  });

  it('a purge that fails keeps the club in Testing: no status change, no history row, no test row removed', async () => {
    await ledger('t_ledger');
    await ledger('t_boom', `create function public.__boom_del() returns trigger language plpgsql as $$ begin raise exception 'purge boom'; end $$;
                            create trigger t_boom_del before delete on public.t_boom for each row execute function public.__boom_del();`);
    await setStatus(admin, 'testing');
    await tdb.query(`insert into public.t_ledger (club_id, amount) values ($1, 5)`, [CLUB]);
    await tdb.query(`insert into public.t_boom (club_id, amount) values ($1, 1)`, [CLUB]);
    await addChecks(['pass']);
    await expect(setStatus(admin, 'live')).rejects.toThrow(/purge boom/);
    expect(await statusOf()).toBe('testing');
    expect(await changes()).toHaveLength(1);
    expect((await tdb.query(`select count(*)::int as n from public.t_ledger`)).rows[0].n).toBe(1);
    expect(await purgeEntries()).toBe(0);
  });

  it('a refused Go live (checks not passed) does not purge', async () => {
    await ledger('t_ledger');
    await setStatus(admin, 'testing');
    await tdb.query(`insert into public.t_ledger (club_id, amount) values ($1, 5)`, [CLUB]);
    await addChecks(['fail']);
    await expect(setStatus(admin, 'live')).rejects.toThrow(/blocked/);
    expect((await tdb.query(`select count(*)::int as n from public.t_ledger`)).rows[0].n).toBe(1);
  });

  it('the purge never runs for Draft to Testing, pause or resume', async () => {
    await setStatus(admin, 'testing');
    expect(await purgeEntries()).toBe(0);
    await addChecks(['pass']);
    await setStatus(admin, 'live');
    expect(await purgeEntries()).toBe(1);
    await apply(admin, 'paused', 'r');
    await apply(admin, 'live', 'r');
    expect(await purgeEntries()).toBe(1);
  });
});
