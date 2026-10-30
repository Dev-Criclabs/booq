import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { findViolations, isScanned } from './banned-patterns.mjs';

describe('F01-T01 banned patterns (FA 4.5 static checks)', () => {
  it('flags service_role anywhere in app code', () => {
    const v = findViolations('apps/web/src/a.ts', "const k = process.env.SUPABASE_SERVICE_ROLE_KEY;");
    expect(v.map((x) => x.rule)).toContain('no-service-role');
  });

  it('flags importing pg outside packages/db', () => {
    expect(findViolations('packages/auth/src/a.ts', "import pg from 'pg';").map((x) => x.rule)).toContain('no-raw-pg');
    expect(findViolations('apps/web/src/a.ts', 'const { Pool } = require("pg");').map((x) => x.rule)).toContain('no-raw-pg');
    expect(findViolations('apps/worker/src/a.ts', "import postgres from 'postgres';").map((x) => x.rule)).toContain('no-raw-pg');
    expect(findViolations('apps/web/src/a.ts', "import { Pool } from 'pg-pool';").map((x) => x.rule)).toContain('no-raw-pg');
  });

  it('allows pg inside packages/db only', () => {
    expect(findViolations('packages/db/src/pool.ts', "import pg from 'pg';")).toEqual([]);
  });

  it('does not flag look-alike module names', () => {
    expect(findViolations('packages/auth/src/a.ts', "import x from 'pgvector'; import y from './pg-helpers';")).toEqual([]);
  });

  it('scans source files and skips node_modules and build output', () => {
    expect(isScanned('apps/web/src/a.ts')).toBe(true);
    expect(isScanned('packages/db/src/a.mjs')).toBe(true);
    expect(isScanned('apps/web/node_modules/x/index.js')).toBe(false);
    expect(isScanned('apps/web/.next/server.js')).toBe(false);
    expect(isScanned('docs/architecture/foundation.md')).toBe(false);
  });

  it('the repository itself has no violations (CLI exits 0)', () => {
    const r = spawnSync('node', ['tools/lint/banned-patterns.mjs'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
  });
});
