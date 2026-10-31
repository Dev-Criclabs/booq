// Shared by the acceptance sweep gates (F04-T21 style): every criterion of a feature has a real test (a traced pointer or a QA test, never a generated todo),
// or is listed with its reason. A listed criterion that has since gained a test fails as stale, so the list only shrinks.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allCriteria } from './spec-ids';

const dir = fileURLToPath(new URL('.', import.meta.url));
const realText = () =>
  readdirSync(dir)
    .filter((f) => /^F\d\d-.*\.(traced|new)\.spec\.ts$/.test(f) && !f.endsWith('-gate.new.spec.ts'))
    .map((f) => readFileSync(resolve(dir, f), 'utf8'))
    .join('\n');

export function namedInRealTests(id: string, text = realText()): boolean {
  const esc = id.replace(/[/.-]/g, '\\$&');
  return new RegExp(`['"\`]${esc}[ '"\`]`).test(text) || new RegExp(`\\b${esc}(?![0-9a-z])`).test(text.replace(/\/\/.*$/gm, ''));
}

export function defineGate(feature: string, open: Record<string, string>, min: number): void {
  describe(`${feature} acceptance sweep gate`, () => {
    const criteria = allCriteria().filter((c) => c.id.startsWith(`${feature}/`));
    it('there are criteria to check', () => {
      expect(criteria.length).toBeGreaterThanOrEqual(min);
    });
    it('no criterion is without a real test unless it is listed with its reason', () => {
      const text = realText();
      expect(criteria.map((c) => c.id).filter((id) => !namedInRealTests(id, text) && !(id in open)), `${feature} criteria with no test and no reason`).toEqual([]);
    });
    it('a listed criterion has no test yet: when it gets one, take it off the list; every reason is written', () => {
      const text = realText();
      expect(Object.keys(open).filter((id) => namedInRealTests(id, text)), 'stale entries').toEqual([]);
      expect(Object.keys(open).filter((id) => !criteria.some((c) => c.id === id)), `ids that are not ${feature} criteria`).toEqual([]);
      expect(Object.entries(open).filter(([, why]) => why.trim().length < 12), 'entries without a reason').toEqual([]);
    });
  });
}
