import { Reply, route, RouteError, type Route, type RouteContext } from '@booq/auth';
import type { Db } from '@booq/db';
import { ProfileEditError, type ProfileEditErrorCode, type createProfileEditService } from '@booq/domain';

// GET and PUT /me/profile (F02-T14; AUTH-02-AC15 to AC23, AC29). Any signed-in person, their own
// row only. The body is read as sent (`ctx.body`), not from the merged input, so a query value can
// never change the profile and an unknown field is refused.

type Service = ReturnType<typeof createProfileEditService>;
export interface ProfileRouteDeps {
  db: Db;
  service(): Service;
}

const STATUS: Record<Exclude<ProfileEditErrorCode, 'invalid'>, number> = { forbidden: 403, bad_input: 400 };

export function profileRoutes(deps: ProfileRouteDeps): Route<unknown>[] {
  const inClub = async <T>(ctx: RouteContext, fn: (service: Service, tx: Parameters<Parameters<Db['withClubTx']>[1]>[0]) => Promise<T>): Promise<T | Reply<unknown>> => {
    try {
      return await deps.db.withClubTx(
        { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'player_app', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) },
        (tx) => fn(deps.service(), tx),
      );
    } catch (e) {
      if (e instanceof ProfileEditError) {
        if (e.code === 'invalid') return new Reply({ code: 'invalid', fields: e.fields }, { status: 400 });
        throw new RouteError(STATUS[e.code], e.code);
      }
      throw e;
    }
  };
  const actor = (ctx: RouteContext) => ({ clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles as readonly string[] });

  return [
    route({ method: 'GET', path: '/me/profile', needsPerson: true }, (ctx) => inClub(ctx, (s, tx) => s.get(tx, actor(ctx)))),
    route({ method: 'PUT', path: '/me/profile', needsPerson: true }, (ctx) => inClub(ctx, (s, tx) => s.update(tx, actor(ctx), ctx.body))),
  ];
}
