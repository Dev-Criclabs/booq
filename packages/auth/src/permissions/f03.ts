import type { PermissionFragment } from './types';

// F03 design section 8. Every club person also holds the player role (D115), so booking.read.own needs
// no staff role repeated; the service narrows it to the caller's own booking. Staff booking, moving and
// abandoning a hold are front desk and owner (BOOK-04-AC7, D43, D60).
export const permissions: PermissionFragment = {
  'booking.read.own': ['player', 'coach', 'front_desk', 'accountant', 'owner'],
  'booking.create.staff': ['front_desk', 'owner'],
  'booking.move': ['front_desk', 'owner'],
};
