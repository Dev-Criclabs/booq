import { route, RouteError, type Route } from '@booq/auth';
import type { Db } from '@booq/db';

// POST /me/line-friend (F02-T17; LINE-01-AC7 to AC9; design 5.2). The client reports `liff.getFriendship()`; the answer is
// kept as `app_user.line_friend` for the in-app ask to add the Official Account and for the push choice. It never blocks
// booking or payment (AC7, AC8): nothing else reads it to refuse anything. Only the signed-in person's own row changes, by
// the definer function app.set_line_friend (migration 0101), which takes the club from the context.

export interface LineFriendRouteDeps {
  db: Db;
}

export function lineFriendRoutes(deps: LineFriendRouteDeps): Route<unknown>[] {
  return [
    route({ method: 'POST', path: '/me/line-friend', needsPerson: true }, async (ctx) => {
      const body = ctx.body as Record<string, unknown> | undefined;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => k !== 'friendFlag') || typeof body['friendFlag'] !== 'boolean') {
        throw new RouteError(400, 'bad_input');
      }
      const flag = body['friendFlag'];
      await deps.db.withClubTx(
        { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'player_app', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) },
        async (tx) => {
          await tx.query('select app.set_line_friend(u.line_user_id, $1) from public.app_user u where u.id = app.user_id() and u.line_user_id is not null', [flag]);
        },
      );
      return { lineFriend: flag };
    }),
  ];
}
