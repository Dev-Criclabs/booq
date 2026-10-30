import { createDb } from '@booq/db';
import { listClubIds } from './club-list';
import { buildCrontab, readWorkerConfig } from './config';
import { IMPORT_STAGING_DISPATCH, IMPORT_STAGING_SWEEP, importStagingDispatch, sweepImportStaging } from './tasks/import-staging';
import { startWorker } from './worker';

// The worker process (F01-T34). Settings come from the environment (see config.ts); there are
// no defaults. The club export task (club_export) is added here once DevOps chooses the bucket
// provider and its ExportStorage exists; until then no export job is picked up.
const config = readWorkerConfig(process.env);
const db = createDb({ connectionString: config.databaseUrl, role: 'booq_worker' });

const worker = await startWorker({
  connectionString: config.queueUrl,
  db,
  tasks: { [IMPORT_STAGING_SWEEP]: sweepImportStaging },
  globalTasks: { [IMPORT_STAGING_DISPATCH]: importStagingDispatch({ listClubIds: () => listClubIds(db) }) },
  crontab: buildCrontab(config),
});

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void worker.stop().then(() => db.end()).then(() => process.exit(0));
  });
}
