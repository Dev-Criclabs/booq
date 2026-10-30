import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { checkImmutable, checkNames } from './check-migrations.mjs';

describe('F01-T36 migration number check', () => {
  it('accepts well-formed names in a feature block', () => {
    expect(checkNames(['0001_roles_schemas.sql', '0101_player_profile.sql', '0215_idempotency_key.sql', '0501_packages.sql'])).toEqual([]);
  });
  it('refuses a duplicate number, a bad name, and a number outside every block', () => {
    expect(checkNames(['0002_a.sql', '0002_b.sql']).join()).toMatch(/also used by/);
    expect(checkNames(['2_a.sql', '0003_Bad.sql', '0003-x.sql', '0003_x.SQL']).length).toBe(4);
    expect(checkNames(['0100_gap.sql', '0200_gap.sql']).join()).toMatch(/no feature block/);
  });
  it('refuses to edit, remove or rename a migration that is on the base branch', () => {
    const base = new Map([['0001_a.sql', 'one'], ['0002_b.sql', 'two']]);
    expect(checkImmutable(base, new Map([['0001_a.sql', 'one'], ['0002_b.sql', 'two'], ['0003_c.sql', 'three']]))).toEqual([]);
    expect(checkImmutable(base, new Map([['0001_a.sql', 'ONE'], ['0002_b.sql', 'two']])).join()).toMatch(/edited/);
    expect(checkImmutable(base, new Map([['0001_a.sql', 'one']])).join()).toMatch(/removed or renamed/);
  });
  it('the repository itself passes (CLI exits 0)', () => {
    const r = spawnSync('node', ['tools/check-migrations.mjs'], { encoding: 'utf8', env: { ...process.env, BASE_REF: 'HEAD' } });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});
