'use client';
import { useEffect, useState } from 'react';
import { signOut } from './auth';
import { t } from './i18n';

// The side menu of the signed-in console pages (board P1 and the others): the sections, who is signed in with their role, and
// Sign out. English only. `current` marks the page the person is on (aria-current). The name and role come from GET /auth/me; if
// that is not available the menu still works without them.

export type Section = 'clubs' | 'team' | 'config' | 'legal';
const SECTIONS: Array<{ id: Section; href: string; key: string }> = [
  { id: 'clubs', href: '/clubs', key: 'X-0002' },
  { id: 'team', href: '/staff', key: 'X-new.staff_title' },
  { id: 'config', href: '/config', key: 'X-new.nav_config' },
  { id: 'legal', href: '/legal', key: 'X-new.nav_legal' },
];
const ROLE_KEY: Record<string, string> = { platform_admin: 'X-0006', onboarding_specialist: 'X-0267' };

export function ConsoleNav({ current }: { current: Section }) {
  const [me, setMe] = useState<{ displayName: string; role: string } | null>(null);
  useEffect(() => {
    let live = true;
    void window
      .fetch('/api/auth/me')
      .then(async (res) => (res.status === 200 ? ((await res.json()) as { displayName?: string; role?: string }) : null))
      .then((j) => live && j && typeof j.displayName === 'string' && typeof j.role === 'string' && setMe({ displayName: j.displayName, role: j.role }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  async function onSignOut() {
    await signOut(window.fetch.bind(window));
    window.location.replace('/sign-in');
  }
  return (
    <aside className="side">
      <div className="brand">
        <strong>BOOQ</strong>
        <span>{t('X-0001')}</span>
      </div>
      <nav aria-label={t('X-new.nav_label')}>
        {SECTIONS.map((s) => (
          <a key={s.id} href={s.href} aria-current={s.id === current ? 'page' : undefined} data-testid={`nav-${s.id}`}>{t(s.key)}</a>
        ))}
      </nav>
      <div className="me">
        {me ? (
          <div data-testid="me">
            <strong>{me.displayName}</strong>
            <span>{ROLE_KEY[me.role] ? t(ROLE_KEY[me.role]!) : ''}</span>
          </div>
        ) : null}
        <button type="button" className="btn secondary small" onClick={() => void onSignOut()} data-testid="sign-out">{t('X-new.signout')}</button>
      </div>
    </aside>
  );
}
