import type { PermissionFragment } from './types';

// F04 design section 8. Every club person also holds the player role (D115), so orders.read.own is held by all;
// the row policies narrow it to the player's own order, or the club's orders for owner, front desk and accountant
// (the accountant sees no contact detail, none is in an order, D35). Staff quote and pay reuse F03's
// booking.create.staff (front desk, owner).
export const permissions: PermissionFragment = {
  'orders.read.own': ['player', 'coach', 'front_desk', 'accountant', 'owner'],
};
