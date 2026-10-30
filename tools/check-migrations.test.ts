import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { checkImmutable, checkLateRedefinitions, checkNames, definedObjects } from './check-migrations.mjs';

describe('F01-T36 migration number check', () => {
  it('accepts well-formed names in a feature block', () => {
    expect(checkNames(['0001_roles_schemas.sql', '0101_player_profile.sql', '0215_idempotency_key.sql', '0501_packages.sql'])).toEqual([]);
  });
  it('refuses a duplicate number, a bad name, and a number outside every block', () => {
    expect(checkNames(['0002_a.sql', '0002_b.sql']).join()).toMatch(/also used by/);
    expect(checkNames(['2_a.sql', '0003_Bad.sql', '0003-x.sql', '0003_x.SQL']).length).toBe(4);
    expect(checkNames(['0100_gap.sql', '0200_gap.sql']).join()).toMatch(/no feature block/);
  });
  it('knows every feature block of the build plan, in order, without a catch-all', () => {
    expect(checkNames(['0501_a.sql', '0601_a.sql', '0701_a.sql', '0801_a.sql', '0901_a.sql', '1001_a.sql', '1401_a.sql'])).toEqual([]);
    expect(checkNames(['1301_gap.sql']).join()).toMatch(/no feature block/);
    expect(checkNames(['1701_after_f16.sql', '2001_x.sql']).length).toBe(2);
    expect(checkNames(['0600_gap.sql', '0800_gap.sql']).length).toBe(2);
  });
  it('four digit numbers sort after 0999 as strings, so the loader order is the number order', () => {
    expect(['1001_a.sql', '0999_b.sql', '0501_c.sql'].sort()).toEqual(['0501_c.sql', '0999_b.sql', '1001_a.sql']);
  });
  it('refuses to edit, remove or rename a migration that is on the base branch', () => {
    const base = new Map([['0001_a.sql', 'one'], ['0002_b.sql', 'two']]);
    expect(checkImmutable(base, new Map([['0001_a.sql', 'one'], ['0002_b.sql', 'two'], ['0003_c.sql', 'three']]))).toEqual([]);
    expect(checkImmutable(base, new Map([['0001_a.sql', 'ONE'], ['0002_b.sql', 'two']])).join()).toMatch(/edited/);
    expect(checkImmutable(base, new Map([['0001_a.sql', 'one']])).join()).toMatch(/removed or renamed/);
  });
  it('reads the functions and views a migration defines, ignoring comments', () => {
    const sql = "-- create function app.not_this() returns void\ncreate function app.a() returns void language sql as 'select 1';\ncreate or replace function PUBLIC.B(x int) returns int language sql as 'select 1';\ncreate view public.v as select 1;";
    expect([...definedObjects(sql)].sort()).toEqual(['function app.a', 'function public.b', 'view public.v']);
  });
  it('refuses a new late migration that redefines what a higher numbered one on the base already defines', () => {
    const fn = (n: number) => `create or replace function app.f() returns int language sql as 'select ${n}';`;
    const base = new Map([['0225_a.sql', fn(1)], ['0801_b.sql', fn(2)]]);
    // a new 0226 redefining app.f would overwrite 0801 on a database that has it
    expect(checkLateRedefinitions(base, new Map([...base, ['0226_c.sql', fn(3)]])).join()).toMatch(/0226_c.sql: redefines function app.f, which 0801_b.sql/);
    // above the base file, or an object nobody else defines, or a file already on the base: fine
    expect(checkLateRedefinitions(base, new Map([...base, ['0802_c.sql', fn(3)]]))).toEqual([]);
    expect(checkLateRedefinitions(base, new Map([...base, ['0226_c.sql', 'create function app.g() returns int language sql as $$ select 1 $$;']]))).toEqual([]);
    expect(checkLateRedefinitions(base, base)).toEqual([]);
  });
  it('also covers constraints, policies and triggers per table (D159)', () => {
    const sql = "alter table public.club_setting add constraint c1 check (true), drop constraint if exists c0;\ncreate policy p1 on public.club_setting for select using (true);\ndrop policy p0 on public.club_feature;\ncreate trigger t1 before insert on public.club_setting for each row execute function f();";
    expect([...definedObjects(sql)].sort()).toEqual(['constraint public.club_setting.c0', 'constraint public.club_setting.c1', 'policy public.club_feature.p0', 'policy public.club_setting.p1', 'trigger public.club_setting.t1']);
    const base = new Map([['0801_b.sql', 'alter table public.club_setting add constraint c1 check (true);']]);
    expect(checkLateRedefinitions(base, new Map([...base, ['0226_c.sql', 'alter table public.club_setting drop constraint c1;']])).join()).toMatch(/constraint public.club_setting.c1/);
    expect(checkLateRedefinitions(base, new Map([...base, ['0226_c.sql', 'alter table public.club add constraint c1 check (true);']]))).toEqual([]);   // another table
  });
  it('the repository itself passes (CLI exits 0)', () => {
    const r = spawnSync('node', ['tools/check-migrations.mjs'], { encoding: 'utf8', env: { ...process.env, BASE_REF: 'HEAD' } });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});
