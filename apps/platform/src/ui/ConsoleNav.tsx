'use client';
import { signOut } from './auth';
import { t } from './i18n';

// The shell of the signed-in console pages: the sections and Sign out. English only. `current` marks the page the
// person is on (aria-current), so the menu reads right with a screen reader.

export type Section = 'clubs' | 'team' | 'config' | 'legal';
const SECTIONS: Array<{ id: Section; href: string; key: string }> = [
  { id: 'clubs', href: '/clubs', key: 'X-0002' },
  { id: 'team', href: '/staff', key: 'X-new.staff_title' },
  { id: 'config', href: '/config', key: 'X-new.nav_config' },
  { id: 'legal', href: '/legal', key: 'X-new.nav_legal' },
];

export function ConsoleNav({ current }: { current: Section }) {
  async function onSignOut() {
    await signOut(window.fetch.bind(window));
    window.location.replace('/sign-in');
  }
  return (
    <header className="nav">
      <span className="brand">{t('X-0001')}</span>
      <nav aria-label={t('X-new.nav_label')}>
        {SECTIONS.map((s) => (
          <a key={s.id} href={s.href} aria-current={s.id === current ? 'page' : undefined} data-testid={`nav-${s.id}`}>{t(s.key)}</a>
        ))}
      </nav>
      <button type="button" className="btn secondary small" onClick={() => void onSignOut()} data-testid="sign-out">{t('X-new.signout')}</button>
    </header>
  );
}
