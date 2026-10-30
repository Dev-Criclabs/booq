import { route, RouteError, type Route, type RouteContext } from '@booq/auth';
import type { Db } from '@booq/db';
import { ExportError, type ExportErrorCode, type ExportKind, type ExportSummary, createExportService } from '@booq/domain';

// Export routes (F01-T32; PLAT-06-AC11, AC12, AC17; D14). `export.run` is the owner's. The
// owner starts an export and later asks for its status and signed link; the build happens in a
// worker task in the club's context, told by ids only. There is no delete route here or anywhere
// (AC17). BOOQ staff start an export from the platform console, not from this app, and have no
// route here to read it. A path parameter arrives as `input.id`.

type Service = ReturnType<typeof createExportService>;

export const CLUB_EXPORT_TASK = 'club_export';

export interface ExportRouteDeps {
  db: Db;
  service(): Service;
  /** Adds a worker job. The payload carries ids only. */
  enqueue(task: string, payload: { clubId: string; exportId: string }): Promise<void>;
}

const STATUS: Record<ExportErrorCode, number> = { forbidden: 403, not_found: 404, expired: 410 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: readonly ExportKind[] = ['club', 'customers'];
const bad = () => new RouteError(400, 'bad_input');

export function exportRoutes(deps: ExportRouteDeps): Route<ExportSummary>[] {
  const inClub = async <T>(ctx: RouteContext, fn: (service: Service, tx: Parameters<Parameters<Db['withClubTx']>[1]>[0]) => Promise<T>): Promise<T> => {
    try {
      return await deps.db.withClubTx(
        { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'admin', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) },
        (tx) => fn(deps.service(), tx),
      );
    } catch (e) {
      if (e instanceof ExportError) throw new RouteError(STATUS[e.code], e.code);
      throw e;
    }
  };
  const actor = (ctx: RouteContext) => ({ clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles as readonly string[] });

  return [
    route({ method: 'POST', path: '/exports', permission: 'export.run' }, async (ctx) => {
      const kind = (ctx.input as { kind?: unknown } | null)?.kind;
      if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) throw bad();
      const started = await inClub(ctx, (s, tx) => s.start(tx, actor(ctx), { kind: kind as ExportKind }));
      await deps.enqueue(CLUB_EXPORT_TASK, { clubId: ctx.clubId, exportId: started.id });
      return started;
    }),
    route({ method: 'GET', path: '/exports/:id', permission: 'export.run' }, (ctx) => {
      const id = (ctx.input as { id?: unknown } | null)?.id;
      if (typeof id !== 'string' || !UUID.test(id)) throw bad();
      return inClub(ctx, (s, tx) => s.get(tx, actor(ctx), id));
    }),
  ];
}
