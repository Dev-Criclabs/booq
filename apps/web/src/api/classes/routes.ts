import { route, RouteError, type Route, type RouteContext } from '@booq/auth';
import type { ClubContext, Db, Tx } from '@booq/db';
import {
  ClassError, type ClassErrorCode, cancelSession, claimOffer, createTemplate, editSession, endTemplate, getClass, listClasses, listSessions, listTemplates, myWaitlist, myWaitlistEntry,
  resolveSession, roster, staffWaitlist, updateTemplate,
} from '@booq/domain';

// F08 public and player class routes (design 5.1, prefix /api/c/{slug}). Thin handlers: resolve the club, open the club transaction
// with the caller's context, call the service in packages/domain/src/classes or the waitlist function in the database, answer a
// body or a typed code. No club id is read from the input. The seat itself is taken only by Pay in checkout (F04): there is no
// player route here that takes a seat. Text is never written here; a code goes to the client, which picks the locale key.

export interface ClassRouteDeps {
  db: Db;
  now(): Date;
  /** The club behind a path slug, or null when there is none. */
  clubBySlug(slug: string): Promise<{ clubId: string } | null>;
}

export type ClassRoute<T> = Route<T> & { headers?: Readonly<Record<string, string>> };

// Refusals the staff functions add (BK001, message = the code): the checks of check_template and edit_session, and below_taken.
const STAFF_DB_STATUS: Record<string, number> = {
  court_clash: 409, coach_clash: 409, coach_leave: 409, coach_rest: 409, below_taken: 409, booking_window_unset: 409,
};
const STATUS: Record<ClassErrorCode, number> = { bad_input: 400, not_found: 404, spot_gone: 409, forbidden: 403, template_clash: 409 };
// A refusal raised by a database function (BK001, message = the code; F08 design 4.4, 4.8).
const DB_STATUS: Record<string, number> = {
  sign_in_required: 401, club_paused: 409, club_not_available: 404, session_not_available: 404, class_not_for_you: 403, entry_not_found: 404,
  not_full: 409, not_taken: 409, already_seated: 409, already_booked: 409, hour_started: 409, in_the_past: 400, outside_window: 400, outside_hours: 400,
  not_on_the_hour: 400, resource_inactive: 404,
};
const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const inputOf = (ctx: RouteContext) => (ctx.input ?? {}) as Record<string, unknown>;
const bodyOf = (ctx: RouteContext) => (ctx.body ?? {}) as Record<string, unknown>;

async function inTx<T>(db: Db, c: ClubContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.withClubTx(c, fn);
  } catch (e) {
    if (e instanceof ClassError) throw new RouteError(STATUS[e.code], e.code, Object.keys(e.detail).length ? (e.detail as never) : undefined);
    const err = e as { code?: string; message?: string };
    if (err.code === 'BK001' && err.message) throw new RouteError(DB_STATUS[err.message] ?? STAFF_DB_STATUS[err.message] ?? 409, err.message);
    if (err.code === '42501') throw new RouteError(403, 'forbidden');
    throw e;
  }
}

/** The context of a public route: a guest reads as role `guest`; a signed in caller keeps their own; a slug naming another club is not found. */
async function publicContext(deps: ClassRouteDeps, ctx: RouteContext): Promise<ClubContext> {
  const slug = inputOf(ctx)['slug'];
  if (typeof slug !== 'string' || !SLUG.test(slug)) throw new RouteError(404, 'not_found');
  const club = await deps.clubBySlug(slug);
  if (!club) throw new RouteError(404, 'not_found');
  const signedIn = typeof ctx.clubId === 'string' && typeof ctx.userId === 'string';
  if (!signedIn) return { clubId: club.clubId, userId: null, roles: ['guest'] };
  if (ctx.clubId !== club.clubId) throw new RouteError(404, 'not_found');
  return { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, ...(ctx.requestId ? { requestId: ctx.requestId } : {}) };
}

async function sessionContext(deps: ClassRouteDeps, ctx: RouteContext, source: 'player_app' | 'admin' = 'player_app'): Promise<ClubContext> {
  const slug = inputOf(ctx)['slug'];
  if (slug !== undefined) {
    const club = typeof slug === 'string' && SLUG.test(slug) ? await deps.clubBySlug(slug) : null;
    if (!club || club.clubId !== ctx.clubId) throw new RouteError(404, 'not_found');
  }
  return { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source, ...(ctx.requestId ? { requestId: ctx.requestId } : {}) };
}

const idOf = (ctx: RouteContext): string => {
  const id = inputOf(ctx)['id'];
  if (typeof id !== 'string' || !UUID.test(id)) throw new RouteError(404, 'not_found');
  return id.toLowerCase();
};

const noStore = <T>(r: Route<T>): ClassRoute<T> => ({ ...r, headers: NO_STORE });

/** GET /classes and /classes/:id are public: a guest opens C7 and C8 and sees Adult classes only (CLASS-01-AC5 to AC8). */
export function publicClassRoutes(deps: ClassRouteDeps): ClassRoute<unknown>[] {
  return [
    noStore(
      route({ method: 'GET', path: '/classes', public: true }, async (ctx) => {
        const c = await publicContext(deps, ctx);
        const q = inputOf(ctx);
        return inTx(deps.db, c, (tx) => listClasses(tx, { userId: c.userId }, { from: q['from'], to: q['to'], level: q['level'] }, deps.now()));
      }),
    ),
    noStore(
      route({ method: 'GET', path: '/classes/:id', public: true }, async (ctx) => {
        const c = await publicContext(deps, ctx);
        return inTx(deps.db, c, (tx) => getClass(tx, { userId: c.userId }, inputOf(ctx)['id']));
      }),
    ),
  ];
}

/** The signed in waitlist routes (design 5.1, CLASS-02-AC1, AC3, AC8; WAIT-01-AC1): join, leave, my list, an offer, claim and decline. */
export function playerClassRoutes(deps: ClassRouteDeps): ClassRoute<unknown>[] {
  return [
    noStore(
      route({ method: 'POST', path: '/classes/:id/waitlist', needsPerson: true }, async (ctx) => {
        const c = await sessionContext(deps, ctx);
        const id = idOf(ctx);
        const entryId = await inTx(deps.db, c, async (tx) => (await tx.query<{ id: string }>('select app.join_waitlist($1, null, null) as id', [id])).rows[0]!.id);
        return { entryId };
      }),
    ),
    noStore(
      route({ method: 'POST', path: '/schedule/waitlist', needsPerson: true }, async (ctx) => {
        const c = await sessionContext(deps, ctx);
        const body = bodyOf(ctx);
        const resourceId = body['resourceId'];
        const startAt = body['startAt'];
        if (typeof resourceId !== 'string' || !UUID.test(resourceId) || typeof startAt !== 'string' || Number.isNaN(Date.parse(startAt))) throw new RouteError(400, 'bad_input');
        const entryId = await inTx(deps.db, c, async (tx) => (await tx.query<{ id: string }>('select app.join_waitlist(null, $1, $2::timestamptz) as id', [resourceId.toLowerCase(), new Date(startAt).toISOString()])).rows[0]!.id);
        return { entryId };
      }),
    ),
    noStore(
      route({ method: 'GET', path: '/me/waitlist', needsPerson: true }, async (ctx) => {
        const c = await sessionContext(deps, ctx);
        return inTx(deps.db, c, (tx) => myWaitlist(tx));
      }),
    ),
    noStore(
      route({ method: 'GET', path: '/me/waitlist/:id', needsPerson: true }, async (ctx) => {
        const c = await sessionContext(deps, ctx);
        return inTx(deps.db, c, (tx) => myWaitlistEntry(tx, inputOf(ctx)['id']));
      }),
    ),
    noStore(
      route({ method: 'DELETE', path: '/me/waitlist/:id', needsPerson: true }, async (ctx) => {
        const c = await sessionContext(deps, ctx);
        const id = idOf(ctx);
        await inTx(deps.db, c, (tx) => tx.query('select app.leave_waitlist($1)', [id]));
        return { left: true };
      }),
    ),
    noStore(
      route({ method: 'POST', path: '/me/waitlist/:id/claim', needsPerson: true }, async (ctx) => {
        const c = await sessionContext(deps, ctx);
        return inTx(deps.db, c, (tx) => claimOffer(tx, inputOf(ctx)['id']));
      }),
    ),
    noStore(
      route({ method: 'POST', path: '/me/waitlist/:id/decline', needsPerson: true }, async (ctx) => {
        const c = await sessionContext(deps, ctx);
        const id = idOf(ctx);
        await inTx(deps.db, c, (tx) => tx.query('select app.decline_offer($1)', [id]));
        return { declined: true };
      }),
    ),
  ];
}

/** The staff routes of design 5.2: templates (owner), sessions (front desk and owner read and cancel, the owner edits and resolves), the roster and the waitlist. */
export function staffClassRoutes(deps: ClassRouteDeps): ClassRoute<unknown>[] {
  const admin = (ctx: RouteContext) => sessionContext(deps, ctx, 'admin');
  return [
    noStore(
      route({ method: 'GET', path: '/staff/class-templates', permission: 'class.session.read' }, async (ctx) => {
        const c = await admin(ctx);
        return inTx(deps.db, c, (tx) => listTemplates(tx));
      }),
    ),
    noStore(
      route({ method: 'POST', path: '/staff/class-templates', permission: 'class.template' }, async (ctx) => {
        const c = await admin(ctx);
        return inTx(deps.db, c, (tx) => createTemplate(tx, ctx.userId, ctx.body));
      }),
    ),
    noStore(
      route({ method: 'PUT', path: '/staff/class-templates/:id', permission: 'class.template' }, async (ctx) => {
        const c = await admin(ctx);
        const body = bodyOf(ctx);
        if (body['end'] === true && Object.keys(body).length === 1) {
          // End the template: today is its last day; its future sessions are cancelled one by one, each in its own transaction (design 4.7).
          const ids = await inTx(deps.db, c, (tx) => endTemplate(tx, inputOf(ctx)['id'], deps.now()));
          let cancelled = 0;
          let failed = 0;
          for (const sid of ids) {
            try {
              await inTx(deps.db, c, (tx) => cancelSession(tx, sid, {}, { template: true }));
              cancelled += 1;
            } catch {
              failed += 1;
            }
          }
          return { ended: true, cancelled, failed };
        }
        return inTx(deps.db, c, (tx) => updateTemplate(tx, inputOf(ctx)['id'], ctx.body));
      }),
    ),
    noStore(
      route({ method: 'GET', path: '/staff/class-sessions', permission: 'class.session.read' }, async (ctx) => {
        const c = await admin(ctx);
        const q = inputOf(ctx);
        return inTx(deps.db, c, (tx) => listSessions(tx, { from: q['from'], to: q['to'], status: q['status'] }, deps.now()));
      }),
    ),
    noStore(
      route({ method: 'PUT', path: '/staff/class-sessions/:id', permission: 'class.session.edit' }, async (ctx) => {
        const c = await admin(ctx);
        await inTx(deps.db, c, (tx) => editSession(tx, inputOf(ctx)['id'], ctx.body));
        return { edited: true };
      }),
    ),
    noStore(
      route({ method: 'POST', path: '/staff/class-sessions/:id/cancel', permission: 'class.session.cancel' }, async (ctx) => {
        const c = await admin(ctx);
        return inTx(deps.db, c, (tx) => cancelSession(tx, inputOf(ctx)['id'], ctx.body));
      }),
    ),
    noStore(
      route({ method: 'POST', path: '/staff/class-sessions/:id/resolve', permission: 'class.session.edit' }, async (ctx) => {
        const c = await admin(ctx);
        return inTx(deps.db, c, (tx) => resolveSession(tx, inputOf(ctx)['id']));
      }),
    ),
    noStore(
      route({ method: 'GET', path: '/staff/class-sessions/:id/roster', permission: 'class.roster.read' }, async (ctx) => {
        const c = await admin(ctx);
        return inTx(deps.db, c, (tx) => roster(tx, inputOf(ctx)['id']));
      }),
    ),
    noStore(
      route({ method: 'GET', path: '/staff/waitlist', permission: 'class.session.read' }, async (ctx) => {
        const c = await admin(ctx);
        return inTx(deps.db, c, (tx) => staffWaitlist(tx, { sessionId: inputOf(ctx)['sessionId'] }));
      }),
    ),
    noStore(
      route({ method: 'GET', path: '/coach/sessions/:id/roster', permission: 'class.roster.read' }, async (ctx) => {
        const c = await sessionContext(deps, ctx, 'player_app');
        return inTx(deps.db, c, (tx) => roster(tx, inputOf(ctx)['id']));
      }),
    ),
  ];
}
