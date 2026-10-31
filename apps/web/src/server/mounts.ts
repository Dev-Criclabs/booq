import { businessRoute, createClaimService, createDataRequestService, createExportService, createImportService, createProfileEditService, hoursRoute, quoteSources, normalizePhone, resourceRoutes, settingsRoutes, supportWindowRoute } from '@booq/domain';
import { createRedactingLogger, RouteError, type Route } from '@booq/auth';
import { beamGateway } from '@booq/beam';
import { loadDecryptKey } from '@booq/secrets';
import type { Db } from '@booq/db';
import { bangkokDate } from '@booq/time';
import { playerBookingRoutes, publicScheduleRoutes, staffBookingRoutes } from '../api/booking/routes';
import { checkoutRoutes } from '../api/checkout/routes';
import { pricingRoutes } from '../api/pricing/routes';
import { playerClassRoutes, publicClassRoutes, staffClassRoutes } from '../api/classes/routes';
import { setupDataRoutes, setupRoutes, auditRoutes, calendarRoutes, customerRoutes, customerValueRoutes, shellRoutes } from '../api/admin/routes';
import { playerCoachRoutes, publicCoachRoutes, staffCoachRoutes } from '../api/coaches/routes';
import { claimRoutes } from '../api/claim/routes';
import { exportRoutes } from '../api/export/routes';
import { dataRequestRoutes } from '../api/data-request/routes';
import { profileRoutes } from '../api/profile/routes';
import { staffRoutes } from '../api/staff/routes';
import { dobHistoryRoutes } from '../api/dob-history/routes';
import { lineFriendRoutes } from '../api/line/friend/routes';
import { createReceiptPdf } from '../api/receipts/pdf';
import { receiptRoutes } from '../api/receipts/routes';
import { reportRoutes } from '../api/reports/routes';
import { importRoutes } from '../api/import/routes';
import { noticeRoutes } from '../api/notice/routes';
import { playerPackageRoutes } from '../api/packages/routes';
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

// F05 P1 alerts (a kind and the club only) go to the redacted log until a platform alert store exists.
const alertLog = createRedactingLogger((line) => process.stderr.write(`${line}\n`));
const paymentAlerts = { p1: (kind: string, clubId: string) => alertLog.error('p1_alert', { source: 'payments', kind, clubId }) };

export const mounts: readonly Mount[] = [
  (m) =>
    importRoutes({
      db: m.db,
      limits: m.config.importLimits,
      service: (limits) => createImportService({ limits, today: () => bangkokDate(m.now()), normalizePhone }),
    }),
  (m) => claimRoutes({ db: m.db, service: () => createClaimService() }),
  // F01-T25 (PLAT-06-AC11, AC12): the owner's data export. Until the storage provider and the queue are given in the config, both routes
  // answer 503 export_not_configured before anything is written, so no request is left that nothing will build.
  (m) =>
    exportRoutes({
      db: m.db,
      service: () => {
        if (!m.config.exports) throw new RouteError(503, 'export_not_configured');
        return createExportService({ storage: m.config.exports.storage, linkSeconds: m.config.exports.linkSeconds });
      },
      enqueue: (task, payload) => {
        if (!m.config.exports) throw new RouteError(503, 'export_not_configured');
        return m.config.exports.enqueue(task, payload);
      },
    }),
  (m) => dataRequestRoutes({ db: m.db, service: () => createDataRequestService() }),
  (m) => staffRoutes({ db: m.db }),
  (m) => dobHistoryRoutes({ db: m.db }),
  (m) => pricingRoutes({ db: m.db }),
  (m) => lineFriendRoutes({ db: m.db }),
  (m) => receiptRoutes({ db: m.db, pdf: createReceiptPdf(m.config.localesDir ?? null) }),
  (m) => playerPackageRoutes({ db: m.db, clubBySlug: m.clubBySlug }),
  (m) => reportRoutes({ db: m.db }),
  (m) => Object.values(settingsRoutes(m.db)),
  (m) => [businessRoute(m.db)],
  (m) => [publicScheduleRoutes, playerBookingRoutes, staffBookingRoutes].flatMap((f) => f({ db: m.db, clubBySlug: m.clubBySlug })),
  (m) => noticeRoutes({ db: m.db, clubBySlug: m.clubBySlug }),
  (m) => [publicClassRoutes, playerClassRoutes, staffClassRoutes].flatMap((f) => f({ db: m.db, now: m.now, clubBySlug: m.clubBySlug })),
  (m) => [publicCoachRoutes, playerCoachRoutes, staffCoachRoutes].flatMap((f) => f({ db: m.db, clubBySlug: m.clubBySlug })),
  (m) => [shellRoutes, calendarRoutes, customerRoutes, customerValueRoutes, auditRoutes, setupRoutes, setupDataRoutes].flatMap((f) => f({ db: m.db, clubBySlug: m.clubBySlug })),
  // F11 A16 Settings: opening hours, courts and the support window (F01 routes in packages/domain/src/club; the settings routes are mounted above).
  (m) => [hoursRoute(m.db), resourceRoutes(m.db).create, resourceRoutes(m.db).update, supportWindowRoute(m.db)],
  (m) => profileRoutes({ db: m.db, service: () => createProfileEditService({ today: () => bangkokDate(m.now()) }) }),
  (m) => checkoutRoutes({ db: m.db, clubBySlug: m.clubBySlug, sources: quoteSources, payments: { privateKey: () => loadDecryptKey(), gateway: beamGateway, alerts: paymentAlerts, now: m.now } }),
];
