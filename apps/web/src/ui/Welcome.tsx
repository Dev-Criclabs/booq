'use client';
import type { Lang, T } from '../client/i18n';
import { LanguageToggle } from './LanguageToggle';
import { LineIcon } from './LineIcon';
import { Wordmark } from './Wordmark';

// C1 Welcome and LINE sign-in (H-C01-Welcome, T-C01-Welcome; AUTH-01-AC6, LINE-01-AC2, AC6).
// Shown only in a browser; inside LINE sign in is silent. The add-friend choice is LINE's own
// consent screen (LIFF add friend option On (normal), decision D38), so C1 shows a plain note and
// no checkbox: the canvas checkbox is a canvas bug. Keep browsing creates nothing.

export interface WelcomeSlot {
  court: string;
  /** Already formatted for the language (`{date}`: Sat 9 Jan). */
  date: string;
  startTime: string;
  endTime: string;
}

export interface WelcomeProps {
  t: T;
  lang: Lang;
  onLang(lang: Lang): void;
  /** The club's name in the screen language, for P-0003. */
  clubName: string;
  /** The club's English name, the wordmark in both languages. */
  wordmark: string;
  slot: WelcomeSlot | null;
  termsHref: string;
  privacyHref: string;
  busy: boolean;
  onLogin(): void;
  onKeepBrowsing(): void;
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export function Welcome(p: WelcomeProps) {
  const { t } = p;
  return (
    <main className="app welcome" data-screen="C1">
      <div className="welcome-hero">
        <div className="court" aria-hidden="true" />
        <div className="welcome-top">
          <LanguageToggle t={t} lang={p.lang} onChange={p.onLang} />
        </div>
        <Wordmark name={p.wordmark} />
      </div>
      <section className="sheet" aria-labelledby="welcome-title">
        <div>
          <h1 id="welcome-title">{t('P-0001')}</h1>
          {p.slot ? (
            <p className="lead" data-testid="welcome-slot">
              {t('P-0002', { court: p.slot.court, date: p.slot.date, startTime: p.slot.startTime, endTime: p.slot.endTime })}
            </p>
          ) : null}
        </div>
        <p className="note" data-testid="friend-note">
          <BellIcon />
          <span>{t('P-0003', { clubName: p.clubName })}</span>
        </p>
        <button type="button" className="btn btn-line" data-testid="line-login" onClick={p.onLogin} disabled={p.busy}>
          <LineIcon />
          <span>{t('P-0004')}</span>
        </button>
        <button type="button" className="btn btn-ghost" data-testid="keep-browsing" onClick={p.onKeepBrowsing}>
          <span>{t('P-0005')}</span>
        </button>
        <p className="legal">
          {t('P-0006')} <a href={p.termsHref}>{t('P-0007')}</a> {t('P-0008')} <a href={p.privacyHref}>{t('P-0009')}</a>
        </p>
      </section>
    </main>
  );
}
