import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { checkTableClasses } from './check';
import { collectRegistry, mergeFragments } from './index';
import type { Registry } from './types';
import { createProductionDatabase, type TestDatabase } from '../testing/harness';

// F01-T05: table class registry (S, D or P) and its check. A table with no class, a club table
// that does not force row-level security or lacks unique (club_id, id), and a personal-data
// column in a setup table all fail the check (F01 design 3.1; FA 4.5; PLAT-02-AC1, PDPA-01-AC1).
const open: TestDatabase[] = [];
async function prod() {
  const db = await createProductionDatabase();
  open.push(db);
  return db;
}
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

const club = (extra = '') => `
  create table public.widget (id uuid primary key default gen_random_uuid(), club_id uuid not null ${extra});
  alter table public.widget add constraint widget_club_id_id unique (club_id, id);
  alter table public.widget enable row level security;
  alter table public.widget force row level security;`;

describe('table class registry check', () => {
  it('passes on a database built only from the migrations', async () => {
    const db = await prod();
    const r = await checkTableClasses(db.pool, await collectRegistry());
    expect(r.problems).toEqual([]);
  });

  it('fails an unlisted table (the acceptance case)', async () => {
    const db = await prod();
    await db.query('create table public.fake_unlisted (id int)');
    const r = await checkTableClasses(db.pool, await collectRegistry());
    expect(r.problems.map((p) => [p.kind, p.table])).toEqual([['unclassified', 'public.fake_unlisted']]);
  });

  it('accepts a correct club table', async () => {
    const db = await prod();
    await db.query(club());
    const reg: Registry = { ...(await collectRegistry()), 'public.widget': { class: 'D' } };
    expect((await checkTableClasses(db.pool, reg)).problems).toEqual([]);
  });

  it('fails a club table that does not FORCE row-level security', async () => {
    const db = await prod();
    await db.query(club());
    await db.query('alter table public.widget no force row level security');
    const reg: Registry = { ...(await collectRegistry()), 'public.widget': { class: 'D' } };
    expect((await checkTableClasses(db.pool, reg)).problems.map((p) => p.kind)).toEqual(['no-force-rls']);
  });

  it('fails a club table with row-level security off', async () => {
    const db = await prod();
    await db.query(club());
    await db.query('alter table public.widget disable row level security');
    const reg: Registry = { ...(await collectRegistry()), 'public.widget': { class: 'S' } };
    expect((await checkTableClasses(db.pool, reg)).problems.map((p) => p.kind)).toContain('no-rls');
  });

  it('fails a club table without unique (club_id, id)', async () => {
    const db = await prod();
    await db.query(club());
    await db.query('alter table public.widget drop constraint widget_club_id_id');
    const reg: Registry = { ...(await collectRegistry()), 'public.widget': { class: 'D' } };
    expect((await checkTableClasses(db.pool, reg)).problems.map((p) => p.kind)).toEqual(['no-unique-club-id-id']);
  });

  it('fails a club table with no club_id column', async () => {
    const db = await prod();
    await db.query('create table public.widget (id uuid primary key); alter table public.widget enable row level security; alter table public.widget force row level security');
    const reg: Registry = { ...(await collectRegistry()), 'public.widget': { class: 'D' } };
    expect((await checkTableClasses(db.pool, reg)).problems.map((p) => p.kind)).toContain('no-club-id');
  });

  it("the club table itself ('self' scope) needs forced RLS but no club_id", async () => {
    const db = await prod();
    await db.query('create table public.club (id uuid primary key); alter table public.club enable row level security; alter table public.club force row level security');
    const reg: Registry = { ...(await collectRegistry()), 'public.club': { class: 'S', scope: 'self' } };
    expect((await checkTableClasses(db.pool, reg)).problems).toEqual([]);
  });

  it('fails a personal-data column in a setup table, unless that column is allowed', async () => {
    const db = await prod();
    await db.query(club(', phone text'));
    const base = await collectRegistry();
    const bad = await checkTableClasses(db.pool, { ...base, 'public.widget': { class: 'S' } });
    expect(bad.problems.map((p) => [p.kind, p.detail])).toEqual([['personal-column-in-setup-table', 'phone']]);
    const ok = await checkTableClasses(db.pool, { ...base, 'public.widget': { class: 'S', allowColumns: ['phone'] } });
    expect(ok.problems).toEqual([]);
    const dataTable = await checkTableClasses(db.pool, { ...base, 'public.widget': { class: 'D' } });
    expect(dataTable.problems).toEqual([]); // personal data is expected in class D
  });

  it('keeps class P in the platform schema and class S or D out of it', async () => {
    const db = await prod();
    await db.query('create table public.p_in_public (id int)');
    await db.query(`create table platform.s_in_platform (id uuid primary key, club_id uuid not null, unique (club_id, id));
      alter table platform.s_in_platform enable row level security; alter table platform.s_in_platform force row level security`);
    const base = await collectRegistry();
    const r = await checkTableClasses(db.pool, { ...base, 'public.p_in_public': { class: 'P' }, 'platform.s_in_platform': { class: 'D' } });
    expect(r.problems.map((p) => [p.kind, p.table]).sort()).toEqual([
      ['wrong-schema-for-class', 'platform.s_in_platform'],
      ['wrong-schema-for-class', 'public.p_in_public'],
    ]);
  });

  it('reports a registry entry with no table as a warning, not a failure', async () => {
    const db = await prod();
    const r = await checkTableClasses(db.pool, { ...(await collectRegistry()), 'public.not_built_yet': { class: 'D' } });
    expect(r.problems).toEqual([]);
    expect(r.warnings.map((w) => w.table)).toEqual(['public.not_built_yet']);
  });
});

describe('registry fragments (build plan section 4)', () => {
  it('collects one fragment per feature from the registry folder', async () => {
    const reg = await collectRegistry();
    expect(reg['booq_migrations.applied']).toEqual({ class: 'infra' });
  });

  it('refuses a table classified twice', () => {
    expect(() => mergeFragments({ f01: { 'public.a': { class: 'D' } }, f03: { 'public.a': { class: 'S' } } })).toThrow(/public\.a.*f01.*f03/);
  });

  it('refuses a class that is not S, D, P or infra, and a bad table name', () => {
    expect(() => mergeFragments({ f01: { 'public.a': { class: 'X' as never } } })).toThrow(/class/i);
    expect(() => mergeFragments({ f01: { widget: { class: 'D' } } })).toThrow(/schema\.table/i);
  });
});

describe('CI entry point', () => {
  it('node tools/check-table-classes.mjs exits 0 on the repository', () => {
    const r = spawnSync('node', ['tools/check-table-classes.mjs'], { encoding: 'utf8', env: process.env, timeout: 120_000 });
    expect(r.stderr + r.stdout).toMatch(/table classes/i);
    expect(r.status).toBe(0);
  }, 150_000);
});
