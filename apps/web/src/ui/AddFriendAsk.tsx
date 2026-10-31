'use client';
import type { T } from '../client/i18n';

// The in-app ask to add the club's Official Account (LINE-01-AC8, AC9; D9). Shown to a known
// non-friend at most once per session; it never blocks anything. With the Official Account's basic id
// it opens LINE's add-friend page; without it the ask is the note alone.
export function AddFriendAsk({ t, clubName, url, onDismiss }: { t: T; clubName: string; url: string | null; onDismiss(): void }) {
  return (
    <aside className="friend-ask" data-testid="friend-ask" role="note">
      <p>{t('P-0003', { clubName })}</p>
      <div className="friend-ask-actions">
        {url ? (
          <a className="btn btn-line btn-small" href={url} target="_blank" rel="noopener" onClick={onDismiss}>
            <span>{t('P-new.add_friend_button')}</span>
          </a>
        ) : null}
        <button type="button" className="btn btn-ghost btn-small" data-testid="friend-ask-dismiss" onClick={onDismiss}>
          <span>{t('P-new.not_now')}</span>
        </button>
      </div>
    </aside>
  );
}
