import { RouteError } from '@booq/auth';
import { answer } from '../http/answer';
import { actorOf, clubIdOf } from '../clubs/routes';
import { platformRoute, type PlatformRoute } from '../http/server';
import type { createAdminService } from './admin';

// Admin routes of the console (design 5.2; PLAT-04, P6 config, the legal notice). Admin only, each with a
// fresh second factor; the database functions behind them check the role again and write P6.

export interface AdminRouteDeps {
  admin: ReturnType<typeof createAdminService>;
}

const KEY = /^[a-z][a-z0-9_]{0,63}$/;

export function adminRoutes(deps: AdminRouteDeps): PlatformRoute[] {
  const { admin } = deps;
  return [
    // P4: the checks of one club, with their results and which ones are recorded by hand.
    platformRoute({ method: 'GET', path: '/clubs/:id/launch', access: 'staff' }, async (ctx) => answer(await admin.launchOverview(ctx.staff!.id, clubIdOf(ctx)))),
    // P4: record the result of a recorded launch check (Testing clubs only). Nothing here runs a check.
    platformRoute({ method: 'PUT', path: '/clubs/:id/launch/:checkKey', access: 'admin' }, async (ctx) =>
      answer(await admin.recordLaunchCheck(actorOf(ctx), clubIdOf(ctx), ctx.input['checkKey'], ctx.body)),
    ),
    // P6: the platform values that are set.
    platformRoute({ method: 'GET', path: '/config', access: 'staff' }, async (ctx) => answer(await admin.listConfig(ctx.staff!.id))),
    // P6: one config value, audited with what was added or removed.
    platformRoute({ method: 'PUT', path: '/config/:key', access: 'admin' }, async (ctx) => {
      const key = ctx.input['key'];
      if (typeof key !== 'string' || !KEY.test(key)) throw new RouteError(404, 'not_found');
      return answer(await admin.setConfig(actorOf(ctx), key, ctx.body));
    }),
    // The legal notice: a new release of the privacy and terms texts in both languages.
    platformRoute({ method: 'POST', path: '/legal/releases', access: 'admin' }, async (ctx) => answer(await admin.publishLegalRelease(actorOf(ctx), ctx.body))),
  ];
}
