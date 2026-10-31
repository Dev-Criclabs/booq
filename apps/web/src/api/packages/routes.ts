import { route, RouteError, type Route, type RouteContext } from '@booq/auth';
import type { ClubContext, Db, Tx } from '@booq/db';
import { listPublicProducts, ownCredits, ownLedger, PackageError, type PackageErrorCode } from '@booq/domain';

// F06-T15 player routes (F06 design 5, prefix /api/c/{slug}). Thin handlers: resolve the club, open the club transaction with the
// caller's context, call the service in packages/domain/src/packages, answer a body or a typed code. No club id is read from the
// input; text is never written here (CC-5). Buying a package is BE-C's Pay route (C10P): the products list gives the product id it
// takes. There is no route here, or anywhere, that withdraws or refunds wallet value (PKG-01-AC9).

export interface PackageRouteDeps {
  db: Db;
  /** The club behind a path slug, or null when there is none. */
  clubBySlug(slug: string): Promise<{ clubId: string } | null>;
}

export type PackageRoute<T> = Route<T> & { headers?: Readonly<Record<string, string>> };

const STATUS: Record<PackageErrorCode, number> = { bad_input: 400, not_found: 404, forbidden: 403 };
const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const inputOf = (ctx: RouteContext) => (ctx.input ?? {}) as Record<string, unknown>;

async function inTx<T>(db: Db, c: ClubContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.withClubTx(c, fn);
  } catch (e) {
    if (e instanceof PackageError) throw new RouteError(STATUS[e.code], e.code);
    if ((e as { code?: string }).code === '42501') throw new RouteError(403, 'forbidden');
    throw e;
  }
}

/** A guest reads as role `guest`; a signed in caller keeps their own context; a slug naming another club is not found. */
async function publicContext(deps: PackageRouteDeps, ctx: RouteContext): Promise<ClubContext> {
  const slug = inputOf(ctx)['slug'];
  if (typeof slug !== 'string' || !SLUG.test(slug)) throw new RouteError(404, 'not_found');
  const club = await deps.clubBySlug(slug);
  if (!club) throw new RouteError(404, 'not_found');
  const signedIn = typeof ctx.clubId === 'string' && typeof ctx.userId === 'string';
  if (!signedIn) return { clubId: club.clubId, userId: null, roles: ['guest'] };
  if (ctx.clubId !== club.clubId) throw new RouteError(404, 'not_found');
  return { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, ...(ctx.requestId ? { requestId: ctx.requestId } : {}) };
}

async function ownContext(deps: PackageRouteDeps, ctx: RouteContext): Promise<ClubContext & { userId: string }> {
  const slug = inputOf(ctx)['slug'];
  if (slug !== undefined) {
    const club = typeof slug === 'string' && SLUG.test(slug) ? await deps.clubBySlug(slug) : null;
    if (!club || club.clubId !== ctx.clubId) throw new RouteError(404, 'not_found');
  }
  return { clubId: ctx.clubId, userId: ctx.userId as string, roles: ctx.roles, source: 'player_app', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) };
}

export function playerPackageRoutes(deps: PackageRouteDeps): PackageRoute<unknown>[] {
  return [
    // C9: the club's products, for a guest too (named public columns only, D103).
    {
      ...route({ method: 'GET', path: '/packages', public: true }, async (ctx) => {
        const c = await publicContext(deps, ctx);
        return inTx(deps.db, c, (tx) => listPublicProducts(tx));
      }),
      headers: NO_STORE,
    },
    // C14: the caller's packages and wallet balance.
    {
      ...route({ method: 'GET', path: '/me/credits', needsPerson: true }, async (ctx) => {
        const c = await ownContext(deps, ctx);
        return inTx(deps.db, c, (tx) => ownCredits(tx, c.userId));
      }),
      headers: NO_STORE,
    },
    // C14: the caller's movements, newest first: ?kind=credit|wallet&cursor=
    {
      ...route({ method: 'GET', path: '/me/ledger', needsPerson: true }, async (ctx) => {
        const c = await ownContext(deps, ctx);
        const i = inputOf(ctx);
        return inTx(deps.db, c, (tx) => ownLedger(tx, c.userId, i['kind'], i['cursor']));
      }),
      headers: NO_STORE,
    },
  ];
}
