import { RouteError } from '@booq/auth';
import { answer } from '../http/answer';
import { actorOf, clubIdOf } from '../clubs/routes';
import { platformRoute, type PlatformRoute } from '../http/server';
import type { createOwnerService } from './owner';

// Owner invite and owner contact routes (design 5.2; SR-01, D122; ROLE-02-AC8). The invite link is
// emailed to the owner by the system and never returned to the staff member: the console sees status
// only. A change to the owner's contact by a specialist waits for a second admin.

export interface OwnerRouteDeps {
  owner: ReturnType<typeof createOwnerService>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ownerRoutes(deps: OwnerRouteDeps): PlatformRoute[] {
  const { owner } = deps;
  return [
    platformRoute({ method: 'POST', path: '/clubs/:id/owner-invite', access: 'staff' }, async (ctx) => answer(await owner.createOwnerInvite(actorOf(ctx), clubIdOf(ctx)))),
    platformRoute({ method: 'GET', path: '/clubs/:id/owner-invite', access: 'staff' }, async (ctx) => answer(await owner.getOwnerInvite(ctx.staff!.id, clubIdOf(ctx)))),
    platformRoute({ method: 'POST', path: '/clubs/:id/owner-verified', access: 'staff' }, async (ctx) => answer(await owner.confirmOwnerVerified(actorOf(ctx), clubIdOf(ctx)))),
    platformRoute({ method: 'PUT', path: '/clubs/:id/owner-contact', access: 'staff' }, async (ctx) => answer(await owner.changeOwnerContact(actorOf(ctx), clubIdOf(ctx), ctx.body))),
    ...(['approve', 'reject'] as const).map((decision) =>
      platformRoute({ method: 'POST', path: `/clubs/:id/owner-contact/:requestId/${decision}`, access: 'admin' }, async (ctx) => {
        const requestId = ctx.input['requestId'];
        if (typeof requestId !== 'string' || !UUID.test(requestId)) throw new RouteError(404, 'not_found');
        return answer(await owner.decideOwnerContactChange(actorOf(ctx), clubIdOf(ctx), requestId, decision === 'approve'));
      }),
    ),
  ];
}
