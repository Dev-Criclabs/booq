import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findUndeclaredRoutes, isRouteFile } from './check';

// The build check itself (F01-T13): every route file in apps/ declares its routes through route().
const ROOT = join(__dirname, '..', '..', '..');

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

describe('repository route declarations', () => {
  it('has no route file with an undeclared handler', () => {
    const files = [...walk(join(ROOT, 'apps'))]
      .map((p) => relative(ROOT, p))
      .filter(isRouteFile)
      .map((path) => ({ path, text: readFileSync(join(ROOT, path), 'utf8') }));
    expect(findUndeclaredRoutes(files)).toEqual([]);
  });
});
