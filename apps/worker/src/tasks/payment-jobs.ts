import type { Db } from '@booq/db';
import { clearFinalQrImagesClub, expirePackageOrdersClub, reconcileClub, type ReconcileDeps } from '@booq/domain';
import { listClubIds } from '../club-list';
import { recordQueueHealth, recordTaskRun } from '../heartbeat';

// beam_reconcile and package_order_expiry (F05-T09; PAY-02-AC15, PAY-04-AC1 to AC7; D73, D74; F05 design 5.2, 5.10; FA 5.4).
// One run walks the clubs; each club is one worker transaction in its own context (the club is never an argument), so one
// club's failure rolls back only that club and the next run tries it again. The run throws after the batch if any club or
// any payment failed, so the queue records it. The work itself is in packages/domain/src/payments/jobs.ts.
export const BEAM_RECONCILE = 'beam_reconcile';
export const PACKAGE_ORDER_EXPIRY = 'package_order_expiry';

export interface PaymentJobsResult {
  clubs: number;
  acted: number;
  failed: number;
}

const jobContext = (clubId: string, task: string) => ({ clubId, userId: null, roles: [], source: 'job' as const, actorLabel: task });

async function eachClub(db: Db, task: string, work: (clubId: string) => Promise<{ acted: number; failed: number }>): Promise<PaymentJobsResult> {
  return recordTaskRun(db, task, async () => {
    const result: PaymentJobsResult = { clubs: 0, acted: 0, failed: 0 };
    for (const clubId of await listClubIds(db)) {
      result.clubs += 1;
      try {
        const r = await work(clubId);
        result.acted += r.acted;
        result.failed += r.failed;
      } catch {
        result.failed += 1;
      }
    }
    await recordQueueHealth(db, task, 0, 0);
    if (result.failed > 0) throw new Error(`${task}: ${result.failed} items failed`);
    return result;
  });
}

/** `db` must connect as booq_worker. The key is read when a run starts. */
export const runBeamReconcile = (db: Db, deps: Omit<ReconcileDeps, 'privateKey'> & { privateKey(): string }) =>
  eachClub(db, BEAM_RECONCILE, (clubId) =>
    db.withClubTx(jobContext(clubId, BEAM_RECONCILE), async (tx) => {
      const r = await reconcileClub(tx, clubId, { ...deps, privateKey: deps.privateKey() });
      return { acted: r.acted, failed: r.failed };
    }));

/** `db` must connect as booq_worker. Expires package orders past their QR time, then clears final payments' QR images. */
export const runPackageOrderExpiry = (db: Db) =>
  eachClub(db, PACKAGE_ORDER_EXPIRY, (clubId) =>
    db.withClubTx(jobContext(clubId, PACKAGE_ORDER_EXPIRY), async (tx) => {
      const expired = await expirePackageOrdersClub(tx);
      await clearFinalQrImagesClub(tx);
      return { acted: expired, failed: 0 };
    }));
