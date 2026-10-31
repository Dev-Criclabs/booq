import { describe, expect, it } from 'vitest';
import { can } from './index';

// F09 design section 7: the staff cancel and the marks are front desk and owner; closures use F11's closure.write.
describe('F09 permissions', () => {
  it('only front desk and owner cancel for a player, mark and reverse, and manage closures', () => {
    for (const p of ['booking.cancel.staff', 'booking.mark', 'closure.write']) {
      expect(can(['front_desk'], p)).toBe(true);
      expect(can(['owner'], p)).toBe(true);
      for (const r of ['player', 'coach', 'accountant'] as const) expect(can([r], p)).toBe(false);
    }
  });
});
