import { RouteError } from '@booq/auth';
import { answer } from '../http/answer';
import { platformRoute, type PlatformRoute } from '../http/server';
import type { createStaffInviteClient } from './staff-invite-client';

// BOOQ staff management routes of the console (F01-T17b; ROLE-02-AC4 to AC6; D123, D148): invite a teammate, reset a
// teammate's second factor, deactivate a teammate. Admin only. Every rule is in apps/staff-invite, which this app asks
// with a signed call; it also checks the actor again. After a reset or a deactivation the client ends that teammate's
// console sessions here. Without the other app's address in the settings these answer 503 not_configured.

export interface StaffRouteDeps {
  staff: ReturnType<typeof createStaffInviteClient> | null;
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
  return [
    platformRoute({ method: 'POST', path: '/staff', access: 'admin' }, async (ctx) => {
      const b = ctx.body;
      if (!isObject(b) || Object.keys(b).some((k) => !['email', 'displayName', 'role'].includes(k)) || typeof b['email'] !== 'string' || typeof b['displayName'] !== 'string' || typeof b['role'] !== 'string') throw new RouteError(400, 'bad_input');
      const r = await client().invite(actor(ctx), { email: b['email'], displayName: b['displayName'], role: b['role'] });
      return answer(r.ok ? { ok: true, staffId: r.staffId } : r);
    }),
    platformRoute({ method: 'POST', path: '/staff/:id/reset-factor', access: 'admin' }, async (ctx) => answer(await client().resetFactor(actor(ctx), target(ctx)))),
    platformRoute({ method: 'POST', path: '/staff/:id/deactivate', access: 'admin' }, async (ctx) => answer(await client().deactivate(actor(ctx), target(ctx)))),
  ];
}
