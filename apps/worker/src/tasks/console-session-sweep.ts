import type { Db } from '@booq/db';

// console_session_sweep (migrations 0051 and 0056). Deletes console sign-in challenges that expired, sessions older than the
// absolute limit, login states with nothing to remember, and staff enrolment links that expired or were used that long ago. The function reads and returns no club data, so the
// task runs in the system context. The limit comes from worker config and must not be shorter than the console's own.
export const CONSOLE_SESSION_SWEEP = 'console_session_sweep';

const SYSTEM_CONTEXT = { clubId: '00000000-0000-0000-0000-000000000000', userId: null, roles: [], source: 'job', actorLabel: CONSOLE_SESSION_SWEEP } as const;

/** `db` must connect as booq_worker. Returns how many rows were removed. */
export function consoleSessionSweep(options: { db: Db; absoluteSeconds: number }): () => Promise<number> {
  if (!Number.isInteger(options.absoluteSeconds) || options.absoluteSeconds < 1) throw new Error('console session sweep: absoluteSeconds must be a whole number above zero');
  return async () => {
    return options.db.withClubTx(SYSTEM_CONTEXT, async (tx) => {
      const sessions = await tx.query<{ n: number }>('select app.sweep_console_sessions($1) as n', [options.absoluteSeconds]);
      const links = await tx.query<{ n: number }>('select app.sweep_staff_enrolments($1) as n', [options.absoluteSeconds]);
      return (sessions.rows[0]?.n ?? 0) + (links.rows[0]?.n ?? 0);
    });
  };
}
