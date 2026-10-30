import { route, RouteError, type Route, type RouteContext } from '@booq/auth';
import type { Db } from '@booq/db';
import { DataRequestError, type DataRequestAction, type DataRequestErrorCode, createDataRequestService } from '@booq/domain';

// Staff routes for player data requests (F01-T33; PDPA-01-AC4, AC6, AC7). `datarequest.handle`
// is the owner's and front desk's. A player makes and reads their own through `datarequest.own`
// (POST and GET /me/data-requests). Path parameter: `input.id`.

type Service = ReturnType<typeof createDataRequestService>;

export interface DataRequestRouteDeps {
  db: Db;
  service(): Service;
}

const STATUS: Record<DataRequestErrorCode, number> = { forbidden: 403, not_found: 404, bad_transition: 409, future_booking: 409, already_erased: 409 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS: readonly DataRequestAction[] = ['start', 'done', 'decline'];
const bad = () => new RouteError(400, 'bad_input');

export function dataRequestRoutes(deps: DataRequestRouteDeps): Route<unknown>[] {
  const inClub = async <T>(ctx: RouteContext, fn: (service: Service, tx: Parameters<Parameters<Db['withClubTx']>[1]>[0]) => Promise<T>): Promise<T> => {
    try {
      return await deps.db.withClubTx(
        { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'admin', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) },
        (tx) => fn(deps.service(), tx),
      );
    } catch (e) {
      if (e instanceof DataRequestError) throw new RouteError(STATUS[e.code], e.code);
      throw e;
    }
  };
  const actor = (ctx: RouteContext) => ({ clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles as readonly string[] });

  return [
    route({ method: 'POST', path: '/me/data-requests', permission: 'datarequest.own' }, (ctx) => {
      const kind = (ctx.input as { kind?: unknown } | null)?.kind;
      if (kind !== 'copy' && kind !== 'delete') throw bad();
      return inClub(ctx, (s, tx) => s.create(tx, actor(ctx), { kind }));
    }),
    route({ method: 'GET', path: '/me/data-requests', permission: 'datarequest.own' }, (ctx) => inClub(ctx, (s, tx) => s.listOwn(tx, actor(ctx)))),
    route({ method: 'GET', path: '/data-requests/:id/impact', permission: 'datarequest.handle' }, (ctx) => {
      const id = (ctx.input as { id?: unknown } | null)?.id;
      if (typeof id !== 'string' || !UUID.test(id)) throw bad();
      return inClub(ctx, (s, tx) => s.deletionImpact(tx, actor(ctx), id));
    }),
    route({ method: 'GET', path: '/data-requests', permission: 'datarequest.handle' }, (ctx) => inClub(ctx, (s, tx) => s.listOpen(tx, actor(ctx)))),
    route({ method: 'POST', path: '/data-requests/:id/handle', permission: 'datarequest.handle' }, (ctx) => {
      const i = ctx.input as { id?: unknown; action?: unknown; note?: unknown } | null;
      if (typeof i?.id !== 'string' || !UUID.test(i.id)) throw bad();
      if (typeof i.action !== 'string' || !(ACTIONS as readonly string[]).includes(i.action)) throw bad();
      if (i.note !== undefined && typeof i.note !== 'string') throw bad();
      const id = i.id;
      const input = { action: i.action as DataRequestAction, ...(typeof i.note === 'string' ? { note: i.note } : {}) };
      return inClub(ctx, (s, tx) => s.handle(tx, actor(ctx), id, input));
    }),
  ];
}
