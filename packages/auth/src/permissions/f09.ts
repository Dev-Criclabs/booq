import type { PermissionFragment } from './types';

// F09 design section 7. Cancelling for a player or as the club, and marking or reversing a no show or late cancel, are front
// desk and owner, each with a written reason (CANCEL-01-AC20, CANCEL-04-AC10). A player cancels their own booking under
// booking.read.own (F03), as every club person holds the player role (D115). Closures use closure.write, declared in f11.ts.
export const permissions: PermissionFragment = {
  'booking.cancel.staff': ['front_desk', 'owner'],
  'booking.mark': ['front_desk', 'owner'],
};
