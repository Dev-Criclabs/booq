'use client';
import { useCallback, useEffect, useState } from 'react';
import { loadCourts } from '../../client/admin/calendar';
import {
  assign, coachBody, coachErrorKey, decideLeave, loadAway, loadCoach, loadCoaches, loadFlagged, loadGroups, loadLeave, loadPay, loadSubstitutes, loadTiers, missing, payBody, payDraft, profileDraft, reasonFor,
  saveCoach, savePay, type Away, type CoachFull, type CoachRow, type Flagged, type Group, type Leave, type PayDraft, type ProfileDraft, type Tier,
} from '../../client/admin/coaches';
import { addDays } from '../../client/admin/calendar';
import { adminPath } from '../../client/admin/shell';
import { dateOf, longDayOf, timeOf } from '../../client/admin/time';
import { useAdmin } from './AdminFrame';

// A7 Coaches (F11-T16; ADMIN-08; board H-A07-Coaches): the coaches with their tier and state, leave requests to approve or decline, solo classes that need a
// substitute, and (owner) each coach's tier, public profile in Thai and English, consent, publish, price overrides and pay model. Front desk reads the list and who
// is away. A value left empty is "not set". Not drawn: Add coach (a person must already be a user; no route lists people who are not coaches yet), the
// "booked solo classes will need a substitute" count and the player name on a flagged session (neither is in the reads), the month's session totals (no route).

type Msg = { key: string; vars?: Record<string, string | number>; error: boolean } | null;
type Load = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error' } | { kind: 'forbidden' };

export function CoachesScreen() {
  const { slug, lang, t, owner } = useAdmin();
  const f = () => window.fetch.bind(window);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [coaches, setCoaches] = useState<CoachRow[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [leave, setLeave] = useState<Leave[]>([]);
  const [flagged, setFlagged] = useState<Flagged[]>([]);
  const [away, setAway] = useState<Away[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const [c, ti, gr, today] = await Promise.all([loadCoaches(slug, f()), loadTiers(slug, f()), loadGroups(slug, f()), loadCourts(slug, f())]);
    if (c.kind === 'forbidden') return setLoad({ kind: 'forbidden' });
    if (c.kind !== 'ok') return setLoad({ kind: 'error' });
    setCoaches(c.body);
    setTiers(ti);
    setGroups(gr);
    const day = today.kind === 'ok' ? today.body.today : null;
    if (day) {
      const a = await loadAway(slug, day, addDays(day, 31), f());
      setAway(a.kind === 'ok' ? a.body : []);
    }
    if (owner) {
      const [l, fl] = await Promise.all([loadLeave(slug, f()), loadFlagged(slug, f())]);
      setLeave(l.kind === 'ok' ? l.body : []);
      setFlagged(fl.kind === 'ok' ? fl.body : []);
    }
    setLoad({ kind: 'ready' });
  }, [slug, owner]);
  useEffect(() => {
    void reload();
  }, [reload]);

  if (load.kind === 'loading') return <p aria-busy="true" className="adm-muted">…</p>;
  if (load.kind === 'forbidden') return <p role="alert" data-testid="coach-forbidden">{t('A-new.coach_err_forbidden')}</p>;
  if (load.kind === 'error') return <div role="alert" data-testid="coach-error"><p>{t('A-new.coach_load_failed')}</p><button type="button" className="adm-btn" onClick={() => { setLoad({ kind: 'loading' }); void reload(); }}>{t('A-new.set_retry')}</button></div>;

  const nameOf = (id: string) => coaches.find((c) => c.coachId === id)?.displayName ?? t('A-new.coach_no_name');
  const tierName = (id: string | null) => { const x = tiers.find((y) => y.id === id); return x ? (lang === 'th' ? x.nameTh : x.nameEn) : ''; };
  const range = (l: { startDate: string; endDate: string; fromHour: number | null; toHour: number | null }) => {
    const days = l.startDate === l.endDate ? longDayOf(lang, l.startDate) : `${longDayOf(lang, l.startDate)} – ${longDayOf(lang, l.endDate)}`;
    return l.fromHour !== null && l.toHour !== null ? t('A-new.coach_hours', { days, from: `${String(l.fromHour).padStart(2, '0')}:00`, to: `${String(l.toHour).padStart(2, '0')}:00` }) : t('A-new.coach_full_days', { days });
  };
  async function decide(l: Leave, approve: boolean) {
    setBusy(true);
    const r = await decideLeave(slug, l.leaveId, approve, f());
    setBusy(false);
    if (r.kind !== 'ok') return setMsg({ key: coachErrorKey(r), error: true });
    setMsg({ key: approve ? 'A-new.coach_approved' : 'A-new.coach_declined', error: false });
    await reload();
  }

  return (
    <section data-testid="coaches" aria-labelledby="coach-title">
      <header className="adm-head"><h1 id="coach-title">{t('A-0158')}</h1>{owner ? <a className="adm-btn" href={`${adminPath(slug, 'staff')}?role=coach`} data-testid="coach-add">{t('A-0169')}</a> : null}</header>
      <p className="adm-muted" data-testid="coach-summary">{t('A-0168', { coachCount: coaches.length, leaveCount: leave.length })}</p>
      {msg ? <p role={msg.error ? 'alert' : 'status'} className={msg.error ? 'adm-error' : 'adm-ok'} data-testid="coach-msg">{t(msg.key, msg.vars)}</p> : null}

      {owner && leave.length > 0 ? (
        <section className="adm-card" aria-labelledby="coach-leave" data-testid="coach-leave">
          <h2 id="coach-leave">{t('A-0170', { count: leave.length })}</h2>
          <ul className="adm-list">
            {leave.map((l) => (
              <li key={l.leaveId} data-testid={`leave-${l.leaveId}`}>
                <span>{nameOf(l.coachId)} · {range(l)}{l.note ? <span className="adm-muted"> · {l.note}</span> : null}</span>
                <span className="adm-inline">
                  <button type="button" className="adm-btn" disabled={busy} onClick={() => void decide(l, true)} data-testid={`approve-${l.leaveId}`}>{t('A-0173')}</button>
                  <button type="button" className="adm-btn adm-btn-ghost" disabled={busy} onClick={() => void decide(l, false)} data-testid={`decline-${l.leaveId}`}>{t('A-0174')}</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {owner && flagged.length > 0 ? (
        <section className="adm-card" aria-labelledby="coach-flagged" data-testid="coach-flagged">
          <h2 id="coach-flagged">{t('A-0175', { count: flagged.length })}</h2>
          <p className="adm-muted">{t('A-new.coach_flag_note')}</p>
          {flagged.map((x) => <FlagRow key={x.bookingId} flag={x} coachName={nameOf(x.coachId)} onDone={reload} />)}
        </section>
      ) : null}

      <section className="adm-card" aria-labelledby="coach-list">
        <h2 id="coach-list" className="adm-sr">{t('A-0158')}</h2>
        {coaches.length === 0 ? <p className="adm-muted">{t('A-new.coach_none')}</p> : (
          <div className="adm-table-wrap">
            <table className="adm-table" data-testid="coach-table">
              <thead><tr><th scope="col">{t('A-0193')}</th><th scope="col">{t('A-0182')}</th><th scope="col">{t('A-new.coach_state')}</th>{owner ? <th scope="col"><span className="adm-sr">{t('A-0192')}</span></th> : null}</tr></thead>
              <tbody>
                {coaches.map((c) => (
                  <tr key={c.coachId} data-testid={`coach-${c.coachId}`}>
                    <th scope="row">{c.displayName ?? t('A-new.coach_no_name')}</th>
                    <td>{tierName(c.tierId) || t('A-new.coach_no_tier')}</td>
                    <td>{t(c.active ? 'A-new.coach_active' : 'A-new.coach_inactive')} · {t(c.published ? 'A-new.coach_published' : 'A-new.coach_unpublished')}</td>
                    {owner ? <td><button type="button" className="adm-btn adm-btn-ghost" aria-expanded={open === c.coachId} onClick={() => setOpen(open === c.coachId ? null : c.coachId)} data-testid={`edit-${c.coachId}`}>{t('A-0192')}</button></td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {owner && open ? <Editor key={open} id={open} tiers={tiers} groups={groups} onSaved={reload} onClose={() => setOpen(null)} /> : null}

      <section className="adm-card" aria-labelledby="coach-away" data-testid="coach-away">
        <h2 id="coach-away">{t('A-new.coach_away_title')}</h2>
        {away.length === 0 ? <p className="adm-muted">{t('A-new.coach_away_none')}</p> : (
          <ul className="adm-list">
            {away.map((a) => <li key={a.leaveId}><span>{a.coachName ?? t('A-new.coach_no_name')} · {range(a)}</span><span className="adm-muted">{t(a.status === 'approved' ? 'A-new.coach_status_approved' : a.status === 'pending' ? 'A-new.coach_status_pending' : 'A-new.coach_status_declined')}</span></li>)}
          </ul>
        )}
      </section>
    </section>
  );
}

function FlagRow({ flag, coachName, onDone }: { flag: Flagged; coachName: string; onDone(): Promise<void> }) {
  const { slug, lang, t } = useAdmin();
  const f = () => window.fetch.bind(window);
  const [subs, setSubs] = useState<CoachRow[] | null>(null);
  const [pick, setPick] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void loadSubstitutes(slug, flag.bookingId, f()).then((r) => live && setSubs(r.kind === 'ok' ? r.body : []));
    return () => {
      live = false;
    };
  }, [slug, flag.bookingId]);
  async function go() {
    if (!pick) return setMsg({ key: 'A-new.coach_pick_sub', error: true });
    setBusy(true);
    const r = await assign(slug, flag.bookingId, pick, reasonFor(flag), f());
    setBusy(false);
    if (r.kind !== 'ok') return setMsg({ key: coachErrorKey(r), error: true });
    await onDone();
  }
  return (
    <div className="adm-rule" data-testid={`flag-${flag.bookingId}`}>
      <p>{dateOf(lang, flag.startAt)} · {timeOf(flag.startAt)} · {t('A-new.coach_flag_line', { coachName })}</p>
      <div className="adm-rule-control">
        <select value={pick} aria-label={t('A-0177')} onChange={(e) => setPick(e.target.value)} data-testid={`sub-${flag.bookingId}`}>
          <option value="">{t('A-0177')}</option>
          {(subs ?? []).map((s) => <option key={s.coachId} value={s.coachId}>{s.displayName ?? t('A-new.coach_no_name')}</option>)}
        </select>
        <button type="button" className="adm-btn" disabled={busy || subs === null} onClick={() => void go()} data-testid={`assign-${flag.bookingId}`}>{t('A-0178')}</button>
      </div>
      {subs !== null && subs.length === 0 ? <p className="adm-muted">{t('A-new.coach_no_subs')}</p> : null}
      {msg ? <p role="alert" className="adm-error" data-testid="flag-msg">{t(msg.key)}</p> : null}
    </div>
  );
}

function Editor({ id, tiers, groups, onSaved, onClose }: { id: string; tiers: Tier[]; groups: Group[]; onSaved(): Promise<void>; onClose(): void }) {
  const { slug, lang, t } = useAdmin();
  const f = () => window.fetch.bind(window);
  const [coach, setCoach] = useState<CoachFull | null>(null);
  const [was, setWas] = useState<ProfileDraft | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [pay, setPay] = useState<PayDraft | null>(null);
  const [gone, setGone] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [payMsg, setPayMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void Promise.all([loadCoach(slug, id, f()), loadPay(slug, id, f())]).then(([c, p]) => {
      if (!live) return;
      if (c.kind !== 'ok') return setGone(true);
      setCoach(c.body);
      const d = profileDraft(c.body, groups);
      setWas(d);
      setDraft(d);
      if (p.kind === 'ok') setPay(payDraft(p.body));
    });
    return () => {
      live = false;
    };
  }, [slug, id, groups]);
  if (gone) return <p role="alert" className="adm-error">{t('A-new.coach_err_gone')}</p>;
  if (!coach || !draft || !was) return <p aria-busy="true" className="adm-muted">…</p>;
  const set = (p: Partial<ProfileDraft>) => setDraft({ ...draft, ...p });
  const m = missing(coach);

  async function save() {
    const b = coachBody(coach!, was!, draft!);
    if (!b.ok) return setMsg({ key: b.key, error: true });
    setBusy(true);
    const r = await saveCoach(slug, id, b.body, f());
    setBusy(false);
    if (r.kind !== 'ok') return setMsg({ key: coachErrorKey(r), error: true });
    setCoach(r.body);
    const d = profileDraft(r.body, groups);
    setWas(d);
    setDraft(d);
    setMsg({ key: 'A-new.set_saved', error: false });
    await onSaved();
  }
  async function savePayNow() {
    if (!pay) return;
    const b = payBody(pay);
    if (!b.ok) return setPayMsg({ key: b.key, error: true });
    setBusy(true);
    const r = await savePay(slug, id, b.body, f());
    setBusy(false);
    setPayMsg(r.kind === 'ok' ? { key: 'A-new.set_saved', error: false } : { key: coachErrorKey(r), error: true });
  }
  const text = (k: keyof ProfileDraft, label: string, area = false) => (
    <label className="adm-field" key={k}><span>{label}</span>
      {area
        ? <textarea rows={3} value={draft[k] as string} disabled={busy} onChange={(e) => set({ [k]: e.target.value } as Partial<ProfileDraft>)} data-testid={`co-${k}`} />
        : <input value={draft[k] as string} disabled={busy} onChange={(e) => set({ [k]: e.target.value } as Partial<ProfileDraft>)} data-testid={`co-${k}`} />}
    </label>
  );
  const kindSel = (value: PayDraft['soloKind'], on: (v: PayDraft['soloKind']) => void, tid: string) => (
    <select value={value} disabled={busy} aria-label={t('A-0184')} onChange={(e) => on(e.target.value as PayDraft['soloKind'])} data-testid={tid}>
      <option value="">{t('A-new.coach_not_set')}</option><option value="fixed">{t('A-new.coach_pay_fixed')}</option><option value="percent">{t('A-new.coach_pay_percent')}</option>
    </select>
  );

  return (
    <section className="adm-card" aria-labelledby="coach-edit" data-testid="coach-editor">
      <h2 id="coach-edit">{coach.displayName ?? t('A-new.coach_no_name')}</h2>
      <p className="adm-muted">{m.th ? t('A-0196') : ''}{m.th && m.en ? ' · ' : ''}{m.en ? t('A-new.coach_english_missing') : ''}</p>
      <div className="adm-form">
        <label className="adm-field"><span>{t('A-0182')}</span>
          <select value={draft.tierId} disabled={busy} onChange={(e) => set({ tierId: e.target.value })} data-testid="co-tier">
            <option value="">{t('A-new.coach_no_tier')}</option>
            {tiers.map((x) => <option key={x.id} value={x.id}>{lang === 'th' ? x.nameTh : x.nameEn}</option>)}
          </select>
        </label>
        <h3>{t('A-0186')}</h3>
        {text('bioTh', t('A-new.coach_bio_th'), true)}{text('bioEn', t('A-new.coach_bio_en'), true)}
        {text('certificationsTh', t('A-new.coach_cert_th'))}{text('certificationsEn', t('A-new.coach_cert_en'))}
        {text('specialtiesTh', t('A-new.coach_spec_th'))}{text('specialtiesEn', t('A-new.coach_spec_en'))}
        {text('agesLevelsTh', t('A-new.coach_ages_th'))}{text('agesLevelsEn', t('A-new.coach_ages_en'))}
        {text('languages', t('A-new.coach_languages'))}
        <label className="adm-check"><input type="checkbox" checked={draft.consent} disabled={busy} onChange={(e) => set({ consent: e.target.checked })} data-testid="co-consent" /> {t('A-new.coach_consent')}</label>
        <label className="adm-check"><input type="checkbox" checked={draft.published} disabled={busy} onChange={(e) => set({ published: e.target.checked })} data-testid="co-published" /> {t('A-new.coach_publish')}</label>
        <label className="adm-check"><input type="checkbox" checked={draft.active} disabled={busy} onChange={(e) => set({ active: e.target.checked })} data-testid="co-active" /> {t('A-new.coach_active_label')}</label>
        {groups.length > 0 ? (
          <>
            <h3>{t('A-0183')}</h3>
            <p className="adm-muted">{t('A-new.coach_override_hint')}</p>
            {groups.map((g) => (
              <label key={g.id} className="adm-field"><span>{lang === 'th' ? g.nameTh : g.nameEn} · {t('A-new.price_baht_unit')}</span>
                <input inputMode="decimal" value={draft.overrides[g.id] ?? ''} placeholder={t('A-new.coach_not_set')} disabled={busy} onChange={(e) => set({ overrides: { ...draft.overrides, [g.id]: e.target.value } })} data-testid={`co-ovr-${g.id}`} />
              </label>
            ))}
          </>
        ) : null}
        {msg ? <p role={msg.error ? 'alert' : 'status'} className={msg.error ? 'adm-error' : 'adm-ok'} data-testid="co-msg">{t(msg.key)}</p> : null}
        <span className="adm-inline">
          <button type="button" className="adm-btn" disabled={busy} onClick={() => void save()} data-testid="co-save">{t('A-0321')}</button>
          <button type="button" className="adm-btn adm-btn-ghost" onClick={onClose} data-testid="co-close">{t('A-new.cal_close')}</button>
        </span>
      </div>

      {pay ? (
        <div className="adm-form" data-testid="coach-pay">
          <h3>{t('A-0184')}</h3>
          <label className="adm-field"><span>{t('A-new.coach_monthly')} · {t('A-new.price_baht_unit')}</span><input inputMode="decimal" value={pay.monthlyBase} placeholder={t('A-new.coach_not_set')} disabled={busy} onChange={(e) => setPay({ ...pay, monthlyBase: e.target.value })} data-testid="pay-base" /></label>
          <label className="adm-field"><span>{t('A-new.coach_solo_pay')}</span>{kindSel(pay.soloKind, (v) => setPay({ ...pay, soloKind: v }), 'pay-solo-kind')}
            <input inputMode="decimal" aria-label={t('A-new.coach_pay_value')} value={pay.soloValue} disabled={busy} onChange={(e) => setPay({ ...pay, soloValue: e.target.value })} data-testid="pay-solo-value" /></label>
          <label className="adm-field"><span>{t('A-new.coach_group_pay')}</span>{kindSel(pay.groupKind, (v) => setPay({ ...pay, groupKind: v }), 'pay-group-kind')}
            <input inputMode="decimal" aria-label={t('A-new.coach_pay_value')} value={pay.groupValue} disabled={busy} onChange={(e) => setPay({ ...pay, groupValue: e.target.value })} data-testid="pay-group-value" /></label>
          <p className="adm-muted">{t('A-new.coach_pay_hint')}</p>
          {payMsg ? <p role={payMsg.error ? 'alert' : 'status'} className={payMsg.error ? 'adm-error' : 'adm-ok'} data-testid="pay-msg">{t(payMsg.key)}</p> : null}
          <button type="button" className="adm-btn" disabled={busy} onClick={() => void savePayNow()} data-testid="pay-save">{t('A-0321')}</button>
        </div>
      ) : null}
    </section>
  );
}
