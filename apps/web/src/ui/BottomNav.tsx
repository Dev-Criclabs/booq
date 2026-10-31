import { clubPath, type PlayerPage } from '@booq/line/src/links/deep-link';
import type { T } from '../client/i18n';

// The player app's bottom navigation (canvas: Home, Courts, Classes, Bookings, Profile; P-0034 to
// P-0038). Every link is built from the one page list, so it always carries the club (D6).

export type NavTab = 'home' | 'courts' | 'classes' | 'bookings' | 'profile';
const TABS: readonly { tab: NavTab; key: string; target: PlayerPage; icon: string }[] = [
  { tab: 'home', key: 'P-0034', target: { page: 'home' }, icon: 'm3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10' },
  { tab: 'courts', key: 'P-0035', target: { page: 'book' }, icon: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM12 5v14M3 12h18' },
  { tab: 'classes', key: 'P-0036', target: { page: 'solo_classes' }, icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
  { tab: 'bookings', key: 'P-0037', target: { page: 'bookings' }, icon: 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM16 2v4M8 2v4M3 10h18M9 16l2 2 4-4' },
  { tab: 'profile', key: 'P-0038', target: { page: 'profile' }, icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8z' },
];

export function BottomNav({ t, slug, current }: { t: T; slug: string; current: NavTab }) {
  return (
    <nav className="bottom-nav">
      {TABS.map((x) => (
        <a key={x.tab} href={clubPath(slug, x.target)} aria-current={x.tab === current ? 'page' : undefined}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d={x.icon} />
          </svg>
          <span>{t(x.key)}</span>
        </a>
      ))}
    </nav>
  );
}
