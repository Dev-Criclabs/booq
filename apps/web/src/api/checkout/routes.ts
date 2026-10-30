import { route, RouteError, type Route, type RouteContext } from '@booq/auth';
import type { ClubContext, Db, Tx } from '@booq/db';
import { CheckoutError, parseQuoteRequest, quoteFor, type CheckoutErrorCode, type QuoteSources } from '@booq/domain';

// F04 checkout routes (design 5.1, prefix /api/c/{slug}). Thin handlers: the session's club, the club
// transaction with the caller's context, the service in packages/domain/src/checkout, a body or a typed code.
// The client sends choices, never amounts (CC-2); the body is read as sent, not merged with the query.
// No club id is read from the input.

export interface CheckoutRouteDeps {
  db: Db;
  clubBySlug(slug: string): Promise<{ clubId: string } | null>;
  sources: QuoteSources;
}

const STATUS: Record<CheckoutErrorCode, number> = {
  bad_input: 400,
  club_paused: 409,
  club_not_available: 409,
  resource_inactive: 409,
  selection_invalid: 400,
  price_not_set: 409,
  coach_price_not_set: 409,
  add_on_not_for_sale: 409,
  code_not_valid: 422,
  code_expired: 422,
  code_wrong_audience: 422,
  code_out_of_scope: 422,
  code_below_minimum: 422,
  code_first_booking_only: 422,
  code_used_up: 422,
  code_not_for_solo_class: 422,
};
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const inputOf = (ctx: RouteContext) => (ctx.input ?? {}) as Record<string, unknown>;

async function inTx<T>(db: Db, c: ClubContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.withClubTx(c, fn);
  } catch (e) {
    if (e instanceof CheckoutError) throw new RouteError(STATUS[e.code], e.code, Object.keys(e.detail).length ? e.detail : undefined);
    throw e;
  }
}

/** The session's club; a path slug naming another club is not found (FA 4.2). */
async function sessionContext(deps: CheckoutRouteDeps, ctx: RouteContext): Promise<ClubContext> {
  const slug = inputOf(ctx)['slug'];
  if (slug !== undefined) {
    const club = typeof slug === 'string' && SLUG.test(slug) ? await deps.clubBySlug(slug) : null;
    if (!club || club.clubId !== ctx.clubId) throw new RouteError(404, 'not_found');
  }
  return { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'player_app', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) };
}

/** F04-T11: POST /checkout/quote. Needs a signed in person; a guest signs in first (R8-AC4). Prices as a player (ROLE-01-AC4). */
export function checkoutRoutes(deps: CheckoutRouteDeps): Route<unknown>[] {
  return [
    {
      ...route({ method: 'POST', path: '/checkout/quote', needsPerson: true }, async (ctx) => {
        const c = await sessionContext(deps, ctx);
        const request = (() => {
          try {
            return parseQuoteRequest(ctx.body);
          } catch (e) {
            if (e instanceof CheckoutError) throw new RouteError(STATUS[e.code], e.code);
            throw e;
          }
        })();
        return inTx(deps.db, c, (tx) => quoteFor(tx, ctx.userId, request, deps.sources));
      }),
      headers: NO_STORE,
    },
  ];
}
