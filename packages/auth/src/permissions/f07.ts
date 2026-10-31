import type { PermissionFragment } from './types';

// F07 design 10 (assumption A-6). Only the owner publishes, deactivates, sets an override or pay, decides leave and substitutes; front
// desk may read the coach list (the staff picker and A2) and nothing about pay, leave type or notes. A coach keeps their own
// availability and leave; the owner may do it for any coach. The database checks the same rules again (app.coach_caller_ok).
export const permissions: PermissionFragment = {
  'coach.read': ['front_desk', 'owner'],
  'coach.manage': ['owner'],
  'coach.pay': ['owner'],
  'coach.leave.decide': ['owner'],
  'coach.substitute': ['owner'],
  'coach.self': ['coach', 'owner'],
};
