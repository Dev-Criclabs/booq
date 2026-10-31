import { RouteError } from '@booq/auth';
import { answer } from '../http/answer';
import { platformRoute, type PlatformRoute } from '../http/server';
import { actorOf, clubIdOf } from '../clubs/routes';
import type { createSettingsService } from './settings';

// The club settings of the console (F01; PLAT-05): the same settings the owner edits, written by BOOQ staff while the club is
// Draft or Testing (or the owner opened the support window). Thin: every rule is in the service and the database.
export interface SettingsRouteDeps {
  settings: ReturnType<typeof createSettingsService>;
}

export function settingsRoutes(deps: SettingsRouteDeps): PlatformRoute[] {
  return [
    platformRoute({ method: 'GET', path: '/clubs/:id/settings', access: 'staff' }, async (ctx) => answer(await deps.settings.list(ctx.staff!.id, clubIdOf(ctx)))),
    platformRoute({ method: 'PUT', path: '/clubs/:id/settings/:key', access: 'staff' }, async (ctx) => {
      const key = ctx.input['key'];
      if (typeof key !== 'string') throw new RouteError(404, 'not_found');
      return answer(await deps.settings.set(actorOf(ctx), clubIdOf(ctx), key, ctx.body));
    }),
  ];
}
