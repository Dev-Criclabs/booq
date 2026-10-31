import { RouteError } from '@booq/auth';
import { answer } from '../http/answer';
import { actorOf, clubIdOf } from '../clubs/routes';
import { platformRoute, type PlatformRoute } from '../http/server';
import type { createSupportService } from './support';

// Support routes of the console (design 5.2; PLAT-02-AC2 to AC7, AC9). Thin: the staff member and the
// freshness of their second factor come from the session, the club from the path, and every rule
// (look or edit, sections, secrets, the step-up for connections) is in the service. A club the caller
// may not see is 404, the same as one that does not exist.

export interface SupportRouteDeps {
  support: ReturnType<typeof createSupportService>;
}

export function supportRoutes(deps: SupportRouteDeps): PlatformRoute[] {
  const { support } = deps;
  return [
    platformRoute({ method: 'GET', path: '/clubs/:id/support/setup', access: 'staff' }, async (ctx) => answer(await support.getSetup(ctx.staff!.id, clubIdOf(ctx)))),
    platformRoute({ method: 'PUT', path: '/clubs/:id/support/setup/:section', access: 'staff' }, async (ctx) => {
      const section = ctx.input['section'];
      if (typeof section !== 'string') throw new RouteError(404, 'not_found');
      return answer(await support.putSetup(ctx.staff!.id, clubIdOf(ctx), section, ctx.body, { stepUpFresh: ctx.stepUpFresh }));
    }),
    // "Test all again": asks the worker to recheck the stored values. No secret is read here; a Live club can be asked too (a look only visit).
    platformRoute({ method: 'POST', path: '/clubs/:id/support/connection-check', access: 'staff' }, async (ctx) => answer(await support.requestConnectionCheck(ctx.staff!.id, clubIdOf(ctx)))),
    platformRoute({ method: 'POST', path: '/clubs/:id/support/close', access: 'staff' }, async (ctx) => answer(await support.closeSession(actorOf(ctx).staffId, clubIdOf(ctx)))),
    // Probe on the values given, nothing written. Needs a fresh second factor like the write (SR-16).
    platformRoute({ method: 'POST', path: '/clubs/:id/connections/:kind/test', access: 'staff' }, async (ctx) => {
      const kind = ctx.input['kind'];
      if (kind !== 'line' && kind !== 'beam') throw new RouteError(404, 'not_found');
      if (!ctx.stepUpFresh) throw new RouteError(403, 'step_up_required');
      return answer(await support.testConnection(ctx.staff!.id, clubIdOf(ctx), kind, ctx.body));
    }),
  ];
}
