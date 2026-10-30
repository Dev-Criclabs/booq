import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('@booq/worker smoke (F01-T01)', () => {
  it('loads', () => {
    expect(packageName).toBe('@booq/worker');
  });
});
