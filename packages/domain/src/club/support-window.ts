import { route, RouteError } from '@booq/auth';
import type { Db } from '@booq/db';

// PUT /support-window (F01 design 5.1; PLAT-02-AC4, AC5): the owner lets BOOQ staff change setup
// values for 24 hours, or stops it early. The permission is checked by route(); the owner check
// and the 24 hour rule are repeated inside app.set_support_window, the only writer (SR-02).
export function supportWindowRoute(db: Db) {
  return route({ method: 'PUT', path: '/support-window', permission: 'support-window.write' }, async (ctx) => {
    const input = ctx.input;
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new RouteError(400, 'invalid_input');
    const body = input as Record<string, unknown>;
    if (Object.keys(body).length !== 1 || typeof body['on'] !== 'boolean') throw new RouteError(400, 'invalid_input');
    const on = body['on'];
    const until = await db.withClubTx(
      { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'admin', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) },
      async (tx) => (await tx.query<{ until: Date | null }>('select app.set_support_window($1) as until', [on])).rows[0]?.until ?? null,
    );
    return { on, until: until ? until.toISOString() : null };
  });
}
