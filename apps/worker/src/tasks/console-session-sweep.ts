import type { Db } from '@booq/db';

// console_session_sweep (migration 0051). Deletes console sign-in challenges that expired, sessions older than the
// absolute limit, and login states with nothing to remember. The function reads and returns no club data, so the
// task runs in the system context. The limit comes from worker config and must not be shorter than the console's own.
export const CONSOLE_SESSION_SWEEP = 'console_session_sweep';

const SYSTEM_CONTEXT = { clubId: '00000000-0000-0000-0000-000000000000', userId: null, roles: [], source: 'job', actorLabel: CONSOLE_SESSION_SWEEP } as const;

/** `db` must connect as booq_worker. Returns how many rows were removed. */
export function consoleSessionSweep(options: { db: Db; absoluteSeconds: number }): () => Promise<number> {
  if (!Number.isInteger(options.absoluteSeconds) || options.absoluteSeconds < 1) throw new Error('console session sweep: absoluteSeconds must be a whole number above zero');
  return async () => {
    const r = await options.db.withClubTx(SYSTEM_CONTEXT, (tx) => tx.query<{ n: number }>('select app.sweep_console_sessions($1) as n', [options.absoluteSeconds]));
    return r.rows[0]?.n ?? 0;
  };
}
