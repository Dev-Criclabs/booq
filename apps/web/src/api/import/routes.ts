import { route, RouteError, type Route, type RouteContext } from '@booq/auth';
import type { Db } from '@booq/db';
import { ImportError, type ImportErrorCode, type ImportLimits, type ImportSummary, createImportService } from '@booq/domain';

// CSV import routes (F01-T31; PLAT-06-AC1 to AC8; design 5 and 7.4). Owner only: every route
// declares `import.run`, which only the owner holds, and the service and the database policies
// check again. The handlers are thin: validate the input, open the club transaction, call the
// service, answer a summary or a typed code. The club, user and roles come from the session
// only. A path parameter arrives as `input.id`.

type Service = ReturnType<typeof createImportService>;

export interface ImportRouteDeps {
  db: Db;
  /** Platform configuration (row limit, staging life). Null until configured: the import is then refused. */
  limits: ImportLimits | null;
  service(limits: ImportLimits): Service;
}

const STATUS: Record<ImportErrorCode, number> = {
  forbidden: 403,
  not_found: 404,
  kind_not_available: 400,
  too_many_rows: 413,
  not_confirmable: 409,
  not_cancellable: 409,
  expired: 410,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = () => new RouteError(400, 'bad_input');

export function importRoutes(deps: ImportRouteDeps): Route<ImportSummary>[] {
  const run = async (ctx: RouteContext, fn: (service: Service, tx: Parameters<Parameters<Db['withClubTx']>[1]>[0]) => Promise<ImportSummary>) => {
    if (!deps.limits) throw new RouteError(503, 'import_not_configured');
    const service = deps.service(deps.limits);
    try {
      return await deps.db.withClubTx(
        { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'admin', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) },
        (tx) => fn(service, tx),
      );
    } catch (e) {
      if (e instanceof ImportError) throw new RouteError(STATUS[e.code], e.code);
      throw e;
    }
  };
  const actor = (ctx: RouteContext) => ({ clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles as readonly string[] });
  const idOf = (ctx: RouteContext) => {
    const id = (ctx.input as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !UUID.test(id)) throw bad();
    return id;
  };

  return [
    route({ method: 'POST', path: '/imports', permission: 'import.run' }, (ctx) => {
      const i = ctx.input as { kind?: unknown; fileName?: unknown; content?: unknown } | null;
      if (typeof i?.kind !== 'string' || typeof i.fileName !== 'string' || i.fileName.trim() === '' || typeof i.content !== 'string') throw bad();
      const input = { kind: i.kind, fileName: i.fileName.trim(), text: i.content };
      return run(ctx, (s, tx) => s.start(tx, actor(ctx), input));
    }),
    route({ method: 'GET', path: '/imports/:id', permission: 'import.run' }, (ctx) => {
      const id = idOf(ctx);
      return run(ctx, (s, tx) => s.get(tx, actor(ctx), id));
    }),
    route({ method: 'POST', path: '/imports/:id/confirm', permission: 'import.run' }, (ctx) => {
      const id = idOf(ctx);
      return run(ctx, (s, tx) => s.confirm(tx, actor(ctx), id));
    }),
    route({ method: 'DELETE', path: '/imports/:id', permission: 'import.run' }, (ctx) => {
      const id = idOf(ctx);
      return run(ctx, (s, tx) => s.cancel(tx, actor(ctx), id));
    }),
  ];
}
