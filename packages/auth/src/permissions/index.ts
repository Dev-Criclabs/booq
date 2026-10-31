import { permissions as core } from './core';
import { permissions as f01 } from './f01';
import { permissions as f02 } from './f02';
import { permissions as f03 } from './f03';
import { permissions as f11 } from './f11';
import { permissions as f12 } from './f12';
import { permissions as f13 } from './f13';
import { permissions as f04 } from './f04';
import { permissions as f07 } from './f07';
import { permissions as f08 } from './f08';
import { ROLES, type PermissionFragment, type Role } from './types';

export { ROLES, type PermissionFragment, type Role } from './types';

// One line per feature fragment. A permission may be declared once only.
const FRAGMENTS: Record<string, PermissionFragment> = { core, f01, f02, f03, f04, f07, f08, f11, f12, f13 };

export function mergePermissions(fragments: Record<string, PermissionFragment>): ReadonlyMap<string, ReadonlySet<Role>> {
  const merged = new Map<string, ReadonlySet<Role>>();
  const owner = new Map<string, string>();
  for (const [feature, fragment] of Object.entries(fragments)) {
    for (const [name, roles] of Object.entries(fragment)) {
      if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(name)) throw new Error(`${feature}: bad permission name "${name}"`);
      if (owner.has(name)) throw new Error(`permission ${name} is declared twice: ${owner.get(name)} and ${feature}`);
      for (const r of roles) if (!ROLES.includes(r)) throw new Error(`${feature}: ${name} names unknown role "${r}"`);
      owner.set(name, feature);
      merged.set(name, new Set(roles));
    }
  }
  return merged;
}

const MATRIX = mergePermissions(FRAGMENTS);

export function permissionNames(): string[] {
  return [...MATRIX.keys()];
}

export function isPermission(name: string): boolean {
  return MATRIX.has(name);
}

/** Server-side check (ROLE-01-AC2): allowed when any role held allows it. Unknown input is refused. */
export function can(roles: readonly Role[], permission: string): boolean {
  const allowed = MATRIX.get(permission);
  return allowed !== undefined && roles.some((r) => allowed.has(r));
}

export function canAll(roles: readonly Role[], permissions: readonly string[]): boolean {
  return permissions.every((p) => can(roles, p));
}
