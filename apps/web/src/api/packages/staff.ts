import { route, RouteError, type Route, type RouteContext } from '@booq/auth';
import type { ClubContext, Db, Tx } from '@booq/db';
import { CheckoutError, packageQuoteFor, placePackageOrder, requestHash, withIdempotency, type QuoteSources } from '@booq/domain';

// F06-T16 (D174): the desk cash package sale, A02c (R3-AC5, AC6, AC8; F05 PAY-06). One transaction: the package order is placed for
// the named customer the way the player's package Pay places it (the club must be open: a Paused club is refused, R3-AC6; the
// product's price group must fit the buyer: a Student product needs a buyer under 18, R3-AC8; the wallet is used before money), then
// F05's app.take_cash records the cash with its reason code, grants the package through the grant_package port and issues the
// receipt through F13's port (R3-AC5). When the wallet covers the whole price nothing is left for cash and the order is complete at
// once (PAY-07). Repeated safely by its Idempotency-Key. The adjust, extend and credits routes of A6 are F11-T07's (customer.adjust,
// package.extend); value owed is F13's report. Text is never written here; a code goes to the client.

export interface StaffPackageRouteDeps {
  db: Db;
  clubBySlug(slug: string): Promise<{ clubId: string } | null>;
  sources: QuoteSources;
}

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[\x21-\x7e]{1,200}$/;
const REASONS = ['no_banking_app', 'qr_failed_at_counter', 'other'] as const;
const inputOf = (ctx: RouteContext) => (ctx.input ?? {}) as Record<string, unknown>;
const bodyOf = (ctx: RouteContext) => (ctx.body ?? {}) as Record<string, unknown>;

function checkoutStatus(code: string): number {
  if (code === 'bad_input' || code === 'selection_invalid') return 400;
  if (code === 'order_not_found' || code === 'customer_not_found') return 404;
  if (code === 'payment_unavailable') return 503;
  if (code.startsWith('code_') || code === 'one_code_per_order') return 422;
  return 409;
}

async function inTx<T>(db: Db, c: ClubContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.withClubTx(c, fn);
  } catch (e) {
    if (e instanceof RouteError) throw e;
    if (e instanceof CheckoutError) throw new RouteError(checkoutStatus(e.code), e.code);
    const err = e as { code?: string; message?: string };
    if (err.code === '42501') throw new RouteError(403, 'forbidden');
    if (err.code === 'P0001' && err.message === 'payment: no open order') throw new RouteError(409, 'order_not_open');
    throw e;
  }
}

async function staffContext(deps: StaffPackageRouteDeps, ctx: RouteContext): Promise<ClubContext> {
  const slug = inputOf(ctx)['slug'];
  if (slug !== undefined) {
    const club = typeof slug === 'string' && SLUG.test(slug) ? await deps.clubBySlug(slug) : null;
    if (!club || club.clubId !== ctx.clubId) throw new RouteError(404, 'not_found');
  }
  return { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'admin', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) };
}

interface SaleRequest {
  customerId: string;
  productId: string;
  reasonCode: (typeof REASONS)[number];
  note: string | null;
}

function parseSale(ctx: RouteContext): SaleRequest {
  const customerId = inputOf(ctx)['id'];
  const b = bodyOf(ctx);
  const productId = b['productId'];
  const reasonCode = b['reasonCode'];
  const note = b['note'] ?? null;
  if (typeof customerId !== 'string' || !UUID.test(customerId)) throw new RouteError(404, 'not_found');
  if (typeof productId !== 'string' || !UUID.test(productId)) throw new RouteError(400, 'bad_input', { field: 'productId' });
  if (typeof reasonCode !== 'string' || !(REASONS as readonly string[]).includes(reasonCode)) throw new RouteError(400, 'bad_input', { field: 'reasonCode' });
  if (note !== null && typeof note !== 'string') throw new RouteError(400, 'bad_input', { field: 'note' });
  const trimmed = note === null ? '' : note.trim();
  // PAY-06-AC2: the reason "other" needs a written note (take_cash and the table CHECK say the same).
  if (reasonCode === 'other' && trimmed === '') throw new RouteError(400, 'reason_required');
  return { customerId: customerId.toLowerCase(), productId: productId.toLowerCase(), reasonCode: reasonCode as SaleRequest['reasonCode'], note: trimmed === '' ? null : trimmed };
}

export interface PackageSaleResult {
  orderId: string;
  /** The cash payment, or null when the wallet covered the whole price. */
  paymentId: string | null;
  cashSatang: number;
  walletSatang: number;
}

export function staffPackageRoutes(deps: StaffPackageRouteDeps): Array<Route<unknown> & { headers?: Readonly<Record<string, string>> }> {
  const path = '/staff/customers/:id/package-sale';
  return [
    {
      ...route({ method: 'POST', path, permission: 'payment.cash' }, async (ctx): Promise<PackageSaleResult> => {
        const c = await staffContext(deps, ctx);
        const key = inputOf(ctx)['idempotencyKey'];
        if (typeof key !== 'string' || !KEY.test(key)) throw new RouteError(400, 'bad_input', { field: 'idempotency_key' });
        const sale = parseSale(ctx);
        return inTx(deps.db, c, (tx) =>
          withIdempotency(tx, key, requestHash(`POST ${path}`, sale), async () => {
            const quote = await packageQuoteFor(tx, sale.customerId, { productId: sale.productId, code: null }, deps.sources, { forCustomer: true });
            const placed = await placePackageOrder(tx, sale.customerId, quote, deps.sources);
            if (placed.confirmed) return { orderId: placed.orderId, paymentId: null, cashSatang: 0, walletSatang: quote.walletSatang };
            const r = (await tx.query<{ r: { payment_id: string } }>('select app.take_cash($1, $2, $3) as r', [placed.orderId, sale.reasonCode, sale.note])).rows[0]!.r;
            return { orderId: placed.orderId, paymentId: r.payment_id, cashSatang: quote.moneySatang, walletSatang: quote.walletSatang };
          }),
        );
      }),
      headers: NO_STORE,
    },
  ];
}
