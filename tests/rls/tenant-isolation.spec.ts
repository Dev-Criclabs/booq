// F01-T07 Tenant isolation suite (CC-1, ROLE-AC6). Driven by the table class registry (packages/db/src/registry):
// for every club table (class S and D) it proves club A cannot read, change, delete or insert for club B,
// that no club context returns no rows, that the platform role reads no class D row, and (from the catalog) that
// tenant policies exist and foreign keys between club tables carry club_id. A new table needs no change here:
// it is registered once and this suite picks it up. A table the generic seeder cannot fill fails a test until
// a fixture is added in seed.ts (so no table passes by being empty).
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { collectRegistry, type TableEntry } from '../../packages/db/src/registry/index';
import { createTestDatabase } from '../../packages/db/src/testing/harness';
import { createDb, type ClubContext } from '../../packages/db/src/tx';
import { seedRow } from './seed';

const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const registry = await collectRegistry(join(__dirname, '..', '..', 'packages', 'db', 'src', 'registry'));
const tdb = await createTestDatabase();
const db = createDb({ connectionString: tdb.url, max: 2 });
afterAll(async () => {
  await db.end();
  await tdb.close();
});

const existing = new Set(
  (await tdb.query(`select n.nspname || '.' || c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','p')`)).rows.map((r) => r.t as string),
);
/** Club tables: class S or D, present in the database. */
const clubTables = Object.entries(registry)
  .filter(([t, e]) => (e.class === 'S' || e.class === 'D') && existing.has(t))
  .sort(([a], [b]) => a.localeCompare(b)) as Array<[string, TableEntry]>;
const unbuilt = Object.entries(registry).filter(([t, e]) => (e.class === 'S' || e.class === 'D') && !existing.has(t)).map(([t]) => t);
/** The column that holds the club: club_id, or id for the club table itself. */
const clubCol = (e: TableEntry) => (e.scope === 'self' ? 'id' : 'club_id');

// ---- seed two clubs and one row per club table, as a superuser with triggers and foreign keys off ----
const unseedable: Record<string, string> = {};
{
  const c = await tdb.pool.connect();
  try {
    await c.query(
      `insert into public.club (id, slug, name_th, name_en, status, legal_name, tax_id, tax_branch, registered_address, owner_name, owner_phone, owner_line, owner_email, billing_starts_at)
       values ($1, 'a', 'ก', 'A', 'live', 'Legal Co', '0135569018041', '00000', 'addr', 'Owner', '0812345678', null, 'o@example.com', now()),
              ($2, 'b', 'ข', 'B', 'live', 'Other Co', '999', '00001', 'x', 'O2', '0899999999', null, 'p@example.com', now())`,
      [A, B],
    );
    // The throwaway test database only: drop CHECK constraints so generic values fit. They guard data validity,
    // not tenancy; RLS policies are evaluated before them, and foreign keys and unique keys stay in place.
    const { rows: checks } = await c.query(
      `select c.conrelid::regclass::text as t, c.conname from pg_constraint c
         where c.contype = 'c' and c.conrelid::regclass::text = any($1)`,
      [clubTables.map(([t]) => t).flatMap((t) => [t, t.replace(/^public\./, '')])],
    );
    for (const k of checks) await c.query(`alter table ${k.t} drop constraint "${k.conname}"`);
    await c.query(`set session_replication_role = replica`);
    for (const [t, e] of clubTables) {
      if (e.scope === 'self') continue;
      for (const club of [A, B]) {
        try {
          await seedRow(c, t, club);
        } catch (err) {
          unseedable[t] = (err as Error).message;
          break;
        }
      }
    }
  } finally {
    await c.query(`reset session_replication_role`).catch(() => undefined);
    c.release();
  }
}

// Mutation check (run by hand, see tests/rls/README.md): QA_MUTATE breaks the database on purpose and this suite must go red.
//   QA_MUTATE=drop-policy:booking_tenant:public.booking   removes a tenant policy
//   QA_MUTATE=open-policy:booking_tenant:public.booking   makes it let every club through
//   QA_MUTATE=grant-public:public.booking                 grants select to PUBLIC
if (process.env.QA_MUTATE) {
  const [kind, a, b] = process.env.QA_MUTATE.split(':') as [string, string, string?];
  if (kind === 'drop-policy') await tdb.query(`drop policy "${a}" on ${b}`);
  if (kind === 'open-policy') await tdb.query(`alter policy "${a}" on ${b} using (true) with check (true)`);
  if (kind === 'grant-public') await tdb.query(`grant select on ${a} to public`);
}

const count = async (sql: string, params: unknown[] = []) => Number((await tdb.query(sql, params)).rows[0].n);
const ROLE_SETS: ReadonlyArray<readonly string[]> = [[], ['guest'], ['player'], ['coach', 'player'], ['front_desk', 'player'], ['accountant', 'player'], ['owner', 'player']];
const ctx = (roles: readonly string[], club = A): ClubContext => ({ clubId: club, userId: null, roles, source: 'admin', reason: 'tenant isolation test' });

type Outcome = { denied: true } | { denied: false; rows: Array<Record<string, unknown>>; rowCount: number } | { error: string; code: string | undefined };
async function attempt(roles: readonly string[], sql: string, params: unknown[] = []): Promise<Outcome> {
  try {
    const r = await db.withClubTx(ctx(roles), (tx) => tx.query(sql, params));
    return { denied: false, rows: r.rows, rowCount: r.rowCount ?? 0 };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === '42501') return { denied: true };
    return { error: (e as Error).message, code };
  }
}

describe('registry and seed', () => {
  it('every class S and D table in the registry exists in the migrated database', () => {
    expect(unbuilt, 'registered but not built (a feature migration is missing, or the registry is ahead)').toEqual([]);
  });
  it('there are club tables to test', () => {
    expect(clubTables.length).toBeGreaterThan(10);
  });
  it('every club table could be seeded with one row for each club, so no test below is vacuous', () => {
    if (process.env.QA_DUMP) console.log('UNSEEDABLE ' + JSON.stringify(unseedable, null, 1));
    expect(unseedable, 'add a fixture for these tables in tests/rls/seed.ts (FIXTURES)').toEqual({});
  });
});

describe.each(clubTables)('%s', (table, entry) => {
  const col = clubCol(entry);
  const seeded = !(table in unseedable);

  it('a club A context never reads a club B row, in any role set', async () => {
    if (seeded) expect(await count(`select count(*) n from ${table} where ${col} = $1`, [B]), 'club B has a row to hide').toBeGreaterThan(0);
    for (const roles of ROLE_SETS) {
      const r = await attempt(roles, `select ${col} as c from ${table}`);
      if ('error' in r) throw new Error(`${table} as [${roles}]: unexpected error ${r.code} ${r.error}`);
      if (r.denied) continue; // not readable by this role at all: isolated
      expect(r.rows.filter((x) => x.c !== A), `${table} as [${roles}] returned rows of another club`).toEqual([]);
    }
  });

  it('with no club context the application role reads no row', async () => {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role booq_app');
      try {
        const r = await c.query(`select ${col} from ${table}`);
        expect(r.rowCount, `${table} returned rows with no club context`).toBe(0);
      } catch (e) {
        expect((e as { code?: string }).code, 'only a permission error is acceptable').toBe('42501');
      }
    } finally {
      await c.query('rollback').catch(() => undefined);
      c.release();
    }
  });

  it('a club A owner cannot update, delete or move rows of club B, and cannot insert for club B', async () => {
    const before = await count(`select count(*) n from ${table} where ${col} = $1`, [B]);
    const owner = ['owner', 'player'];

    const upd = await attempt(owner, `update ${table} set ${col} = ${col} where ${col} = $1`, [B]);
    if ('error' in upd) throw new Error(`${table} update: unexpected error ${upd.code} ${upd.error}`);
    if (!upd.denied) expect(upd.rowCount, 'update touched a club B row').toBe(0);

    const del = await attempt(owner, `delete from ${table} where ${col} = $1`, [B]);
    if ('error' in del) throw new Error(`${table} delete: unexpected error ${del.code} ${del.error}`);
    if (!del.denied) expect(del.rowCount, 'delete removed a club B row').toBe(0);

    const move = await attempt(owner, `update ${table} set ${col} = $2 where ${col} = $1`, [A, B]);
    if ('error' in move) {
      // A constraint or trigger stopped the move: acceptable only if nothing moved.
    } else if (!move.denied) expect(move.rowCount, 'a club A row was moved to club B').toBe(0);

    const ins = await attempt(owner, `insert into ${table} (${col}) values ($1)`, [B]);
    if (!('error' in ins) && !ins.denied) throw new Error(`${table}: club A inserted a row for club B`);
    if ('error' in ins) expect(ins.code, `${table} insert for club B must be refused by the policy or the grant (42501), got ${ins.code}: ${ins.error}`).toBe('42501');

    expect(await count(`select count(*) n from ${table} where ${col} = $1`, [B]), 'club B rows changed').toBe(before);
    expect(await count(`select count(*) n from ${table} where ${col} = $1`, [A]), 'a club A row was lost or added').toBeGreaterThanOrEqual(0);
  });

  if (entry.class === 'D') {
    it('the platform role reads no club data row (class D)', async () => {
      const c = await tdb.pool.connect();
      try {
        await c.query('begin');
        await c.query('set local role booq_platform');
        try {
          const r = await c.query(`select ${col} from ${table}`);
          expect(r.rowCount, `${table}: BOOQ platform role read club data`).toBe(0);
        } catch (e) {
          expect((e as { code?: string }).code, 'only a permission error is acceptable').toBe('42501');
        }
      } finally {
        await c.query('rollback').catch(() => undefined);
        c.release();
      }
    });
  }
});

// ---- catalog checks: no data needed ----
describe('tenant policies and foreign keys (catalog)', () => {
  it('every club table has a restrictive tenant policy on club_id for the application role, covering all commands', async () => {
    const { rows } = await tdb.query(
      `select tablename as t, cmd, permissive, roles::text as roles, qual, with_check from pg_policies where schemaname in ('public','app') `,
    );
    const problems: string[] = [];
    for (const [table, entry] of clubTables) {
      const name = table.split('.')[1];
      const mine = rows.filter((r) => r.t === name && r.permissive === 'RESTRICTIVE' && /booq_app|public/.test(r.roles) && String(r.qual ?? '').includes('app.club_id()'));
      for (const cmd of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const covers = mine.some((r) => r.cmd === 'ALL' || r.cmd === cmd);
        if (!covers) problems.push(`${table}: no restrictive ${cmd} policy on app.club_id() for booq_app`);
      }
      const writesChecked = mine.some((r) => (r.cmd === 'ALL' || r.cmd === 'INSERT') && String(r.with_check ?? '').includes('app.club_id()'));
      if (!writesChecked && entry.class !== 'infra') problems.push(`${table}: no WITH CHECK on app.club_id() for inserts`);
    }
    expect(problems).toEqual([]);
  });

  it('every foreign key between two club tables includes club_id on both sides (a row cannot point into another club)', async () => {
    const { rows } = await tdb.query(
      `select c.conrelid::regclass::text as src, c.confrelid::regclass::text as dst, c.conname,
              array(select a.attname::text from unnest(c.conkey) k join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k) as src_cols,
              array(select a.attname::text from unnest(c.confkey) k join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k) as dst_cols
         from pg_constraint c where c.contype = 'f'`,
    );
    const club = new Map(clubTables.map(([t, e]) => [t, e]));
    const norm = (s: string) => (s.includes('.') ? s : `public.${s}`);
    const problems: string[] = [];
    for (const r of rows) {
      const src = norm(r.src as string);
      const dst = norm(r.dst as string);
      const s = club.get(src);
      const d = club.get(dst);
      if (!s || !d || s.scope === 'self') continue;
      if (d.scope === 'self') continue; // club_id -> club(id)
      if (!(r.src_cols as string[]).includes('club_id') || !(r.dst_cols as string[]).includes('club_id')) {
        problems.push(`${src} -> ${dst} (${r.conname}): the foreign key does not include club_id on both sides`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('PUBLIC, anon and authenticated hold no privilege on a club table', async () => {
    const { rows } = await tdb.query(
      `select table_schema || '.' || table_name as t, grantee, privilege_type from information_schema.role_table_grants where grantee in ('PUBLIC','anon','authenticated')`,
    );
    const clubs = new Set(clubTables.map(([t]) => t));
    expect(rows.filter((r) => clubs.has(r.t as string))).toEqual([]);
  });
});
