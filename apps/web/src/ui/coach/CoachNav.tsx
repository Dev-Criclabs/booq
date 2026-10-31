import type { T } from '../../client/i18n';

// The coach portal's bottom bar (boards H-K1 to H-K6: Today, Schedule, Availability, Leave, Earnings; keys K-0002, K-0019 to K-0022).
export type CoachTab = 'today' | 'schedule' | 'availability' | 'leave' | 'earnings';
const TABS: readonly { tab: CoachTab; key: string; path: string; icon: string }[] = [
  { tab: 'today', key: 'K-0002', path: '', icon: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' },
  { tab: 'schedule', key: 'K-0019', path: '/schedule', icon: 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM16 2v4M8 2v4M3 10h18' },
  { tab: 'availability', key: 'K-0020', path: '/availability', icon: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zM12 6v6l4 2' },
  { tab: 'leave', key: 'K-0021', path: '/leave', icon: 'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z' },
  { tab: 'earnings', key: 'K-0022', path: '/earnings', icon: 'M2 7h20v10H2zM12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM6 12h.01M18 12h.01' },
];

export const coachPath = (slug: string, sub = '') => `/c/${slug}/coach${sub}`;

export function CoachNav({ t, slug, current }: { t: T; slug: string; current: CoachTab }) {
  return (
    <nav className="bottom-nav coach-nav">
      {TABS.map((x) => (
        <a key={x.tab} href={coachPath(slug, x.path)} aria-current={x.tab === current ? 'page' : undefined} data-testid={`nav-${x.tab}`}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d={x.icon} />
          </svg>
          <span>{t(x.key)}</span>
        </a>
      ))}
    </nav>
  );
}
