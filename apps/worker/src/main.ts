import { createDb } from '@booq/db';
import { listClubIds } from './club-list';
import { buildCrontab, readWorkerConfig } from './config';
import { IMPORT_STAGING_DISPATCH, IMPORT_STAGING_SWEEP, importStagingDispatch, sweepImportStaging } from './tasks/import-staging';
import { RATE_LIMIT_SWEEP, rateLimitSweep } from './tasks/rate-limit-sweep';
import { PAY_TAP_PRUNE, PAY_TAP_PRUNE_DISPATCH, payTapPruneDispatch, prunePayTaps } from './tasks/pay-tap-prune';
import { runHoldRelease } from './tasks/hold-release';
import { startTicker } from './ticker';
import { startWorker } from './worker';

// The worker process (F01-T34). Settings come from the environment (see config.ts); there are
// no defaults. The club export task (club_export) is added here once DevOps chooses the bucket
// provider and its ExportStorage exists; until then no export job is picked up.
const config = readWorkerConfig(process.env);
const db = createDb({ connectionString: config.databaseUrl, role: 'booq_worker' });

const sweepRateLimit = rateLimitSweep({ db, keepSeconds: config.rateLimitKeepSeconds });

const worker = await startWorker({
  connectionString: config.queueUrl,
  db,
  tasks: { [IMPORT_STAGING_SWEEP]: sweepImportStaging, [PAY_TAP_PRUNE]: prunePayTaps },
  globalTasks: {
    [IMPORT_STAGING_DISPATCH]: importStagingDispatch({ listClubIds: () => listClubIds(db) }),
    [PAY_TAP_PRUNE_DISPATCH]: payTapPruneDispatch({ listClubIds: () => listClubIds(db) }),
    [RATE_LIMIT_SWEEP]: async () => {
      await sweepRateLimit();
    },
  },
  crontab: buildCrontab(config),
});

// hold_release runs on its own timer: cron cannot go below a minute, and a late tick blocks nobody
// (BOOK-03-AC6). A failed tick is already counted in the heartbeat; the loop carries on.
const holdRelease = startTicker({
  everyMs: config.holdReleaseTickSeconds * 1000,
  run: () => runHoldRelease(db),
  onError: () => undefined,
});

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void holdRelease.stop().then(() => worker.stop()).then(() => db.end()).then(() => process.exit(0));
  });
}
