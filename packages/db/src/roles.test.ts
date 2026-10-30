import { afterEach, describe, expect, it } from 'vitest';
import { createProductionDatabase, createTestDatabase, type TestDatabase } from './testing/harness';

// F01-T03 / migration 0001 (F01 design 3.1; FA 4.1 to 4.3). Acceptance: roles exist and none
// has BYPASSRLS; anon and authenticated can read nothing; with no context the helpers return null.
const open: TestDatabase[] = [];
async function track(p: Promise<TestDatabase>) {
  const db = await p;
  open.push(db);
  return db;
}
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

const ROLES = ['booq_owner', 'booq_app', 'booq_worker', 'booq_platform'];

describe('roles and schemas (CC-1, CC-2, PDPA-01-AC1)', () => {
  it('creates the four roles; none can log in directly, bypass RLS, or is a superuser', async () => {
    const db = await track(createTestDatabase());
    const r = await db.query(
      'select rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname = any($1) order by rolname',
      [ROLES],
    );
    expect(r.rows.map((x) => x.rolname)).toEqual([...ROLES].sort());
    for (const row of r.rows) {
      expect(row, row.rolname).toMatchObject({ rolcanlogin: false, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false });
    }
  });

  it('sets every role to the Asia/Bangkok time zone', async () => {
    const db = await track(createTestDatabase());
    const r = await db.query('select rolname, rolconfig from pg_roles where rolname = any($1)', [ROLES]);
    for (const row of r.rows) expect(row.rolconfig, row.rolname).toContain('TimeZone=Asia/Bangkok');
  });

  it('creates schemas app, platform and audit owned by booq_owner', async () => {
    const db = await track(createTestDatabase());
    const r = await db.query(
      "select nspname, pg_get_userbyid(nspowner) as owner from pg_namespace where nspname in ('app','platform','audit') order by nspname",
    );
    expect(r.rows).toEqual([
      { nspname: 'app', owner: 'booq_owner' },
      { nspname: 'audit', owner: 'booq_owner' },
      { nspname: 'platform', owner: 'booq_owner' },
    ]);
  });

  it('installs btree_gist and pgcrypto', async () => {
    const db = await track(createTestDatabase());
    const r = await db.query("select extname from pg_extension where extname in ('btree_gist','pgcrypto') order by extname");
    expect(r.rows.map((x) => x.extname)).toEqual(['btree_gist', 'pgcrypto']);
  });

  it('the platform schema is usable by booq_platform and booq_worker only; nobody can create in public', async () => {
    const db = await track(createTestDatabase());
    const usage = async (role: string, schema: string) =>
      (await db.query('select has_schema_privilege($1, $2, $3) as ok', [role, schema, 'usage'])).rows[0].ok;
    expect(await usage('booq_platform', 'platform')).toBe(true);
    expect(await usage('booq_worker', 'platform')).toBe(true);
    expect(await usage('booq_app', 'platform')).toBe(false);
    expect(await usage('booq_app', 'app')).toBe(true);
    expect(await usage('booq_platform', 'audit')).toBe(false);
    for (const role of ['booq_app', 'booq_worker', 'booq_platform']) {
      const c = await db.query('select has_schema_privilege($1, $2, $3) as ok', [role, 'public', 'create']);
      expect(c.rows[0].ok, role).toBe(false);
    }
  });
});

describe('Supabase REST roles get nothing (decision R3, FA 4.1)', () => {
  it('anon and authenticated cannot use the public schema or read a table created later', async () => {
    const db = await track(createTestDatabase());
    await db.query('create table public.later_table (id int)');
    for (const role of ['anon', 'authenticated']) {
      const s = await db.query('select has_schema_privilege($1, $2, $3) as ok', [role, 'public', 'usage']);
      expect(s.rows[0].ok, `${role} schema usage`).toBe(false);
      const t = await db.query('select has_table_privilege($1, $2, $3) as ok', [role, 'public.later_table', 'select']);
      expect(t.rows[0].ok, `${role} select`).toBe(false);
    }
  });

  it('cannot execute the app helper functions (PUBLIC execute is revoked too)', async () => {
    const db = await track(createTestDatabase());
    for (const role of ['anon', 'authenticated']) {
      const r = await db.query('select has_function_privilege($1, $2, $3) as ok', [role, 'app.club_id()', 'execute']);
      expect(r.rows[0].ok, role).toBe(false);
    }
    for (const fn of ['club_id', 'user_id', 'roles', 'has_any_role', 'now']) {
      const acl = await db.query("select p.proacl::text as acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = $1", [fn]);
      expect(acl.rows[0].acl, fn).not.toMatch(/(^\{|,)=X/);
    }
  });
});

describe('request context helpers (CC-1: fail closed)', () => {
  it('return null and an empty role set when no context is set', async () => {
    const db = await track(createTestDatabase());
    const r = await db.query("select app.club_id() as club, app.user_id() as usr, app.roles() as roles, app.has_any_role('owner','front_desk') as any");
    expect(r.rows[0]).toEqual({ club: null, usr: null, roles: [], any: false });
  });

  it('read the transaction-local settings that withClubTx will set', async () => {
    const db = await track(createTestDatabase());
    const club = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
    const usr = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
    const c = await db.pool.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('app.club_id', $1, true), set_config('app.user_id', $2, true), set_config('app.roles', 'coach,player', true)", [club, usr]);
      const r = await c.query("select app.club_id()::text as club, app.user_id()::text as usr, app.roles() as roles, app.has_any_role('owner','player') as p, app.has_any_role('owner','front_desk') as f");
      expect(r.rows[0]).toEqual({ club, usr, roles: ['coach', 'player'], p: true, f: false });
      await c.query('commit');
      const after = await c.query('select app.club_id() as club, app.roles() as roles');
      expect(after.rows[0]).toEqual({ club: null, roles: [] });
    } finally {
      c.release();
    }
  });

  it('are callable by the three app roles', async () => {
    const db = await track(createTestDatabase());
    for (const role of ['booq_app', 'booq_worker', 'booq_platform']) {
      const r = await db.query('select has_function_privilege($1, $2, $3) as ok', [role, 'app.club_id()', 'execute']);
      expect(r.rows[0].ok, role).toBe(true);
    }
  });
});

describe('production app.now()', () => {
  it('is plain now() in a database built only from the migrations', async () => {
    const db = await track(createProductionDatabase());
    const c = await db.pool.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('app.test_now', '2000-01-01', true)");
      const r = await c.query('select app.now() = now() as same');
      expect(r.rows[0].same).toBe(true);
      await c.query('rollback');
    } finally {
      c.release();
    }
    const t = await db.query("select to_regclass('app.test_clock') as t");
    expect(t.rows[0].t).toBeNull();
  });

  it('migrating a second database on the same cluster works (roles already exist)', async () => {
    await track(createProductionDatabase());
    await track(createProductionDatabase());
  });
});
