import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, loadMigrations } from './migrate';
import { createScratchDatabase, type TestDatabase } from './testing/harness';

let dir: string;
let db: TestDatabase;

function write(files: Record<string, string>) {
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'booq-mig-'));
  db = await createScratchDatabase();
});
afterEach(async () => {
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('migration runner (F01-T02; build plan section 4)', () => {
  it('applies files in number order, each once, and records them', async () => {
    write({ '0002_b.sql': 'create table b (id int);', '0001_a.sql': 'create table a (id int);' });
    const first = await applyMigrations(db.pool, dir);
    expect(first.applied).toEqual(['0001_a', '0002_b']);
    const second = await applyMigrations(db.pool, dir);
    expect(second.applied).toEqual([]);
    const rows = await db.query('select version from booq_migrations.applied order by version');
    expect(rows.rows.map((r) => r.version)).toEqual(['0001', '0002']);
  });

  it('refuses a duplicate number', () => {
    write({ '0001_a.sql': 'select 1;', '0001_other.sql': 'select 1;' });
    expect(() => loadMigrations(dir)).toThrow(/duplicate/i);
  });

  it('refuses a badly named file', () => {
    write({ 'x_a.sql': 'select 1;' });
    expect(() => loadMigrations(dir)).toThrow(/name/i);
  });

  it('refuses to run when a merged migration was edited', async () => {
    write({ '0001_a.sql': 'create table a (id int);' });
    await applyMigrations(db.pool, dir);
    write({ '0001_a.sql': 'create table a (id int, extra int);' });
    await expect(applyMigrations(db.pool, dir)).rejects.toThrow(/changed/i);
  });

  it('refuses a new migration numbered below one already applied', async () => {
    write({ '0002_b.sql': 'create table b (id int);' });
    await applyMigrations(db.pool, dir);
    write({ '0001_a.sql': 'create table a (id int);' });
    await expect(applyMigrations(db.pool, dir)).rejects.toThrow(/out of order/i);
  });

  it('a failing migration rolls back completely and is not recorded', async () => {
    write({ '0001_a.sql': 'create table a (id int); select 1/0;' });
    await expect(applyMigrations(db.pool, dir)).rejects.toThrow();
    const t = await db.query("select to_regclass('public.a') as t");
    expect(t.rows[0].t).toBeNull();
    const rows = await db.query('select count(*)::int as n from booq_migrations.applied');
    expect(rows.rows[0].n).toBe(0);
  });

  it('two runners at once apply each migration exactly once', async () => {
    write({ '0001_a.sql': 'create table a (id int);', '0002_b.sql': 'create table b (id int);' });
    const [x, y] = await Promise.all([applyMigrations(db.pool, dir), applyMigrations(db.pool, dir)]);
    expect(x.applied.length + y.applied.length).toBe(2);
  });
});
