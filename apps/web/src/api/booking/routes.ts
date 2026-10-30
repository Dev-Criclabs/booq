import { route, RouteError, type Route, type RouteContext } from '@booq/auth';
import type { ClubContext, Db, Tx } from '@booq/db';
import { BookingError, type BookingErrorCode, courtsFor, scheduleDays, scheduleFor, type Viewer } from '@booq/domain';

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
};
const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const inputOf = (ctx: RouteContext) => (ctx.input ?? {}) as Record<string, unknown>;
const viewerOf = (c: ClubContext): Viewer => ({ userId: c.userId, roles: c.roles as readonly string[] });

async function inTx<T>(db: Db, c: ClubContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.withClubTx(c, fn);
  } catch (e) {
    if (e instanceof BookingError) throw new RouteError(STATUS[e.code], e.code);
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
