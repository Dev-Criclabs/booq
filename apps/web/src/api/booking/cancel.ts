import { route, RouteError, type RouteContext, type RouteParams } from '@booq/auth';
import type { ClubContext, Db, Tx } from '@booq/db';
import { BookingError, cancelOwnBooking, previewOwnCancel, requestHash, withIdempotency } from '@booq/domain';
import type { BookingRoute, BookingRouteDeps } from './routes';

// F09-T12 player cancel routes (F09 design 5, prefix /api/c/{slug}): GET /me/bookings/:id/cancel-preview for the C13b sheet
// and POST /me/bookings/:id/cancel with an optional Idempotency-Key. Thin handlers over packages/domain/src/booking/cancel.ts.
// The cancel takes nothing but the booking: an outcome, a club cancel flag or a reason from the client is bad_input. The
// database's refusals ('cancel:<code>', P0001) answer as typed codes. A Paused club still cancels (D118); no route sends
// money back (the value goes to the package or the wallet, CANCEL-02). The helpers below are shared with staff-cancel.ts.

// The refusals of the F09 functions, by prefix: 'cancel:' (cancel_outcome, cancel_booking), 'mark:' and 'reverse:' (1008),
// 'closure:' (1009, 1010, 1015, 1016). closure:busy is SQLSTATE 40001, left after withClubTx's retries.
const REFUSALS: Record<string, Record<string, number>> = {
  cancel: { not_found: 404, forbidden: 403, not_confirmed: 409, not_cancelled: 409, started: 409, hold: 409, window_unset: 409, reason_required: 400, kind: 400 },
  mark: { not_found: 404, forbidden: 403, not_confirmed: 409, not_ended: 409, ended: 409, reason_required: 400 },
  reverse: { not_marked: 409, slot_unavailable: 409 },
  closure: {
    not_found: 404, forbidden: 403, invalid_court: 400, invalid_range: 400, invalid_repeat: 400, reason_required: 400,
    window_unset: 409, ended: 409, not_active: 409, too_many: 409, busy: 409,
  },
};
const BOOKING_STATUS: Record<string, number> = { bad_input: 400, not_found: 404, forbidden: 403 };
const KEY = /^[\x21-\x7e]{1,200}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const inputOf = (ctx: RouteContext) => (ctx.input ?? {}) as Record<string, unknown>;

export async function inCancelTx<T>(db: Db, c: ClubContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.withClubTx(c, fn);
  } catch (e) {
    if (e instanceof BookingError) throw new RouteError(BOOKING_STATUS[e.code] ?? 400, e.code);
    const err = e as { code?: string; message?: string; detail?: string };
    const m = (err.code === 'P0001' || err.code === '40001') && err.message ? /^(cancel|mark|reverse|closure):([a-z_]+)$/.exec(err.message) : null;
    const status = m ? REFUSALS[m[1]!]?.[m[2]!] : undefined;
    if (m && status !== undefined) {
      const params: RouteParams | undefined = m[2] === 'too_many' && err.detail ? { count: Number(err.detail) } : undefined;
      throw new RouteError(status, m[2]!, params);
    }
    throw e;
  }
}

/** The caller's club context, refusing any input field not named in `allowed` (no outcome, flag or value from the client). */
export async function contextFor(
  deps: BookingRouteDeps, ctx: RouteContext, source: 'player_app' | 'admin', allowed: readonly string[],
): Promise<ClubContext> {
  const input = inputOf(ctx);
  for (const k of Object.keys(input)) if (k !== 'slug' && k !== 'idempotencyKey' && !allowed.includes(k)) throw new RouteError(400, 'bad_input');
  const slug = input['slug'];
  if (slug !== undefined) {
    const club = typeof slug === 'string' && SLUG.test(slug) ? await deps.clubBySlug(slug) : null;
    if (!club || club.clubId !== ctx.clubId) throw new RouteError(404, 'not_found');
  }
  return { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source, ...(ctx.requestId ? { requestId: ctx.requestId } : {}) };
}

/** Runs `work` once per Idempotency-Key (FA 3.5): the same key again returns the stored answer. */
export function idempotent<T>(tx: Tx, ctx: RouteContext, routeName: string, work: () => Promise<T>): Promise<T> {
  const { idempotencyKey: key, ...rest } = inputOf(ctx);
  if (key !== undefined && (typeof key !== 'string' || !KEY.test(key))) throw new RouteError(400, 'bad_input');
  return withIdempotency(tx, key as string | undefined, requestHash(routeName, rest), work);
}

export function playerCancelRoutes(deps: BookingRouteDeps): BookingRoute<unknown>[] {
  return [
    route({ method: 'GET', path: '/me/bookings/:id/cancel-preview', permission: 'booking.read.own' }, async (ctx) => {
      const c = await contextFor(deps, ctx, 'player_app', ['id']);
      return inCancelTx(deps.db, c, (tx) => previewOwnCancel(tx, c, inputOf(ctx)['id']));
    }),
    route({ method: 'POST', path: '/me/bookings/:id/cancel', needsPerson: true }, async (ctx) => {
      const c = await contextFor(deps, ctx, 'player_app', ['id']);
      return inCancelTx(deps.db, c, (tx) => idempotent(tx, ctx, 'POST /me/bookings/:id/cancel', () => cancelOwnBooking(tx, c, inputOf(ctx)['id'])));
    }),
  ];
}
