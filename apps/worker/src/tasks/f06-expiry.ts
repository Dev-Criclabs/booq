import type { Db } from '@booq/db';
import { recordQueueHealth, recordTaskRun } from '../heartbeat';

// package_expire and wallet_expire (F06-T13; PKG-03-AC3, AC10; F06 design 4.6, 4.7 and 6; FA 5.4). One tick:
//  1. lists, across clubs, what is due (app.due_package_expiry, app.due_wallet_expiry: worker only; paused clubs and
//     work already done are left out);
//  2. writes each item in its own club-context transaction (app.credit_expire, app.wallet_expire), which re-checks under
//     its locks, so one failure rolls back only that item and the next tick finds it again;
//  3. throws after the batch if any item failed, so the queue records it.
// Idempotent: each expiry is written once by its dedupe key (expire:{package}:{expires_at}, expire:{customer}:{day}),
// so a repeated or overlapping tick writes nothing more. Time is the database clock (app.now()).
export const PACKAGE_EXPIRE = 'package_expire';
export const WALLET_EXPIRE = 'wallet_expire';

const SYSTEM_CONTEXT = { clubId: '00000000-0000-0000-0000-000000000000', userId: null, roles: [] } as const;
const DEFAULT_BATCH = 200;

export interface ExpiryResult {
  /** Items listed as due in this tick. */
  due: number;
  /** Items this tick wrote an expire row for. */
  expired: number;
  failed: number;
}

interface Sweep {
  task: string;
  list: string;
  act: string;
}
const PACKAGES: Sweep = { task: PACKAGE_EXPIRE, list: 'select club_id, package_id as id from app.due_package_expiry($1)', act: 'select app.credit_expire($1) as n' };
const WALLETS: Sweep = { task: WALLET_EXPIRE, list: 'select club_id, customer_id as id from app.due_wallet_expiry($1)', act: 'select app.wallet_expire($1) as n' };

async function sweep(db: Db, s: Sweep, batch: number): Promise<ExpiryResult> {
  return recordTaskRun(db, s.task, async () => {
    const rows = await db.withClubTx(SYSTEM_CONTEXT, async (tx) => (await tx.query<{ club_id: string; id: string }>(s.list, [batch])).rows);
    const result: ExpiryResult = { due: rows.length, expired: 0, failed: 0 };
    for (const row of rows) {
      try {
        const n = await db.withClubTx({ clubId: row.club_id, userId: null, roles: [], source: 'job', actorLabel: s.task }, async (tx) =>
          Number((await tx.query<{ n: string | number }>(s.act, [row.id])).rows[0]?.n ?? 0));
        if (n > 0) result.expired += 1;
      } catch {
        result.failed += 1;
      }
    }
    await recordQueueHealth(db, s.task, 0, 0);
    if (result.failed > 0) throw new Error(`${s.task}: ${result.failed} of ${result.due} items failed`);
    return result;
  });
}

/** `db` must connect as booq_worker. */
export const runPackageExpire = (db: Db, options: { batch?: number } = {}) => sweep(db, PACKAGES, options.batch ?? DEFAULT_BATCH);
/** `db` must connect as booq_worker. Only clubs that set wallet_expiry_months are listed (D89). */
export const runWalletExpire = (db: Db, options: { batch?: number } = {}) => sweep(db, WALLETS, options.batch ?? DEFAULT_BATCH);
