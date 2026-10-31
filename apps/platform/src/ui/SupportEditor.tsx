'use client';
import { useEffect, useState, type FormEvent } from 'react';
import type { Failure, SupportSetup } from './club';
import { t } from './i18n';
import { COURT_TYPES, courtDraft, courtsPatch, featuresPatch, hoursDraft, hoursPatch, newCourt, saveSection, SPORTS, WEEKDAYS, type CourtDraft, type HoursDraft } from './support-edit';

// The support view's editing (P3b), for a club that BOOQ may change: opening hours, courts and switches. Each part is saved on its
// own and only what changed is sent. A court is switched off, not deleted, and a new court goes into the club's first location.
// Club settings cannot be changed here yet. English only; text by key.

export function SupportEditor({ id, support, busy, onSaved, onError }: { id: string; support: SupportSetup; busy: boolean; onSaved(): Promise<void>; onError(key: string): void }) {
  const [hours, setHours] = useState<HoursDraft>(() => hoursDraft(support.hours));
  const [courts, setCourts] = useState<Record<string, CourtDraft>>(() => Object.fromEntries(support.resources.map((r) => [r.id, courtDraft(r)])));
  const [features, setFeatures] = useState<Record<string, boolean>>(() => Object.fromEntries(support.features.map((f) => [f.feature_key, f.enabled])));
  const [fresh, setFresh] = useState({ name: '', sport: 'tennis' });
  const [problem, setProblem] = useState<{ part: 'hours' | 'courts' | 'new'; key: string; where?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // A reload after a save brings new data; the drafts start from it.
  useEffect(() => {
    setHours(hoursDraft(support.hours));
    setCourts(Object.fromEntries(support.resources.map((r) => [r.id, courtDraft(r)])));
    setFeatures(Object.fromEntries(support.features.map((f) => [f.feature_key, f.enabled])));
  }, [support]);

  async function send(section: 'resources-hours' | 'features', body: unknown) {
    setSaving(true);
    const r = await saveSection(window.fetch.bind(window), id, section, body);
    setSaving(false);
    if (r.kind === 'error') return onError((r as Failure).key);
    setProblem(null);
    await onSaved();
  }

  function onSaveHours(e: FormEvent) {
    e.preventDefault();
    const p = hoursPatch(hoursDraft(support.hours), hours);
    if (!p.ok) return setProblem({ part: 'hours', key: p.key, where: t(`X-new.weekday_${p.weekday}`) });
    if (p.hours.length === 0) return setProblem({ part: 'hours', key: 'X-new.support_court_none_changed' });
    void send('resources-hours', { hours: p.hours });
  }
  function onSaveCourts(e: FormEvent) {
    e.preventDefault();
    const p = courtsPatch(Object.fromEntries(support.resources.map((r) => [r.id, courtDraft(r)])), courts);
    if (!p.ok) return setProblem({ part: 'courts', key: p.key, where: courts[p.id]?.name ?? '' });
    if (p.resources.length === 0) return setProblem({ part: 'courts', key: 'X-new.support_court_none_changed' });
    void send('resources-hours', { resources: p.resources });
  }
  function onAddCourt(e: FormEvent) {
    e.preventDefault();
    const c = newCourt(support.locations, fresh);
    if (!c.ok) return setProblem({ part: 'new', key: c.key });
    setFresh({ name: '', sport: fresh.sport });
    void send('resources-hours', { resources: [c.resource] });
  }
  function onSaveFeatures(e: FormEvent) {
    e.preventDefault();
    const changed = featuresPatch(Object.fromEntries(support.features.map((f) => [f.feature_key, f.enabled])), features);
    if (Object.keys(changed).length === 0) return setProblem({ part: 'courts', key: 'X-new.support_court_none_changed' });
    void send('features', { features: changed });
  }

  const off = busy || saving;
  const say = (part: 'hours' | 'courts' | 'new') => (problem?.part === part ? <p role="alert" className="error" data-testid={`support-problem-${part}`}>{t(problem.key)}{problem.where ? ` (${problem.where})` : ''}</p> : null);

  return (
    <div data-testid="support-editor">
      <p className="sub">{t('X-new.support_edit_hint')}</p>

      <h3>{t('X-new.support_hours')}</h3>
      <form onSubmit={onSaveHours} className="form" data-testid="hours-form" noValidate>
        <p className="sub">{t('X-new.support_hours_hint')}</p>
        {WEEKDAYS.map((d) => (
          <div key={d} className="hours-row">
            <span className="day">{t(`X-new.weekday_${d}`)}</span>
            <label className="sr-only" htmlFor={`h-${d}-open`}>{t(`X-new.weekday_${d}`)} {t('X-new.support_hours_open')}</label>
            <input id={`h-${d}-open`} inputMode="numeric" placeholder="06:00" value={hours[d]!.open} onChange={(e) => setHours({ ...hours, [d]: { ...hours[d]!, open: e.target.value } })} />
            <label className="sr-only" htmlFor={`h-${d}-close`}>{t(`X-new.weekday_${d}`)} {t('X-new.support_hours_close')}</label>
            <input id={`h-${d}-close`} inputMode="numeric" placeholder="24:00" value={hours[d]!.close} onChange={(e) => setHours({ ...hours, [d]: { ...hours[d]!, close: e.target.value } })} />
          </div>
        ))}
        {say('hours')}
        <button type="submit" className="btn" disabled={off} data-testid="save-hours">{t('X-new.support_save_hours')}</button>
      </form>

      <h3>{t('X-new.support_courts')}</h3>
      <form onSubmit={onSaveCourts} className="form" data-testid="courts-form" noValidate>
        {support.resources.length === 0 ? <p>{t('X-new.support_none')}</p> : null}
        {support.resources.map((r) => {
          const c = courts[r.id];
          if (!c) return null;
          const set = (patch: Partial<CourtDraft>) => setCourts({ ...courts, [r.id]: { ...c, ...patch } });
          return (
            <fieldset key={r.id} className="notice" data-testid={`court-${r.id}`}>
              <legend>{r.name}</legend>
              <div className="field"><label htmlFor={`c-${r.id}-name`}>{t('X-new.support_court_name')}</label><input id={`c-${r.id}-name`} value={c.name} onChange={(e) => set({ name: e.target.value })} /></div>
              <div className="field">
                <label htmlFor={`c-${r.id}-sport`}>{t('X-new.support_court_sport')}</label>
                <select id={`c-${r.id}-sport`} value={c.sport} onChange={(e) => set({ sport: e.target.value })}>
                  {(SPORTS as readonly string[]).includes(c.sport) ? null : <option value={c.sport}>{c.sport}</option>}
                  {SPORTS.map((s) => <option key={s} value={s}>{t(`X-new.support_sport_${s}`)}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`c-${r.id}-type`}>{t('X-new.support_court_type')}</label>
                <select id={`c-${r.id}-type`} value={c.type} onChange={(e) => set({ type: e.target.value })}>
                  <option value="">{t('X-new.support_court_any')}</option>
                  {COURT_TYPES.map((x) => <option key={x} value={x}>{t(`X-new.support_court_${x}`)}</option>)}
                </select>
              </div>
              <div className="field"><label htmlFor={`c-${r.id}-players`}>{t('X-new.support_court_players')}</label><input id={`c-${r.id}-players`} inputMode="numeric" value={c.max_players} onChange={(e) => set({ max_players: e.target.value })} /></div>
              <label className="check"><input type="checkbox" checked={c.lights} onChange={(e) => set({ lights: e.target.checked })} /> {t('X-new.support_court_lights')}</label>
              <label className="check"><input type="checkbox" checked={c.active} onChange={(e) => set({ active: e.target.checked })} /> {t('X-new.support_court_active')}</label>
            </fieldset>
          );
        })}
        {say('courts')}
        {support.resources.length > 0 ? <button type="submit" className="btn" disabled={off} data-testid="save-courts">{t('X-new.support_save_courts')}</button> : null}
      </form>

      <form onSubmit={onAddCourt} className="form" data-testid="add-court-form" noValidate>
        <div className="field"><label htmlFor="new-court-name">{t('X-new.support_court_name')}</label><input id="new-court-name" value={fresh.name} onChange={(e) => setFresh({ ...fresh, name: e.target.value })} /></div>
        <div className="field">
          <label htmlFor="new-court-sport">{t('X-new.support_court_sport')}</label>
          <select id="new-court-sport" value={fresh.sport} onChange={(e) => setFresh({ ...fresh, sport: e.target.value })}>
            {SPORTS.map((s) => <option key={s} value={s}>{t(`X-new.support_sport_${s}`)}</option>)}
          </select>
        </div>
        {say('new')}
        <button type="submit" className="btn secondary" disabled={off} data-testid="add-court">{t('X-new.support_add_court')}</button>
      </form>

      <h3>{t('X-new.support_features')}</h3>
      <form onSubmit={onSaveFeatures} className="form" data-testid="features-form" noValidate>
        {support.features.length === 0 ? <p>{t('X-new.support_none')}</p> : null}
        {support.features.map((f) => (
          <label key={f.feature_key} className="check"><input type="checkbox" checked={features[f.feature_key] ?? false} onChange={(e) => setFeatures({ ...features, [f.feature_key]: e.target.checked })} data-testid={`feature-${f.feature_key}`} /> {f.feature_key}</label>
        ))}
        {support.features.length > 0 ? <button type="submit" className="btn" disabled={off} data-testid="save-features">{t('X-new.support_save_features')}</button> : null}
      </form>

      <h3>{t('X-new.support_settings')}</h3>
      <p className="sub">{t('X-new.support_settings_note')}</p>
    </div>
  );
}
