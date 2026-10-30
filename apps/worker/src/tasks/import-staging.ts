import type { ClubTaskHandler } from '../task-wrapper';
import { DEFAULT_JOB_SPEC } from '../policy';
import type { GlobalTask } from '../worker';

// Import staging clean-up (F01-T31; PLAT-06-AC10). Runs once per club, inside the club's context:
// app.sweep_import_staging() cancels that club's expired jobs, and the database trigger clears
// their staging rows. The club is never an argument.
export const IMPORT_STAGING_SWEEP = 'import_staging_sweep';

export const sweepImportStaging: ClubTaskHandler<{ clubId: string }> = async (tx) => {
  await tx.query('select app.sweep_import_staging()');
};

/** The cron line's task: adds one sweep job per club (design 7.4; the sweep itself runs per club). */
export const IMPORT_STAGING_DISPATCH = 'import_staging_dispatch';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DispatchDeps {
  /** Club ids only, from a worker-safe source (no club data). */
  listClubIds(): Promise<string[]>;
}

export function importStagingDispatch(deps: DispatchDeps): GlobalTask {
  return async (_payload, helpers) => {
    const seen = new Set<string>();
    for (const id of await deps.listClubIds()) {
      if (typeof id !== 'string' || !UUID.test(id) || seen.has(id)) continue;
      seen.add(id);
      // One pending sweep per club: a second tick before the first runs replaces it (jobKey).
      await helpers.addJob(IMPORT_STAGING_SWEEP, { clubId: id }, { ...DEFAULT_JOB_SPEC, jobKey: `${IMPORT_STAGING_SWEEP}:${id}` });
    }
  };
}
