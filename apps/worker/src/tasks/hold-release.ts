import type { Db } from '@booq/db';
import { recordQueueHealth, recordTaskRun } from '../heartbeat';

// hold_release (F03-T19; BOOK-03-AC5, AC6; F03 design 6). Run every 15 to 30 seconds. One tick:
//  1. lists, across clubs, the orders whose hold has ended (app.due_hold_orders, worker only);
//  2. releases each order whole in its own club-context transaction (app.release_hold), so one
//     order's failure rolls back only that order and the next tick retries it;
//  3. records how long the oldest due hold waited, for the P1 health tile.
// Correctness never depends on this job: a late tick blocks nobody, because the claim releases
// expired holds in its way (FA 3.2). The job only finishes the side effects: the handlers
// (credit and wallet reversal, waitlist, the released message) run once per order inside release_hold.
export const HOLD_RELEASE = 'hold_release';

const SYSTEM_CONTEXT = { clubId: '00000000-0000-0000-0000-000000000000', userId: null, roles: [] } as const;
const DEFAULT_BATCH = 200;

export interface HoldReleaseResult {
  /** Orders found with an ended hold in this tick. */
  due: number;
  /** Orders this tick released (an order a claim released a moment earlier is not counted). */
  released: number;
  failed: number;
  /** Seconds the oldest due hold had waited. */
  lagSeconds: number;
}

/** `db` must connect as booq_worker. Throws after the batch if any order failed, so the queue records it. */
export async function runHoldRelease(db: Db, options: { batch?: number } = {}): Promise<HoldReleaseResult> {
  return recordTaskRun(db, HOLD_RELEASE, async () => {
    const found = await db.withClubTx(SYSTEM_CONTEXT, (tx) =>
      tx.query<{ club_id: string; order_id: string; lag_seconds: number }>('select club_id, order_id, lag_seconds from app.due_hold_orders($1)', [options.batch ?? DEFAULT_BATCH]),
    );
    const result: HoldReleaseResult = { due: found.rows.length, released: 0, failed: 0, lagSeconds: found.rows[0]?.lag_seconds ?? 0 };
    for (const row of found.rows) {
      try {
        const released = await db.withClubTx(
          { clubId: row.club_id, userId: null, roles: [], source: 'job', actorLabel: HOLD_RELEASE },
          async (tx) => (await tx.query<{ released: boolean }>(`select app.release_hold($1, 'expired') as released`, [row.order_id])).rows[0]?.released === true,
        );
        if (released) result.released += 1;
      } catch {
        result.failed += 1; // rolled back with its own transaction; the next tick finds it again
      }
    }
    await recordQueueHealth(db, HOLD_RELEASE, result.lagSeconds, 0);
    if (result.failed > 0) throw new Error(`${HOLD_RELEASE}: ${result.failed} of ${result.due} orders failed`);
    return result;
  });
}
