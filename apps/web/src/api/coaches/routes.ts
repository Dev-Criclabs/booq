import { route, RouteError, type Route, type RouteContext, type RouteParams } from '@booq/auth';
import type { ClubContext, Db, Tx } from '@booq/db';
import { addCoach, CoachError, type CoachErrorCode, coachTimes, getCoach, listCoaches, offerableCoaches } from '@booq/domain';

// F07-T11 public and player coach routes (design 6, prefix /api/c/{slug}). Thin handlers: resolve the club, open the club transaction
// with the caller's context, call the service in packages/domain/src/coaches, answer a body or a typed code. No club id is read from
// the input. Text is never written here; a code goes to the client, which picks the locale key (CC-5).

export interface CoachRouteDeps {
  db: Db;
  /** The club behind a path slug, or null when there is none. */
  clubBySlug(slug: string): Promise<{ clubId: string } | null>;
}

export type CoachRoute<T> = Route<T> & { headers?: Readonly<Record<string, string>> };

const STATUS: Record<CoachErrorCode, number> = { bad_input: 400, not_found: 404, club_paused: 409, forbidden: 403 };
// A refusal raised by a database function (BK001, message = the code; F07 design 5.1, 5.5). coach_unavailable and rest_rule are the
// coach_check codes; the rest are the refusals of add_coach_to_booking and the club state.
const DB_STATUS: Record<string, number> = {
  forbidden: 403, sign_in_required: 401, booking_not_found: 404, order_not_found: 404, club_paused: 409, club_not_available: 404,
  hour_started: 409, not_movable: 409, coach_unavailable: 409, rest_rule: 409, no_court_open: 409, hold_setting_unset: 409,
};
// The refusal's detail, as the plain value the client puts in its text: the cap of the rest rule is {hours}.
const DB_PARAMS: Record<string, (detail: string) => RouteParams> = {
  rest_rule: (d) => ({ hours: Number(d) }),
};
const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const inputOf = (ctx: RouteContext) => (ctx.input ?? {}) as Record<string, unknown>;
const bodyOf = (ctx: RouteContext) => (ctx.body ?? {}) as Record<string, unknown>;

async function inTx<T>(db: Db, c: ClubContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.withClubTx(c, fn);
  } catch (e) {
    if (e instanceof CoachError) throw new RouteError(STATUS[e.code], e.code);
    const err = e as { code?: string; message?: string; detail?: string };
    if (err.code === 'BK001' && err.message) {
      const params = err.detail ? DB_PARAMS[err.message]?.(err.detail) : undefined;
      throw new RouteError(DB_STATUS[err.message] ?? 409, err.message, params);
    }
    if (err.code === '42501') throw new RouteError(403, 'forbidden');
    throw e;
  }
}

/** The context of a public route: a guest reads as role `guest`; a signed in caller keeps their own; a slug naming another club is not found. */
async function publicContext(deps: CoachRouteDeps, ctx: RouteContext): Promise<ClubContext> {
  const slug = inputOf(ctx)['slug'];
  if (typeof slug !== 'string' || !SLUG.test(slug)) throw new RouteError(404, 'not_found');
  const club = await deps.clubBySlug(slug);
  if (!club) throw new RouteError(404, 'not_found');
  const signedIn = typeof ctx.clubId === 'string' && typeof ctx.userId === 'string';
  if (!signedIn) return { clubId: club.clubId, userId: null, roles: ['guest'] };
  if (ctx.clubId !== club.clubId) throw new RouteError(404, 'not_found');
  return { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, ...(ctx.requestId ? { requestId: ctx.requestId } : {}) };
}

async function sessionContext(deps: CoachRouteDeps, ctx: RouteContext): Promise<ClubContext> {
  const slug = inputOf(ctx)['slug'];
  if (slug !== undefined) {
    const club = typeof slug === 'string' && SLUG.test(slug) ? await deps.clubBySlug(slug) : null;
    if (!club || club.clubId !== ctx.clubId) throw new RouteError(404, 'not_found');
  }
  return { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'player_app', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) };
}

/**
 * GET /coaches, /coaches/offerable, /coaches/:id and /coaches/:id/times are public: a guest opens C5 and C6 (R1-AC6). /coaches/offerable
 * is registered before /coaches/:id so the word is never read as an id.
 */
export function publicCoachRoutes(deps: CoachRouteDeps): CoachRoute<unknown>[] {
  const pub = <T>(path: string, fn: (tx: Tx, input: Record<string, unknown>) => Promise<T>): CoachRoute<T> => ({
    ...route({ method: 'GET', path, public: true }, async (ctx) => {
      const c = await publicContext(deps, ctx);
      return inTx(deps.db, c, (tx) => fn(tx, inputOf(ctx)));
    }),
    headers: NO_STORE,
  });
  return [
    pub('/coaches', (tx) => listCoaches(tx)),
    pub('/coaches/offerable', (tx, i) => offerableCoaches(tx, i['starts'], i['resourceId'])),
    pub('/coaches/:id', (tx, i) => getCoach(tx, i['id'])),
    pub('/coaches/:id/times', (tx, i) => coachTimes(tx, i['id'], i['from'], i['to'])),
  ];
}

/**
 * POST /bookings/:id/coach adds a coach to the caller's own confirmed court booking (COACH-03-AC3, D111). The add order is the player's
 * own priced order for the coaching portion (F04); the coach is held with it. A booking that is not theirs is not found.
 */
export function playerCoachRoutes(deps: CoachRouteDeps): CoachRoute<unknown>[] {
  return [
    route({ method: 'POST', path: '/bookings/:id/coach', needsPerson: true }, async (ctx) => {
      const c = await sessionContext(deps, ctx);
      const b = bodyOf(ctx);
      return inTx(deps.db, c, (tx) => addCoach(tx, inputOf(ctx)['id'], { coachId: b['coachId'], orderId: b['orderId'] }));
    }),
  ];
}
