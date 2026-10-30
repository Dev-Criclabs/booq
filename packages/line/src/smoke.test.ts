import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('@booq/line smoke (F01-T01)', () => {
  it('loads', () => {
    expect(packageName).toBe('@booq/line');
  });
});
