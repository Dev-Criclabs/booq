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

// One number block per feature (docs/architecture/build-plan.md section 4; proposal docs/proposals/migration-blocks.md).
// Numbers are four digits and compare as strings, so 1001 sorts after 0999. A number in a gap belongs to no feature.
export const BLOCKS = [
  { name: 'F01', from: 1, to: 99 },
  { name: 'F02', from: 101, to: 199 },
  { name: 'F03', from: 201, to: 299 },
  { name: 'F04', from: 301, to: 399 },
  { name: 'F05', from: 401, to: 499 },
  { name: 'F06', from: 501, to: 599 },
  { name: 'F10', from: 601, to: 699 },
  { name: 'F13', from: 701, to: 799 },
  { name: 'F07', from: 801, to: 899 },
  { name: 'F08', from: 901, to: 999 },
  { name: 'F09', from: 1001, to: 1099 },
  { name: 'F11', from: 1101, to: 1199 },   // none expected; reserved so a table of its own has a place
  { name: 'F12', from: 1201, to: 1299 },   // none expected; reserved
  { name: 'F14', from: 1401, to: 1499 },
  { name: 'F15', from: 1501, to: 1599 },
  { name: 'F16', from: 1601, to: 1699 },
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

/**
 * What a migration defines or redefines, lower case, as written: functions and views (create, create or replace, drop),
 * and per table the constraints, policies and triggers it adds or drops (decision D159). Two files naming the same
 * object are a redefinition; the later one must have the higher number.
 */
export function definedObjects(sql) {
  const out = new Set();
  const text = sql.replace(/--.*$/gm, '');
  for (const m of text.matchAll(/(?:create\s+(?:or\s+replace\s+)?|drop\s+(?:if\s+exists\s+)?)(?:function|view)\s+((?:[a-z0-9_]+\.)?[a-z0-9_]+)/gi)) out.add(`${/function/i.test(m[0]) ? 'function' : 'view'} ${m[1].toLowerCase()}`);
  for (const stmt of text.split(';')) {
    const t = /alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?((?:[a-z0-9_]+\.)?[a-z0-9_]+)/i.exec(stmt);
    if (t) for (const m of stmt.matchAll(/(?:add|drop)\s+constraint\s+(?:if\s+exists\s+)?([a-z0-9_]+)/gi)) out.add(`constraint ${t[1].toLowerCase()}.${m[1].toLowerCase()}`);
  }
  for (const m of text.matchAll(/(?:create|drop)\s+policy\s+(?:if\s+exists\s+)?([a-z0-9_]+)\s+on\s+((?:[a-z0-9_]+\.)?[a-z0-9_]+)/gi)) out.add(`policy ${m[2].toLowerCase()}.${m[1].toLowerCase()}`);
  for (const m of text.matchAll(/(?:create|drop)\s+trigger\s+(?:if\s+exists\s+)?([a-z0-9_]+)[\s\S]*?\bon\s+((?:[a-z0-9_]+\.)?[a-z0-9_]+)/gi)) out.add(`trigger ${m[2].toLowerCase()}.${m[1].toLowerCase()}`);
  return out;
}

/**
 * The migrator applies a file numbered below the highest applied one (feature blocks interleave over time), and a fresh
 * database applies in number order, so a migration that redefines an object must be numbered above every earlier
 * definition of it (decision D159): a late file that redefines something a higher numbered file already on the base
 * defines would overwrite it on a database that has the higher file, and be overwritten on a fresh one. Returns the
 * problems: a file that is new (not on the base) defines an object that a file on the base with a higher number defines.
 */
export function checkLateRedefinitions(base, current) {
  const problems = [];
  const baseDefs = [...base].map(([name, sql]) => [name, definedObjects(sql)]);
  for (const [name, sql] of current) {
    if (base.has(name)) continue;
    const mine = definedObjects(sql);
    for (const [other, objs] of baseDefs) {
      if (other <= name) continue;
      for (const o of mine) {
        if (objs.has(o)) problems.push(`${name}: redefines ${o}, which ${other} (higher number, already on the base branch) also defines (D159: number above every earlier definition). Renumber it above ${other.slice(0, 4)}.`);
      }
    }
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
  else problems.push(...checkImmutable(base, current), ...checkLateRedefinitions(base, current));
  return { problems, count: names.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync('packages/db/migrations')) { console.error('no packages/db/migrations'); process.exit(1); }
  const { problems, count } = run();
  for (const p of problems) console.error(`::error::migrations: ${p}`);
  console.log(`Migrations: ${problems.length === 0 ? 'OK' : 'FAILED'} (${count} files, ${problems.length} problems)`);
  process.exit(problems.length ? 1 : 0);
}
