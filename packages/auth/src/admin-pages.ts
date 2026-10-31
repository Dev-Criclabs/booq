import { can, type Role } from './permissions';

// F11 design 4 (ADMIN-01): the pages of the club admin console and the permission that opens each. The sidebar is computed from this map
// by the same `can()` that guards the routes, so the two cannot disagree; a person with several roles gets the union (D58). A4 Backup
// slip check is not here: it is built with F16 and not for Hunter (D53). A3, A11 and A15 are removed and never listed.
export const ADMIN_PAGES = [
  { id: 'A0', permission: 'setup.read' },
  { id: 'A1', permission: 'calendar.read' },
  { id: 'A2', permission: 'booking.create.staff' },
  { id: 'A5', permission: 'customer.contact.read' },
  { id: 'A6', permission: 'customer.contact.read' },
  { id: 'A7', permission: 'coach.read' },
  { id: 'A8', permission: 'class.session.read' },
  { id: 'A9', permission: 'price.read' },
  { id: 'A9b', permission: 'price.read' },
  { id: 'A10', permission: 'price.write' },
  { id: 'A12', permission: 'closure.write' },
  { id: 'A13', permission: 'report.read' },
  { id: 'A14', permission: 'receipt.list' },
  { id: 'A16', permission: 'settings.business.read' },
  { id: 'A17', permission: 'staff.manage' },
] as const;

export type AdminPageId = (typeof ADMIN_PAGES)[number]['id'];

/** The page ids the roles may open, in sidebar order. */
export function pagesFor(roles: readonly Role[]): AdminPageId[] {
  return ADMIN_PAGES.filter((p) => can(roles, p.permission)).map((p) => p.id);
}
