import { FileReply, pagesFor, route, RouteError, type Route, type RouteContext } from '@booq/auth';
import type { ClubContext, Db, Tx } from '@booq/db';
import { addCustomer, AdminError, type AdminErrorCode, customersCsv, listCustomers, setTag, shellState, staffCalendar } from '@booq/domain';

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

const STATUS: Record<AdminErrorCode, number> = { bad_input: 400, not_found: 404, forbidden: 403, reason_required: 400 };
// A refusal raised by an admin function in the database (BK001, message = the code).
const DB_STATUS: Record<string, number> = { phone_in_use: 409, reason_required: 400 };

async function inTx<T>(db: Db, c: ClubContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.withClubTx(c, fn);
  } catch (e) {
    if (e instanceof AdminError) throw new RouteError(STATUS[e.code], e.code, Object.keys(e.detail).length ? (e.detail as never) : undefined);
    const err = e as { code?: string; message?: string };
    if (err.code === 'BK001' && err.message) throw new RouteError(DB_STATUS[err.message] ?? 409, err.message);
    if (err.code === '42501') throw new RouteError(403, 'forbidden');
    if (err.code === 'P0001' && err.message?.includes('invalid range')) throw new RouteError(400, 'bad_input');
    if (err.code === 'P0001' && err.message?.startsWith('customers: ')) throw new RouteError(/unknown/.test(err.message) ? 404 : 400, /unknown/.test(err.message) ? 'not_found' : 'bad_input');
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

/** F11-T03: GET /staff/calendar?from=&to= for A1 (ADMIN-03): one read of the days, at most 7. Front desk and owner. */
export function calendarRoutes(deps: AdminRouteDeps): AdminRoute<unknown>[] {
  return [
    {
      ...route({ method: 'GET', path: '/staff/calendar', permission: 'calendar.read' }, async (ctx) => {
        const c = await sessionContext(deps, ctx);
        const i = inputOf(ctx);
        return inTx(deps.db, c, (tx) => staffCalendar(tx, i['from'], i['to']));
      }),
      headers: NO_STORE,
    },
  ];
}

const bodyOf = (ctx: RouteContext) => (ctx.body ?? {}) as Record<string, unknown>;

/**
 * F11-T04: A5 Customers (ADMIN-06) and the walk in quick add (ADMIN-04). The list and the CSV need `customer.contact.read` and
 * `customer.export`; tags and the quick add need `customer.write`. `/staff/customers/csv` is declared before any `/staff/customers/:id`.
 */
export function customerRoutes(deps: AdminRouteDeps): AdminRoute<unknown>[] {
  const csv = (name: string, body: string) => new FileReply(new TextEncoder().encode(body), { contentType: 'text/csv; charset=utf-8', filename: name });
  return [
    {
      ...route({ method: 'GET', path: '/staff/customers', permission: 'customer.contact.read' }, async (ctx) => {
        const c = await sessionContext(deps, ctx);
        const i = inputOf(ctx);
        return inTx(deps.db, c, (tx) => listCustomers(tx, i['q'], i['tag'], i['cursor']));
      }),
      headers: NO_STORE,
    },
    {
      ...route({ method: 'GET', path: '/staff/customers/csv', permission: 'customer.export' }, async (ctx) => {
        const c = await sessionContext(deps, ctx);
        const r = await inTx(deps.db, c, (tx) => customersCsv(tx));
        return csv('customers.csv', r.csv);
      }),
      headers: NO_STORE,
    },
    route({ method: 'POST', path: '/staff/customers', permission: 'customer.write' }, async (ctx) => {
      const c = await sessionContext(deps, ctx);
      const b = bodyOf(ctx);
      return inTx(deps.db, c, (tx) => addCustomer(tx, { name: b['name'], phone: b['phone'] }));
    }),
    route({ method: 'POST', path: '/staff/customers/:id/tags', permission: 'customer.write' }, async (ctx) => {
      const c = await sessionContext(deps, ctx);
      return inTx(deps.db, c, (tx) => setTag(tx, inputOf(ctx)['id'], bodyOf(ctx)['tag'], true));
    }),
    route({ method: 'DELETE', path: '/staff/customers/:id/tags/:tag', permission: 'customer.write' }, async (ctx) => {
      const c = await sessionContext(deps, ctx);
      const i = inputOf(ctx);
      return inTx(deps.db, c, (tx) => setTag(tx, i['id'], i['tag'], false));
    }),
  ];
}
