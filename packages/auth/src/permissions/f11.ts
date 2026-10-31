import type { PermissionFragment } from './types';

// F11 design section 8 (approved D168). The console reuses the permission names of the features behind each page; these are the names F11
// adds. The Accountant has none of the customer, calendar or setup permissions (D35, D115). `closure.write` is the closure screen and
// routes of F09 (A12); F09's routes use this name and do not declare it again. A coach has no console page.
export const permissions: PermissionFragment = {
  'staff.shell': ['front_desk', 'accountant', 'owner'],
  'calendar.read': ['front_desk', 'owner'],
  'setup.read': ['owner'],
  'setup.done': ['owner'],
  'customer.write': ['front_desk', 'owner'],
  'customer.export': ['front_desk', 'owner'],
  'customer.adjust': ['front_desk', 'owner'],
  'package.extend': ['owner'],
  'price.read': ['front_desk', 'accountant', 'owner'],
  'closure.write': ['front_desk', 'owner'],
};
