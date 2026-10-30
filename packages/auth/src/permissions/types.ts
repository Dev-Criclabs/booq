export const ROLES = ['player', 'coach', 'front_desk', 'accountant', 'owner'] as const;
export type Role = (typeof ROLES)[number];

/** One feature's share of the permission matrix: permission name to the roles that hold it. */
export type PermissionFragment = Readonly<Record<string, readonly Role[]>>;
