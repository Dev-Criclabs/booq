import { route, RouteError, type Route, type RouteContext } from '@booq/auth';
import type { Db, Tx } from '@booq/db';
import {
  SetupError,
  createSetup,
  listCoachTierPrices,
  listSetup,
  setCoachTierPrice,
  updateSetup,
  type SetupErrorCode,
  type SetupResourceName,
} from '@booq/domain';

// F04-T14: the owner's setup routes (design 5.3; R3-AC8, PROMO-01-AC12). GET with price.read (front desk, accountant,
// owner), POST and PUT with price.write (owner). The service is packages/domain/src/checkout/setup.ts; every write is
// audited by the table triggers with the old and new values, and applies to new orders only. No delete route: a price
// that a held or paid order used is never removed (its lines hold copies; add-ons and codes are retired by `active`).
// The club is the session's; no club id is read from the input. Path parameter: `input.id`.

export interface PricingRouteDeps {
  db: Db;
}

const STATUS: Record<SetupErrorCode, number> = { bad_input: 400, not_found: 404, duplicate: 409, peak_not_defined: 400 };
const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const RESOURCES: SetupResourceName[] = ['price-groups', 'court-prices', 'add-ons', 'partners', 'promo-codes'];

function inTx<T>(deps: PricingRouteDeps, ctx: RouteContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return deps.db
    .withClubTx({ clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'admin', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) }, fn)
    .catch((e: unknown) => {
      if (e instanceof SetupError) throw new RouteError(STATUS[e.code], e.code);
      throw e;
    });
}

const idOf = (ctx: RouteContext) => ((ctx.input ?? {}) as Record<string, unknown>)['id'];

export function pricingRoutes(deps: PricingRouteDeps): Route<unknown>[] {
  const noStore = <T>(r: Route<T>): Route<T> => ({ ...r, headers: NO_STORE });
  const routes: Route<unknown>[] = [];
  for (const name of RESOURCES) {
    routes.push(
      noStore(route({ method: 'GET', path: `/setup/${name}`, permission: 'price.read' }, (ctx) => inTx(deps, ctx, (tx) => listSetup(tx, name)))),
      noStore(route({ method: 'POST', path: `/setup/${name}`, permission: 'price.write' }, (ctx) => inTx(deps, ctx, (tx) => createSetup(tx, name, ctx.body)))),
      noStore(route({ method: 'PUT', path: `/setup/${name}/:id`, permission: 'price.write' }, (ctx) => inTx(deps, ctx, (tx) => updateSetup(tx, name, idOf(ctx), ctx.body)))),
    );
  }
  // Coach tier prices are keyed by tier and price group: POST and PUT both set one.
  routes.push(
    noStore(route({ method: 'GET', path: '/setup/coach-tier-prices', permission: 'price.read' }, (ctx) => inTx(deps, ctx, (tx) => listCoachTierPrices(tx)))),
    noStore(route({ method: 'POST', path: '/setup/coach-tier-prices', permission: 'price.write' }, (ctx) => inTx(deps, ctx, (tx) => setCoachTierPrice(tx, ctx.body)))),
    noStore(route({ method: 'PUT', path: '/setup/coach-tier-prices', permission: 'price.write' }, (ctx) => inTx(deps, ctx, (tx) => setCoachTierPrice(tx, ctx.body)))),
  );
  return routes;
}
