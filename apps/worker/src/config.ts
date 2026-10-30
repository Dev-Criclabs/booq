import { HOUSEKEEPING } from './worker';
import { IMPORT_STAGING_DISPATCH } from './tasks/import-staging';
import { CONSOLE_SESSION_SWEEP } from './tasks/console-session-sweep';
import { RATE_LIMIT_SWEEP } from './tasks/rate-limit-sweep';
import { PAY_TAP_PRUNE_DISPATCH } from './tasks/pay-tap-prune';

// Worker settings (F01-T34). Connection strings and schedules are deployment config: nothing
// here has a default, so a missing value stops the worker at start instead of guessing.

export interface WorkerConfig {
  /** The worker role's connection for club data (booq_worker). */
  databaseUrl: string;
  /** A direct, non-pooled connection for the queue (LISTEN/NOTIFY). */
  queueUrl: string;
  housekeepingCron: string;
  importSweepCron: string;
  rateLimitSweepCron: string;
  /** The dispatcher that adds one Pay tap prune per club (F03-T12). */
  payTapPruneCron: string;
  /** How long a sign-in rate-limit window is kept before the sweep removes it. */
  rateLimitKeepSeconds: number;
  consoleSweepCron: string;
  /** Sessions older than this are removed; not shorter than the console's absolute session limit. */
  consoleSessionAbsoluteSeconds: number;
  /** Seconds between hold_release ticks (an in-process timer; cron cannot go below a minute). */
  holdReleaseTickSeconds: number;
}

const CRON = /^\S+ \S+ \S+ \S+ \S+$/;

export function readWorkerConfig(env: Record<string, string | undefined>): WorkerConfig {
  const names = ['DATABASE_URL', 'WORKER_QUEUE_URL', 'WORKER_HOUSEKEEPING_CRON', 'WORKER_IMPORT_SWEEP_CRON', 'WORKER_RATE_LIMIT_SWEEP_CRON', 'WORKER_PAY_TAP_PRUNE_CRON', 'WORKER_RATE_LIMIT_KEEP_SECONDS', 'WORKER_CONSOLE_SWEEP_CRON', 'WORKER_CONSOLE_SESSION_ABSOLUTE_SECONDS', 'WORKER_HOLD_RELEASE_TICK_SECONDS'] as const;
  const missing = names.filter((n) => !env[n]);
  if (missing.length) throw new Error(`worker settings missing: ${missing.join(', ')}`);
  for (const n of ['WORKER_HOUSEKEEPING_CRON', 'WORKER_IMPORT_SWEEP_CRON', 'WORKER_RATE_LIMIT_SWEEP_CRON', 'WORKER_CONSOLE_SWEEP_CRON', 'WORKER_PAY_TAP_PRUNE_CRON'] as const) {
    if (!CRON.test(env[n]!)) throw new Error(`${n} must be five cron fields`);
  }
  if (!/^[1-9][0-9]*$/.test(env['WORKER_HOLD_RELEASE_TICK_SECONDS']!)) throw new Error('WORKER_HOLD_RELEASE_TICK_SECONDS must be a whole number of seconds above zero');
  if (!/^[1-9][0-9]*$/.test(env['WORKER_RATE_LIMIT_KEEP_SECONDS']!)) throw new Error('WORKER_RATE_LIMIT_KEEP_SECONDS must be a whole number of seconds above zero');
  if (!/^[1-9][0-9]*$/.test(env['WORKER_CONSOLE_SESSION_ABSOLUTE_SECONDS']!)) throw new Error('WORKER_CONSOLE_SESSION_ABSOLUTE_SECONDS must be a whole number of seconds above zero');
  return {
    databaseUrl: env['DATABASE_URL']!,
    queueUrl: env['WORKER_QUEUE_URL']!,
    housekeepingCron: env['WORKER_HOUSEKEEPING_CRON']!,
    importSweepCron: env['WORKER_IMPORT_SWEEP_CRON']!,
    rateLimitSweepCron: env['WORKER_RATE_LIMIT_SWEEP_CRON']!,
    payTapPruneCron: env['WORKER_PAY_TAP_PRUNE_CRON']!,
    rateLimitKeepSeconds: Number(env['WORKER_RATE_LIMIT_KEEP_SECONDS']),
    consoleSweepCron: env['WORKER_CONSOLE_SWEEP_CRON']!,
    consoleSessionAbsoluteSeconds: Number(env['WORKER_CONSOLE_SESSION_ABSOLUTE_SECONDS']),
    holdReleaseTickSeconds: Number(env['WORKER_HOLD_RELEASE_TICK_SECONDS']),
  };
}

/** Graphile Worker crontab text: housekeeping, the dispatchers that add one import sweep and one Pay tap prune per club, the rate-limit sweep and the console session sweep. */
export function buildCrontab(c: Pick<WorkerConfig, 'housekeepingCron' | 'importSweepCron' | 'rateLimitSweepCron' | 'consoleSweepCron' | 'payTapPruneCron'>): string {
  return `${c.housekeepingCron} ${HOUSEKEEPING}\n${c.importSweepCron} ${IMPORT_STAGING_DISPATCH}\n${c.rateLimitSweepCron} ${RATE_LIMIT_SWEEP}\n${c.consoleSweepCron} ${CONSOLE_SESSION_SWEEP}\n${c.payTapPruneCron} ${PAY_TAP_PRUNE_DISPATCH}\n`;
}
