// Shared test world for the database suites: two clubs, one seeded row per club table, a restricted application connection.
// Built once per test file. Seeding uses a superuser with triggers and foreign keys off (see seed.ts).
import { join } from 'node:path';
import { collectRegistry, type TableEntry } from '../../packages/db/src/registry/index';
import { createTestDatabase } from '../../packages/db/src/testing/harness';
import { createDb } from '../../packages/db/src/tx';
import { seedRow } from './seed';

export const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
export const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

/** The column that holds the club: club_id, or id for the club table itself. */
export const clubCol = (e: TableEntry) => (e.scope === 'self' ? 'id' : 'club_id');

export async function buildWorld() {
  const registry = await collectRegistry(join(__dirname, '..', '..', 'packages', 'db', 'src', 'registry'));
  const tdb = await createTestDatabase();
  const db = createDb({ connectionString: tdb.url, max: 2 });

  const existing = new Set(
    (await tdb.query(`select n.nspname || '.' || c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','p')`)).rows.map((r) => r.t as string),
  );
  /** Club tables: class S or D, present in the database. */
  const clubTables = Object.entries(registry)
    .filter(([t, e]) => (e.class === 'S' || e.class === 'D') && existing.has(t))
    .sort(([a], [b]) => a.localeCompare(b)) as Array<[string, TableEntry]>;
  const unbuilt = Object.entries(registry).filter(([t, e]) => (e.class === 'S' || e.class === 'D') && !existing.has(t)).map(([t]) => t);

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


  const close = async () => {
    await db.end();
    await tdb.close();
  };
  return { registry, tdb, db, clubTables, unbuilt, unseedable, close };
}
