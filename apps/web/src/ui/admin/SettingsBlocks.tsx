'use client';
import { useEffect, useState, type FormEvent } from 'react';
import {
  addCourt, businessDraft, businessPatch, checkCourt, COURT_TYPES, courtChanges, courtDraft, hoursDraft, hoursPatch, saveBusiness, saveCourt, saveHours, setErrorKey, setSupportWindow, SPORTS, WEEKDAYS, windowOpen,
  type Business, type BusinessDraft, type ClubSetup, type Court, type CourtDraft, type HoursDraft,
} from '../../client/admin/club-setup';
import { dayMonthOf } from '../../client/admin/shell';
import { timeOf } from '../../client/admin/time';
import { useAdmin } from './AdminFrame';

// A16 Settings (F11-T22; ADMIN-16; board H-A16-Settings): the cards that change the club's own setup. Each card saves on its own, sends only what
// changed and keeps what was typed when the server refuses. Only the owner changes anything; the accountant reads the business card. Every change
// is audited by the server with the owner as actor.

type Msg = { key: string; error: boolean; vars?: Record<string, string | number> } | null;
const Say = ({ m }: { m: Msg }) => {
  const { t } = useAdmin();
  return m ? <p role={m.error ? 'alert' : 'status'} className={m.error ? 'adm-error' : 'adm-ok'} data-testid="set-msg">{t(m.key, m.vars)}</p> : null;
};

export function BusinessCard({ business, canEdit, onChanged }: { business: Business; canEdit: boolean; onChanged(): Promise<void> }) {
  const { slug, t } = useAdmin();
  const [draft, setDraft] = useState<BusinessDraft>(() => businessDraft(business));
  const [msg, setMsg] = useState<Msg>(null);
  const [bad, setBad] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(businessDraft(business)), [business]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const p = businessPatch(businessDraft(business), draft);
    if (!p.ok) { setBad(p.field); return setMsg({ key: p.key, error: true }); }
    setBad(null);
    setBusy(true);
    const r = await saveBusiness(slug, p.body, window.fetch.bind(window));
    setBusy(false);
    if (r.kind !== 'ok') return setMsg({ key: setErrorKey(r), error: true });
    setMsg({ key: 'A-new.set_saved', error: false });
    await onChanged();
  }
  const text = (f: 'legal_name' | 'tax_id' | 'tax_branch' | 'registered_address', labelKey: string) => (
    <label className="adm-field" key={f}>
      <span>{t(labelKey)}</span>
      <input value={draft[f]} readOnly={!canEdit} aria-invalid={bad === f} onChange={(e) => setDraft({ ...draft, [f]: e.target.value })} data-testid={`biz-${f}`} />
    </label>
  );
  return (
    <section className="adm-card" aria-labelledby="set-business" data-testid="set-business">
      <h2 id="set-business">{t('A-0354')}</h2>
      {!canEdit ? <p className="adm-muted">{t('A-new.set_readonly_note')}</p> : null}
      <form onSubmit={(e) => void submit(e)} className="adm-form">
        {text('legal_name', 'A-0355')}
        {text('tax_id', 'A-new.set_business_tax_id')}
        {text('tax_branch', 'A-new.set_business_branch')}
        {text('registered_address', 'A-0358')}
        <label className="adm-field">
          <span>{t('A-new.set_business_prefix')}</span>
          <input value={business.receipt_prefix ?? ''} readOnly aria-readonly="true" data-testid="biz-receipt_prefix" />
          <span className="adm-muted">{t('A-new.set_business_prefix_note')}</span>
        </label>
        <label className="adm-field">
          <span>{t('A-0359')}</span>
          <select value={draft.vat} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, vat: e.target.value as BusinessDraft['vat'] })} data-testid="biz-vat">
            <option value="">{t('A-new.set_not_set')}</option>
            <option value="off">{t('A-new.set_vat_off')}</option>
            <option value="on">{t('A-new.set_vat_on')}</option>
          </select>
          <span className="adm-muted">{t('A-0360')}</span>
        </label>
        <Say m={msg} />
        {canEdit ? <button type="submit" className="adm-btn" disabled={busy} data-testid="biz-save">{t('A-0321')}</button> : null}
      </form>
    </section>
  );
}

export function HoursCard({ hours, onChanged }: { hours: NonNullable<ClubSetup['hours']>; onChanged(): Promise<void> }) {
  const { slug, t } = useAdmin();
  const [draft, setDraft] = useState<HoursDraft>(() => hoursDraft(hours));
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(hoursDraft(hours)), [hours]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const p = hoursPatch(hoursDraft(hours), draft);
    if (!p.ok) return setMsg({ key: p.key, error: true, vars: {} });
    setBusy(true);
    const r = await saveHours(slug, p.hours, window.fetch.bind(window));
    setBusy(false);
    if (r.kind !== 'ok') return setMsg({ key: setErrorKey(r), error: true });
    setMsg({ key: 'A-new.set_saved', error: false });
    await onChanged();
  }
  return (
    <section className="adm-card" aria-labelledby="set-hours" data-testid="set-hours">
      <h2 id="set-hours">{t('A-0323')}</h2>
      <p className="adm-muted">{t('A-new.set_hours_hint')}</p>
      <form onSubmit={(e) => void submit(e)} className="adm-form" noValidate>
        {WEEKDAYS.map((d) => {
          const row = draft[d]!;
          const set = (patch: Partial<typeof row>) => setDraft({ ...draft, [d]: { ...row, ...patch } });
          return (
            <div key={d} className="adm-hours-row" data-testid={`hours-${d}`}>
              <span className="adm-day">{t(`A-new.set_weekday_${d}`)}</span>
              <label className="adm-sr" htmlFor={`h-${d}-o`}>{t(`A-new.set_weekday_${d}`)} {t('A-new.set_hours_open')}</label>
              <input id={`h-${d}-o`} inputMode="numeric" placeholder="06:00" value={row.open} disabled={row.closed} onChange={(e) => set({ open: e.target.value })} />
              <label className="adm-sr" htmlFor={`h-${d}-c`}>{t(`A-new.set_weekday_${d}`)} {t('A-new.set_hours_close')}</label>
              <input id={`h-${d}-c`} inputMode="numeric" placeholder="24:00" value={row.close} disabled={row.closed} onChange={(e) => set({ close: e.target.value })} />
              <label className="adm-check"><input type="checkbox" checked={row.closed} onChange={(e) => set({ closed: e.target.checked })} data-testid={`closed-${d}`} /> {t('A-new.set_hours_closed')}</label>
            </div>
          );
        })}
        <Say m={msg} />
        <button type="submit" className="adm-btn" disabled={busy} data-testid="hours-save">{t('A-new.set_save_hours')}</button>
      </form>
    </section>
  );
}

function CourtFields({ d, set, disabled, idp }: { d: CourtDraft; set(p: Partial<CourtDraft>): void; disabled: boolean; idp: string }) {
  const { t } = useAdmin();
  return (
    <>
      <label className="adm-field"><span>{t('A-new.set_court_name')}</span>
        <input id={`${idp}-name`} value={d.name} disabled={disabled} onChange={(e) => set({ name: e.target.value })} data-testid={`${idp}-name`} />
        <span className="adm-muted">{t('A-new.set_court_name_hint', { label: '1' })}</span>
      </label>
      <label className="adm-field"><span>{t('A-new.set_court_sport')}</span>
        <select value={d.sport} disabled={disabled} onChange={(e) => set({ sport: e.target.value })} data-testid={`${idp}-sport`}>
          {(SPORTS as readonly string[]).includes(d.sport) ? null : <option value={d.sport}>{d.sport}</option>}
          {SPORTS.map((s) => <option key={s} value={s}>{t(`A-new.set_sport_${s}`)}</option>)}
        </select>
      </label>
      <label className="adm-field"><span>{t('A-new.set_court_type')}</span>
        <select value={d.type} disabled={disabled} onChange={(e) => set({ type: e.target.value })} data-testid={`${idp}-type`}>
          <option value="">{t('A-new.set_court_type_any')}</option>
          {COURT_TYPES.map((x) => <option key={x} value={x}>{t(`A-new.set_court_${x}`)}</option>)}
        </select>
      </label>
      <label className="adm-field"><span>{t('A-new.set_court_players_label')}</span><input inputMode="numeric" value={d.max_players} disabled={disabled} onChange={(e) => set({ max_players: e.target.value })} data-testid={`${idp}-players`} /></label>
      <label className="adm-check"><input type="checkbox" checked={d.lights} disabled={disabled} onChange={(e) => set({ lights: e.target.checked })} /> {t('A-new.set_court_lights')}</label>
    </>
  );
}

export function CourtsCard({ courts, locations, onChanged }: { courts: Court[]; locations: NonNullable<ClubSetup['locations']>; onChanged(): Promise<void> }) {
  const { slug, t } = useAdmin();
  const [drafts, setDrafts] = useState<Record<string, CourtDraft>>(() => Object.fromEntries(courts.map((c) => [c.id, courtDraft(c)])));
  const [fresh, setFresh] = useState<CourtDraft & { location_id: string }>({ name: '', sport: 'tennis', type: '', lights: false, max_players: '', active: true, location_id: '' });
  const [msgs, setMsgs] = useState<Record<string, Msg>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => setDrafts(Object.fromEntries(courts.map((c) => [c.id, courtDraft(c)]))), [courts]);
  const note = (k: string, m: Msg) => setMsgs((x) => ({ ...x, [k]: m }));

  async function save(c: Court) {
    const now = drafts[c.id]!;
    const problem = checkCourt(now);
    if (problem) return note(c.id, { key: problem, error: true });
    const changes = courtChanges(courtDraft(c), now);
    if (Object.keys(changes).length === 0) return note(c.id, { key: 'A-new.set_nothing_changed', error: true });
    setBusy(true);
    const r = await saveCourt(slug, c.id, changes, window.fetch.bind(window));
    setBusy(false);
    if (r.kind !== 'ok') return note(c.id, { key: setErrorKey(r), error: true });
    note(c.id, { key: 'A-new.set_saved', error: false });
    await onChanged();
  }
  async function add(e: FormEvent) {
    e.preventDefault();
    const loc = fresh.location_id || locations[0]?.id || '';
    if (!loc) return note('new', { key: 'A-new.set_court_no_location', error: true });
    const problem = checkCourt(fresh);
    if (problem) return note('new', { key: problem, error: true });
    setBusy(true);
    const r = await addCourt(slug, { ...fresh, location_id: loc }, window.fetch.bind(window));
    setBusy(false);
    if (r.kind !== 'ok') return note('new', { key: setErrorKey(r), error: true });
    setFresh({ ...fresh, name: '', max_players: '' });
    note('new', { key: 'A-new.set_saved', error: false });
    await onChanged();
  }
  return (
    <section className="adm-card" aria-labelledby="set-courts" data-testid="set-courts">
      <h2 id="set-courts">{t('A-new.set_courts_title')}</h2>
      {courts.length === 0 ? <p className="adm-muted">{t('A-new.set_courts_none')}</p> : null}
      {courts.map((c) => {
        const d = drafts[c.id];
        if (!d) return null;
        const set = (p: Partial<CourtDraft>) => setDrafts({ ...drafts, [c.id]: { ...d, ...p } });
        return (
          <fieldset key={c.id} className="adm-court" data-testid={`court-${c.id}`}>
            <legend>{t('A-0019', { court: c.name })}</legend>
            <CourtFields d={d} set={set} disabled={busy} idp={`c-${c.id}`} />
            <label className="adm-check"><input type="checkbox" checked={d.active} disabled={busy} onChange={(e) => set({ active: e.target.checked })} data-testid={`c-${c.id}-active`} /> {t('A-new.set_court_active')}</label>
            <p className="adm-muted">{t('A-new.set_court_inactive_note')}</p>
            <Say m={msgs[c.id] ?? null} />
            <button type="button" className="adm-btn" disabled={busy} onClick={() => void save(c)} data-testid={`c-${c.id}-save`}>{t('A-new.set_court_save')}</button>
          </fieldset>
        );
      })}
      <form onSubmit={(e) => void add(e)} className="adm-form adm-court" data-testid="court-new" noValidate>
        <h3>{t('A-new.set_court_add')}</h3>
        {locations.length === 0 ? <p className="adm-muted">{t('A-new.set_court_no_location')}</p> : (
          <label className="adm-field"><span>{t('A-new.set_court_location')}</span>
            <select value={fresh.location_id || locations[0]!.id} onChange={(e) => setFresh({ ...fresh, location_id: e.target.value })} data-testid="new-location">
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
        )}
        <CourtFields d={fresh} set={(p) => setFresh({ ...fresh, ...p })} disabled={busy || locations.length === 0} idp="new" />
        <Say m={msgs['new'] ?? null} />
        <button type="submit" className="adm-btn" disabled={busy || locations.length === 0} data-testid="new-add">{t('A-new.set_court_add')}</button>
      </form>
    </section>
  );
}

export function SupportCard({ until, onChanged }: { until: string | null; onChanged(): Promise<void> }) {
  const { slug, lang, t } = useAdmin();
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const on = windowOpen(until, new Date());
  async function flip(next: boolean) {
    setBusy(true);
    const r = await setSupportWindow(slug, next, window.fetch.bind(window));
    setBusy(false);
    if (r.kind !== 'ok') return setMsg({ key: setErrorKey(r), error: true });
    setMsg(null);
    await onChanged();
  }
  return (
    <section className="adm-card" aria-labelledby="set-support" data-testid="set-support">
      <h2 id="set-support">{t('A-0361')}</h2>
      <p>{t('A-0364')}</p>
      <p><strong>{t('A-0362')}</strong> · <span data-testid="support-state">{on && until ? t('A-new.set_support_on', { dayMonth: dayMonthOf(lang, until), time: timeOf(until) }) : t('A-new.set_support_off')}</span></p>
      <p className="adm-muted">{t('A-0363')}</p>
      <Say m={msg} />
      <button type="button" className="adm-btn" disabled={busy} onClick={() => void flip(!on)} data-testid="support-toggle">{t(on ? 'A-new.set_support_turn_off' : 'A-new.set_support_turn_on')}</button>
    </section>
  );
}
