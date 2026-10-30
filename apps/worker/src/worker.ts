import { run, type JobHelpers, type Runner, type TaskList } from 'graphile-worker';
import type { Db } from '@booq/db';
import { recordQueueHealth, recordTaskRun } from './heartbeat';
import { isPermanentFailure } from './policy';
import { clubTask, type ClubTaskHandler } from './task-wrapper';

// Worker bootstrap (F01-T34; FA 5, R9). Graphile Worker on a direct (not pooled) connection,
// because it uses LISTEN/NOTIFY. Every club task goes through clubTask (club context) and
// recordTaskRun (heartbeat). Payloads hold ids only. The queue connection is the worker's own
// and is not used for club data; club data goes through `db` (withClubTx).

/** A task with no club of its own (cron, dispatch). It gets the heartbeat but no club context. */
export type GlobalTask = (payload: unknown, helpers: JobHelpers) => Promise<void>;

export interface WorkerOptions {
  /** A direct connection string, not the pooler. */
  connectionString: string;
  db: Db;
  tasks: Record<string, ClubTaskHandler<{ clubId: string }>>;
  /** Tasks that add club jobs or report queue health; never touch club data directly. */
  globalTasks?: Record<string, GlobalTask>;
  /** Graphile crontab text, from buildCrontab(). */
  crontab?: string;
  concurrency?: number;
}
export interface RunningWorker {
  stop(): Promise<void>;
}

export const HOUSEKEEPING = 'housekeeping';

export async function startWorker(options: WorkerOptions): Promise<RunningWorker> {
  const taskList: TaskList = {};
  for (const [name, handler] of Object.entries(options.tasks)) {
    const task = clubTask(options.db, handler, { actorLabel: name });
    taskList[name] = async (payload, helpers) => {
      try {
        await recordTaskRun(options.db, name, () => task(payload, helpers));
      } catch (error) {
        if (isPermanentFailure(error)) return; // recorded as a failure; retrying cannot help
        throw error;
      }
    };
  }
  for (const [name, task] of Object.entries(options.globalTasks ?? {})) {
    taskList[name] = (payload, helpers) => recordTaskRun(options.db, name, () => task(payload, helpers));
  }
  // Not a club task: counts only. Lag is the age of the oldest due job; dead jobs have used all attempts.
  taskList[HOUSEKEEPING] = async (_payload, helpers) => {
    await recordTaskRun(options.db, HOUSEKEEPING, async () => {
      const { rows } = await helpers.withPgClient((c) =>
        c.query<{ lag: string; dead: string }>(
          `select coalesce(extract(epoch from (now() - min(run_at) filter (where locked_at is null and attempts < max_attempts and run_at <= now()))), 0)::text as lag,
                  (count(*) filter (where attempts >= max_attempts and locked_at is null))::text as dead
             from graphile_worker.jobs where task_identifier <> $1`,
          [HOUSEKEEPING],
        ),
      );
      await recordQueueHealth(options.db, HOUSEKEEPING, Number(rows[0]?.lag ?? 0), Number(rows[0]?.dead ?? 0));
    });
  };

  const runner: Runner = await run({
    connectionString: options.connectionString,
    concurrency: options.concurrency ?? 2,
    noHandleSignals: true,
    taskList,
    ...(options.crontab === undefined ? {} : { crontab: options.crontab }),
  });
  return {
    async stop() {
      await runner.stop();
      // stop() resolves when work has stopped; `promise` when the queue's connections are closed too.
      await runner.promise.catch(() => undefined);
    },
  };
}
