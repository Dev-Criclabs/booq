import type { PermissionFragment } from './types';

// F01 design section 6.2. Every club person also holds the player role (D115), so a staff role
// never needs to repeat a player permission. The accountant has no customer.contact.read (D35).
export const permissions: PermissionFragment = {
  'club.read': ['player', 'coach', 'front_desk', 'accountant', 'owner'],
  'settings.read': ['owner'],
  'settings.business.read': ['accountant', 'owner'],
  'settings.write': ['owner'],
  'club.business.write': ['owner'],
  'hours.write': ['owner'],
  'resource.write': ['owner'],
  'staff.manage': ['owner'],
  'roles.assign': ['owner'],
  'support-window.write': ['owner'],
  'audit.read': ['owner'],
  'import.run': ['owner'],
  'export.run': ['owner'],
  'datarequest.handle': ['front_desk', 'owner'],
  'datarequest.own': ['player', 'owner'],
  'customer.contact.read': ['front_desk', 'owner'],
  'customer.names.read': ['front_desk', 'accountant', 'owner'],
};
