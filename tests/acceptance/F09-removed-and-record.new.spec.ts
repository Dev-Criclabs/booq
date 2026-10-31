// F09 (QA): CANCEL-04-AC12 (no check in anywhere: the canvas notes about "Late after 15 minutes" and a check in QR are not built; CLAUDE.md "Removed, do not build")
// and CANCEL-03-AC14 (a closure records its courts, range, repeat, reason and staff member). F11-T26 uses the same scan for A3, A11, A15 and the slip queue.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_PAGES, permissionNames } from '../../packages/auth/src/index';
import { createTestDatabase, type TestDatabase } from '../../packages/db/src/testing/harness';
import { repoRoot } from './spec-ids';

const ROOT = repoRoot();
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? (n === 'node_modules' || n === '.next' ? [] : walk(p)) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
const REMOVED = /check-?in|qr-?check|gift|voucher|message-?editor|compose|broadcast|campaign|slip|backup-?mode/i;

describe('F09/CANCEL-04-AC12 nothing removed is built: no check in, no gift voucher, no message editor, no slip queue', () => {
  it('no route path under apps/web or apps/platform names a removed feature', () => {
    const paths: string[] = [];
    for (const dir of ['apps/web/src', 'apps/platform/src']) for (const f of walk(resolve(ROOT, dir))) for (const m of readFileSync(f, 'utf8').matchAll(/\bpath:\s*['"`]([^'"`]+)['"`]/g)) paths.push(`${f.replace(ROOT + '/', '')} ${m[1]}`);
    expect(paths.length).toBeGreaterThan(100);
    expect(paths.filter((p) => REMOVED.test(p.split(' ')[1]!)), 'routes of removed features').toEqual([]);
  });
  it('no app page folder is a removed feature', () => {
    const pages = walk(resolve(ROOT, 'apps/web/src/app')).map((f) => f.replace(ROOT + '/', '')).filter((f) => /page\.tsx$/.test(f));
    expect(pages.length).toBeGreaterThan(8);
    expect(pages.filter((p) => REMOVED.test(p)), 'pages of removed features').toEqual([]);
  });
  it('the admin sidebar lists no A3, A4, A11 or A15, and no permission names a removed feature', () => {
    const ids = ADMIN_PAGES.map((p) => p.id as string);
    for (const gone of ['A3', 'A4', 'A11', 'A15']) expect(ids, gone).not.toContain(gone);
    expect([...permissionNames()].filter((n) => REMOVED.test(n)), 'permissions of removed features').toEqual([]);
  });
  it('the database has no check in column or table and no slip table (Beam only for Hunter)', async () => {
    const tdb = await createTestDatabase();
    try {
      const rows = (await tdb.query(`select table_name, column_name from information_schema.columns where table_schema = 'public' and (column_name ~* 'check_?in|slip|voucher' or table_name ~* 'check_?in|slip|voucher|gift')`)).rows;
      expect(rows, 'columns or tables of removed features').toEqual([]);
    } finally {
      await tdb.close();
    }
  }, 120_000);
});

describe('F09/CANCEL-03-AC14 a closure records its courts, range, repeat, reason and the staff member', () => {
  let tdb: TestDatabase;
  beforeAll(async () => {
    tdb = await createTestDatabase();
  }, 120_000);
  afterAll(async () => {
    await tdb?.close();
  });
  it('the closure table and its courts table hold each of them, and the reason and the staff member cannot be empty', async () => {
    const cols = (await tdb.query(`select column_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'closure'`)).rows as Array<{ column_name: string; is_nullable: string }>;
    const by = new Map(cols.map((c) => [c.column_name, c.is_nullable]));
    for (const c of ['range_start', 'range_end', 'repeat_rule', 'reason', 'created_by']) expect(by.has(c), `closure.${c}`).toBe(true);
    for (const c of ['range_start', 'range_end', 'reason', 'created_by']) expect(by.get(c), `closure.${c} may not be null`).toBe('NO');
    expect(by.get('repeat_rule'), 'a one off closure has no repeat').toBe('YES');
    const courts = (await tdb.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'closure_resource'`)).rows.map((r) => r.column_name as string);
    expect(courts).toContain('closure_id');
    expect(courts).toContain('resource_id');
  });
});
