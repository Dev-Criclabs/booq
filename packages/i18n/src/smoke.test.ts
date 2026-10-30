import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('@booq/i18n smoke (F01-T01)', () => {
  it('loads', () => {
    expect(packageName).toBe('@booq/i18n');
  });
});
