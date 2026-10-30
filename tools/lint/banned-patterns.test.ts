import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { findViolations, isScanned } from './banned-patterns.mjs';

describe('F01-T01 banned patterns (FA 4.5 static checks)', () => {
  it('flags service_role anywhere in app code', () => {
    const v = findViolations('apps/web/src/a.ts', "const k = process.env.SUPABASE_SERVICE_ROLE_KEY;");
    expect(v.map((x) => x.rule)).toContain('no-service-role');
  });

  it('allows service_role only under apps/staff-invite (SR-06, F01-T17b)', () => {
    const code = 'const k = process.env.SUPABASE_SERVICE_ROLE_KEY;';
    expect(findViolations('apps/staff-invite/src/env.ts', code)).toEqual([]);
    for (const p of ['apps/platform/src/a.ts', 'apps/web/src/a.ts', 'packages/auth/src/a.ts', 'apps/staff-invite-extra/src/a.ts']) {
      expect(findViolations(p, code).map((x) => x.rule), p).toContain('no-service-role');
    }
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

  it('flags reading the secret keys or calling the secret functions outside packages/secrets (SR-03)', () => {
    for (const code of ["process.env.SECRETS_PRIVATE_KEY", "const k = env.SECRETS_PUBLIC_KEY;", "tx.query('select app.read_secret($1)', [k])", "select app.read_secret_worker('x')", "select app.write_secret(a,b,c,d)"]) {
      expect(findViolations('apps/platform/src/a.ts', code).map((x) => x.rule), code).toContain('no-secret-access');
      expect(findViolations('packages/line/src/a.ts', code).map((x) => x.rule), code).toContain('no-secret-access');
    }
    expect(findViolations('packages/secrets/src/a.ts', 'process.env.SECRETS_PRIVATE_KEY')).toEqual([]);
    expect(findViolations('packages/db/src/a.ts', "select app.read_secret('x')")).toEqual([]);
    expect(findViolations('apps/web/src/a.ts', 'const readSecretValue = 1; // read_secrets list')).toEqual([]);
  });

  describe('report-not-test (F01-T29; PLAT-07-AC7; D33)', () => {
    const rule = (path: string, code: string) => findViolations(path, code).map((x) => x.rule);
    it('flags a report module that reads a table with is_test without the helper', () => {
      for (const path of ['packages/domain/src/reports/revenue.ts', 'apps/web/src/reports/bookings.ts', 'packages/domain/src/daily-close/close.ts', 'apps/platform/src/usage/x.report.ts']) {
        expect(rule(path, "tx.query(`select count(*) from public.booking where status = 'confirmed'`)"), path).toContain('report-not-test');
        expect(rule(path, 'tx.query("select 1 from booking b join payment p on p.club_id = b.club_id")'), path).toContain('report-not-test');
      }
    });
    it('passes when the statement uses notTest() or names is_test', () => {
      const path = 'packages/domain/src/reports/revenue.ts';
      expect(rule(path, "tx.query(`select count(*) from public.booking b where ${notTest('b')}`)")).toEqual([]);
      expect(rule(path, "tx.query(`select count(*) from public.booking where is_test = false`)")).toEqual([]);
    });
    it('ignores tables without the flag, and files that are not report modules', () => {
      expect(rule('packages/domain/src/reports/a.ts', "tx.query(`select * from public.club_setting`)")).toEqual([]);
      expect(rule('packages/domain/src/booking/a.ts', "tx.query(`select * from public.booking`)")).toEqual([]);
    });
    it('does not take a table-like word in prose or a look-alike name', () => {
      expect(rule('packages/domain/src/reports/a.ts', "// the booking count is built from the occupancy table\nconst x = 'from booking_rules';")).toEqual([]);
    });
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
