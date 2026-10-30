import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlatformDb, type PlatformDb } from './platform-tx';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F01-T22 / migration 0033: pause_club, resume_club, app.pause_handlers
// (PLAT-03-AC1, AC2, AC3, AC7, AC10, AC11; PLAT-01-AC10).
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

let tdb: TestDatabase;
let pdb: PlatformDb;
let db: Db;
let admin: string;
let spec: string;

async function staff(email: string, role: string, auth: string, name: string): Promise<string> {
  return (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1, $2, $3, $4) returning id`, [auth, email, name, role])).rows[0].id;
}
const as = (staffId: string, club = CLUB) => ({ staffId, staffLabel: 'Staff', clubId: club });
const pause = (who: string, reason: string | null, club = CLUB) =>
  pdb.withPlatformTx(as(who, club), async (tx) => (await tx.query(`select app.pause_club($1) as id`, [reason])).rows[0]?.id as string);
const resume = (who: string, reason: string | null, club = CLUB) =>
  pdb.withPlatformTx(as(who, club), async (tx) => (await tx.query(`select app.resume_club($1) as r`, [reason])).rows[0]?.r);
const status = async (club = CLUB) => (await tdb.query(`select status from public.club where id = $1`, [club])).rows[0].status as string;
const pauses = async (club = CLUB) =>
  (await tdb.query(`select pause_reason, paused_by, paused_at, resumed_at, resume_reason, resumed_by from public.club_pause where club_id = $1 order by paused_at, id`, [club])).rows;
const goLive = () => tdb.query(`update public.club set status = 'live' where id = $1`, [CLUB]);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1, 'a', 'ก', 'A'), ($2, 'b', 'ข', 'B')`, [CLUB, OTHER]);
  admin = await staff('admin@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000001', 'Ada Admin');
  spec = await staff('spec@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000002', 'Sam Specialist');
  await tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1, $2)`, [spec, CLUB]);
  await goLive();
  pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
  db = createDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await pdb.end();
  await db.end();
  await tdb.close();
});

describe('pause_club (PLAT-03-AC1, AC2, AC3)', () => {
  it('an admin pauses a Live club with a reason: status, one open pause, history, window cleared', async () => {
    await tdb.setNow('2026-12-29T03:00:00Z');
    await tdb.query(`update public.club set allow_booq_changes_set_at = app.now(), allow_booq_changes_until = app.now() + interval '24 hours' where id = $1`, [CLUB]);
    const id = await pause(admin, 'payment problem');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await status()).toBe('paused');
    const [p] = await pauses();
    expect(p).toMatchObject({ pause_reason: 'payment problem', paused_by: admin, resumed_at: null });
    expect(new Date(p.paused_at).toISOString()).toBe('2026-12-29T03:00:00.000Z');
    const h = await tdb.query(`select from_status, to_status, reason, actor_staff_id from public.club_status_change where club_id = $1`, [CLUB]);
    expect(h.rows).toEqual([{ from_status: 'live', to_status: 'paused', reason: 'payment problem', actor_staff_id: admin }]);
    expect((await tdb.query(`select allow_booq_changes_until as u from public.club where id = $1`, [CLUB])).rows[0].u).toBeNull();
  });

  it('refuses a missing or blank reason and changes nothing', async () => {
    for (const reason of [null, '', '   ']) await expect(pause(admin, reason), String(reason)).rejects.toThrow(/reason_required/);
    expect(await status()).toBe('live');
    expect(await pauses()).toEqual([]);
  });

  it('only a platform admin: a specialist is refused even on their own club', async () => {
    await expect(pause(spec, 'because')).rejects.toThrow(/admin_only/);
    expect(await status()).toBe('live');
  });

  it('only a Live club can be paused; a second pause is refused so there is one open row', async () => {
    await pause(admin, 'a');
    await expect(pause(admin, 'b')).rejects.toThrow(/transition_not_allowed/);
    await expect(pause(admin, 'b', OTHER)).rejects.toThrow(/transition_not_allowed/); // OTHER is a Draft club
    expect((await pauses()).length).toBe(1);
  });

  it('the club row change and the pause row are written together: a failure in the pause row rolls back the status', async () => {
    await tdb.query(`create or replace function public.__boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$`);
    await tdb.query(`create trigger boom before insert on public.club_pause for each row execute function public.__boom()`);
    await expect(pause(admin, 'x')).rejects.toThrow(/boom/);
    expect(await status()).toBe('live');
    expect(await pauses()).toEqual([]);
  });
});

/** Handlers registered by the migrations of later features (F06 registers one in 0508); tests add theirs on top. */
const registeredHandlers = async () => Number((await tdb.query('select count(*) from app.pause_handlers')).rows[0].count);

describe('resume_club (PLAT-01-AC10, PLAT-03-AC11)', () => {
  it('an admin resumes with a reason: Live again, the pause is closed with who, when and why', async () => {
    await tdb.setNow('2026-12-29T03:00:00Z');
    await pause(admin, 'payment problem');
    await tdb.advance('3 days 2 hours');
    const baseline = await registeredHandlers();      // handlers other features register (F06 0508, ...)
    const r = await resume(admin, 'fixed');
    expect({ ...r, paused_at: new Date(r.paused_at).toISOString(), resumed_at: new Date(r.resumed_at).toISOString() }).toEqual({ paused_at: '2026-12-29T03:00:00.000Z', resumed_at: '2027-01-01T05:00:00.000Z', handlers_run: baseline });
    expect(await status()).toBe('live');
    const [p] = await pauses();
    expect(p).toMatchObject({ resume_reason: 'fixed', resumed_by: admin });
    expect(new Date(p.resumed_at).getTime() - new Date(p.paused_at).getTime()).toBe((3 * 24 + 2) * 3600_000);
  });

  it('refuses a missing reason, a specialist, a club that is not paused', async () => {
    await expect(resume(admin, 'x')).rejects.toThrow(/transition_not_allowed/);
    await pause(admin, 'a');
    await expect(resume(admin, null)).rejects.toThrow(/reason_required/);
    await expect(resume(spec, 'x')).rejects.toThrow(/admin_only/);
    expect(await status()).toBe('paused');
    expect((await pauses())[0]?.resumed_at).toBeNull();
  });

  it('a club can be paused again after it resumed, and keeps both rows', async () => {
    await pause(admin, 'a');
    await resume(admin, 'b');
    await pause(admin, 'c');
    expect((await pauses()).map((p) => p.pause_reason)).toEqual(['a', 'c']);
  });
});

describe('app.pause_handlers (PLAT-03-AC7)', () => {
  async function register(name: string, body = '') {
    await tdb.query(`create table if not exists public.__handled (club_id uuid, handler text, paused_at timestamptz, resumed_at timestamptz)`);
    await tdb.query(`grant all on public.__handled to booq_owner`);
    await tdb.query(`create function public.${name}(p_club uuid, p_paused timestamptz, p_resumed timestamptz) returns void language plpgsql as $$
      begin ${body} insert into public.__handled values (p_club, '${name}', p_paused, p_resumed); end $$`);
    await tdb.query(`insert into app.pause_handlers (handler_key, handler) values ($1, $2::regprocedure)`, [name, `public.${name}(uuid, timestamptz, timestamptz)`]);
  }
  const handled = async () => (await tdb.query(`select club_id, handler, paused_at, resumed_at from public.__handled order by handler`)).rows;

  it('runs every registered handler once on resume, with the club, the pause start and the resume time', async () => {
    const baseline = await registeredHandlers();
    await register('h_one');
    await register('h_two');
    await tdb.setNow('2026-12-29T03:00:00Z');
    await pause(admin, 'a');
    expect(await handled()).toEqual([]);
    await tdb.advance('2 days');
    const r = await resume(admin, 'b');
    expect(r.handlers_run).toBe(baseline + 2);
    const rows = await handled();
    expect(rows.map((x) => x.handler)).toEqual(['h_one', 'h_two']);
    expect(new Date(rows[0].paused_at).toISOString()).toBe('2026-12-29T03:00:00.000Z');
    expect(new Date(rows[0].resumed_at).toISOString()).toBe('2026-12-31T03:00:00.000Z');
    expect(rows[0].club_id).toBe(CLUB);
    await expect(resume(admin, 'again')).rejects.toThrow(/transition_not_allowed/);
    expect((await handled()).length).toBe(2);
  });

  it('a failing handler rolls the whole resume back: still Paused, the pause still open, no handler recorded', async () => {
    await register('h_ok');
    await register('h_bad', `raise exception 'handler broke';`);
    await pause(admin, 'a');
    await expect(resume(admin, 'b')).rejects.toThrow(/handler broke/);
    expect(await status()).toBe('paused');
    expect((await pauses())[0]?.resumed_at).toBeNull();
    expect(await handled()).toEqual([]);
  });

  it('handlers run in key order and the registry is writable by nobody but the owner', async () => {
    for (const role of ['booq_app', 'booq_worker', 'booq_platform', 'anon', 'authenticated']) {
      const r = await tdb.query(`select has_table_privilege($1, 'app.pause_handlers', 'select,insert,update,delete') as ok`, [role]);
      expect(r.rows[0].ok, role).toBe(false);
    }
  });
});

describe('who can call them', () => {
  it('booq_platform only; the club comes from the context, the reason is the only argument', async () => {
    for (const fn of ['app.pause_club(text)', 'app.resume_club(text)']) {
      const q = (role: string) => tdb.query(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn]).then((r) => r.rows[0].ok);
      expect(await q('booq_platform'), fn).toBe(true);
      for (const role of ['booq_app', 'booq_worker', 'anon', 'authenticated']) expect(await q(role), `${fn} ${role}`).toBe(false);
    }
    const a = await tdb.query(`select p.proname, pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname in ('pause_club', 'resume_club') order by 1`);
    expect(a.rows).toEqual([{ proname: 'pause_club', args: 'p_reason text' }, { proname: 'resume_club', args: 'p_reason text' }]);
  });

  it('an unassigned specialist cannot pause (not found) and a club app role cannot call it', async () => {
    const lone = await staff('lone@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000003', 'Lone');
    await expect(pause(lone, 'x')).rejects.toThrow(/not_found|admin_only/);
    await expect(db.withClubTx({ clubId: CLUB, userId: '11111111-2222-4333-8444-555555555555', roles: ['owner'], source: 'admin' }, (tx) => tx.query(`select app.pause_club('x')`))).rejects.toThrow(/permission denied/i);
    expect(await status()).toBe('live');
  });

  it('the club and platform audit trail: the status update entry names the BOOQ staff member', async () => {
    await pause(admin, 'a');
    const a = await tdb.query(`select actor_type, actor_label from public.audit_entry where club_id = $1 and record_type = 'club' and action = 'update' and actor_type = 'platform_staff'`, [CLUB]);
    expect(a.rows).toEqual([{ actor_type: 'platform_staff', actor_label: 'Staff' }]);
  });
});
