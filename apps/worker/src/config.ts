import { HOUSEKEEPING } from './worker';
import { IMPORT_STAGING_DISPATCH } from './tasks/import-staging';

// Worker settings (F01-T34). Connection strings and schedules are deployment config: nothing
// here has a default, so a missing value stops the worker at start instead of guessing.

export interface WorkerConfig {
  /** The worker role's connection for club data (booq_worker). */
  databaseUrl: string;
  /** A direct, non-pooled connection for the queue (LISTEN/NOTIFY). */
  queueUrl: string;
  housekeepingCron: string;
  importSweepCron: string;
  /** Seconds between hold_release ticks (an in-process timer; cron cannot go below a minute). */
  holdReleaseTickSeconds: number;
}

const CRON = /^\S+ \S+ \S+ \S+ \S+$/;

export function readWorkerConfig(env: Record<string, string | undefined>): WorkerConfig {
  const names = ['DATABASE_URL', 'WORKER_QUEUE_URL', 'WORKER_HOUSEKEEPING_CRON', 'WORKER_IMPORT_SWEEP_CRON', 'WORKER_HOLD_RELEASE_TICK_SECONDS'] as const;
  const missing = names.filter((n) => !env[n]);
  if (missing.length) throw new Error(`worker settings missing: ${missing.join(', ')}`);
  for (const n of ['WORKER_HOUSEKEEPING_CRON', 'WORKER_IMPORT_SWEEP_CRON'] as const) {
    if (!CRON.test(env[n]!)) throw new Error(`${n} must be five cron fields`);
  }
  if (!/^[1-9][0-9]*$/.test(env['WORKER_HOLD_RELEASE_TICK_SECONDS']!)) throw new Error('WORKER_HOLD_RELEASE_TICK_SECONDS must be a whole number of seconds above zero');
  return {
    databaseUrl: env['DATABASE_URL']!,
    queueUrl: env['WORKER_QUEUE_URL']!,
    housekeepingCron: env['WORKER_HOUSEKEEPING_CRON']!,
    importSweepCron: env['WORKER_IMPORT_SWEEP_CRON']!,
    holdReleaseTickSeconds: Number(env['WORKER_HOLD_RELEASE_TICK_SECONDS']),
  };
}

/** Graphile Worker crontab text: housekeeping, and the dispatcher that adds one sweep per club. */
export function buildCrontab(c: Pick<WorkerConfig, 'housekeepingCron' | 'importSweepCron'>): string {
  return `${c.housekeepingCron} ${HOUSEKEEPING}\n${c.importSweepCron} ${IMPORT_STAGING_DISPATCH}\n`;
}
