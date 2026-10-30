import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';

// SQL-first migrations (build plan section 4): numbered files, one transaction each,
// a merged file is never edited (its checksum is stored), numbers only go up.
export interface Migration {
  version: string; // '0001'
  name: string; // '0001_roles_schemas'
  sql: string;
  checksum: string;
}

const FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export function loadMigrations(dir: string): Migration[] {
  const found = new Map<string, Migration>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const m = FILE.exec(file);
    if (!m) throw new Error(`Bad migration file name: ${file} (expected 0001_snake_case.sql)`);
    const version = m[1]!;
    if (found.has(version)) throw new Error(`Duplicate migration number ${version}: ${found.get(version)!.name} and ${file}`);
    const sql = readFileSync(join(dir, file), 'utf8');
    found.set(version, {
      version,
      name: file.replace(/\.sql$/, ''),
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }
  return [...found.values()].sort((a, b) => a.version.localeCompare(b.version));
}

const LOCK_KEY = 7_244_001; // arbitrary constant; one migrator at a time

export async function applyMigrations(pool: Pool, dir: string): Promise<{ applied: string[] }> {
  const migrations = loadMigrations(dir);
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query('create schema if not exists booq_migrations');
    await client.query(`create table if not exists booq_migrations.applied (
      version text primary key,
      name text not null,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`);
    const done = new Map<string, string>(
      (await client.query('select version, checksum from booq_migrations.applied')).rows.map((r) => [r.version, r.checksum]),
    );
    const highest = [...done.keys()].sort().pop() ?? '0000';

    for (const m of migrations) {
      const recorded = done.get(m.version);
      if (recorded !== undefined) {
        if (recorded !== m.checksum) throw new Error(`Migration ${m.name} changed after it was applied; write a new migration instead`);
        continue;
      }
      if (m.version < highest) throw new Error(`Migration ${m.name} is out of order: ${highest} is already applied`);
      try {
        await client.query('begin');
        await client.query(m.sql);
        await client.query('insert into booq_migrations.applied (version, name, checksum) values ($1, $2, $3)', [m.version, m.name, m.checksum]);
        await client.query('commit');
      } catch (e) {
        await client.query('rollback');
        throw e;
      }
      applied.push(m.name);
    }
    return { applied };
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
