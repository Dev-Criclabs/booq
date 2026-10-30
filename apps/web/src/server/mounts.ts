import { createClaimService, createDataRequestService, createImportService, normalizePhone } from '@booq/domain';
import type { Route } from '@booq/auth';
import type { Db } from '@booq/db';
import { bangkokDate } from '@booq/time';
import { claimRoutes } from '../api/claim/routes';
import { dataRequestRoutes } from '../api/data-request/routes';
import { importRoutes } from '../api/import/routes';
import type { WebConfig } from './context';

// The route registry. Each feature adds ONE line to `mounts` and keeps its routes in plain form
// under apps/web/src/api/<feature>/ (a factory that returns route() objects). Lanes edit different
// lines, so they do not collide. The sign-in routes are in context.ts because they share the
// session services with the resolver.
//
//   F03 booking:  add   (m) => bookingRoutes({ db: m.db, now: m.now })   below, import it above.
//
// serveRoutes checks the whole table when it is built: every entry declared, no path twice.

export interface MountContext {
  db: Db;
  now(): Date;
  config: WebConfig;
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
];
