// Static checks from FA 4.5 / F01-T01:
//  - no-service-role: the Supabase service_role key is never used in the request path.
//  - no-raw-pg: a Postgres driver is imported only inside packages/db, so every query
//    goes through withClubTx (F01-T04).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCANNED_ROOTS = ['apps', 'packages'];
const SCANNED_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SKIPPED_DIR = /(^|\/)(node_modules|dist|\.next|\.turbo|coverage)(\/|$)/;
const DRIVER_ALLOWED_IN = 'packages/db/';
// Exact module specifiers only: pg, pg/..., pg-pool, pg-native, pg-promise, postgres.
const DRIVER = /(?:from\s+|require\(\s*|import\(\s*)['"](pg|pg\/[^'"]*|pg-pool|pg-native|pg-promise|postgres)['"]/;
const SERVICE_ROLE = /service[_-]?role/i;

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
  });
  return out;
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
