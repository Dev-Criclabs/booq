import { describe, expect, it } from 'vitest';
import { notTest } from './test-data';

describe('notTest (PLAT-07-AC7, D33)', () => {
  it('gives the condition bare or for an alias', () => {
    expect(notTest()).toBe('is_test = false');
    expect(notTest('b')).toBe('b.is_test = false');
  });
  it('refuses an alias that is not a plain identifier', () => {
    for (const a of ['', 'b; drop table x', 'B', 'a.b', '1a', "x'"]) expect(() => notTest(a), a).toThrow();
  });
});
