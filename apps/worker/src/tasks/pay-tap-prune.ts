import type { ClubTaskHandler } from '../task-wrapper';
import { DEFAULT_JOB_SPEC } from '../policy';
import type { GlobalTask } from '../worker';

// Pay tap housekeeping (F03-T12; D61; F03 design 4.8). Runs once per club, inside the club's context:
// app.prune_pay_taps() drops that club's attempts that have left the limit's window (all of them while
// the limit is unset), since they no longer count. The club is never an argument.
export const PAY_TAP_PRUNE = 'pay_tap_prune';

export const prunePayTaps: ClubTaskHandler<{ clubId: string }> = async (tx) => {
  await tx.query('select app.prune_pay_taps()');
};

/** The cron line's task: adds one prune job per club, as the import staging dispatch does. */
export const PAY_TAP_PRUNE_DISPATCH = 'pay_tap_prune_dispatch';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function payTapPruneDispatch(deps: { listClubIds(): Promise<string[]> }): GlobalTask {
  return async (_payload, helpers) => {
    const seen = new Set<string>();
    for (const id of await deps.listClubIds()) {
      if (typeof id !== 'string' || !UUID.test(id) || seen.has(id)) continue;
      seen.add(id);
      await helpers.addJob(PAY_TAP_PRUNE, { clubId: id }, { ...DEFAULT_JOB_SPEC, jobKey: `${PAY_TAP_PRUNE}:${id}` });
    }
  };
}
