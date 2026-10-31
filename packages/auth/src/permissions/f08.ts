import type { PermissionFragment } from './types';

// F08 design section 8. Players, guests and the Accountant have no class permission here: they use the public routes. The owner writes
// templates and edits a session; front desk and owner read the sessions and the waitlist and cancel a session (with a reason); a
// coach reads the roster of the sessions they teach (the database limits the rows, class_roster).
export const permissions: PermissionFragment = {
  'class.template': ['owner'],
  'class.session.read': ['front_desk', 'owner'],
  'class.session.cancel': ['front_desk', 'owner'],
  'class.session.edit': ['owner'],
  'class.roster.read': ['coach', 'front_desk', 'owner'],
};
