// CI entry point named in .github/workflows/ci.yml (F01-T36; build plan section 4).
//   - every file is NNNN_name.sql (four digits, lower case words)
//   - numbers are unique and each lies in a feature block (F01 0001-0099, F02 0101-0199,
//     F03 0201-0299, F04 0301-0399, F05 0401-0499, 0501 and up for later features)
//   - a migration already on the base branch is never edited, renamed or removed
//     (a fix is a new migration). The base is BASE_REF, else origin/main when it exists.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BLOCKS = [
  { name: 'F01', from: 1, to: 99 },
  { name: 'F02', from: 101, to: 199 },
  { name: 'F03', from: 201, to: 299 },
  { name: 'F04', from: 301, to: 399 },
  { name: 'F05', from: 401, to: 499 },
  { name: 'later', from: 501, to: 9999 },
];
const FILE = /^(\d{4})_[a-z0-9]+(_[a-z0-9]+)*\.sql$/;

/** Pure check of a list of file names. Returns a list of problems (strings). */
export function checkNames(names) {
  const problems = [];
  const seen = new Map();
  for (const name of names) {
    const m = FILE.exec(name);
    if (!m) { problems.push(`${name}: not NNNN_lower_case_name.sql`); continue; }
    const n = Number(m[1]);
    if (seen.has(n)) problems.push(`${name}: number ${m[1]} is also used by ${seen.get(n)}`);
    seen.set(n, name);
    if (!BLOCKS.some((b) => n >= b.from && n <= b.to)) problems.push(`${name}: number ${m[1]} is in no feature block`);
  }
  return problems;
}

/** Files of the base that are missing or different now. `base` maps name to text; `current` likewise. */
export function checkImmutable(base, current) {
  const problems = [];
  for (const [name, text] of base) {
    if (!current.has(name)) problems.push(`${name}: exists on the base branch and was removed or renamed`);
    else if (current.get(name) !== text) problems.push(`${name}: exists on the base branch and was edited (write a new migration)`);
  }
  return problems;
}

function baseFiles(dir, ref) {
  try {
    const list = execFileSync('git', ['ls-tree', '--name-only', ref, `${dir}/`], { encoding: 'utf8' }).split('\n').filter(Boolean);
    const out = new Map();
    for (const path of list) {
      if (!path.endsWith('.sql')) continue;
      out.set(path.split('/').pop(), execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' }));
    }
    return out;
  } catch {
    return null;
  }
}

export function run(dir = 'packages/db/migrations', env = process.env) {
  const names = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const problems = checkNames(names);
  const current = new Map(names.map((n) => [n, readFileSync(join(dir, n), 'utf8')]));
  const ref = env.BASE_REF || 'origin/main';
  const base = baseFiles(dir, ref);
  if (base === null) console.log(`::notice::migrations: base ${ref} not available; the never-edited rule was not checked`);
  else problems.push(...checkImmutable(base, current));
  return { problems, count: names.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync('packages/db/migrations')) { console.error('no packages/db/migrations'); process.exit(1); }
  const { problems, count } = run();
  for (const p of problems) console.error(`::error::migrations: ${p}`);
  console.log(`Migrations: ${problems.length === 0 ? 'OK' : 'FAILED'} (${count} files, ${problems.length} problems)`);
  process.exit(problems.length ? 1 : 0);
}
