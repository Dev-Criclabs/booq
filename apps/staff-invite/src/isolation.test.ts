import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// SR-06 / D124 option 1 / D148: no other app can reach the identity provider's admin key. Nothing else depends on this
// package or imports it, and no file outside apps/staff-invite names the key (the lint also fails the build on that).
const ROOT = join(__dirname, '..', '..', '..');
function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.next', 'dist', '.git'].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}
const outside = (f: string) => !relative(ROOT, f).split('\\').join('/').startsWith('apps/staff-invite/');

describe('the admin key stays in apps/staff-invite', () => {
  it('no other package.json depends on @booq/staff-invite', () => {
    const hits = [...walk(join(ROOT, 'apps')), ...walk(join(ROOT, 'packages'))].filter((f) => f.endsWith('package.json') && outside(f) && readFileSync(f, 'utf8').includes('@booq/staff-invite'));
    expect(hits).toEqual([]);
  });
  it('no source outside apps/staff-invite imports it or names the key', () => {
    const hits: string[] = [];
    for (const f of [...walk(join(ROOT, 'apps')), ...walk(join(ROOT, 'packages'))]) {
      if (!/\.(ts|tsx|mjs|js|json)$/.test(f) || !outside(f) || /\.test\.ts$/.test(f)) continue;
      const text = readFileSync(f, 'utf8');
      if (/@booq\/staff-invite|service[_-]?role/i.test(text)) hits.push(relative(ROOT, f));
    }
    expect(hits).toEqual([]);
  });
});
