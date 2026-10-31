import type { Db, Tx } from '@booq/db';
import type { LineUsageApi } from '@booq/line/server';
import { recordTaskRun } from '../heartbeat';

// line_usage_sync and line_health (F10-T13; F10 design 5.7, 5.8, 8; FA 5.4, 5.6). LINE-06, LINE-07-AC1 to AC6, AC9,
// AC10; D97, D99, D114. For each Testing, Live and Paused club (app.line_sync_clubs; a Testing club's messages count
// toward its cap, D32):
//  * line_usage_sync (every 10 minutes): the club's token is read in its transaction; LINE's quota and consumption are
//    read outside any transaction; app.record_line_usage then writes this month's usage row, the health checks, the
//    80 percent void of queued reminders and the owner's once a month message at 100 percent on a paid plan. A failed
//    read is passed on as a code: the last known value is kept and P1 is alerted, reminders are not stopped (D97);
//  * line_health (daily): the quota is read with the token; app.record_line_token_check fails or clears line_token.
// One club's failure never stops the others; a thrown error is counted, the next run tries again. Results are counts.
export const LINE_USAGE_SYNC = 'line_usage_sync';
export const LINE_HEALTH = 'line_health';

const SYSTEM_CONTEXT = { clubId: '00000000-0000-0000-0000-000000000000', userId: null, roles: [] } as const;
const ctx = (clubId: string, actorLabel: string) => ({ clubId, userId: null, roles: [], source: 'job' as const, actorLabel });

export interface LineUsageDeps {
  api: LineUsageApi;
  /** The club's channel access token, read in the club's transaction; null when none is set. */
  readToken(tx: Tx, clubId: string): Promise<string | null>;
}

export interface LineUsageSyncResult {
  clubs: number;
  /** Clubs whose consumption LINE answered. */
  fromLine: number;
  /** Clubs kept on the last known value or our own count. */
  fallback: number;
  ownerMessages: number;
  voided: number;
  errors: number;
}

export interface LineHealthResult {
  clubs: number;
  ok: number;
  failed: number;
  unchanged: number;
  errors: number;
}

const clubsToVisit = async (db: Db) =>
  (await db.withClubTx(SYSTEM_CONTEXT, (tx) => tx.query<{ id: string }>('select id from app.line_sync_clubs() as t(id)'))).rows.map((r) => r.id);

/** `db` must connect as booq_worker. */
export async function runLineUsageSync(db: Db, deps: LineUsageDeps): Promise<LineUsageSyncResult> {
  return recordTaskRun(db, LINE_USAGE_SYNC, async () => {
    const clubs = await clubsToVisit(db);
    const result: LineUsageSyncResult = { clubs: clubs.length, fromLine: 0, fallback: 0, ownerMessages: 0, voided: 0, errors: 0 };
    for (const clubId of clubs) {
      try {
        const token = await db.withClubTx(ctx(clubId, LINE_USAGE_SYNC), (tx) => deps.readToken(tx, clubId));
        const quota = token ? await deps.api.quota(token) : { ok: false as const, code: 'no_token' };
        const consumption = token ? await deps.api.consumption(token) : { ok: false as const, code: 'no_token' };
        const r = await db.withClubTx(ctx(clubId, LINE_USAGE_SYNC), async (tx) =>
          (await tx.query<{ r: { voided: number; owner_message: boolean } }>('select app.record_line_usage($1, $2, $3, $4, $5) as r', [
            quota.ok ? quota.type : null, quota.ok ? quota.value : null, quota.ok ? null : quota.code,
            consumption.ok ? consumption.totalUsage : null, consumption.ok ? null : consumption.code,
          ])).rows[0]!.r);
        if (consumption.ok) result.fromLine += 1; else result.fallback += 1;
        result.voided += r.voided;
        if (r.owner_message) result.ownerMessages += 1;
      } catch {
        result.errors += 1;
      }
    }
    return result;
  });
}

/** `db` must connect as booq_worker. */
export async function runLineHealth(db: Db, deps: LineUsageDeps): Promise<LineHealthResult> {
  return recordTaskRun(db, LINE_HEALTH, async () => {
    const clubs = await clubsToVisit(db);
    const result: LineHealthResult = { clubs: clubs.length, ok: 0, failed: 0, unchanged: 0, errors: 0 };
    for (const clubId of clubs) {
      try {
        const token = await db.withClubTx(ctx(clubId, LINE_HEALTH), (tx) => deps.readToken(tx, clubId));
        const quota = token ? await deps.api.quota(token) : { ok: false as const, code: 'no_token' };
        const status = await db.withClubTx(ctx(clubId, LINE_HEALTH), async (tx) =>
          (await tx.query<{ s: 'ok' | 'failed' | 'unchanged' }>('select app.record_line_token_check($1) as s', [quota.ok ? null : quota.code])).rows[0]!.s);
        result[status] += 1;
      } catch {
        result.errors += 1;
      }
    }
    return result;
  });
}
