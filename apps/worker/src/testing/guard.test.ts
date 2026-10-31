import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// A worker test that creates a database must close it with closeTestDatabase (teardown.ts): the plain `tdb.close()` can drop the
// database while a queue connection is still closing and fail an unrelated test with an unhandled 57P01 (seen three times).
function* testFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* testFiles(full);
    else if (/\.test\.ts$/.test(name)) yield full;
  }
}

describe('worker tests close their database with closeTestDatabase', () => {
  const root = join(__dirname, '..');
  const files = [...testFiles(root)].filter((f) => !f.endsWith('guard.test.ts') && readFileSync(f, 'utf8').includes('createTestDatabase('));

  it('finds the worker tests that create a database', () => {
    expect(files.length).toBeGreaterThan(8);
  });
  it.each(files.map((f) => [f.slice(root.length + 1), f]))('%s', (_name, file) => {
    const text = readFileSync(file as string, 'utf8');
    expect(text, 'import closeTestDatabase from testing/teardown').toMatch(/closeTestDatabase\b[^;]*from\s+['"][./]+(?:testing\/)?teardown['"]/);
    expect(text, 'call closeTestDatabase(tdb)').toMatch(/await closeTestDatabase\(\s*\w+/);
    expect(text, 'no direct tdb.close()').not.toMatch(/\btdb\??\.close\(\)/);
  });
});
