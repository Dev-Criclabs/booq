import { RouteError } from '@booq/auth';
import { answer } from '../http/answer';
import { clubIdOf } from '../clubs/routes';
import { platformRoute, type PlatformRoute } from '../http/server';
import type { createTesterService } from './testers';

// Tester routes (design 5.2; PLAT-07-AC5, AC6; D4): who may sign in to a Draft or Testing club as a
// test player. BOOQ staff list testers, create an invite link for a BOOQ tester and remove one; every
// change is in P6. The list holds ids, dates and display names only. The link goes to the staff member
// who asked, to hand to the tester.

export interface TesterRouteDeps {
  testers: ReturnType<typeof createTesterService>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function testerRoutes(deps: TesterRouteDeps): PlatformRoute[] {
  const { testers } = deps;
  return [
    platformRoute({ method: 'GET', path: '/clubs/:id/testers', access: 'staff' }, async (ctx) => answer(await testers.listTesters(ctx.staff!.id, clubIdOf(ctx)))),
    platformRoute({ method: 'POST', path: '/clubs/:id/testers', access: 'staff' }, async (ctx) => answer(await testers.createTesterInvite(ctx.staff!.id, clubIdOf(ctx)))),
    platformRoute({ method: 'POST', path: '/clubs/:id/testers/:testerId/remove', access: 'staff' }, async (ctx) => {
      const testerId = ctx.input['testerId'];
      if (typeof testerId !== 'string' || !UUID.test(testerId)) throw new RouteError(404, 'not_found');
      return answer(await testers.removeTester(ctx.staff!.id, clubIdOf(ctx), testerId));
    }),
  ];
}
