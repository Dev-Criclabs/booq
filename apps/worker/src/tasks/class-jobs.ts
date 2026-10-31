import type { Db } from '@booq/db';
import { recordQueueHealth, recordTaskRun } from '../heartbeat';

// offer_expiry and class_below_minimum (F08-T10; CLASS-02-AC4, AC15; CLASS-01-AC16; WAIT-01-AC4; F08 design 4.9, 4.10, 6).
// Both run on their own timers (cron cannot go below a minute) and across clubs: a list function that only the worker role may call
// names the due rows, then each is handled in its own club-context transaction, so one failure rolls back only that row and the
// next tick finds it again. Correctness never depends on a tick being on time: an offer's held booking ends with its own hold.
export const OFFER_EXPIRY = 'offer_expiry';
export const CLASS_BELOW_MINIMUM = 'class_below_minimum';

const SYSTEM_CONTEXT = { clubId: '00000000-0000-0000-0000-000000000000', userId: null, roles: [] } as const;
const DEFAULT_BATCH = 200;

export interface OfferExpiryResult {
  /** Entries ended because their class or court hour has started. */
  ended: number;
  /** Offers passed on because their message was undeliverable (the club is at its message cap, CLASS-02-AC9). */
  passedOn: number;
  /** Offers found past their end time. */
  due: number;
  /** Offers this tick expired and passed on (an offer a hold release ended a moment earlier is not counted). */
  expired: number;
  failed: number;
  lagSeconds: number;
}

/** `db` must connect as booq_worker. Throws after the batch if any offer failed, so the queue records it. */
export async function runOfferExpiry(db: Db, options: { batch?: number } = {}): Promise<OfferExpiryResult> {
  return recordTaskRun(db, OFFER_EXPIRY, async () => {
    const found = await db.withClubTx(SYSTEM_CONTEXT, async (tx) => ({
      ended: Number((await tx.query<{ n: number }>('select app.end_passed_waitlist_entries() as n')).rows[0]?.n ?? 0),
      offers: (await tx.query<{ club_id: string; entry_id: string; lag_seconds: number }>('select club_id, entry_id, lag_seconds from app.due_offers($1)', [options.batch ?? DEFAULT_BATCH])).rows,
    }));
    const result: OfferExpiryResult = { ended: found.ended, passedOn: 0, due: found.offers.length, expired: 0, failed: 0, lagSeconds: found.offers[0]?.lag_seconds ?? 0 };
    for (const row of found.offers) {
      try {
        const done = await db.withClubTx(
          { clubId: row.club_id, userId: null, roles: [], source: 'job', actorLabel: OFFER_EXPIRY },
          async (tx) => (await tx.query<{ r: boolean }>('select app.offer_expire($1) as r', [row.entry_id])).rows[0]?.r === true,
        );
        if (done) result.expired += 1;
      } catch {
        result.failed += 1;
      }
    }
    // An offer whose message F10 could not send at the free plan cap passes to the next in line at once (CLASS-02-AC9).
    const undeliverable = await db.withClubTx(SYSTEM_CONTEXT, (tx) => tx.query<{ club_id: string; entry_id: string }>('select club_id, entry_id from app.due_undeliverable_offers($1)', [options.batch ?? DEFAULT_BATCH]));
    for (const row of undeliverable.rows) {
      try {
        const done = await db.withClubTx(
          { clubId: row.club_id, userId: null, roles: [], source: 'job', actorLabel: OFFER_EXPIRY },
          async (tx) => (await tx.query<{ r: boolean }>('select app.waitlist_pass_on($1) as r', [row.entry_id])).rows[0]?.r === true,
        );
        if (done) result.passedOn += 1;
      } catch {
        result.failed += 1;
      }
    }
    await recordQueueHealth(db, OFFER_EXPIRY, result.lagSeconds, 0);
    if (result.failed > 0) throw new Error(`${OFFER_EXPIRY}: ${result.failed} offers failed`);
    return result;
  });
}

export interface ClassBelowMinimumResult {
  due: number;
  /** Messages queued (one per front desk person). */
  alerts: number;
  failed: number;
}

/** The alert only informs: nothing here cancels a session. It is inert while a club's below_min_alert_minutes is empty. */
export async function runClassBelowMinimum(db: Db, options: { batch?: number } = {}): Promise<ClassBelowMinimumResult> {
  return recordTaskRun(db, CLASS_BELOW_MINIMUM, async () => {
    const found = await db.withClubTx(SYSTEM_CONTEXT, (tx) =>
      tx.query<{ club_id: string; session_id: string }>('select club_id, session_id from app.due_below_minimum($1)', [options.batch ?? DEFAULT_BATCH]),
    );
    const result: ClassBelowMinimumResult = { due: found.rows.length, alerts: 0, failed: 0 };
    for (const row of found.rows) {
      try {
        result.alerts += await db.withClubTx(
          { clubId: row.club_id, userId: null, roles: [], source: 'job', actorLabel: CLASS_BELOW_MINIMUM },
          async (tx) => Number((await tx.query<{ n: number }>('select app.send_below_minimum_alert($1) as n', [row.session_id])).rows[0]?.n ?? 0),
        );
      } catch {
        result.failed += 1;
      }
    }
    if (result.failed > 0) throw new Error(`${CLASS_BELOW_MINIMUM}: ${result.failed} of ${result.due} sessions failed`);
    return result;
  });
}
