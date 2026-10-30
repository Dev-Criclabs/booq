import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F01-T33 lane D / DevOps worker proposal, migration 0021: the job queue has a role of its own, booq_queue,
// that owns the graphile_worker schema and can touch nothing else.
let tdb: TestDatabase;
beforeEach(async () => {
  tdb = await createTestDatabase();
});
afterEach(async () => {
  await tdb.close();
});

describe('booq_queue', () => {
  it('exists as a NOLOGIN role that cannot bypass RLS, create databases or roles', async () => {
    const r = (await tdb.query(`select rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolconfig from pg_roles where rolname = 'booq_queue'`)).rows[0];
    expect(r).toMatchObject({ rolcanlogin: false, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false });
    expect(r.rolconfig).toContain('TimeZone=Asia/Bangkok');
  });

  it('owns the graphile_worker schema, so the queue needs no CREATE on the database', async () => {
    const r = await tdb.query(`select pg_get_userbyid(nspowner) as owner from pg_namespace where nspname = 'graphile_worker'`);
    expect(r.rows).toEqual([{ owner: 'booq_queue' }]);
    const db = await tdb.query(`select has_database_privilege('booq_queue', current_database(), 'create') as c`);
    expect(db.rows[0].c).toBe(false);
  });

  it('has no access to public, app, platform or audit, and no table grant in them (without schema USAGE no function is reachable either)', async () => {
    for (const s of ['public', 'app', 'platform', 'audit']) {
      expect((await tdb.query(`select has_schema_privilege('booq_queue', $1, 'usage') as u, has_schema_privilege('booq_queue', $1, 'create') as c`, [s])).rows[0], s).toEqual({ u: false, c: false });
    }
    const t = await tdb.query(`select count(*)::int as n from information_schema.role_table_grants where grantee = 'booq_queue' and table_schema in ('public', 'app', 'platform', 'audit')`);
    expect(t.rows[0].n).toBe(0);
  });

  it('is not a member of any BOOQ role', async () => {
    const r = await tdb.query(`select count(*)::int as n from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member where u.rolname = 'booq_queue' and g.rolname like 'booq\\_%'`);
    expect(r.rows[0].n).toBe(0);
  });
});
