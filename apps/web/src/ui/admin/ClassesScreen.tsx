'use client';
import { useCallback, useEffect, useState } from 'react';
import { formatBaht } from '../../client/admin/api';
import { loadCourts, type CourtInfo } from '../../client/admin/calendar';
import {
  belowMinimum, blankTemplate, cancelSession, classErrorKey, createTemplate, editSession, endTemplate, loadRoster, loadSessions, loadTemplates, loadWaitlist, resolveSession, sessionBody, sessionDraft,
  STATUS_KEY, templateBody, templateDraft, updateTemplate, weekOf, type RosterRow, type Session, type SessionDraft, type Template, type TemplateDraft, type WaitRow,
} from '../../client/admin/classes';
import { loadCoaches, type CoachRow } from '../../client/admin/coaches';
import { loadRules } from '../../client/admin/rules';
import { dateOf, longDayOf, timeOf } from '../../client/admin/time';
import { weekdayKey } from '../../client/format';
import { useAdmin } from './AdminFrame';

// A8 Group classes (F11-T17; ADMIN-09; board H-A08-Group-classes): this week's sessions with seats taken and the waiting count, the sessions below their minimum (cancel
// gives every seat its full value back and sends a LINE message), a session's roster and waitlist, and the templates (owner creates, changes and ends them). A class is 60 minutes
// on the hour; the database refuses a clash, a coach past the daily limit or a coach on leave. Not drawn: Keep it running (no route records it), the booked count inside a calendar cell.

type Msg = { key: string; dates?: string; vars?: Record<string, string | number>; error: boolean } | null;
type Load = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error' } | { kind: 'forbidden' };
const SUN = '2027-01-17'; // a Sunday, only to pick a weekday word: 0 = Sunday
const weekdayWord = (t: (k: string) => string, n: number) => t(weekdayKey(new Date(Date.parse(`${SUN}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)));

export function ClassesScreen() {
  const { slug, lang, t, owner } = useAdmin();
  const f = () => window.fetch.bind(window);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [today, setToday] = useState('');
  const [now, setNow] = useState('');
  const [offset, setOffset] = useState(0);
  const [courts, setCourts] = useState<CourtInfo[]>([]);
  const [coaches, setCoaches] = useState<CoachRow[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [upcoming, setUpcoming] = useState<Session[]>([]);
  const [restCap, setRestCap] = useState<number | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const c = await loadCourts(slug, window.fetch.bind(window));
    if (c.kind === 'forbidden') return setLoad({ kind: 'forbidden' });
    if (c.kind !== 'ok') return setLoad({ kind: 'error' });
    setToday(c.body.today);
    setNow(new Date().toISOString());
    setCourts(c.body.courts);
    const wk = weekOf(c.body.today, offset);
    const ahead = weekOf(c.body.today, 0);
    const [tp, se, up, co] = await Promise.all([
      loadTemplates(slug, window.fetch.bind(window)), loadSessions(slug, wk.from, wk.to, window.fetch.bind(window)),
      loadSessions(slug, c.body.today, (() => { const d = new Date(`${ahead.to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 21); return d.toISOString().slice(0, 10); })(), window.fetch.bind(window)),
      loadCoaches(slug, window.fetch.bind(window)),
    ]);
    if (tp.kind === 'forbidden' || se.kind === 'forbidden') return setLoad({ kind: 'forbidden' });
    if (tp.kind !== 'ok' || se.kind !== 'ok') return setLoad({ kind: 'error' });
    setTemplates(tp.body);
    setSessions(se.body);
    setUpcoming(up.kind === 'ok' ? up.body : []);
    setCoaches(co.kind === 'ok' ? co.body : []);
    if (owner) {
      const rules = await loadRules(slug, window.fetch.bind(window));
      const cap = rules.kind === 'ok' ? rules.body.find((x) => x.key === 'rest_cap_hours') : undefined;
      setRestCap(cap && !cap.unset && typeof cap.value === 'number' ? cap.value : null);
    }
    setLoad({ kind: 'ready' });
  }, [slug, offset, owner]);
  useEffect(() => {
    void reload();
  }, [reload]);

  if (load.kind === 'loading') return <p aria-busy="true" className="adm-muted">…</p>;
  if (load.kind === 'forbidden') return <p role="alert" data-testid="cls-forbidden">{t('A-new.cls_err_forbidden')}</p>;
  if (load.kind === 'error') return <div role="alert" data-testid="cls-error"><p>{t('A-new.cls_load_failed')}</p><button type="button" className="adm-btn" onClick={() => { setLoad({ kind: 'loading' }); void reload(); }}>{t('A-new.set_retry')}</button></div>;

  const week = weekOf(today, offset);
  const name = (s: { nameTh: string; nameEn: string }) => (lang === 'th' ? s.nameTh : s.nameEn);
  const coachName = (id: string) => coaches.find((c) => c.coachId === id)?.displayName ?? t('A-new.coach_no_name');
  const courtName = (id: string) => courts.find((c) => c.id === id)?.name ?? '';
  const below = upcoming.filter((s) => belowMinimum(s, now));
  const say = (key: string, error: boolean, extra: { dates?: string; vars?: Record<string, string | number> } = {}) => setMsg({ key, error, ...extra });

  async function cancel(s: Session, reason: 'below_minimum' | 'owner') {
    if (!window.confirm(t('A-0204', { count: s.taken }))) return;
    setBusy(true);
    const r = await cancelSession(slug, s.id, reason, f());
    setBusy(false);
    if (r.kind !== 'ok') return say(classErrorKey(r).key, true);
    say('A-new.cls_cancelled', false, { vars: { seats: r.body.seats } });
    await reload();
  }
  async function resolve(s: Session) {
    setBusy(true);
    const r = await resolveSession(slug, s.id, f());
    setBusy(false);
    if (r.kind !== 'ok') return say(classErrorKey(r).key, true);
    say(r.body.resolved ? 'A-new.cls_resolved' : 'A-new.cls_not_resolved', !r.body.resolved);
    await reload();
  }

  return (
    <section data-testid="classes" aria-labelledby="cls-title">
      <header className="adm-head"><h1 id="cls-title">{t('A-0159')}</h1></header>
      <p className="adm-muted" data-testid="cls-summary">{t('A-0200', { templates: templates.filter((x) => x.active).length, sessions: sessions.filter((x) => x.status !== 'cancelled').length })}</p>
      {msg ? <p role={msg.error ? 'alert' : 'status'} className={msg.error ? 'adm-error' : 'adm-ok'} data-testid="cls-msg">{t(msg.key, msg.vars)}{msg.dates ? ` ${msg.dates.split(',').map((d) => longDayOf(lang, d)).join(', ')}` : ''}</p> : null}

      {below.length > 0 ? (
        <section className="adm-card" aria-labelledby="cls-below" data-testid="cls-below">
          <h2 id="cls-below">{t('A-0202')}</h2>
          {below.map((s) => (
            <div key={s.id} className="adm-rule" data-testid={`below-${s.id}`}>
              <p>{t('A-new.cls_below_line', { date: dateOf(lang, s.startAt), time: timeOf(s.startAt), className: name(s), booked: s.taken, minPlayers: s.minPlayers })}</p>
              <p className="adm-muted">{t('A-0204', { count: s.taken })}</p>
              <button type="button" className="adm-btn" disabled={busy} onClick={() => void cancel(s, 'below_minimum')} data-testid={`below-cancel-${s.id}`}>{t('A-0206')}</button>
            </div>
          ))}
        </section>
      ) : null}

      <section className="adm-card" aria-labelledby="cls-week" data-testid="cls-week">
        <h2 id="cls-week">{t('A-0208')}</h2>
        <div className="adm-inline">
          <button type="button" className="adm-btn adm-btn-ghost" onClick={() => setOffset(offset - 1)} aria-label={t('A-new.cls_prev_week')} data-testid="cls-prev">‹</button>
          <span data-testid="cls-range">{longDayOf(lang, week.from)} – {longDayOf(lang, week.to)}</span>
          <button type="button" className="adm-btn adm-btn-ghost" onClick={() => setOffset(offset + 1)} aria-label={t('A-new.cls_next_week')} data-testid="cls-next">›</button>
        </div>
        {sessions.length === 0 ? <p className="adm-muted" data-testid="cls-none">{t('A-new.cls_none_week')}</p> : sessions.map((s) => (
          <SessionRow key={s.id} s={s} nameText={name(s)} coachName={coachName(s.coachId)} courtName={courtName(s.resourceId)} coaches={coaches} courts={courts} busy={busy} onCancel={() => void cancel(s, 'owner')} onResolve={() => void resolve(s)} onDone={reload} say={say} />
        ))}
      </section>

      <Templates templates={templates} coaches={coaches} courts={courts} nameOf={name} coachName={coachName} courtName={courtName} onDone={reload} say={say} />
      {restCap !== null ? <p className="adm-muted" data-testid="cls-note">{t('A-0224', { maxHoursInRow: restCap })}</p> : null}
    </section>
  );
}

type Say = (key: string, error: boolean, extra?: { dates?: string; vars?: Record<string, string | number> }) => void;

function SessionRow({ s, nameText, coachName, courtName, coaches, courts, busy, onCancel, onResolve, onDone, say }: {
  s: Session; nameText: string; coachName: string; courtName: string; coaches: CoachRow[]; courts: CourtInfo[]; busy: boolean; onCancel(): void; onResolve(): void; onDone(): Promise<void>; say: Say;
}) {
  const { slug, lang, t, owner } = useAdmin();
  const f = () => window.fetch.bind(window);
  const [roster, setRoster] = useState<{ seats: RosterRow[]; wait: WaitRow[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<SessionDraft | null>(null);
  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    const [r, w] = await Promise.all([loadRoster(slug, s.id, f()), loadWaitlist(slug, s.id, f())]);
    setRoster({ seats: r.kind === 'ok' ? r.body : [], wait: w.kind === 'ok' ? w.body : [] });
  }
  async function save() {
    if (!edit) return;
    const b = sessionBody(s, edit);
    if (!b.ok) return say(b.key, true);
    const r = await editSession(slug, s.id, b.body, f());
    if (r.kind !== 'ok') return say(classErrorKey(r).key, true);
    setEdit(null);
    say('A-new.set_saved', false);
    await onDone();
  }
  const live = s.status !== 'cancelled';
  return (
    <div className="adm-rule" data-testid={`session-${s.id}`}>
      <p>
        <strong>{nameText}</strong> · {dateOf(lang, s.startAt)} {timeOf(s.startAt)} · {t('A-0019', { court: courtName })} · {coachName}
      </p>
      <p className="adm-muted">
        {t('A-0024', { booked: s.taken, maxPlayers: s.maxPlayers })} · {t('A-new.cls_min_line', { min: s.minPlayers })}{s.waiting > 0 ? ` · ${t('A-new.cls_waiting', { count: s.waiting })}` : ''} · <span className="adm-chip" data-testid={`status-${s.id}`}>{t(STATUS_KEY[s.status] ?? 'A-new.cls_status_scheduled')}</span>
        {s.status === 'needs_attention' && s.attentionReason ? <> · {s.attentionReason}</> : null}
      </p>
      <span className="adm-inline">
        <button type="button" className="adm-btn adm-btn-ghost" aria-expanded={open} onClick={() => void toggle()} data-testid={`roster-${s.id}`}>{t('A-new.cls_roster')}</button>
        {owner && live ? <button type="button" className="adm-btn adm-btn-ghost" onClick={() => setEdit(edit ? null : sessionDraft(s))} data-testid={`edit-${s.id}`}>{t('A-0192')}</button> : null}
        {live ? <button type="button" className="adm-btn adm-btn-ghost" disabled={busy} onClick={onCancel} data-testid={`cancel-${s.id}`}>{t('A-0206')}</button> : null}
        {owner && s.status === 'needs_attention' ? <button type="button" className="adm-btn adm-btn-ghost" disabled={busy} onClick={onResolve} data-testid={`resolve-${s.id}`}>{t('A-new.cls_resolve')}</button> : null}
      </span>
      {open ? (
        <div data-testid={`roster-panel-${s.id}`}>
          {roster === null ? <p aria-busy="true" className="adm-muted">…</p> : (
            <>
              <h3>{t('A-new.cls_roster')}</h3>
              {roster.seats.length === 0 ? <p className="adm-muted">{t('A-new.cls_roster_none')}</p> : <ul className="adm-list">{roster.seats.map((r) => <li key={r.bookingId}><span>{r.displayName ?? t('A-new.cust_no_name')}</span><span className="adm-muted">{t(r.status === 'confirmed' ? 'A-new.book_status_confirmed' : 'A-0015')}</span></li>)}</ul>}
              <h3>{t('A-new.cls_waitlist')}</h3>
              {roster.wait.length === 0 ? <p className="adm-muted">{t('A-new.cls_waitlist_none')}</p> : <ul className="adm-list">{roster.wait.map((w) => <li key={w.entryId}><span>{w.position}. {w.displayName ?? t('A-new.cust_no_name')}</span><span className="adm-muted">{t(w.status === 'offered' ? 'A-new.cls_offered' : 'A-new.cls_waiting_state')}</span></li>)}</ul>}
            </>
          )}
        </div>
      ) : null}
      {edit ? (
        <form className="adm-form" onSubmit={(e) => { e.preventDefault(); void save(); }} data-testid={`edit-form-${s.id}`}>
          <label className="adm-field"><span>{t('A-0187')}</span>
            <select value={edit.coachId} onChange={(e) => setEdit({ ...edit, coachId: e.target.value })} data-testid={`sed-coach-${s.id}`}>{coaches.map((c) => <option key={c.coachId} value={c.coachId}>{c.displayName ?? t('A-new.coach_no_name')}</option>)}</select></label>
          <label className="adm-field"><span>{t('A-0212')}</span>
            <select value={edit.resourceId} onChange={(e) => setEdit({ ...edit, resourceId: e.target.value })} data-testid={`sed-court-${s.id}`}>{courts.map((c) => <option key={c.id} value={c.id}>{t('A-0019', { court: c.name })}</option>)}</select></label>
          <label className="adm-field"><span>{t('A-new.cls_min')}</span><input inputMode="numeric" value={edit.minPlayers} onChange={(e) => setEdit({ ...edit, minPlayers: e.target.value })} data-testid={`sed-min-${s.id}`} /></label>
          <label className="adm-field"><span>{t('A-new.cls_max')}</span><input inputMode="numeric" value={edit.maxPlayers} onChange={(e) => setEdit({ ...edit, maxPlayers: e.target.value })} data-testid={`sed-max-${s.id}`} /></label>
          <label className="adm-field"><span>{t('A-new.cls_drop_in')}</span><input inputMode="decimal" value={edit.dropIn} placeholder={t('A-new.coach_not_set')} onChange={(e) => setEdit({ ...edit, dropIn: e.target.value })} data-testid={`sed-price-${s.id}`} /></label>
          <span className="adm-inline"><button type="submit" className="adm-btn" data-testid={`sed-save-${s.id}`}>{t('A-0321')}</button><button type="button" className="adm-btn adm-btn-ghost" onClick={() => setEdit(null)}>{t('A-new.cal_close')}</button></span>
        </form>
      ) : null}
    </div>
  );
}

function Templates({ templates, coaches, courts, nameOf, coachName, courtName, onDone, say }: {
  templates: Template[]; coaches: CoachRow[]; courts: CourtInfo[]; nameOf(s: { nameTh: string; nameEn: string }): string; coachName(id: string): string; courtName(id: string): string; onDone(): Promise<void>; say: Say;
}) {
  const { slug, t, owner } = useAdmin();
  const f = () => window.fetch.bind(window);
  const [fresh, setFresh] = useState<TemplateDraft>(() => blankTemplate());
  const [editing, setEditing] = useState<{ id: string; draft: TemplateDraft } | null>(null);
  const [busy, setBusy] = useState(false);
  const live = templates.filter((x) => x.active);

  async function create() {
    const b = templateBody(undefined, fresh);
    if (!b.ok) return say(b.key, true);
    setBusy(true);
    const r = await createTemplate(slug, b.body, f());
    setBusy(false);
    if (r.kind !== 'ok') {
      const e = classErrorKey(r);
      return say(e.key, true, e.dates ? { dates: e.dates } : {});
    }
    setFresh(blankTemplate());
    say('A-new.cls_created', false, { vars: { made: r.body.made, attention: r.body.needsAttention } });
    await onDone();
  }
  async function change(tpl: Template) {
    if (!editing) return;
    const b = templateBody(tpl, editing.draft);
    if (!b.ok) return say(b.key, true);
    setBusy(true);
    const r = await updateTemplate(slug, tpl.id, b.body, f());
    setBusy(false);
    if (r.kind !== 'ok') {
      const e = classErrorKey(r);
      return say(e.key, true, e.dates ? { dates: e.dates } : {});
    }
    setEditing(null);
    say('A-new.cls_updated', false, { vars: { rewritten: r.body.rewritten, cancelled: r.body.cancelled, generated: r.body.generated } });
    await onDone();
  }
  async function end(tpl: Template) {
    if (!window.confirm(t('A-new.cls_end_confirm'))) return;
    setBusy(true);
    const r = await endTemplate(slug, tpl.id, f());
    setBusy(false);
    if (r.kind !== 'ok') return say(classErrorKey(r).key, true);
    say('A-new.cls_ended', false, { vars: { cancelled: r.body.cancelled, failed: r.body.failed } });
    await onDone();
  }
  const fields = (d: TemplateDraft, set: (p: Partial<TemplateDraft>) => void, idp: string) => (
    <div className="adm-form">
      <label className="adm-field"><span>{t('A-new.price_name_th')}</span><input value={d.nameTh} onChange={(e) => set({ nameTh: e.target.value })} data-testid={`${idp}-nameTh`} /></label>
      <label className="adm-field"><span>{t('A-new.price_name_en')}</span><input value={d.nameEn} onChange={(e) => set({ nameEn: e.target.value })} data-testid={`${idp}-nameEn`} /></label>
      <label className="adm-field"><span>{t('A-0210')}</span>
        <select value={d.audience} onChange={(e) => set({ audience: e.target.value as TemplateDraft['audience'] })} data-testid={`${idp}-audience`}><option value="adult">{t('A-0069')}</option><option value="student">{t('A-0070')}</option></select></label>
      <label className="adm-field"><span>{t('A-0211')}</span><input value={d.level} onChange={(e) => set({ level: e.target.value })} data-testid={`${idp}-level`} /></label>
      <label className="adm-field"><span>{t('A-0187')}</span>
        <select value={d.coachId} onChange={(e) => set({ coachId: e.target.value })} data-testid={`${idp}-coach`}><option value="">{t('A-new.sell_pick')}</option>{coaches.map((c) => <option key={c.coachId} value={c.coachId}>{c.displayName ?? t('A-new.coach_no_name')}</option>)}</select></label>
      <label className="adm-field"><span>{t('A-0212')}</span>
        <select value={d.resourceId} onChange={(e) => set({ resourceId: e.target.value })} data-testid={`${idp}-court`}><option value="">{t('A-new.sell_pick')}</option>{courts.map((c) => <option key={c.id} value={c.id}>{t('A-0019', { court: c.name })}</option>)}</select></label>
      <label className="adm-field"><span>{t('A-0213')}</span>
        <select value={d.weekday} onChange={(e) => set({ weekday: e.target.value })} data-testid={`${idp}-weekday`}><option value="">{t('A-new.sell_pick')}</option>{[1, 2, 3, 4, 5, 6, 0].map((n) => <option key={n} value={n}>{weekdayWord(t, n)}</option>)}</select></label>
      <label className="adm-field"><span>{t('A-new.cls_start_hour')}</span>
        <select value={d.startHour} onChange={(e) => set({ startHour: e.target.value })} data-testid={`${idp}-hour`}><option value="">{t('A-new.sell_pick')}</option>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select></label>
      <p className="adm-muted">{t('A-0214')}: {t('A-0218')}</p>
      <label className="adm-field"><span>{t('A-new.cls_min')}</span><input inputMode="numeric" value={d.minPlayers} onChange={(e) => set({ minPlayers: e.target.value })} data-testid={`${idp}-min`} /></label>
      <label className="adm-field"><span>{t('A-new.cls_max')}</span><input inputMode="numeric" value={d.maxPlayers} onChange={(e) => set({ maxPlayers: e.target.value })} data-testid={`${idp}-max`} /></label>
      <label className="adm-field"><span>{t('A-new.cls_drop_in')}</span><input inputMode="decimal" value={d.dropIn} placeholder={t('A-new.coach_not_set')} onChange={(e) => set({ dropIn: e.target.value })} data-testid={`${idp}-price`} /></label>
    </div>
  );
  return (
    <section className="adm-card" aria-labelledby="cls-templates" data-testid="cls-templates">
      <h2 id="cls-templates">{t('A-0207')}</h2>
      {live.length === 0 ? <p className="adm-muted">{t('A-new.cls_no_templates')}</p> : live.map((x) => (
        <div key={x.id} className="adm-rule" data-testid={`tpl-${x.id}`}>
          <p><strong>{nameOf(x)}</strong> · {x.level ?? ''} · {t(x.audience === 'student' ? 'A-0070' : 'A-0069')}</p>
          <p className="adm-muted">{weekdayWord(t, x.weekday)} {x.startTime} · {t('A-0218')} · {t('A-new.cls_min_max', { min: x.minPlayers, max: x.maxPlayers })} · {t('A-0019', { court: courtName(x.resourceId) })} · {coachName(x.coachId)}{x.dropInPriceSatang !== null ? ` · ${formatBaht(x.dropInPriceSatang)}` : ''}</p>
          {owner ? (
            <span className="adm-inline">
              <button type="button" className="adm-btn adm-btn-ghost" onClick={() => setEditing(editing?.id === x.id ? null : { id: x.id, draft: templateDraft(x) })} data-testid={`tpl-edit-${x.id}`}>{t('A-0192')}</button>
              <button type="button" className="adm-btn adm-btn-ghost" disabled={busy} onClick={() => void end(x)} data-testid={`tpl-end-${x.id}`}>{t('A-new.cls_end')}</button>
            </span>
          ) : null}
          {editing?.id === x.id ? (
            <form onSubmit={(e) => { e.preventDefault(); void change(x); }} data-testid={`tpl-form-${x.id}`}>
              {fields(editing.draft, (p) => setEditing({ id: x.id, draft: { ...editing.draft, ...p } }), `te-${x.id}`)}
              <span className="adm-inline"><button type="submit" className="adm-btn" disabled={busy} data-testid={`tpl-save-${x.id}`}>{t('A-0321')}</button><button type="button" className="adm-btn adm-btn-ghost" onClick={() => setEditing(null)}>{t('A-new.cal_close')}</button></span>
            </form>
          ) : null}
        </div>
      ))}
      {owner ? (
        <form className="adm-court" onSubmit={(e) => { e.preventDefault(); void create(); }} noValidate data-testid="tpl-new">
          <h3>{t('A-0201')}</h3>
          {fields(fresh, (p) => setFresh({ ...fresh, ...p }), 'tn')}
          <button type="submit" className="adm-btn" disabled={busy} data-testid="tpl-create">{t('A-0201')}</button>
        </form>
      ) : null}
    </section>
  );
}
