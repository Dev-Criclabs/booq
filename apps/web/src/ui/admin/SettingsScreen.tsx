'use client';
import { useCallback, useEffect, useState } from 'react';
import { loadClubSetup, type ClubSetup } from '../../client/admin/club-setup';
import { BUSINESS_KEYS, loadRules, type SettingRow } from '../../client/admin/rules';
import { useAdmin } from './AdminFrame';
import { RulesCards } from './RulesCard';
import { BusinessCard, CourtsCard, HoursCard, SupportCard } from './SettingsBlocks';

// A16 Settings (F11-T22; ADMIN-16; board H-A16-Settings): the owner's own setup in cards (booking rules, payment and waitlist, coaches and classes,
// packages and wallet, opening hours, courts, business and tax, BOOQ support). The Accountant sees the business card, read only (D115). The six rich
// menu tile labels are F10-T15's routes and the data export waits for its storage, so neither is drawn yet.

type Load = { kind: 'loading' } | { kind: 'ready'; setup: ClubSetup; rules: SettingRow[] } | { kind: 'error' } | { kind: 'forbidden' };

export function SettingsScreen() {
  const { slug, t, owner } = useAdmin();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const reload = useCallback(async () => {
    const f = window.fetch.bind(window);
    const [s, r] = await Promise.all([loadClubSetup(slug, f), loadRules(slug, f)]);
    if (s.kind === 'forbidden') return setLoad({ kind: 'forbidden' });
    if (s.kind !== 'ok' || r.kind !== 'ok') return setLoad({ kind: 'error' });
    setLoad({ kind: 'ready', setup: s.body, rules: r.body.filter((x) => !BUSINESS_KEYS.has(x.key)) });
  }, [slug]);
  useEffect(() => {
    void reload();
  }, [reload]);

  if (load.kind === 'loading') return <p aria-busy="true" className="adm-muted">…</p>;
  if (load.kind === 'forbidden') return <p role="alert" data-testid="set-forbidden">{t('A-new.set_forbidden')}</p>;
  if (load.kind === 'error') return <div role="alert" data-testid="set-error"><p>{t('A-new.set_load_failed')}</p><button type="button" className="adm-btn" onClick={() => { setLoad({ kind: 'loading' }); void reload(); }}>{t('A-new.set_retry')}</button></div>;
  const { setup, rules } = load;
  const full = !!setup.hours; // the owner gets hours, courts and the support window as well
  return (
    <div data-testid="settings-page">
      <header className="adm-head"><h1>{t('A-0162')}</h1></header>
      <p className="adm-muted">{t('A-0320')}</p>
      {full && owner ? <RulesCards rows={rules} canEdit onChanged={reload} /> : null}
      {full && owner && setup.hours ? <HoursCard hours={setup.hours} onChanged={reload} /> : null}
      {full && owner && setup.resources ? <CourtsCard courts={setup.resources} locations={setup.locations ?? []} onChanged={reload} /> : null}
      <BusinessCard business={setup.business} canEdit={full && owner} onChanged={reload} />
      {full && owner ? <SupportCard until={setup.supportWindowUntil ?? null} onChanged={reload} /> : null}
    </div>
  );
}
