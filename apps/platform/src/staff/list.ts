import type { PlatformDb } from '@booq/db';

// The team list of the console (P6): every BOOQ teammate with their role and whether they can sign in. Admin only; the
// route checks the role and the database policy (platform_staff is visible to an admin in full) checks it again.

export interface TeamMember {
  id: string;
  displayName: string;
  email: string;
  role: 'platform_admin' | 'onboarding_specialist';
  active: boolean;
}

export function createTeamService(deps: { db: PlatformDb }) {
  return {
    async list(staffId: string, label: string): Promise<TeamMember[]> {
      return deps.db.withPlatformTx({ staffId, staffLabel: label }, async (tx) =>
        (await tx.query<{ id: string; display_name: string; email: string; role: TeamMember['role']; active: boolean }>(
          'select id, display_name, email, role, active from platform.platform_staff order by active desc, lower(display_name), id',
        )).rows.map((r) => ({ id: r.id, displayName: r.display_name, email: r.email, role: r.role, active: r.active })),
      );
    },
  };
}
