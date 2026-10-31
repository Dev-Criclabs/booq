import { route, RouteError, type Route, type RouteContext } from '@booq/auth';
import type { ClubContext, Db, Tx } from '@booq/db';
import {
  CheckoutError,
  findLiveHold,
  offerChoice,
  offerHold,
  parseOfferRef,
  offerReused,
  placeOfferOrder,
  findLivePackageOrder,
  packageQuoteFor,
  parsePackagePayRequest,
  parsePackageQuoteRequest,
  placePackageOrder,
  preparePackagePay,
  parsePayRequest,
  parseQuoteRequest,
  placeOrder,
  preparePay,
  quoteFor,
  readOrder,
  requestHash,
  startPayment,
  withIdempotency,
  type CheckoutErrorCode,
  type PlacedOrder,
  type QuoteSources,
  type StartPaymentDeps,
} from '@booq/domain';

// F04 checkout routes (design 5.1, prefix /api/c/{slug}). Thin handlers: the session's club, the club
// transaction with the caller's context, the service in packages/domain/src/checkout, a body or a typed code.
// The client sends choices, never amounts (CC-2); the body is read as sent, not merged with the query.
// No club id is read from the input.

export interface CheckoutRouteDeps {
  db: Db;
  clubBySlug(slug: string): Promise<{ clubId: string } | null>;
  sources: QuoteSources;
  /** What startPayment needs besides the database (F05-T04b); the key is read when a payment starts. */
  payments: Omit<StartPaymentDeps, 'db' | 'privateKey'> & { privateKey(): string };
}

const STATUS: Record<CheckoutErrorCode, number> = {
  bad_input: 400,
  club_paused: 409,
  club_not_available: 409,
  resource_inactive: 409,
  selection_invalid: 400,
  price_not_set: 409,
  coach_price_not_set: 409,
  coach_at_checkout_disabled: 409,
  add_on_not_for_sale: 409,
  package_not_for_sale: 409,
  student_item_not_allowed: 409,
  code_not_valid: 422,
  code_expired: 422,
  code_wrong_audience: 422,
  code_out_of_scope: 422,
  code_below_minimum: 422,
  code_first_booking_only: 422,
  code_used_up: 422,
  code_not_for_solo_class: 422,
  one_code_per_order: 422,
  birthday_not_available: 409,
  credit_unavailable: 409,
  payment_unavailable: 503,
  order_not_found: 404,
  spot_gone: 409,
  customer_not_found: 404,
};
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const inputOf = (ctx: RouteContext) => (ctx.input ?? {}) as Record<string, unknown>;

// The refusals of reserve_court (BK001, message = the code, detail = its one value; F03 design 4.2).
const CLAIM_STATUS: Record<string, number> = { too_many_attempts: 429, slot_unavailable: 409, limit_reached: 409, sign_in_required: 401 };
const CLAIM_PARAM: Record<string, string> = { too_many_attempts: 'seconds', slot_unavailable: 'by', limit_reached: 'hours' };
const KEY = /^[\x21-\x7e]{1,200}$/;

async function inTx<T>(db: Db, c: ClubContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.withClubTx(c, fn);
  } catch (e) {
    if (e instanceof CheckoutError) throw new RouteError(STATUS[e.code], e.code, Object.keys(e.detail).length ? e.detail : undefined);
    const err = e as { code?: string; message?: string; detail?: string };
    if (err.code === 'BK001' && err.message) {
      const param = CLAIM_PARAM[err.message];
      const value = param && err.detail !== undefined ? (param === 'by' ? err.detail : Number(err.detail)) : undefined;
      throw new RouteError(CLAIM_STATUS[err.message] ?? 409, err.message, value !== undefined ? { [param!]: value } : undefined);
    }
    throw e;
  }
}

const typed = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch (e) {
    if (e instanceof CheckoutError) throw new RouteError(STATUS[e.code], e.code);
    throw e;
  }
};

/** The session's club; a path slug naming another club is not found (FA 4.2). `staff` marks an admin change. */
async function sessionContext(deps: CheckoutRouteDeps, ctx: RouteContext, staff: boolean): Promise<ClubContext> {
  const slug = inputOf(ctx)['slug'];
  if (slug !== undefined) {
    const club = typeof slug === 'string' && SLUG.test(slug) ? await deps.clubBySlug(slug) : null;
    if (!club || club.clubId !== ctx.clubId) throw new RouteError(404, 'not_found');
  }
  return { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: staff ? 'admin' : 'player_app', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who the order is for: the signed in player, or for staff the customer named in the body (ROLE-01-AC4). */
function customerOf(ctx: RouteContext, staff: boolean): string {
  if (!staff) return ctx.userId;
  const id = ((ctx.body ?? {}) as Record<string, unknown>)['customerId'];
  if (typeof id !== 'string' || !UUID.test(id)) throw new RouteError(400, 'bad_input');
  return id.toLowerCase();
}

function quoteHandler(deps: CheckoutRouteDeps, staff: boolean) {
  return async (ctx: RouteContext) => {
    const c = await sessionContext(deps, ctx, staff);
    const customer = customerOf(ctx, staff);
    // A waitlist offer (F04-T22c) is priced on its held booking's court and hour; a staff quote names no offer.
    const offer = staff ? null : typed(() => parseOfferRef(ctx.body));
    if (offer) return inTx(deps.db, c, async (tx) => quoteFor(tx, customer, offerChoice(ctx.body, await offerHold(tx, customer, offer)), deps.sources));
    const request = typed(() => parseQuoteRequest(ctx.body));
    return inTx(deps.db, c, (tx) => quoteFor(tx, customer, request, deps.sources, { forCustomer: staff }));
  };
}

/** F04-T22c: Pay for the caller's waitlist offer, the claim's held booking and order (body {orderId, bookingId, quoteHash}). */
function offerPay(deps: CheckoutRouteDeps, ctx: RouteContext, c: ClubContext, customer: string, offer: { orderId: string; bookingId: string }): Promise<PayStep> {
  const hash = ((ctx.body ?? {}) as Record<string, unknown>)['quoteHash'];
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/i.test(hash)) throw new RouteError(400, 'bad_input');
  const key = inputOf(ctx)['idempotencyKey'];
  if (key !== undefined && (typeof key !== 'string' || !KEY.test(key))) throw new RouteError(400, 'bad_input');
  return inTx<PayStep>(deps.db, c, (tx) =>
    withIdempotency(tx, key as string | undefined, requestHash('POST /checkout/pay', ctx.body ?? null), async (): Promise<PayStep> => {
      const hold = await offerHold(tx, customer, offer);
      // A second tap (D47): the offer is priced already; its stored payment is returned after commit, not repriced.
      if (hold.priced) return { kind: 'placed', placed: offerReused(offer, hold) };
      const choice = offerChoice(ctx.body, hold);
      const prepared = await preparePay(tx, customer, { choice, quoteHash: hash.toLowerCase() }, deps.sources);
      if (prepared.kind === 'price_changed') return { kind: 'price_changed', quote: prepared.quote };
      return { kind: 'placed', placed: await placeOfferOrder(tx, customer, offer, hold, choice, prepared.quote, deps.sources) };
    }),
  );
}

function payHandler(deps: CheckoutRouteDeps, staff: boolean) {
  const path = staff ? 'POST /staff/orders/pay' : 'POST /checkout/pay';
  return async (ctx: RouteContext) => {
    const c = await sessionContext(deps, ctx, staff);
    const customer = customerOf(ctx, staff);
    const offer = staff ? null : typed(() => parseOfferRef(ctx.body));
    const step = offer ? await offerPay(deps, ctx, c, customer, offer) : await orderPay(deps, ctx, c, customer, staff, path);
    if (step.kind === 'price_changed') return { priceChanged: true, quote: step.quote };
    const p = step.placed;
    if (p.confirmed) return { orderId: p.orderId, holdExpiresAt: null, payment: null, confirmed: true };
    // After commit: the Beam charge (F05-T04b). payment_unavailable has already released the hold.
    const started = await startPayment({ ...deps.payments, db: deps.db, privateKey: deps.payments.privateKey() }, c, p.orderId);
    if (!started.ok) throw new RouteError(503, 'payment_unavailable');
    return {
      orderId: p.orderId,
      holdExpiresAt: p.holdExpiresAt,
      payment: { id: started.paymentId, amountSatang: started.amountSatang, qrImageBase64: started.qrImageBase64, qrExpiresAt: started.qrExpiresAt },
      confirmed: false,
    };
  };
}

type PayStep = { kind: 'price_changed'; quote: unknown } | { kind: 'placed'; placed: PlacedOrder };

function orderPay(deps: CheckoutRouteDeps, ctx: RouteContext, c: ClubContext, customer: string, staff: boolean, path: string): Promise<PayStep> {
  const request = typed(() => parsePayRequest(ctx.body));
  const key = inputOf(ctx)['idempotencyKey'];
  if (key !== undefined && (typeof key !== 'string' || !KEY.test(key))) throw new RouteError(400, 'bad_input');
  // F04-T12a to T12d (design 4.5): the second tap first (not repriced, step 6), then the reprice, then the order,
  // the claim, the lines and the ledger in one transaction; a zero money order is confirmed in it (PAY-07).
  return inTx<PayStep>(deps.db, c, (tx) =>
    withIdempotency(tx, key as string | undefined, requestHash(path, ctx.body ?? null), async (): Promise<PayStep> => {
      const live = await findLiveHold(tx, request.choice, customer);
      if (live) return { kind: 'placed', placed: live };
      const prepared = await preparePay(tx, customer, request, deps.sources, { forCustomer: staff });
      if (prepared.kind === 'price_changed') return { kind: 'price_changed', quote: prepared.quote };
      return { kind: 'placed', placed: await placeOrder(tx, customer, request.choice, prepared.quote, deps.sources) };
    }),
  );
}

function packageQuoteHandler(deps: CheckoutRouteDeps, staff: boolean) {
  return async (ctx: RouteContext) => {
    const c = await sessionContext(deps, ctx, staff);
    const customer = customerOf(ctx, staff);
    const request = typed(() => parsePackageQuoteRequest(ctx.body));
    return inTx(deps.db, c, (tx) => packageQuoteFor(tx, customer, request, deps.sources, { forCustomer: staff }));
  };
}

// F05 package-only Pay (C10P to C11P; PAY-04-AC1, F06 R3-AC1, D74): the same steps as Pay without a claim. A second
// tap returns the running order's payment; a zero money package is granted in the transaction (PAY-07).
function packagePayHandler(deps: CheckoutRouteDeps, staff: boolean) {
  const path = staff ? 'POST /staff/orders/package/pay' : 'POST /checkout/package/pay';
  return async (ctx: RouteContext) => {
    const c = await sessionContext(deps, ctx, staff);
    const customer = customerOf(ctx, staff);
    const request = typed(() => parsePackagePayRequest(ctx.body));
    const key = inputOf(ctx)['idempotencyKey'];
    if (key !== undefined && (typeof key !== 'string' || !KEY.test(key))) throw new RouteError(400, 'bad_input');
    type Step = { kind: 'price_changed'; quote: unknown } | { kind: 'placed'; placed: PlacedOrder };
    const step = await inTx<Step>(deps.db, c, (tx) =>
      withIdempotency(tx, key as string | undefined, requestHash(path, ctx.body ?? null), async (): Promise<Step> => {
        const live = await findLivePackageOrder(tx, request.choice.productId, customer);
        if (live) return { kind: 'placed', placed: live };
        const prepared = await preparePackagePay(tx, customer, request, deps.sources, { forCustomer: staff });
        if (prepared.kind === 'price_changed') return { kind: 'price_changed', quote: prepared.quote };
        return { kind: 'placed', placed: await placePackageOrder(tx, customer, prepared.quote, deps.sources) };
      }),
    );
    if (step.kind === 'price_changed') return { priceChanged: true, quote: step.quote };
    const p = step.placed;
    if (p.confirmed) return { orderId: p.orderId, payment: null, confirmed: true };
    // After commit: the Beam charge. payment_unavailable has already ended the order and given back what it took.
    const started = await startPayment({ ...deps.payments, db: deps.db, privateKey: deps.payments.privateKey() }, c, p.orderId);
    if (!started.ok) throw new RouteError(503, 'payment_unavailable');
    return {
      orderId: p.orderId,
      payment: { id: started.paymentId, amountSatang: started.amountSatang, qrImageBase64: started.qrImageBase64, qrExpiresAt: started.qrExpiresAt },
      confirmed: false,
    };
  };
}

/**
 * F04-T11 to T13 with F05-T04b. POST /checkout/quote and /checkout/pay need a signed in person (a guest signs in
 * first, R8-AC4). GET /orders/:id is the stored snapshot, own or staff by the row policies. POST /staff/orders/quote
 * and /pay are the same pricing for a named customer, front desk and owner (booking.create.staff); the customer
 * pays as a player (ROLE-01-AC4). They supersede F03's POST /staff/bookings. POST /checkout/package/quote and /pay are a
 * package bought on its own (C10P, F05 package-only Pay). Staff selling a package at the desk is F06's A02c.
 */
export function checkoutRoutes(deps: CheckoutRouteDeps): Route<unknown>[] {
  const noStore = <T>(r: Route<T>): Route<T> => ({ ...r, headers: NO_STORE });
  return [
    noStore(route({ method: 'POST', path: '/checkout/quote', needsPerson: true }, quoteHandler(deps, false))),
    noStore(route({ method: 'POST', path: '/checkout/pay', needsPerson: true }, payHandler(deps, false))),
    noStore(
      route({ method: 'GET', path: '/orders/:id', permission: 'orders.read.own' }, async (ctx) => {
        const c = await sessionContext(deps, ctx, false);
        return inTx(deps.db, c, (tx) => readOrder(tx, inputOf(ctx)['id']));
      }),
    ),
    noStore(route({ method: 'POST', path: '/staff/orders/quote', permission: 'booking.create.staff' }, quoteHandler(deps, true))),
    noStore(route({ method: 'POST', path: '/staff/orders/pay', permission: 'booking.create.staff' }, payHandler(deps, true))),
    noStore(route({ method: 'POST', path: '/checkout/package/quote', needsPerson: true }, packageQuoteHandler(deps, false))),
    noStore(route({ method: 'POST', path: '/checkout/package/pay', needsPerson: true }, packagePayHandler(deps, false))),
  ];
}
