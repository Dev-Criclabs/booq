import type { PermissionFragment } from './types';

// F02 design 6 (AUTH-02-AC24, decision D12): only the owner reads the audited changes of a date of birth.
export const permissions: PermissionFragment = {
  'customer.dob-history.read': ['owner'],
};
