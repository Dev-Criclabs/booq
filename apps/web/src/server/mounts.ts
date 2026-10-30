import { createClaimService, createDataRequestService, createImportService, createProfileEditService, normalizePhone } from '@booq/domain';
import type { Route } from '@booq/auth';
import type { Db } from '@booq/db';
import { bangkokDate } from '@booq/time';
import { playerBookingRoutes, publicScheduleRoutes, staffBookingRoutes } from '../api/booking/routes';
import { claimRoutes } from '../api/claim/routes';
import { dataRequestRoutes } from '../api/data-request/routes';
import { profileRoutes } from '../api/profile/routes';
import { importRoutes } from '../api/import/routes';
import { noticeRoutes } from '../api/notice/routes';
import type { WebConfig } from './context';

// The route registry. Each feature adds ONE line to `mounts` and keeps its routes in plain form
// under apps/web/src/api/<feature>/ (a factory that returns route() objects). Lanes edit different
// lines, so they do not collide. The sign-in routes are in context.ts because they share the
// session services with the resolver.
//
//   F03 booking:  add   (m) => publicScheduleRoutes({ db: m.db, clubBySlug: m.clubBySlug })   below, import it above
//   (and the signed-in booking routes of the same file with the deps they declare).
//
// serveRoutes checks the whole table when it is built: every entry declared, no path twice.

export interface MountContext {
  db: Db;
  now(): Date;
  config: WebConfig;
  /** The club behind a path slug (for public routes that run before any session), or null. */
  clubBySlug(slug: string): Promise<{ clubId: string } | null>;
}
export type Mount = (m: MountContext) => Route<unknown>[];

export const mounts: readonly Mount[] = [
  (m) =>
    importRoutes({
      db: m.db,
      limits: m.config.importLimits,
      service: (limits) => createImportService({ limits, today: () => bangkokDate(m.now()), normalizePhone }),
    }),
  (m) => claimRoutes({ db: m.db, service: () => createClaimService() }),
  (m) => dataRequestRoutes({ db: m.db, service: () => createDataRequestService() }),
  (m) => [publicScheduleRoutes, playerBookingRoutes, staffBookingRoutes].flatMap((f) => f({ db: m.db, clubBySlug: m.clubBySlug })),
  (m) => noticeRoutes({ db: m.db, clubBySlug: m.clubBySlug }),
  (m) => profileRoutes({ db: m.db, service: () => createProfileEditService({ today: () => bangkokDate(m.now()) }) }),
];
