import type { ClubTaskHandler } from '../task-wrapper';
import { DEFAULT_JOB_SPEC } from '../policy';
import type { GlobalTask } from '../worker';

// class_generate (F08-T10; CLASS-01-AC2, AC3, AC9; F08 design 4.2). Once a day just after Bangkok midnight (the cron is the
// deployment's WORKER_CLASS_GENERATE_CRON) it makes the sessions of the club's active templates for the booking window, in the
// club's own context. A session whose court or coach cannot be claimed is stored as needs_attention with its reason, never
// skipped. A rerun creates nothing twice (unique template and start). The club is never an argument.
export const CLASS_GENERATE = 'class_generate';

export interface ClassGenerateResult {
  made: number;
  needs_attention: number;
  skipped: boolean;
}

export const generateClassSessions: ClubTaskHandler<{ clubId: string }> = async (tx) => {
  await tx.query<{ r: ClassGenerateResult }>('select app.generate_sessions_window() as r');
};

/** The cron line's task: adds one generation job per club, as the Pay tap prune dispatch does. */
export const CLASS_GENERATE_DISPATCH = 'class_generate_dispatch';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function classGenerateDispatch(deps: { listClubIds(): Promise<string[]> }): GlobalTask {
  return async (_payload, helpers) => {
    const seen = new Set<string>();
    for (const id of await deps.listClubIds()) {
      if (typeof id !== 'string' || !UUID.test(id) || seen.has(id)) continue;
      seen.add(id);
      await helpers.addJob(CLASS_GENERATE, { clubId: id }, { ...DEFAULT_JOB_SPEC, jobKey: `${CLASS_GENERATE}:${id}` });
    }
  };
}
