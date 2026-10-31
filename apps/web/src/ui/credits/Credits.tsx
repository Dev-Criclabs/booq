import { formatMoney } from '../../client/format';
import type { Lang, T } from '../../client/i18n';
import { activePackages, amountText, bangkokParts, countLine, reasonKey, type HistoryRow, type OwnCredits } from '../../client/credits';
import { BottomNav } from '../BottomNav';

// C14 Credits and wallet (F06-T18; H-C14-Credits-wallet): the wallet balance with its rule line (P-0224: spent first,
// never cash), the packages with credits left and their expiry, and the history of both ledgers, newest first, each row
// with its reason's own label (PKG-01-AC10, PKG-03-AC3). Amounts are the server's; nothing is added up here.

export interface CreditsProps {
  t: T;
  lang: Lang;
  slug: string;
  credits: OwnCredits;
  history: HistoryRow[];
  more: boolean;
  loadingMore: boolean;
  onMore(): void;
  backHref: string;
}

export function Credits({ t, lang, slug, credits, history, more, loadingMore, onMore, backHref }: CreditsProps) {
  const name = (id: string | null) => {
    const p = credits.packages.find((x) => x.packageId === id);
    return p ? (lang === 'th' ? p.nameTh : p.nameEn) ?? '' : '';
  };
  const unit = (id: string | null) => credits.packages.find((x) => x.packageId === id)?.creditType ?? null;
  const packages = activePackages(credits);
  return (
    <div className="app credits" data-screen="C14">
      <header className="bar">
        <a className="icon-btn" href={backHref} aria-label={t('P-0058')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </a>
        <h1 className="bar-title">{t('P-0223')}</h1>
      </header>
      <main className="cr-body">
        <section className="cr-wallet" data-testid="wallet">
          <span className="cr-label">{t('P-0029')}</span>
          <span className="cr-balance" data-testid="wallet-balance">{formatMoney(lang, credits.walletSatang)}</span>
          <p className="cr-rule">{t('P-0224')}</p>
        </section>

        <section className="cr-section">
          <h2 className="cr-h">{t('P-0027')}</h2>
          {packages.length === 0 ? (
            <p className="cr-empty" data-testid="no-packages">{t('P-new.credits_no_packages')}</p>
          ) : (
            packages.map((p) => (
              <article key={p.packageId} className="cr-pkg" data-testid="package">
                <h3 className="cr-pkg-name">{lang === 'th' ? p.nameTh : p.nameEn}</h3>
                <span className="cr-count" data-testid="count">{countLine(p, t)}</span>
                <span className="cr-expiry">{t('P-0226', { dayMonthYear: bangkokParts(lang, p.expiresAt).dayMonthYear })}</span>
              </article>
            ))
          )}
        </section>

        <section className="cr-section">
          <h2 className="cr-h">{t('P-0229')}</h2>
          {history.length === 0 && !more ? (
            <p className="cr-empty" data-testid="no-history">{t('P-new.credits_no_history')}</p>
          ) : (
            <ul className="cr-list">
              {history.map(({ kind, entry }) => {
                const when = bangkokParts(lang, entry.at);
                const pkg = kind === 'credit' ? name(entry.packageId) : '';
                return (
                  <li key={`${kind}:${entry.id}`} className="cr-row" data-testid="movement" data-kind={kind} data-reason={entry.reason}>
                    <div className="cr-row-main">
                      <span className="cr-reason">{t(reasonKey(kind, entry.reason))}</span>
                      {pkg ? <span className="cr-sub">{pkg}</span> : null}
                      <span className="cr-sub">{t('P-0231', when)}</span>
                    </div>
                    <span className={entry.change >= 0 ? 'cr-amt cr-in' : 'cr-amt cr-out'} data-testid="amount">
                      {amountText(kind, entry.change, unit(entry.packageId), lang, t)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {more ? (
            <button type="button" className="btn btn-ghost cr-more" onClick={onMore} disabled={loadingMore} data-testid="more">
              <span>{t('P-0239')}</span>
            </button>
          ) : null}
        </section>
      </main>
      <BottomNav t={t} slug={slug} current="profile" />
    </div>
  );
}
