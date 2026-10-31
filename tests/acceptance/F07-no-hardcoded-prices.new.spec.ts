// F07 COACH-02-AC9 (QA): no price is written in the code.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { repoRoot } from './spec-ids';

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? (n === 'node_modules' ? [] : walk(p)) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });

it('F07/COACH-02-AC9 no solo class or coach price is written in the code: the only large numbers in the pricing, checkout and coach code are basis points and their rounding', () => {
  const root = repoRoot();
  const dirs = ['packages/domain/src/checkout', 'apps/web/src/api/checkout', 'apps/web/src/api/coaches', 'apps/web/src/api/classes'];
  const found = new Map<string, string[]>();
  let files = 0;
  for (const d of dirs) {
    let list: string[] = [];
    try { list = walk(resolve(root, d)); } catch { continue; }
    for (const f of list.filter((x) => !/fixture/.test(x))) {
      files += 1;
      const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
      for (const m of text.matchAll(/(?<![\w.'"#-])(\d{4,})(?![\w'"-])/g)) found.set(m[1]!, [...(found.get(m[1]!) ?? []), f.replace(root + '/', '')]);
    }
  }
  expect(files, 'the scan found the code').toBeGreaterThan(8);
  const allowed = new Set(['10000', '5000']);   // basis points, and half a unit of them for the half up rounding (D23)
  const bad = [...found.entries()].filter(([n]) => !allowed.has(n));
  expect(bad.map(([n, fs]) => `${n} in ${[...new Set(fs)].join(', ')}`), 'a price or other large number written in the code').toEqual([]);
});
