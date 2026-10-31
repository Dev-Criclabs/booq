import { route, RouteError, type RouteContext } from '@booq/auth';
import type { ClubContext, Db, Tx } from '@booq/db';
import { BookingError, cancelOwnBooking, previewOwnCancel, requestHash, withIdempotency } from '@booq/domain';
import type { BookingRoute, BookingRouteDeps } from './routes';

// F09-T12 player cancel routes (F09 design 5, prefix /api/c/{slug}): GET /me/bookings/:id/cancel-preview for the C13b sheet
// and POST /me/bookings/:id/cancel with an optional Idempotency-Key. Thin handlers over packages/domain/src/booking/cancel.ts.
// The cancel takes nothing but the booking: an outcome, a club cancel flag or a reason from the client is bad_input. The
// database's refusals ('cancel:<code>', P0001) answer as typed codes. A Paused club still cancels (D118); no route sends
// money back (the value goes to the package or the wallet, CANCEL-02).

// The refusals of app.cancel_outcome and app.cancel_booking.
const CANCEL_STATUS: Record<string, number> = {
  not_found: 404,
  forbidden: 403,
  not_confirmed: 409,
  started: 409,
  hold: 409,
  window_unset: 409,
  reason_required: 400,
};
const BOOKING_STATUS: Record<string, number> = { bad_input: 400, not_found: 404, forbidden: 403 };
const KEY = /^[\x21-\x7e]{1,200}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ALLOWED = new Set(['slug', 'id', 'idempotencyKey']);

const inputOf = (ctx: RouteContext) => (ctx.input ?? {}) as Record<string, unknown>;

async function inTx<T>(db: Db, c: ClubContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.withClubTx(c, fn);
  } catch (e) {
    if (e instanceof BookingError) throw new RouteError(BOOKING_STATUS[e.code] ?? 400, e.code);
    const err = e as { code?: string; message?: string };
    const code = err.code === 'P0001' && err.message?.startsWith('cancel:') ? err.message.slice('cancel:'.length) : undefined;
    if (code && CANCEL_STATUS[code] !== undefined) throw new RouteError(CANCEL_STATUS[code]!, code);
    throw e;
  }
}

async function playerContext(deps: BookingRouteDeps, ctx: RouteContext): Promise<ClubContext> {
  const input = inputOf(ctx);
  for (const k of Object.keys(input)) if (!ALLOWED.has(k)) throw new RouteError(400, 'bad_input');
  const slug = input['slug'];
  if (slug !== undefined) {
    const club = typeof slug === 'string' && SLUG.test(slug) ? await deps.clubBySlug(slug) : null;
    if (!club || club.clubId !== ctx.clubId) throw new RouteError(404, 'not_found');
  }
  return { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'player_app', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) };
}

export function playerCancelRoutes(deps: BookingRouteDeps): BookingRoute<unknown>[] {
  return [
    route({ method: 'GET', path: '/me/bookings/:id/cancel-preview', permission: 'booking.read.own' }, async (ctx) => {
      const c = await playerContext(deps, ctx);
      return inTx(deps.db, c, (tx) => previewOwnCancel(tx, c, inputOf(ctx)['id']));
    }),
    route({ method: 'POST', path: '/me/bookings/:id/cancel', needsPerson: true }, async (ctx) => {
      const c = await playerContext(deps, ctx);
      const { idempotencyKey: key, ...rest } = inputOf(ctx);
      if (key !== undefined && (typeof key !== 'string' || !KEY.test(key))) throw new RouteError(400, 'bad_input');
      const hash = requestHash('POST /me/bookings/:id/cancel', rest);
      return inTx(deps.db, c, (tx) => withIdempotency(tx, key as string | undefined, hash, () => cancelOwnBooking(tx, c, inputOf(ctx)['id'])));
    }),
  ];
}
