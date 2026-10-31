'use client';
import { useCallback, useEffect, useState } from 'react';
import { loadPricing, type Pricing } from '../../client/admin/pricing';
import { useAdmin } from './AdminFrame';
import { AddOnsCard, CourtPartCard, CourtRateCard, GroupsCard, ProductsCard, TierPricesCard, TiersCard } from './PricingBlocks';

// A9 Products and pricing and A9b Price groups and add-ons (F11-T18; ADMIN-10, ADMIN-11; boards H-A09-Pricing, H-A09b-Pricing-groups): one page with
// the board's tabs. The owner only (price.read); a role the server refuses sees the refusal. Every price is a setting: an empty box is "not set".
// The court part of a solo class is the court rate of the price group (Architect): shown read only on Solo classes with the coaching + court preview.

const TABS = [
  { id: 'courts', key: 'A-0226' }, { id: 'solo', key: 'A-0227' }, { id: 'group', key: 'A-0159' }, { id: 'tiers', key: 'A-0228' }, { id: 'groups', key: 'A-0229' },
] as const;
type TabId = (typeof TABS)[number]['id'];
type Load = { kind: 'loading' } | { kind: 'ready'; data: Pricing } | { kind: 'error' } | { kind: 'forbidden' };

export function PricingScreen() {
  const { slug, t } = useAdmin();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [tab, setTab] = useState<TabId>('courts');
  const reload = useCallback(async () => {
    const r = await loadPricing(slug, window.fetch.bind(window));
    if (r.kind === 'forbidden') return setLoad({ kind: 'forbidden' });
    setLoad(r.kind === 'ok' ? { kind: 'ready', data: r.body } : { kind: 'error' });
  }, [slug]);
  useEffect(() => {
    void reload();
  }, [reload]);

  if (load.kind === 'loading') return <p aria-busy="true" className="adm-muted">…</p>;
  if (load.kind === 'forbidden') return <p role="alert" data-testid="price-forbidden">{t('A-new.price_err_forbidden')}</p>;
  if (load.kind === 'error') return <div role="alert" data-testid="price-error"><p>{t('A-new.price_load_failed')}</p><button type="button" className="adm-btn" onClick={() => { setLoad({ kind: 'loading' }); void reload(); }}>{t('A-new.set_retry')}</button></div>;
  const { data } = load;
  return (
    <div data-testid="pricing-page">
      <header className="adm-head"><h1>{t('A-0160')}</h1></header>
      <p className="adm-muted">{t('A-0225')}</p>
      <div role="tablist" aria-label={t('A-new.price_tabs_label')} className="adm-tabs">
        {TABS.map((x) => <button key={x.id} role="tab" type="button" aria-selected={tab === x.id} onClick={() => setTab(x.id)} data-testid={`tab-${x.id}`}>{t(x.key)}</button>)}
      </div>
      {tab === 'courts' ? <><CourtRateCard data={data} onChanged={reload} /><ProductsCard type="court_hour" data={data} onChanged={reload} /></> : null}
      {tab === 'solo' ? <><TierPricesCard data={data} onChanged={reload} /><CourtPartCard data={data} onGoCourts={() => setTab('courts')} /><ProductsCard type="solo_class" data={data} onChanged={reload} /></> : null}
      {tab === 'group' ? <ProductsCard type="group_session" data={data} onChanged={reload} /> : null}
      {tab === 'tiers' ? <TiersCard data={data} onChanged={reload} /> : null}
      {tab === 'groups' ? <><GroupsCard data={data} onChanged={reload} /><AddOnsCard data={data} onChanged={reload} /></> : null}
    </div>
  );
}
