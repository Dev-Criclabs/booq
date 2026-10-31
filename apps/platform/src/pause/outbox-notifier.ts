import type { PlatformDb } from '@booq/db';
import type { OwnerNotifier } from './pause';

// The owner's LINE message on a pause (PLAT-03-AC1, LINE-05-AC14), through F10's outbox by platform.enqueue_owner_message
// (migration 0058). The staff member who paused is the actor of the transaction. A resume has no kind in F10's catalogue yet,
// so it refuses and the pause service logs club.owner_notice_failed; the status change stands either way.
const KIND = { club_paused: 'owner_paused' } as const;

export function createOutboxOwnerNotifier(deps: { db: PlatformDb }): OwnerNotifier {
  return {
    async notifyOwner(notice) {
      const kind = KIND[notice.kind as keyof typeof KIND];
      if (!kind || !notice.dedupeKey) throw new Error(`owner_message:no_kind:${notice.kind}`);
      if (!notice.actor) throw new Error('owner_message:no_actor');
      await deps.db.withPlatformTx(notice.actor, (tx) => tx.query('select platform.enqueue_owner_message($1, $2, $3)', [notice.clubId, kind, notice.dedupeKey]));
    },
  };
}
