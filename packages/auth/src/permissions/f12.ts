import type { PermissionFragment } from './types';

// F12 design 9 (CPORT-01 to CPORT-07). The coach portal shows a coach their own data only. The matrix lists the owner with every
// permission (route.test.ts), so `coach.portal` lists the owner too, but the portal functions then require the Coach role and a coach row of
// the signed-in person (`portal:forbidden`): an owner who is not a coach is refused there, and an owner who is a coach sees their own rows,
// never another coach's (the owner acts for another coach only through F07's `coach.self`). Staff read the coach's Present or Absent mark
// as a hint in A2 (D118): the owner and front desk.
export const permissions: PermissionFragment = {
  'coach.portal': ['coach', 'owner'],
  'attendance.read': ['owner', 'front_desk'],
};
