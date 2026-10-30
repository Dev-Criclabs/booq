import type { PermissionFragment } from './types';

// Rows of the hand-off roles table (Roles, platform console and data protection) that no single
// feature owns. Later features add their own fragment file and one line in index.ts.
export const permissions: PermissionFragment = {
  'booking.write': ['front_desk', 'owner'],
  'report.revenue.read': ['accountant', 'owner'],
  'coach.pay.read': ['accountant', 'owner'],
  'price.write': ['owner'],
  'rules.write': ['owner'],
};
