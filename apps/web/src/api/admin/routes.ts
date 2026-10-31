import { pagesFor, route, RouteError, type Route, type RouteContext } from '@booq/auth';
import type { ClubContext, Db, Tx } from '@booq/db';
import { shellState } from '@booq/domain';

// F11 club admin routes (design 4 to 6, prefix /api/c/{slug}). Thin handlers: resolve the club from the session and the path slug, open
// the club transaction, call the service in packages/domain/src/admin, answer a body or a typed code. No club id is read from the input.
// Text is never written here; the page picks it by key from a code.

export interface AdminRouteDeps {
  db: Db;
  /** The club behind a path slug, or null when there is none. */
  clubBySlug(slug: string): Promise<{ clubId: string } | null>;
}

export type AdminRoute<T> = Route<T> & { headers?: Readonly<Record<string, string>> };

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const inputOf = (ctx: RouteContext) => (ctx.input ?? {}) as Record<string, unknown>;

async function inTx<T>(db: Db, c: ClubContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.withClubTx(c, fn);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === 'BK001' && err.message) throw new RouteError(409, err.message);
    if (err.code === '42501') throw new RouteError(403, 'forbidden');
    throw e;
  }
}

async function sessionContext(deps: AdminRouteDeps, ctx: RouteContext, source: 'admin' = 'admin'): Promise<ClubContext> {
  const slug = inputOf(ctx)['slug'];
  if (slug !== undefined) {
    const club = typeof slug === 'string' && SLUG.test(slug) ? await deps.clubBySlug(slug) : null;
    if (!club || club.clubId !== ctx.clubId) throw new RouteError(404, 'not_found');
  }
  return { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source, ...(ctx.requestId ? { requestId: ctx.requestId } : {}) };
}

/** F11-T02: GET /staff/shell. The pages the roles may open (the same `can()` that guards the routes) and the banners (ADMIN-01). */
export function shellRoutes(deps: AdminRouteDeps): AdminRoute<unknown>[] {
  return [
    {
      ...route({ method: 'GET', path: '/staff/shell', permission: 'staff.shell' }, async (ctx) => {
        const c = await sessionContext(deps, ctx);
        const state = await inTx(deps.db, c, (tx) => shellState(tx));
        return { pages: pagesFor(ctx.roles), ...state };
      }),
      headers: NO_STORE,
    },
  ];
}
