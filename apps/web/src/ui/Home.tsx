'use client';
import { clubPath } from '@booq/line';
import type { Lang, T } from '../client/i18n';
import { AddFriendAsk } from './AddFriendAsk';
import { BottomNav } from './BottomNav';
import { LanguageToggle } from './LanguageToggle';

// C3 Home. A guest sees S-C03-Guest (AUTH-01-AC8): Find a court time, the four quick actions, no
// booking card and no credits, with Sign in in the header. Signing in is never needed to browse.
// The signed-in Home (next booking, balances; H-C03-Home) comes with F03 and F06: until then a signed
// in player sees the same quick actions without the guest card and Sign in. The promotion card is
// left out until the club's package data feeds it (F06): its prices are never written in code.

export interface HomeProps {
  t: T;
  lang: Lang;
  onLang(lang: Lang): void;
  slug: string;
  wordmark: string;
  clubName: string;
  dateLong: string;
  greetingKey: string;
  signedIn: boolean;
  signInHref: string;
  friendAsk: { url: string | null; onDismiss(): void } | null;
}

const QUICK = [
  { key: 'P-0024', target: { page: 'book' } as const },
  { key: 'P-0025', target: { page: 'solo_classes' } as const },
  { key: 'P-0026', target: { page: 'group_classes' } as const },
  { key: 'P-0027', target: { page: 'packages' } as const },
];

export function Home(p: HomeProps) {
  const { t, slug } = p;
  const [w1, ...rest] = p.wordmark.trim().split(/\s+/);
  return (
    <div className="app home" data-screen={p.signedIn ? 'C3' : 'C3-guest'}>
      <header className="home-head">
        <div className="home-top">
          <div className="mini-wordmark" lang="en">
            <span className="w1">{w1}</span>
            {rest.length ? <span className="w2">{rest.join(' ')}</span> : null}
          </div>
          <div className="home-top-actions">
            <LanguageToggle t={t} lang={p.lang} onChange={p.onLang} />
            {p.signedIn ? null : (
              <a className="sign-in-link" href={p.signInHref} data-testid="sign-in">
                {t('P-0447')}
              </a>
            )}
          </div>
        </div>
        <p className="home-date">{t('P-0017', { dateLong: p.dateLong })}</p>
        <h1 className="home-greeting">{t(p.greetingKey)}</h1>
      </header>
      <main className="home-body">
        {p.friendAsk ? <AddFriendAsk t={t} clubName={p.clubName} url={p.friendAsk.url} onDismiss={p.friendAsk.onDismiss} /> : null}
        {p.signedIn ? null : (
          <section className="guest-card" data-testid="guest-card">
            <span className="guest-eyebrow">{t('P-0449')}</span>
            <b className="guest-title">{t('P-0450')}</b>
            <p className="guest-text">{t('P-0451')}</p>
            <a className="btn btn-primary" href={clubPath(slug, { page: 'book' })} data-testid="find-court">
              <span>{t('P-0452')}</span>
            </a>
          </section>
        )}
        <div className="quick">
          {QUICK.map((q) => (
            <a key={q.key} href={clubPath(slug, q.target)} className="quick-tile">
              <span>{t(q.key)}</span>
            </a>
          ))}
        </div>
      </main>
      <BottomNav t={t} slug={slug} current="home" />
    </div>
  );
}
