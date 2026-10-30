import { route, RouteError, type Route, type RouteContext } from '@booq/auth';
import type { Db } from '@booq/db';
import { ClaimError, type ClaimErrorCode, createClaimService } from '@booq/domain';

// Claim routes for imported players (F01-T31b; PLAT-06-AC7; D105, SR-05; the A6 screen's data).
// `claim.handle` is front desk and owner. The merge and the rival rejection are in the database
// (app.claim_confirm, app.claim_reject), run in this request's transaction. A path parameter
// arrives as `input.id`. The claimant is never told a record was found: no player route reads claims.

type Service = ReturnType<typeof createClaimService>;
export interface ClaimRouteDeps {
  db: Db;
  service(): Service;
}

const STATUS: Record<ClaimErrorCode, number> = { forbidden: 403, not_found: 404, not_open: 409 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function claimRoutes(deps: ClaimRouteDeps): Route<unknown>[] {
  const inClub = async <T>(ctx: RouteContext, fn: (service: Service, tx: Parameters<Parameters<Db['withClubTx']>[1]>[0]) => Promise<T>): Promise<T> => {
    try {
      return await deps.db.withClubTx(
        { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'admin', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) },
        (tx) => fn(deps.service(), tx),
      );
    } catch (e) {
      if (e instanceof ClaimError) throw new RouteError(STATUS[e.code], e.code);
      throw e;
    }
  };
  const actor = (ctx: RouteContext) => ({ clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles as readonly string[] });
  const idOf = (ctx: RouteContext) => {
    const id = (ctx.input as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !UUID.test(id)) throw new RouteError(400, 'bad_input');
    return id;
  };

  return [
    route({ method: 'GET', path: '/claims', permission: 'claim.handle' }, (ctx) => inClub(ctx, (s, tx) => s.listOpen(tx, actor(ctx)))),
    route({ method: 'POST', path: '/claims/:id/confirm', permission: 'claim.handle' }, async (ctx) => {
      const id = idOf(ctx);
      await inClub(ctx, (s, tx) => s.confirm(tx, actor(ctx), id));
      return { id, status: 'confirmed' };
    }),
    route({ method: 'POST', path: '/claims/:id/reject', permission: 'claim.handle' }, async (ctx) => {
      const id = idOf(ctx);
      await inClub(ctx, (s, tx) => s.reject(tx, actor(ctx), id));
      return { id, status: 'rejected' };
    }),
  ];
}
