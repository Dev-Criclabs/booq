// CI check (D126, reviewer QA-1): every acceptance criterion ID in an approved requirements.md appears in tests/acceptance.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { allCriteria, featureDirs } from './spec-ids';

const dir = fileURLToPath(new URL('.', import.meta.url));
const text = readdirSync(dir)
  .filter((f) => /^F\d\d-.*\.spec\.ts$/.test(f))
  .map((f) => readFileSync(resolve(dir, f), 'utf8'))
  .join('\n');

describe('acceptance coverage', () => {
  test('there is at least one approved feature', () => {
    expect(featureDirs().length).toBeGreaterThan(0);
  });

  test('every criterion ID in a requirements.md appears in tests/acceptance', () => {
    const missing = allCriteria()
      .map((c) => c.id)
      .filter((id) => !new RegExp(`['"\`]${id.replace(/[/.-]/g, '\\$&')}[ '"\`]`).test(text));
    expect(missing, `criteria with no test or todo (run: node --experimental-strip-types tests/acceptance/generate.ts): ${missing.join(', ')}`).toEqual([]);
  });

  test('no skeleton names an ID that is not in a requirements.md (stale after a spec change)', () => {
    const known = new Set(allCriteria().map((c) => c.id));
    const used = [...text.matchAll(/test(?:\.[a-z]+)?\(\s*["'`](F\d\d\/[A-Za-z0-9-]+)[ "'`]/g)].map((m) => m[1] as string);
    expect(used.filter((id) => !known.has(id))).toEqual([]);
  });
});
