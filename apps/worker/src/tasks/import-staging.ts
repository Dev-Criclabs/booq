import type { ClubTaskHandler } from '../task-wrapper';

// Import staging clean-up (F01-T31; PLAT-06-AC10). Runs once per club, inside the club's context:
// app.sweep_import_staging() cancels that club's expired jobs, and the database trigger clears
// their staging rows. The club is never an argument.
export const IMPORT_STAGING_SWEEP = 'import_staging_sweep';

export const sweepImportStaging: ClubTaskHandler<{ clubId: string }> = async (tx) => {
  await tx.query('select app.sweep_import_staging()');
};
