'use client';
import { clubPath } from '@booq/line';
import type { Lang } from '../../client/i18n';
import { useClub, useLiff } from '../../client/use-club';
import { BottomNav } from '../BottomNav';
import { Loading, StateScreen } from '../StateScreen';
import { PersonGate } from './PersonGate';

// The person pages reached from the bottom nav (AUTH-01-AC9). Profile lists its sections (C17; only
// Personal details is built so far). My bookings (C13) is the page shell: its list comes with F03 and
// F09. Both start sign in for a guest and come back here.

export function PersonPageScreen({ slug, initialLang, page }: { slug: string; initialLang: Lang; page: 'profile' | 'bookings' }) {
  const liff = useLiff();
  const { load, t, retry } = useClub(slug, initialLang, liff);
  if (load.state === 'not_found') return <StateScreen t={t} testId="not-found" textKey="P-new.page_not_found" />;
  if (load.state === 'offline') return <StateScreen t={t} offline testId="offline" titleKey="P-0326" textKey="P-0327" actionKey="P-0328" onAction={retry} />;
  if (load.state === 'loading') return <Loading />;
  return (
    <PersonGate slug={slug} t={t}>
      <div className="app person-page" data-screen={page === 'profile' ? 'C17' : 'C13'}>
        <header className="bar">
          <h1 className="bar-title">{t(page === 'profile' ? 'P-0038' : 'P-0037')}</h1>
        </header>
        <main className="form-body">
          {page === 'profile' ? (
            <nav className="list">
              <a className="list-row" href={`${clubPath(slug, { page: 'profile' })}/personal-details`} data-testid="personal-details">
                <span>{t('P-0250')}</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </a>
            </nav>
          ) : null}
        </main>
        <BottomNav t={t} slug={slug} current={page} />
      </div>
    </PersonGate>
  );
}
