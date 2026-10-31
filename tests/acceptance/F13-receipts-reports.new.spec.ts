// F13 criteria QA tests directly. Written by QA in the F13 sweep.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { repoRoot } from './spec-ids';

const read = (l: string): Record<string, string> => JSON.parse(readFileSync(resolve(repoRoot(), `locales/${l}.json`), 'utf8'));

it('F13/RCPT-02-AC7 the balls add-on reads "Balls (Set of 3 balls)" in English and "ลูกเทนนิส (ชุด 3 ลูก)" in Thai', () => {
  expect(read('en')['A-0048']).toBe('Balls (Set of 3 balls)');
  expect(read('th')['A-0048']).toBe('ลูกเทนนิส (ชุด 3 ลูก)');
});
