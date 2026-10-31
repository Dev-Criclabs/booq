// A traced criterion: the acceptance criterion is proven by a test that lives somewhere else (a lane's test next to its code).
// The trace test fails if that test file disappears or the cited test title is renamed, so a mapping cannot rot silently.
// The ID is written as a literal in the caller, because tests/acceptance/coverage.spec.ts looks for it in the source.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'vitest';
import { repoRoot } from './spec-ids';

export interface Ref {
  /** Path from the repository root. */
  file: string;
  /** A piece of text that must appear in that file: the test title, or the criterion ID if the test cites it. */
  has: string;
}

export function traced(id: string, summary: string, refs: Ref[]): void {
  test(`${id} ${summary}`, () => {
    for (const r of refs) {
      const text = readFileSync(resolve(repoRoot(), r.file), 'utf8');
      if (!text.includes(r.has)) throw new Error(`${id}: ${r.file} no longer contains "${r.has}" (the test that proves this criterion moved or was renamed)`);
    }
  });
}
