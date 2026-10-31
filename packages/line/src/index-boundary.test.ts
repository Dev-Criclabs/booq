import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// '@booq/line' (index.ts) is imported by the player app in the browser; its runtime import graph must pull no node:
// module, no Node built in and no server only package (a regression broke every player page in next dev, front end report
// of 31 Oct). Server only parts live in '@booq/line/server'. This walks the relative imports of index.ts, skipping
// type-only imports and exports (erased at build), and fails on anything that cannot run in a browser.
const SERVER_ONLY = [/^node:/, /^@resvg\//, /^fontkit$/, /^@expo-google-fonts\//, /^pg$/, /^@booq\/db/, /^@booq\/secrets/];
const BUILTINS = new Set(builtinModules);

function runtimeImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  const re = /^\s*(import|export)\s+(type\s+)?([^'"]*?)\s*from\s*['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm;
  for (const m of src.matchAll(re)) {
    if (m[2]) continue;                                   // import type / export type
    if (m[3] && /^\{\s*(type\s+[^,}]+,?\s*)+\}$/.test(m[3])) continue;   // { type A, type B }
    out.push((m[4] ?? m[5])!);
  }
  return out;
}

function walk(entry: string): { file: string; spec: string }[] {
  const seen = new Set<string>();
  const external: { file: string; spec: string }[] = [];
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of runtimeImports(file)) {
      if (spec.startsWith('.')) {
        const base = resolve(dirname(file), spec);
        stack.push(base.endsWith('.ts') ? base : `${base}.ts`);
      } else {
        external.push({ file, spec });
      }
    }
  }
  return external;
}

describe('@booq/line index is browser safe', () => {
  it('pulls no node: module, Node built in or server only package at runtime', () => {
    const bad = walk(resolve(__dirname, 'index.ts')).filter(({ spec }) => SERVER_ONLY.some((re) => re.test(spec)) || BUILTINS.has(spec));
    expect(bad).toEqual([]);
  });

  it('the server entry does carry the server only parts (the check above would see them)', () => {
    const specs = walk(resolve(__dirname, 'server.ts')).map((e) => e.spec);
    expect(specs.some((s) => s.startsWith('node:'))).toBe(true);
    expect(specs).toContain('@resvg/resvg-js');
  });
});
