import type { Db } from '@booq/db';

// Worker heartbeat (F01-T34; FA 5). One row per task type in platform.worker_heartbeat:
// counts and times only, no club and no data. The table is not club data, so the write uses
// a system context whose club id is the nil uuid; every club row policy compares against it
// and matches nothing. Time is the database clock (app.now(), movable in tests).

const SYSTEM_CONTEXT = { clubId: '00000000-0000-0000-0000-000000000000', userId: null, roles: [] } as const;

async function beat(db: Db, sql: string, taskName: string): Promise<void> {
  try {
    await db.withClubTx(SYSTEM_CONTEXT, (tx) => tx.query(sql, [taskName]).then(() => undefined));
  } catch {
    // A heartbeat that cannot be written must never change what the task did.
  }
}

const STARTED = `insert into platform.worker_heartbeat (task_name, last_started_at, runs) values ($1, app.now(), 1)
  on conflict (task_name) do update set last_started_at = app.now(), runs = platform.worker_heartbeat.runs + 1`;
const SUCCEEDED = `update platform.worker_heartbeat set last_succeeded_at = app.now() where task_name = $1`;
const FAILED = `update platform.worker_heartbeat set last_failed_at = app.now(), failures = failures + 1 where task_name = $1`;

/** Runs a task body and records start, success or failure. The result or the error passes through. */
export async function recordTaskRun<T>(db: Db, taskName: string, run: () => Promise<T>): Promise<T> {
  await beat(db, STARTED, taskName);
  try {
    const result = await run();
    await beat(db, SUCCEEDED, taskName);
    return result;
  } catch (error) {
    await beat(db, FAILED, taskName);
    throw error;
  }
}

/** Queue health for the P1 tile: lag in seconds and the count of jobs out of attempts. */
export async function recordQueueHealth(db: Db, taskName: string, lagSeconds: number, deadJobs: number): Promise<void> {
  try {
    await db.withClubTx(SYSTEM_CONTEXT, (tx) =>
      tx
        .query(`update platform.worker_heartbeat set lag_seconds = $2, dead_jobs = $3 where task_name = $1`, [taskName, Math.max(0, Math.round(lagSeconds)), Math.max(0, deadJobs)])
        .then(() => undefined),
    );
  } catch {
    // see beat()
  }
}
