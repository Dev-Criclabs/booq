import { call, type Outcome } from './api';

// A17 Staff (F11-T23; ADMIN-17; board H-A17-Staff-audit), apart from the screen. The owner invites by a link, sees who has a staff or coach
// role and whether they are active, changes a person's roles (a set; every club person also holds Player, D115) and deactivates a person.
// The owner's own role is fixed and the owner cannot be deactivated here. Nothing here decides who may do what: the routes answer 403.

type Fetch = typeof fetch;

export interface StaffMember {
  id: string;
  display_name: string | null;
  roles: string[];
  active: boolean;
}
export interface StaffInvite {
  id: string;
  kind: 'staff' | 'coach';
  roles: string[];
  created_at: string;
  expires_at: string;
}

/** The roles the owner may give or take away. Player is always held; Owner is fixed. */
export const ASSIGNABLE = ['front_desk', 'accountant', 'coach'] as const;
export type Assignable = (typeof ASSIGNABLE)[number];
export const ROLE_KEY: Record<string, string> = { owner: 'A-0369', front_desk: 'A-0367', accountant: 'A-0368', coach: 'A-0193', player: 'A-new.staff_role_player' };
/** The roles worth showing in a row: every staff role, and Player only when it is the whole set. */
export const shownRoles = (roles: readonly string[]): string[] => {
  const staff = roles.filter((r) => r !== 'player');
  return staff.length > 0 ? staff : [...roles];
};

export const loadStaff = async (slug: string, f: Fetch): Promise<Outcome<StaffMember[]>> => {
  const r = await call<StaffMember[] | null>(slug, '/staff', f);
  return r.kind === 'ok' ? { kind: 'ok', body: r.body ?? [] } : r;
};
export const loadInvites = async (slug: string, f: Fetch): Promise<Outcome<StaffInvite[]>> => {
  const r = await call<StaffInvite[] | null>(slug, '/staff/invites', f);
  return r.kind === 'ok' ? { kind: 'ok', body: r.body ?? [] } : r;
};

/** A role choice becomes the invite the route takes: a coach invite has no roles to send; a staff invite needs at least one of the two staff roles. */
export function inviteBody(choice: 'coach' | readonly ('front_desk' | 'accountant')[]): { kind: 'coach' } | { kind: 'staff'; roles: string[] } | null {
  if (choice === 'coach') return { kind: 'coach' };
  return choice.length > 0 ? { kind: 'staff', roles: [...choice] } : null;
}
export const createInvite = (slug: string, body: ReturnType<typeof inviteBody>, f: Fetch) => call<{ id: string; token: string }>(slug, '/staff/invites', f, { method: 'POST', body });
/** `/c/{slug}/join?invite={token}` (F02 design): the address the invited person opens; the token is shown once. */
export const inviteLink = (origin: string, slug: string, token: string): string => `${origin}/c/${slug}/join?invite=${encodeURIComponent(token)}`;

export const setRoles = (slug: string, userId: string, roles: readonly string[], f: Fetch) => call<{ old: string[]; new: string[]; changed: boolean }>(slug, `/staff/${encodeURIComponent(userId)}/roles`, f, { method: 'PUT', body: { roles: [...roles] } });
export const deactivate = (slug: string, userId: string, f: Fetch) => call<{ ok: true }>(slug, `/staff/${encodeURIComponent(userId)}/deactivate`, f, { method: 'POST', body: {} });

/** The role set to send: player always, then the staff roles chosen, sorted so the same choice is the same request. */
export const roleSet = (chosen: readonly string[]): string[] => ['player', ...ASSIGNABLE.filter((r) => chosen.includes(r))].sort();

/** The text key of a refusal from the staff routes (the typed codes of app.staff_*); anything else is the general failure. */
export const STAFF_ERROR_KEY: Record<string, string> = {
  forbidden: 'A-new.staff_err_forbidden', invalid_roles: 'A-new.staff_err_roles', not_found: 'A-new.staff_err_not_found', owner_fixed: 'A-new.staff_err_owner',
  invalid_invite: 'A-new.staff_err_invite', not_configured: 'A-new.staff_err_not_configured', self: 'A-new.staff_err_self',
};
export function staffErrorKey(o: Outcome<unknown>): string {
  if (o.kind === 'forbidden') return 'A-new.staff_err_forbidden';
  if (o.kind === 'not_found') return 'A-new.staff_err_not_found';
  if (o.kind === 'refused') return STAFF_ERROR_KEY[o.code] ?? 'A-new.staff_err_general';
  return 'A-new.staff_err_general';
}
