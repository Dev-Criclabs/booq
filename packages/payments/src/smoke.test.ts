import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('@booq/payments smoke (F01-T01)', () => {
  it('loads', () => {
    expect(packageName).toBe('@booq/payments');
  });
});
