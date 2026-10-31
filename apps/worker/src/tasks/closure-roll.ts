import type { Db } from '@booq/db';
import { recordQueueHealth, recordTaskRun } from '../heartbeat';

// closure_roll (F09-T10; CANCEL-03-AC9, assumption A-8; F09 design 8). Once a day (the deployment's WORKER_CLOSURE_ROLL_CRON),
// for each Live or Paused club:
//  1. lists the repeat closures with an occurrence the booking window now reaches and no closed slot yet
//     (app.closures_due_roll), in the club's context;
//  2. rolls each in its own club-context transaction (app.roll_closure): the occurrence's slots are closed and any booking,
//     hold or class session found there is cancelled by the closure routine (a staff booking made beyond the window, A-8).
//     One closure per transaction, because the court locks are the last locks a transaction takes (FA 3.4);
//  3. throws after the batch if any club or closure failed, so the queue records it; the rest still ran.
// Idempotent: an occurrence that has its slots is not due again, so a repeated or overlapping run adds nothing. Time is the
// database clock (app.now()).
export const CLOSURE_ROLL = 'closure_roll';

export interface ClosureRollResult {
  /** Clubs whose due list was read. */
  clubs: number;
  /** Closures listed as due. */
  due: number;
  /** Closures that gained at least one occurrence. */
  rolled: number;
  failed: number;
}

/** `db` must connect as booq_worker. */
export function runClosureRoll(db: Db, deps: { listClubIds(): Promise<string[]> }): Promise<ClosureRollResult> {
  return recordTaskRun(db, CLOSURE_ROLL, async () => {
    const result: ClosureRollResult = { clubs: 0, due: 0, rolled: 0, failed: 0 };
    for (const clubId of await deps.listClubIds()) {
      const ctx = { clubId, userId: null, roles: [], source: 'job' as const, actorLabel: CLOSURE_ROLL };
      let ids: string[];
      try {
        ids = await db.withClubTx(ctx, async (tx) => (await tx.query<{ ids: string[] | null }>('select app.closures_due_roll() as ids')).rows[0]?.ids ?? []);
      } catch {
        result.failed += 1;
        continue;
      }
      result.clubs += 1;
      result.due += ids.length;
      for (const id of ids) {
        try {
          const added = await db.withClubTx(ctx, async (tx) =>
            Number((await tx.query<{ r: { added?: number } }>('select app.roll_closure($1) as r', [id])).rows[0]?.r.added ?? 0));
          if (added > 0) result.rolled += 1;
        } catch {
          result.failed += 1;
        }
      }
    }
    await recordQueueHealth(db, CLOSURE_ROLL, 0, 0);
    if (result.failed > 0) throw new Error(`${CLOSURE_ROLL}: ${result.failed} failed (clubs ${result.clubs}, closures due ${result.due})`);
    return result;
  });
}
