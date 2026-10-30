import { describe, expect, it } from 'vitest';
import { can } from './index';

// F03 design section 8: who holds the booking permissions (ROLE-01; D43, D60).
describe('F03 permissions', () => {
  it('every club person may read their own booking', () => {
    for (const r of ['player', 'coach', 'front_desk', 'accountant', 'owner'] as const) expect(can([r], 'booking.read.own')).toBe(true);
  });

  it('only front desk and owner may book for others and move bookings', () => {
    for (const p of ['booking.create.staff', 'booking.move']) {
      expect(can(['front_desk'], p)).toBe(true);
      expect(can(['owner'], p)).toBe(true);
      for (const r of ['player', 'coach', 'accountant'] as const) expect(can([r], p)).toBe(false);
    }
  });
});
