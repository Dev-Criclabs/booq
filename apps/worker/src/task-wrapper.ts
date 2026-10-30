import type { Db, Tx } from '@booq/db';

// Club-context task wrapper (FA 5, F01-T34). Every worker task that touches club data goes
// through clubTask: the job payload must carry the club id, and the handler runs inside
// withClubTx for that club, so RLS applies exactly as it does for the web app. A payload
// without a valid club id is refused before any database call. Payloads hold ids only.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The payload was refused. Retrying the same payload cannot help. */
export class TaskRefusedError extends Error {
  constructor(reason: string) {
    super(`task refused: ${reason}`);
    this.name = 'TaskRefusedError';
  }
}

export interface TaskHelpers {
  job?: { id?: string | number };
}

export type ClubTaskHandler<P extends { clubId: string }> = (tx: Tx, payload: P) => Promise<void>;

export interface ClubTaskOptions {
  /** The name shown in the audit log for changes the task makes (the task's own name). */
  actorLabel?: string;
}

export function clubTask<P extends { clubId: string }>(db: Db, handler: ClubTaskHandler<P>, options: ClubTaskOptions = {}) {
  return async (payload: unknown, helpers: TaskHelpers): Promise<void> => {
    const clubId = (payload as { clubId?: unknown } | null | undefined)?.clubId;
    if (typeof clubId !== 'string' || !UUID.test(clubId)) throw new TaskRefusedError('the payload has no valid club id');
    const jobId = helpers.job?.id;
    await db.withClubTx(
      {
        clubId,
        userId: null,
        roles: [],
        source: 'job',
        ...(options.actorLabel === undefined ? {} : { actorLabel: options.actorLabel }),
        ...(jobId === undefined ? {} : { requestId: `job:${jobId}` }),
      },
      (tx) => handler(tx, payload as P),
    );
  };
}
