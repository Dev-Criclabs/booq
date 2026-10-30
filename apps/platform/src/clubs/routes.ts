import { RouteError } from '@booq/auth';
import { answer } from '../http/answer';
import { platformRoute, type PlatformContext, type PlatformRoute } from '../http/server';
import type { createClubService } from './clubs';
import type { createPauseService } from '../pause/pause';
import type { createStatusService } from '../status/status';
import type { createUsageService } from '../usage/usage';

// Club routes of the console (design 5.2; PLAT-01-AC1, AC2, AC8, AC9; PLAT-02-AC10, AC11; PLAT-03; ROLE-02).
// Thin: the staff member and the freshness of their second factor come from the session, the club
// from the path, and every rule is in the service (and the database below it). Pause and resume are
// admin only. A club the caller may not see is 404, the same as one that does not exist.

export interface ClubRouteDeps {
  clubs: ReturnType<typeof createClubService>;
  status: ReturnType<typeof createStatusService>;
  pause: ReturnType<typeof createPauseService>;
  usage: ReturnType<typeof createUsageService>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const actorOf = (ctx: PlatformContext) => ({ staffId: ctx.staff!.id, stepUpFresh: ctx.stepUpFresh });
export const clubIdOf = (ctx: PlatformContext): string => {
  const id = ctx.input['id'];
  if (typeof id !== 'string' || !UUID.test(id)) throw new RouteError(404, 'not_found');
  return id;
};

export function clubRoutes(deps: ClubRouteDeps): PlatformRoute[] {
  return [
    // P1: every club this member can see, with one aggregate number each.
    platformRoute({ method: 'GET', path: '/clubs', access: 'staff' }, async (ctx) => ({ clubs: await deps.usage.portfolio(ctx.staff!.id) })),

    // P2 step 1: a new Draft club.
    platformRoute({ method: 'POST', path: '/clubs', access: 'staff' }, async (ctx) => answer(await deps.clubs.createClub(actorOf(ctx), ctx.body))),

    // P3: checklist, who owes each item, and the aggregate counts. No player data, ever (D2).
    platformRoute({ method: 'GET', path: '/clubs/:id', access: 'staff' }, async (ctx) => {
      const id = clubIdOf(ctx);
      const progress = await deps.clubs.getProgress(ctx.staff!.id, id);
      if (!progress.ok) return answer(progress);
      const counts = await deps.usage.clubCounts(ctx.staff!.id, id);
      return { progress: progress.progress, counts: counts.ok ? counts.counts : null };
    }),

    platformRoute({ method: 'POST', path: '/clubs/:id/status', access: 'staff' }, async (ctx) => answer(await deps.status.changeStatus(actorOf(ctx), clubIdOf(ctx), ctx.body))),

    platformRoute({ method: 'POST', path: '/clubs/:id/pause', access: 'admin' }, async (ctx) => answer(await deps.pause.pauseClub(actorOf(ctx), clubIdOf(ctx), ctx.body))),
    platformRoute({ method: 'POST', path: '/clubs/:id/resume', access: 'admin' }, async (ctx) => answer(await deps.pause.resumeClub(actorOf(ctx), clubIdOf(ctx), ctx.body))),
  ];
}
