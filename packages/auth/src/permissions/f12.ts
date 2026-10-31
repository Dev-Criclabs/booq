import type { PermissionFragment } from './types';

// F12 design 9 (CPORT-01 to CPORT-07). The coach portal shows a coach their own data only: the Coach role, nothing wider (an owner who
// is also a coach holds the Coach role and sees their own rows; the owner acts for another coach only through F07's `coach.self`). Staff
// read the coach's Present or Absent mark as a hint in A2 (D118); the owner and front desk. The database functions check the same rules.
export const permissions: PermissionFragment = {
  'coach.portal': ['coach'],
  'attendance.read': ['owner', 'front_desk'],
};
