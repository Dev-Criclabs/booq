// Static checks from FA 4.5 / F01-T01:
//  - no-service-role: the Supabase service_role key is never used in the request path.
//  - no-secret-access: only packages/secrets reads the key variables or calls the secret
//    functions (F01-T09, SR-03). packages/db may name them (its harness and migrations tests).
//  - report-not-test (F01-T29, PLAT-07-AC7, D33): a report module that reads a table registered in
//    app.test_tables must use notTest() or name is_test in the same statement.
//  - no-raw-pg: a Postgres driver is imported only inside packages/db, so every query
//    goes through withClubTx (F01-T04).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCANNED_ROOTS = ['apps', 'packages'];
const SCANNED_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SKIPPED_DIR = /(^|\/)(node_modules|dist|\.next|\.turbo|coverage)(\/|$)/;
const DRIVER_ALLOWED_IN = 'packages/db/';
// Exact module specifiers only: pg, pg/..., pg-pool, pg-native, pg-promise, postgres.
const DRIVER = /(?:from\s+|require\(\s*|import\(\s*)['"](pg|pg\/[^'"]*|pg-pool|pg-native|pg-promise|postgres)['"]/;
const SERVICE_ROLE = /service[_-]?role/i;
const SECRETS_ALLOWED_IN = ['packages/secrets/', 'packages/db/'];
const SECRET_ACCESS = /SECRETS_(PRIVATE|PUBLIC)_KEY|\bread_secret(_worker)?\b|\bwrite_secret\b/;

// Tables that carry is_test: every `register_test_table('public.x', ...)` in the migrations (FA 4.5, D33).
const MIGRATIONS = fileURLToPath(new URL('../../packages/db/migrations/', import.meta.url));
function testTables() {
  const names = new Set();
  if (!existsSync(MIGRATIONS)) return names;
  for (const f of readdirSync(MIGRATIONS)) {
    if (!f.endsWith('.sql')) continue;
    for (const m of readFileSync(join(MIGRATIONS, f), 'utf8').matchAll(/register_test_table\(\s*'(?:public\.)?(\w+)'/g)) names.add(m[1]);
  }
  return names;
}
const TEST_TABLES = testTables();
// A report module: a file under a reports/ or daily-close/ folder, or named *.report.ts.
const REPORT_MODULE = /(^|\/)(reports?|daily-close)\/|\.report\.(ts|tsx|js|mjs)$/;
const STRING_LITERAL = /`[^`]*`|'[^'\n]*'|"[^"\n]*"/g;
const TABLE_READ = /\b(?:from|join)\s+(?:public\.)?(\w+)\b/gi;

function reportViolations(p, text) {
  const out = [];
  if (!REPORT_MODULE.test(p) || TEST_TABLES.size === 0) return out;
  for (const lit of text.matchAll(STRING_LITERAL)) {
    const body = lit[0];
    if (/\bnotTest\s*\(|\bis_test\b/.test(body)) continue;
    for (const m of body.matchAll(TABLE_READ)) {
      if (!TEST_TABLES.has(m[1])) continue;
      const line = text.slice(0, lit.index).split('\n').length;
      out.push({ path: p, line, rule: 'report-not-test' });
      break;
    }
  }
  return out;
}

export function isScanned(path) {
  const p = path.split(sep).join('/');
  return SCANNED_ROOTS.some((r) => p.startsWith(`${r}/`)) && SCANNED_EXT.test(p) && !SKIPPED_DIR.test(p);
}

export function findViolations(path, text) {
  const p = path.split(sep).join('/');
  const out = [];
  text.split('\n').forEach((line, i) => {
    if (SERVICE_ROLE.test(line)) out.push({ path: p, line: i + 1, rule: 'no-service-role' });
    if (!p.startsWith(DRIVER_ALLOWED_IN) && DRIVER.test(line)) out.push({ path: p, line: i + 1, rule: 'no-raw-pg' });
    if (!SECRETS_ALLOWED_IN.some((a) => p.startsWith(a)) && SECRET_ACCESS.test(line)) out.push({ path: p, line: i + 1, rule: 'no-secret-access' });
  });
  return [...out, ...reportViolations(p, text)];
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (SKIPPED_DIR.test(full.split(sep).join('/'))) continue;
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

export function scanRepository(root = '.') {
  const found = [];
  for (const r of SCANNED_ROOTS) {
    let start;
    try { start = join(root, r); statSync(start); } catch { continue; }
    for (const file of walk(start)) {
      const rel = relative(root, file);
      // Test files may mention the banned patterns as data.
      if (!isScanned(rel) || /\.test\.(ts|tsx|mjs)$/.test(rel)) continue;
      found.push(...findViolations(rel, readFileSync(file, 'utf8')));
    }
  }
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = scanRepository();
  for (const v of violations) console.error(`${v.path}:${v.line} ${v.rule}`);
  process.exit(violations.length ? 1 : 0);
}
