import type { Db } from '@booq/db';

// The club ids the dispatcher fans out over. A worker cannot read the club table without a club
// in its context, so the ids come from app.worker_club_ids(): a definer function granted to
// booq_worker that returns the ids of Live and Paused clubs and nothing else (requested from the
// Architect; migration pending). It runs in the same system context as the heartbeat (nil club id).
const SYSTEM_CONTEXT = { clubId: '00000000-0000-0000-0000-000000000000', userId: null, roles: [] } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listClubIds(db: Db): Promise<string[]> {
  const res = await db.withClubTx(SYSTEM_CONTEXT, (tx) => tx.query<{ id: unknown }>('select id from app.worker_club_ids() as t(id)'));
  return res.rows.map((r) => r.id).filter((id): id is string => typeof id === 'string' && UUID.test(id));
}
