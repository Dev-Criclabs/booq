import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// PLAT-06-AC17 (D14): a club leaves by export and pause only. No route anywhere deletes a club.
function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === 'node_modules') continue;
    if (statSync(full).isDirectory()) yield* sources(full);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) yield full;
  }
}

describe('no delete club (PLAT-06-AC17)', () => {
  it('no route declares DELETE on a club path, and no code deletes from the club table', () => {
    const offenders: string[] = [];
    for (const root of ['apps', 'packages']) {
      for (const file of sources(join(__dirname, '../../../../../', root))) {
        const text = readFileSync(file, 'utf8');
        if (/method:\s*'DELETE',\s*path:\s*'\/clubs\b/.test(text)) offenders.push(`${file}: DELETE /clubs route`);
        if (/delete\s+from\s+(public\.)?club\b(?!_)/i.test(text)) offenders.push(`${file}: delete from club`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
