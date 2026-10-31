'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { adminTranslator } from '../../client/admin/i18n';
import { adminPath, bannersOf, BUILT, GROUP_KEY, isOwnerShell, loadShell, navFor, type ShellLoad } from '../../client/admin/shell';
import { isLang, type Lang } from '../../client/i18n';
import { cookieLang, langCookie } from '../../client/lang';
import { signInPath } from '../../client/paths';
import { LanguageToggle } from '../LanguageToggle';
import { Wordmark } from '../Wordmark';

// The club admin console's shell (F11-T12; ADMIN-01; boards S-A01-Paused, H-A01-Calendar, H-A07-Coaches): the sidebar for the pages
// this person may open, the banners (paused, LINE limit, LINE connection) on every page, and the language toggle. What the person
// may open comes from GET /staff/shell; the page's own routes refuse again (design 4). A guest signs in and comes back here.

type View = { kind: 'loading' } | ShellLoad;

export function AdminFrame({ slug, initialLang, current, children }: { slug: string; initialLang: Lang; current?: string; children?: ReactNode }) {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [lang, setLang] = useState<Lang>(initialLang);
  const [attempt, setAttempt] = useState(0);
  const t = useMemo(() => adminTranslator(lang), [lang]);

  useEffect(() => {
    const fromCookie = cookieLang(document.cookie);
    if (fromCookie) setLang(fromCookie);
  }, []);
  useEffect(() => {
    let live = true;
    void loadShell(slug, window.fetch.bind(window)).then((r) => {
      if (!live) return;
      if (r.kind === 'guest') return window.location.replace(signInPath(slug, window.location.pathname + window.location.search));
      setView(r);
    });
    return () => {
      live = false;
    };
  }, [slug, attempt]);

  const choose = (next: Lang) => {
    if (!isLang(next)) return;
    document.cookie = langCookie(next);
    setLang(next);
  };

  if (view.kind === 'loading' || view.kind === 'guest') return <main className="adm-state" aria-busy="true" data-testid="adm-loading" />;
  if (view.kind !== 'ready') return <Problem kind={view.kind} t={t} onRetry={() => { setView({ kind: 'loading' }); setAttempt((n) => n + 1); }} />;

  const shell = view.shell;
  const club = lang === 'th' ? shell.club.nameTh : shell.club.nameEn;
  const banners = bannersOf(shell, lang);
  return (
    <div className="adm" data-testid="adm">
      <aside className="adm-side">
        <div className="adm-brand"><Wordmark name={shell.club.nameEn} /></div>
        <nav aria-label={t('A-new.shell_nav_label')} data-testid="adm-nav">
          {navFor(shell.pages).map((section) => (
            <div key={section.group} className="adm-group">
              {section.group === 'top' ? null : <p className="adm-group-title">{t(GROUP_KEY[section.group])}</p>}
              <ul>
                {section.items.map((n) => (
                  <li key={n.segment}>
                    {BUILT.has(n.segment) ? (
                      <a href={adminPath(slug, n.segment)} aria-current={current === n.segment ? 'page' : undefined} data-testid={`nav-${n.segment}`}>{t(n.labelKey)}</a>
                    ) : (
                      <span aria-disabled="true" data-testid={`nav-${n.segment}`}>{t(n.labelKey)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="adm-foot"><LanguageToggle t={t} lang={lang} onChange={choose} /></div>
      </aside>
      <div className="adm-main">
        <header className="adm-top"><span className="adm-club" data-testid="adm-club">{club}</span></header>
        {banners.length > 0 ? (
          <div className="adm-banners" data-testid="adm-banners">
            {banners.map((b) => (
              <section key={b.kind} className={`adm-banner adm-banner-${b.kind}`} role="status" data-testid={`banner-${b.kind}`}>
                <div>
                  <p className="adm-banner-title">{t(b.titleKey, b.kind === 'paused' ? b.vars : undefined)}</p>
                  <p className="adm-banner-text">{t(b.textKey)}</p>
                </div>
                {b.kind === 'paused' && isOwnerShell(shell) ? <MessageBooq t={t} /> : null}
              </section>
            ))}
          </div>
        ) : null}
        <main className="adm-content" data-testid="adm-content">
          {children ?? <p className="adm-welcome" data-testid="adm-welcome">{t('A-new.shell_welcome')}</p>}
        </main>
      </div>
    </div>
  );
}

/** "Message BOOQ" opens the LINE chat with the BOOQ team. The address of that chat is BOOQ's, not the club's, and is not in the club's
 *  public config yet: until it is, the button is not shown rather than pointing somewhere invented. */
function MessageBooq({ t }: { t: (k: string) => string }) {
  const href = BOOQ_CHAT_URL;
  return href ? <a className="adm-btn" href={href} data-testid="message-booq">{t('A-0521')}</a> : null;
}
const BOOQ_CHAT_URL: string | null = null;

function Problem({ kind, t, onRetry }: { kind: 'forbidden' | 'not_found' | 'offline'; t: (k: string) => string; onRetry(): void }) {
  return (
    <main className="adm-state" role="alert" data-testid={`adm-${kind}`}>
      <h1>{t(kind === 'forbidden' ? 'A-new.shell_forbidden_title' : kind === 'offline' ? 'P-0326' : 'A-new.shell_club_missing')}</h1>
      {kind === 'forbidden' ? <p>{t('A-new.shell_forbidden_text')}</p> : kind === 'offline' ? <p>{t('P-0327')}</p> : null}
      {kind === 'offline' ? <button type="button" className="adm-btn" onClick={onRetry}>{t('P-0328')}</button> : null}
    </main>
  );
}

