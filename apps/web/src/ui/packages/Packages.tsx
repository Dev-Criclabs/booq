import { useEffect, useRef } from 'react';
import type { Lang, T } from '../../client/i18n';
import { buyPath, card, productsOf, TABS, type PublicProduct, type Tab } from '../../client/packages';
import { BottomNav } from '../BottomNav';

// C9 Packages (F06-T17; H-C09, H-C09b, H-C09c): three tabs, one card per product with its validity, price, price per
// credit, saving when the server has one (D173) and Buy (C10P). Only what GET /packages offers is shown (PKG-02-AC7, AC8).
// Thai runs longer: card text wraps, the price keeps its own line and Buy never wraps (CC-5).

export interface PackagesProps {
  t: T;
  lang: Lang;
  slug: string;
  products: readonly PublicProduct[];
  tab: Tab;
  onTab(tab: Tab): void;
}

export function Packages({ t, lang, slug, products, tab, onTab }: PackagesProps) {
  const shown = productsOf(products, tab).map((p) => card(p, lang, t));
  const tabs = useRef<HTMLDivElement>(null);
  // The chosen tab is kept in view: in Thai at 320 px the strip is wider than the screen.
  useEffect(() => {
    tabs.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab]);
  return (
    <div className="app packages" data-screen="C9">
      <header className="bar">
        <h1 className="bar-title">{t('P-0027')}</h1>
      </header>
      <div className="pk-tabs" role="tablist" ref={tabs}>
        {TABS.map((x) => (
          <button key={x.tab} type="button" role="tab" className="pk-tab" aria-selected={x.tab === tab} data-testid={`tab-${x.tab}`} onClick={() => onTab(x.tab)}>
            <span>{t(x.key)}</span>
          </button>
        ))}
      </div>
      <main className="pk-body" role="tabpanel" data-testid={`panel-${tab}`}>
        {shown.length === 0 ? (
          <p className="pk-empty" data-testid="none">{t('P-new.packages_none')}</p>
        ) : (
          shown.map((c) => (
            <article key={c.productId} className="pk-card" data-testid="product">
              <h2 className="pk-name">{c.name}</h2>
              {c.group ? <span className="pk-group" data-testid="group">{c.group}</span> : null}
              <p className="pk-detail">{c.detail}</p>
              <div className="pk-price-row">
                <div className="pk-prices">
                  <span className="pk-price" data-testid="price">{c.price}</span>
                  <span className="pk-per">{c.perCredit}</span>
                </div>
                {c.saving ? <span className="pk-save" data-testid="saving">{c.saving}</span> : null}
              </div>
              <a className="btn btn-primary pk-buy" href={buyPath(slug, c.productId)} data-testid="buy">
                <span>{t('P-0190')}</span>
              </a>
            </article>
          ))
        )}
      </main>
      <BottomNav t={t} slug={slug} current="home" />
    </div>
  );
}
