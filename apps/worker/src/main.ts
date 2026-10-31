import { createDb } from '@booq/db';
import { beamGateway } from '@booq/beam';
import { createRedactingLogger } from '@booq/auth';
import { loadDecryptKey } from '@booq/secrets';
import { listClubIds } from './club-list';
import { buildCrontab, readWorkerConfig } from './config';
import { IMPORT_STAGING_DISPATCH, IMPORT_STAGING_SWEEP, importStagingDispatch, sweepImportStaging } from './tasks/import-staging';
import { CONSOLE_SESSION_SWEEP, consoleSessionSweep } from './tasks/console-session-sweep';
import { RATE_LIMIT_SWEEP, rateLimitSweep } from './tasks/rate-limit-sweep';
import { PAY_TAP_PRUNE, PAY_TAP_PRUNE_DISPATCH, payTapPruneDispatch, prunePayTaps } from './tasks/pay-tap-prune';
import { runHoldRelease } from './tasks/hold-release';
import { PACKAGE_EXPIRE, SESSION_START, WALLET_EXPIRE, runPackageExpire, runSessionStart, runWalletExpire } from './tasks/f06-expiry';
import { CLASS_GENERATE, CLASS_GENERATE_DISPATCH, classGenerateDispatch, generateClassSessions } from './tasks/class-generate';
import { runClassBelowMinimum, runOfferExpiry } from './tasks/class-jobs';
import { runConnectionChecks } from './tasks/connection-check';
import { CLOSURE_ROLL, runClosureRoll } from './tasks/closure-roll';
import { createLineSender, createLineUsageDeps, createRichMenuBuildDeps } from './tasks/line-sender-setup';
import { LINE_HEALTH, LINE_USAGE_SYNC, runLineHealth, runLineUsageSync } from './tasks/line-usage';
import { RICH_MENU_BUILD, richMenuBuildTask, runRichMenuRequests } from './tasks/line-rich-menu';
import { BEAM_RECONCILE, PACKAGE_ORDER_EXPIRY, runBeamReconcile, runPackageOrderExpiry } from './tasks/payment-jobs';
import { startTicker } from './ticker';
import { startWorker } from './worker';

// The worker process (F01-T34). Settings come from the environment (see config.ts); there are
// no defaults. The club export task (club_export) is added here once DevOps chooses the bucket
// provider and its ExportStorage exists; until then no export job is picked up.
const config = readWorkerConfig(process.env);
const db = createDb({ connectionString: config.databaseUrl, role: 'booq_worker' });

// F05 P1 alerts (a kind and the club only) go to the redacted log; the failed check is also on the health tile (0699).
const alertLog = createRedactingLogger((line) => process.stderr.write(`${line}\n`));
const paymentAlerts = { p1: (kind: string, clubId: string) => alertLog.error('p1_alert', { source: 'beam_reconcile', kind, clubId }) };

const sweepConsoleSessions = consoleSessionSweep({ db, absoluteSeconds: config.consoleSessionAbsoluteSeconds });
const sweepRateLimit = rateLimitSweep({ db, keepSeconds: config.rateLimitKeepSeconds });

// LINE (F10): the private key that opens club tokens is read once here, so a worker without it stops at start (D149).
const lineSettings = {
  lineApiBaseUrl: config.lineApiBaseUrl,
  lineApiDataBaseUrl: config.lineApiDataBaseUrl,
  linePushTimeoutMs: config.linePushTimeoutMs,
  localesDir: config.localesDir,
  privateKey: loadDecryptKey(),
};
const lineSender = createLineSender(db, lineSettings);
const lineUsage = createLineUsageDeps(lineSettings);
const richMenuDeps = createRichMenuBuildDeps(lineSettings);

const worker = await startWorker({
  connectionString: config.queueUrl,
  db,
  tasks: {
    [IMPORT_STAGING_SWEEP]: sweepImportStaging,
    [PAY_TAP_PRUNE]: prunePayTaps,
    [CLASS_GENERATE]: generateClassSessions,
    // F10-T12: one club's rich menu, added by P2 step 4 Upload and Redo and by an owner's label save.
    [RICH_MENU_BUILD]: richMenuBuildTask(db, richMenuDeps),
  },
  globalTasks: {
    [IMPORT_STAGING_DISPATCH]: importStagingDispatch({ listClubIds: () => listClubIds(db) }),
    [PAY_TAP_PRUNE_DISPATCH]: payTapPruneDispatch({ listClubIds: () => listClubIds(db) }),
    [CLASS_GENERATE_DISPATCH]: classGenerateDispatch({ listClubIds: () => listClubIds(db) }),
    [RATE_LIMIT_SWEEP]: async () => {
      await sweepRateLimit();
    },
    [CONSOLE_SESSION_SWEEP]: async () => {
      await sweepConsoleSessions();
    },
    [PACKAGE_EXPIRE]: async () => {
      await runPackageExpire(db);
    },
    [WALLET_EXPIRE]: async () => {
      await runWalletExpire(db);
    },
    [SESSION_START]: async () => {
      await runSessionStart(db);
    },
    [BEAM_RECONCILE]: async () => {
      await runBeamReconcile(db, { privateKey: () => loadDecryptKey(), gateway: beamGateway, alerts: paymentAlerts });
    },
    [PACKAGE_ORDER_EXPIRY]: async () => {
      await runPackageOrderExpiry(db);
    },
    // F10-T13: LINE's usage figures per club (every 10 minutes) and the daily token check.
    [LINE_USAGE_SYNC]: async () => {
      await runLineUsageSync(db, lineUsage);
    },
    [LINE_HEALTH]: async () => {
      await runLineHealth(db, lineUsage);
    },
    [CLOSURE_ROLL]: async () => {
      await runClosureRoll(db, { listClubIds: () => listClubIds(db) });
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

// offer_expiry and class_below_minimum also run on their own timers (F08-T10).
const offerExpiry = startTicker({ everyMs: config.offerExpiryTickSeconds * 1000, run: () => runOfferExpiry(db), onError: () => undefined });
const classBelowMin = startTicker({ everyMs: config.classBelowMinTickSeconds * 1000, run: () => runClassBelowMinimum(db), onError: () => undefined });
// outbox_sender (F10): LINE messages from the outbox, every config.outboxSenderTickSeconds (design 8: 30 seconds).
const outboxSender = startTicker({ everyMs: config.outboxSenderTickSeconds * 1000, run: () => lineSender.run(), onError: () => undefined });
// connection_check (D167): the console's "Test all again". The worker opens the stored secrets and probes LINE and Beam; same tick and settings as the sender.
const privateKey = loadDecryptKey();
// rich menu build requests (D176): an owner's label save and P2's Upload and Redo; same tick as the sender, like connection_check.
const richMenuRequests = startTicker({ everyMs: config.outboxSenderTickSeconds * 1000, run: () => runRichMenuRequests(db, richMenuDeps), onError: () => undefined });
const connectionCheck = startTicker({
  everyMs: config.outboxSenderTickSeconds * 1000,
  run: () => runConnectionChecks(db, { privateKey, lineApiBaseUrl: config.lineApiBaseUrl, probeTimeoutMs: config.linePushTimeoutMs }),
  onError: () => undefined,
});

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void Promise.all([holdRelease.stop(), offerExpiry.stop(), classBelowMin.stop(), outboxSender.stop(), connectionCheck.stop(), richMenuRequests.stop()]).then(() => worker.stop()).then(() => db.end()).then(() => process.exit(0));
  });
}
