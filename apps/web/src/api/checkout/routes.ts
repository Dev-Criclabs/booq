import { route, RouteError, type Route, type RouteContext } from '@booq/auth';
import type { ClubContext, Db, Tx } from '@booq/db';
import {
  CheckoutError,
  findLiveHold,
  parsePayRequest,
  parseQuoteRequest,
  placeOrder,
  preparePay,
  quoteFor,
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

/** The session's club; a path slug naming another club is not found (FA 4.2). */
async function sessionContext(deps: CheckoutRouteDeps, ctx: RouteContext): Promise<ClubContext> {
  const slug = inputOf(ctx)['slug'];
  if (slug !== undefined) {
    const club = typeof slug === 'string' && SLUG.test(slug) ? await deps.clubBySlug(slug) : null;
    if (!club || club.clubId !== ctx.clubId) throw new RouteError(404, 'not_found');
  }
  return { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'player_app', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) };
}

/** F04-T11: POST /checkout/quote; F04-T12a to T12d with F05-T04b: POST /checkout/pay. Needs a signed in person; a guest signs in first (R8-AC4). Prices as a player (ROLE-01-AC4). */
export function checkoutRoutes(deps: CheckoutRouteDeps): Route<unknown>[] {
  return [
    {
      ...route({ method: 'POST', path: '/checkout/quote', needsPerson: true }, async (ctx) => {
        const c = await sessionContext(deps, ctx);
        const request = typed(() => parseQuoteRequest(ctx.body));
        return inTx(deps.db, c, (tx) => quoteFor(tx, ctx.userId, request, deps.sources));
      }),
      headers: NO_STORE,
    },
    {
      ...route({ method: 'POST', path: '/checkout/pay', needsPerson: true }, async (ctx) => {
        const c = await sessionContext(deps, ctx);
        const request = typed(() => parsePayRequest(ctx.body));
        const key = inputOf(ctx)['idempotencyKey'];
        if (key !== undefined && (typeof key !== 'string' || !KEY.test(key))) throw new RouteError(400, 'bad_input');
        // F04-T12a to T12d (design 4.5): the second tap first (not repriced, step 6), then the reprice, then the order,
        // the claim, the lines and the ledger in one transaction; a zero money order is confirmed in it (PAY-07).
        type Step = { kind: 'price_changed'; quote: unknown } | { kind: 'placed'; placed: PlacedOrder };
        const step = await inTx<Step>(deps.db, c, (tx) =>
          withIdempotency(tx, key as string | undefined, requestHash('POST /checkout/pay', ctx.body ?? null), async (): Promise<Step> => {
            const live = await findLiveHold(tx, request.choice);
            if (live) return { kind: 'placed', placed: live };
            const prepared = await preparePay(tx, ctx.userId, request, deps.sources);
            if (prepared.kind === 'price_changed') return { kind: 'price_changed', quote: prepared.quote };
            return { kind: 'placed', placed: await placeOrder(tx, ctx.userId, request.choice, prepared.quote, deps.sources) };
          }),
        );
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
      }),
      headers: NO_STORE,
    },
  ];
}
