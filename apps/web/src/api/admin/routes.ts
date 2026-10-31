import { FileReply, pagesFor, route, RouteError, type Route, type RouteContext } from '@booq/auth';
import type { ClubContext, Db, Tx } from '@booq/db';
import { createSetup, deleteSetup, listSetup, listTierPrices, putTierPrice, SETUP, updateSetup, ownerSetup, tellDone, auditLog, bookingHistory, addCustomer, creditAdjust, customerValue, extendPackage, mapValueError, requestHash, walletAdjust, withIdempotency, addCustomerNote, AdminError, type AdminErrorCode, customerBookings, customerNotes, customerOrders, customerProfile, customersCsv, listCustomers, setTag, shellState, staffCalendar } from '@booq/domain';

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

const STATUS: Record<AdminErrorCode, number> = { bad_input: 400, not_found: 404, forbidden: 403, reason_required: 400, below_zero: 409, customer_not_claimed: 409, duplicate: 409, in_use: 409, peak_not_defined: 400 };
// A refusal raised by an admin function in the database (BK001, message = the code).
const DB_STATUS: Record<string, number> = { phone_in_use: 409, reason_required: 400, club_not_available: 409 };

async function inTx<T>(db: Db, c: ClubContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.withClubTx(c, fn);
  } catch (e) {
    const mapped = mapValueError(e);
    if (mapped) throw new RouteError(STATUS[mapped.code], mapped.code);
    if (e instanceof AdminError) throw new RouteError(STATUS[e.code], e.code, Object.keys(e.detail).length ? (e.detail as never) : undefined);
    const err = e as { code?: string; message?: string };
    if (err.code === 'BK001' && err.message) throw new RouteError(DB_STATUS[err.message] ?? 409, err.message);
    if (err.code === '23505') throw new RouteError(409, 'duplicate');
    if (err.code === '23503') throw new RouteError(409, 'in_use');
    if (err.code === '23514' || err.code === '22P02' || err.code === '22003' || err.code === '22007') throw new RouteError(400, 'bad_input');
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
    {
      ...route({ method: 'GET', path: '/staff/customers/:id', permission: 'customer.contact.read' }, async (ctx) => {
        const c = await sessionContext(deps, ctx);
        return inTx(deps.db, c, (tx) => customerProfile(tx, inputOf(ctx)['id']));
      }),
      headers: NO_STORE,
    },
    {
      ...route({ method: 'GET', path: '/staff/customers/:id/bookings', permission: 'customer.contact.read' }, async (ctx) => {
        const c = await sessionContext(deps, ctx);
        return inTx(deps.db, c, (tx) => customerBookings(tx, inputOf(ctx)['id']));
      }),
      headers: NO_STORE,
    },
    {
      ...route({ method: 'GET', path: '/staff/customers/:id/orders', permission: 'customer.contact.read' }, async (ctx) => {
        const c = await sessionContext(deps, ctx);
        return inTx(deps.db, c, (tx) => customerOrders(tx, inputOf(ctx)['id']));
      }),
      headers: NO_STORE,
    },
    {
      ...route({ method: 'GET', path: '/staff/customers/:id/notes', permission: 'customer.contact.read' }, async (ctx) => {
        const c = await sessionContext(deps, ctx);
        return inTx(deps.db, c, (tx) => customerNotes(tx, inputOf(ctx)['id']));
      }),
      headers: NO_STORE,
    },
    route({ method: 'POST', path: '/staff/customers/:id/notes', permission: 'customer.write' }, async (ctx) => {
      const c = await sessionContext(deps, ctx);
      return inTx(deps.db, c, (tx) => addCustomerNote(tx, inputOf(ctx)['id'], bodyOf(ctx)['note']));
    }),
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

/** F11-T09: A0 Setup checklist (ADMIN-02): the owner's steps and "Tell BOOQ I'm done". Owner only. */
export function setupRoutes(deps: AdminRouteDeps): AdminRoute<unknown>[] {
  return [
    {
      ...route({ method: 'GET', path: '/staff/setup', permission: 'setup.read' }, async (ctx) => {
        const c = await sessionContext(deps, ctx);
        return inTx(deps.db, c, (tx) => ownerSetup(tx));
      }),
      headers: NO_STORE,
    },
    route({ method: 'POST', path: '/staff/setup/done', permission: 'setup.done' }, async (ctx) => {
      const c = await sessionContext(deps, ctx);
      return inTx(deps.db, c, (tx) => tellDone(tx));
    }),
  ];
}

/**
 * F11-T08: GET /staff/audit (A17, owner) and GET /staff/bookings/:id/history (A2, front desk and owner). Read only; there is no write or
 * delete route for the log anywhere (ADMIN-17-AC, D28).
 */
export function auditRoutes(deps: AdminRouteDeps): AdminRoute<unknown>[] {
  return [
    {
      ...route({ method: 'GET', path: '/staff/audit', permission: 'audit.read' }, async (ctx) => {
        const c = await sessionContext(deps, ctx);
        return inTx(deps.db, c, (tx) => auditLog(tx, inputOf(ctx)));
      }),
      headers: NO_STORE,
    },
    {
      ...route({ method: 'GET', path: '/staff/bookings/:id/history', permission: 'booking.create.staff' }, async (ctx) => {
        const c = await sessionContext(deps, ctx);
        return inTx(deps.db, c, (tx) => bookingHistory(tx, inputOf(ctx)['id']));
      }),
      headers: NO_STORE,
    },
  ];
}

const KEY = /^[\x21-\x7e]{1,200}$/;

/** The Idempotency-Key the transport passes from the header. Every change of value needs one (F11 design 7). */
function requiredKey(ctx: RouteContext): string {
  const key = inputOf(ctx)['idempotencyKey'];
  if (typeof key !== 'string' || !KEY.test(key)) throw new RouteError(400, 'bad_input', { field: 'idempotency_key' });
  return key;
}

/**
 * F11-T07: the credit and wallet panels of A6 (ADMIN-07) over F06. Front desk and owner read and adjust with a written reason; only the owner
 * extends a package (D88, D118). An adjust is repeated safely by its Idempotency-Key.
 */
export function customerValueRoutes(deps: AdminRouteDeps): AdminRoute<unknown>[] {
  const change = <T>(path: string, permission: string, fn: (tx: Tx, i: Record<string, unknown>, b: Record<string, unknown>) => Promise<T>) =>
    route({ method: 'POST', path, permission }, async (ctx) => {
      const c = await sessionContext(deps, ctx);
      const key = requiredKey(ctx);
      const { idempotencyKey: _k, ...rest } = inputOf(ctx);
      const hash = requestHash(`POST ${path}`, { ...rest, body: bodyOf(ctx) });
      return inTx(deps.db, c, (tx) => withIdempotency(tx, key, hash, () => fn(tx, inputOf(ctx), bodyOf(ctx))));
    });
  return [
    {
      ...route({ method: 'GET', path: '/staff/customers/:id/credits', permission: 'customer.contact.read' }, async (ctx) => {
        const c = await sessionContext(deps, ctx);
        return inTx(deps.db, c, (tx) => customerValue(tx, inputOf(ctx)['id']));
      }),
      headers: NO_STORE,
    },
    change('/staff/customers/:id/credit-adjust', 'customer.adjust', (tx, i, b) => creditAdjust(tx, i['id'], { packageId: b['packageId'], delta: b['delta'], note: b['note'] })),
    change('/staff/customers/:id/wallet-adjust', 'customer.adjust', (tx, i, b) => walletAdjust(tx, i['id'], { deltaSatang: b['deltaSatang'], note: b['note'] })),
    change('/staff/packages/:id/extend', 'package.extend', (tx, i, b) => extendPackage(tx, i['id'], { newExpiresOn: b['newExpiresOn'], reason: b['reason'] })),
  ];
}

/**
 * F04-T14 / F11 A9, A9b, A10: the owner's setup data (price groups, court prices, coach tiers and their prices, add-ons, partners, promo
 * codes). Reads need `price.read` (front desk and accountant see the prices; the row policies of promo codes and partners decide the rest),
 * writes need `price.write` (owner only). A change applies to new orders only; every write is audited by the table.
 */
export function setupDataRoutes(deps: AdminRouteDeps): AdminRoute<unknown>[] {
  const out: AdminRoute<unknown>[] = [];
  const mk = <T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, permission: string, fn: (tx: Tx, i: Record<string, unknown>, b: unknown) => Promise<T>): AdminRoute<T> =>
    ({
      ...route({ method, path, permission }, async (ctx) => {
        const c = await sessionContext(deps, ctx);
        return inTx(deps.db, c, (tx) => fn(tx, inputOf(ctx), ctx.body));
      }),
      ...(method === 'GET' ? { headers: NO_STORE } : {}),
    });
  for (const r of Object.values(SETUP)) {
    const base = `/staff/setup/${r.path}`;
    out.push(mk('GET', base, 'price.read', (tx) => listSetup(tx, r)));
    out.push(mk('POST', base, 'price.write', (tx, _i, b) => createSetup(tx, r, b)));
    out.push(mk('PUT', `${base}/:id`, 'price.write', (tx, i, b) => updateSetup(tx, r, i['id'], b)));
    if (!r.noDelete) out.push(mk('DELETE', `${base}/:id`, 'price.write', (tx, i) => deleteSetup(tx, r, i['id'])));
  }
  out.push(mk('GET', '/staff/setup/coach-tier-prices', 'price.read', (tx) => listTierPrices(tx)));
  out.push(mk('PUT', '/staff/setup/coach-tier-prices', 'price.write', (tx, _i, b) => putTierPrice(tx, b)));
  return out;
}
