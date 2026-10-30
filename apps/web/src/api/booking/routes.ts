import { route, RouteError, type Route, type RouteContext } from '@booq/auth';
import type { ClubContext, Db, Tx } from '@booq/db';
import {
  BookingError,
  type BookingErrorCode,
  courtsFor,
  getBooking,
  moveStaffBooking,
  releaseStaffHold,
  releaseOwnHold,
  requestHash,
  scheduleDays,
  scheduleFor,
  type Viewer,
  withIdempotency,
} from '@booq/domain';

// F03 booking routes (design 5, prefix /api/c/{slug}). Thin handlers: resolve the club, open the club
// transaction with the caller's context, call the service in packages/domain/src/booking, answer a body or
// a typed code. Path parameters and the query string arrive in `input` (`input.slug`, `input.id`, ...).
// No club id is ever read from the input: the club is the session's, or for a guest the path slug's.

export interface BookingRouteDeps {
  db: Db;
  /** The club behind a path slug, or null when there is none. */
  clubBySlug(slug: string): Promise<{ clubId: string } | null>;
}

/** Headers the transport sets on every answer of the route (the schedule is never cached, design 5.1). */
export type BookingRoute<T> = Route<T> & { headers?: Readonly<Record<string, string>> };

const STATUS: Record<BookingErrorCode, number> = {
  bad_input: 400,
  not_found: 404,
  outside_window: 400,
  in_the_past: 400,
  not_releasable: 409,
  club_paused: 409,
  forbidden: 403,
};
// A refusal raised by a booking function in the database (BK001, message = the code; design 4.2).
const DB_STATUS: Record<string, number> = { booking_not_found: 404, forbidden: 403, sign_in_required: 401 };
const KEY = /^[\x21-\x7e]{1,200}$/;
const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const inputOf = (ctx: RouteContext) => (ctx.input ?? {}) as Record<string, unknown>;
const viewerOf = (c: ClubContext): Viewer => ({ userId: c.userId, roles: c.roles as readonly string[] });

async function inTx<T>(db: Db, c: ClubContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.withClubTx(c, fn);
  } catch (e) {
    if (e instanceof BookingError) throw new RouteError(STATUS[e.code], e.code);
    const err = e as { code?: string; message?: string };
    if (err.code === 'BK001' && err.message) throw new RouteError(DB_STATUS[err.message] ?? 409, err.message);
    throw e;
  }
}

/**
 * The context of a public route. A guest reads as role `guest` with no user; a signed in caller keeps
 * their own context (so My booking and the tester rule apply), and a slug that names another club than
 * the session's is not found (FA 4.2).
 */
async function publicContext(deps: BookingRouteDeps, ctx: RouteContext): Promise<ClubContext> {
  const slug = inputOf(ctx)['slug'];
  if (typeof slug !== 'string' || !SLUG.test(slug)) throw new RouteError(404, 'not_found');
  const club = await deps.clubBySlug(slug);
  if (!club) throw new RouteError(404, 'not_found');
  const signedIn = typeof ctx.clubId === 'string' && typeof ctx.userId === 'string';
  if (!signedIn) return { clubId: club.clubId, userId: null, roles: ['guest'] };
  if (ctx.clubId !== club.clubId) throw new RouteError(404, 'not_found');
  return { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, ...(ctx.requestId ? { requestId: ctx.requestId } : {}) };
}

/** F03-T20: GET /courts, /schedule/days and /schedule. Public: a guest may open C4 (BOOK-02-AC1, AC2, AC5). */
export function publicScheduleRoutes(deps: BookingRouteDeps): BookingRoute<unknown>[] {
  const pub = <T>(path: string, fn: (tx: Tx, viewer: Viewer, input: Record<string, unknown>) => Promise<T>): BookingRoute<T> => ({
    ...route({ method: 'GET', path, public: true }, async (ctx) => {
      const c = await publicContext(deps, ctx);
      return inTx(deps.db, c, (tx) => fn(tx, viewerOf(c), inputOf(ctx)));
    }),
    headers: NO_STORE,
  });
  return [
    pub('/courts', (tx) => courtsFor(tx)),
    pub('/schedule/days', (tx, v, i) => scheduleDays(tx, v, i['from'], i['to'])),
    pub('/schedule', (tx, v, i) => scheduleFor(tx, v, i['date'])),
  ];
}

/**
 * The context of a signed in route: the session's club and roles. A path slug naming another club is not
 * found (FA 4.2). `source` is where an audited change came from.
 */
async function sessionContext(deps: BookingRouteDeps, ctx: RouteContext, source: 'player_app' | 'admin'): Promise<ClubContext> {
  const slug = inputOf(ctx)['slug'];
  if (slug !== undefined) {
    const club = typeof slug === 'string' && SLUG.test(slug) ? await deps.clubBySlug(slug) : null;
    if (!club || club.clubId !== ctx.clubId) throw new RouteError(404, 'not_found');
  }
  return { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source, ...(ctx.requestId ? { requestId: ctx.requestId } : {}) };
}

/** The Idempotency-Key the transport passes from the header, if any; a malformed one is bad input. */
function idempotencyKeyOf(ctx: RouteContext): string | undefined {
  const key = inputOf(ctx)['idempotencyKey'];
  if (key === undefined) return undefined;
  if (typeof key !== 'string' || !KEY.test(key)) throw new RouteError(400, 'bad_input');
  return key;
}

/** The request as hashed for the Idempotency-Key: the input without the key itself. */
function hashOf(method: string, path: string, ctx: RouteContext): string {
  const { idempotencyKey: _key, ...rest } = inputOf(ctx);
  return requestHash(`${method} ${path}`, rest);
}

/**
 * F03-T21: GET /bookings/:id and POST /bookings/:id/release (design 5.2). Every club person holds
 * booking.read.own (D115); the service narrows it to the player's own booking (staff may read the club's),
 * and another player's booking is not found (ROLE-01-AC4). The release needs a signed in person (a guest
 * gets sign_in_required); only their own awaiting payment hold can be released.
 */
export function playerBookingRoutes(deps: BookingRouteDeps): BookingRoute<unknown>[] {
  return [
    route({ method: 'GET', path: '/bookings/:id', permission: 'booking.read.own' }, async (ctx) => {
      const c = await sessionContext(deps, ctx, 'player_app');
      return inTx(deps.db, c, (tx) => getBooking(tx, viewerOf(c), inputOf(ctx)['id']));
    }),
    route({ method: 'POST', path: '/bookings/:id/release', needsPerson: true }, async (ctx) => {
      const c = await sessionContext(deps, ctx, 'player_app');
      const key = idempotencyKeyOf(ctx);
      const hash = hashOf('POST', '/bookings/:id/release', ctx);
      return inTx(deps.db, c, (tx) => withIdempotency(tx, key, hash, () => releaseOwnHold(tx, viewerOf(c), inputOf(ctx)['id'])));
    }),
  ];
}

/**
 * F03-T22 (move and release): PUT /staff/bookings/:id/move and POST /staff/bookings/:id/release (design 5.3).
 * Front desk and owner only: booking.move to move, booking.create.staff to abandon a hold (design 5.3, 8).
 * In a Paused club only the owner may act (D60).
 */
export function staffBookingRoutes(deps: BookingRouteDeps): BookingRoute<unknown>[] {
  const staff = <T>(method: 'PUT' | 'POST', path: string, permission: string, fn: (tx: Tx, c: ClubContext, input: Record<string, unknown>) => Promise<T>) =>
    route({ method, path, permission }, async (ctx) => {
      const c = await sessionContext(deps, ctx, 'admin');
      const key = idempotencyKeyOf(ctx);
      const hash = hashOf(method, path, ctx);
      return inTx(deps.db, c, (tx) => withIdempotency(tx, key, hash, () => fn(tx, c, inputOf(ctx))));
    });
  return [
    staff('PUT', '/staff/bookings/:id/move', 'booking.move', (tx, c, i) => moveStaffBooking(tx, viewerOf(c), i['id'], { courtId: i['courtId'], start: i['start'] })),
    staff('POST', '/staff/bookings/:id/release', 'booking.create.staff', (tx, c, i) => releaseStaffHold(tx, viewerOf(c), i['id'])),
  ];
}
