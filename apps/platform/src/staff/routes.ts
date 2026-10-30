import { RouteError } from '@booq/auth';
import { answer } from '../http/answer';
import { platformRoute, type PlatformRoute } from '../http/server';
import type { createStaffInviteClient } from './staff-invite-client';
import type { createTeamService } from './list';

// BOOQ staff management routes of the console (F01-T17b; ROLE-02-AC4 to AC6; D123, D148): invite a teammate, reset a
// teammate's second factor, deactivate a teammate. Admin only. Every rule is in apps/staff-invite, which this app asks
// with a signed call; it also checks the actor again. After a reset or a deactivation the client ends that teammate's
// console sessions here. An invite and a reset both answer with a single-use enrolment link (F01-T17c). Without the other app's address in the settings these answer 503 not_configured.

export interface StaffRouteDeps {
  staff: ReturnType<typeof createStaffInviteClient> | null;
  /** The console's public address (https). The enrolment link is built from it; the token rides in the fragment, which is never sent to a server or a referrer. */
  consoleBaseUrl: string;
  team: ReturnType<typeof createTeamService>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function staffRoutes(deps: StaffRouteDeps): PlatformRoute[] {
  const client = () => {
    if (!deps.staff) throw new RouteError(503, 'not_configured');
    return deps.staff;
  };
  const target = (ctx: { input: Record<string, unknown> }): string => {
    const id = ctx.input['id'];
    if (typeof id !== 'string' || !UUID.test(id)) throw new RouteError(404, 'not_found');
    return id;
  };
  const actor = (ctx: { staff: { id: string } | null; stepUpFresh: boolean }) => ({ staffId: ctx.staff!.id, stepUpFresh: ctx.stepUpFresh });
  const link = (token: string) => `${deps.consoleBaseUrl.replace(/\/+$/, '')}/enrol#${token}`;
  return [
    // P6: the team. Admin only. No secrets: emails and roles, as the admin who invited them already knows.
    platformRoute({ method: 'GET', path: '/staff', access: 'admin' }, async (ctx) => ({ team: await deps.team.list(ctx.staff!.id, ctx.staff!.displayName) })),
    platformRoute({ method: 'POST', path: '/staff', access: 'admin' }, async (ctx) => {
      const b = ctx.body;
      if (!isObject(b) || Object.keys(b).some((k) => !['email', 'displayName', 'role'].includes(k)) || typeof b['email'] !== 'string' || typeof b['displayName'] !== 'string' || typeof b['role'] !== 'string') throw new RouteError(400, 'bad_input');
      const r = await client().invite(actor(ctx), { email: b['email'], displayName: b['displayName'], role: b['role'] });
      // The link is shown once, to the admin, to hand to the teammate; it is not stored or logged anywhere in the clear.
      return answer(r.ok ? { ok: true, staffId: r.staffId, enrolmentLink: link(r.enrolmentToken) } : r);
    }),
    platformRoute({ method: 'POST', path: '/staff/:id/reset-factor', access: 'admin' }, async (ctx) => {
      const r = await client().resetFactor(actor(ctx), target(ctx));
      return answer(r.ok ? { ok: true, enrolmentLink: link(r.enrolmentToken) } : r);
    }),
    platformRoute({ method: 'POST', path: '/staff/:id/deactivate', access: 'admin' }, async (ctx) => answer(await client().deactivate(actor(ctx), target(ctx)))),
  ];
}
