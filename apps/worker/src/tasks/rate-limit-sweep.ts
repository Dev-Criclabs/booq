import type { Db } from '@booq/db';

// rate_limit_sweep (orchestrator request; migration 0027). Deletes the sign-in rate-limit windows that are older
// than the keep time, in every club. app.sweep_rate_limit reads and returns no club data, so the task runs in
// the system context. Scheduled like the other sweeps; the keep time comes from worker config.
export const RATE_LIMIT_SWEEP = 'rate_limit_sweep';

const SYSTEM_CONTEXT = { clubId: '00000000-0000-0000-0000-000000000000', userId: null, roles: [], source: 'job', actorLabel: RATE_LIMIT_SWEEP } as const;

/** `db` must connect as booq_worker. Returns how many counters were removed. */
export function rateLimitSweep(options: { db: Db; keepSeconds: number }): () => Promise<number> {
  if (!Number.isInteger(options.keepSeconds) || options.keepSeconds < 1) throw new Error('rate limit sweep: keepSeconds must be a whole number above zero');
  return async () => {
    const r = await options.db.withClubTx(SYSTEM_CONTEXT, (tx) => tx.query<{ n: number }>('select app.sweep_rate_limit($1) as n', [options.keepSeconds]));
    return r.rows[0]?.n ?? 0;
  };
}
