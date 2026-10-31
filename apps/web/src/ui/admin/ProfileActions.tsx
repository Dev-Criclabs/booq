'use client';
import { useState, type FormEvent } from 'react';
import { adjustCredit, adjustWallet, actionErrorKey, addNote, extendPackage, nextPackage, packageName, parseBaht, parseCredits, parseDay, type Note, type Value } from '../../client/admin/profile';
import { formatBaht } from '../../client/admin/api';
import { dateOf } from '../../client/admin/time';
import { useAdmin } from './AdminFrame';

// The panels of A6 that change something (F11-T15; ADMIN-07): staff notes, adjust a balance, extend a package. Each change is one request that the
// server writes as a ledger row or a note with who and why; the page shows the typed refusal in words and keeps what was typed. A balance is
// never edited as a number: only a change and a reason go out.

type Msg = { key: string; error: boolean } | null;
const say = (m: Msg, t: (k: string) => string) => (m ? <p role={m.error ? 'alert' : 'status'} className={m.error ? 'adm-error' : 'adm-ok'} data-testid="prof-msg">{t(m.key)}</p> : null);

export function NotesPanel({ id, notes, onChanged }: { id: string; notes: Note[]; onChanged(): Promise<void> }) {
  const { slug, lang, t } = useAdmin();
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (text.trim() === '') return setMsg({ key: 'A-new.prof_err_input', error: true });
    setBusy(true);
    const r = await addNote(slug, id, text, window.fetch.bind(window));
    setBusy(false);
    if (r.kind !== 'ok') return setMsg({ key: actionErrorKey(r), error: true });
    setText('');
    setMsg(null);
    await onChanged();
  }
  return (
    <section className="adm-card" aria-labelledby="prof-notes" data-testid="prof-notes">
      <h2 id="prof-notes">{t('A-0115')}</h2>
      {notes.length === 0 ? <p className="adm-muted">{t('A-new.prof_notes_empty')}</p> : (
        <ul className="adm-notes">{notes.map((n) => (
          <li key={n.noteId}><p>{n.note}</p><p className="adm-muted">{t('A-new.prof_note_by', { name: n.by ?? '', date: dateOf(lang, n.at) })}</p></li>
        ))}</ul>
      )}
      <form onSubmit={(e) => void submit(e)} className="adm-form">
        <label className="adm-field"><span>{t('A-new.prof_note_label')}</span><textarea rows={2} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} data-testid="prof-note-text" /></label>
        {say(msg, t)}
        <button type="submit" className="adm-btn" disabled={busy} data-testid="prof-note-add">{t('A-new.prof_note_add')}</button>
      </form>
    </section>
  );
}

export function AdjustPanel({ id, value, onChanged }: { id: string; value: Value | null; onChanged(): Promise<void> }) {
  const { slug, lang, t } = useAdmin();
  const [what, setWhat] = useState<'wallet' | 'credit'>('wallet');
  const [pkg, setPkg] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const packages = (value?.packages ?? []).filter((p) => p.status === 'active');
  const chosen = pkg || packages[0]?.packageId || '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const f = window.fetch.bind(window);
    if (reason.trim() === '') return setMsg({ key: 'A-new.prof_err_reason', error: true });
    setBusy(true);
    let r;
    if (what === 'wallet') {
      const satang = parseBaht(amount);
      if (satang === null) { setBusy(false); return setMsg({ key: 'A-new.prof_err_input', error: true }); }
      r = await adjustWallet(slug, id, satang, reason, f);
    } else {
      const delta = parseCredits(amount);
      if (delta === null || !chosen) { setBusy(false); return setMsg({ key: 'A-new.prof_err_input', error: true }); }
      r = await adjustCredit(slug, id, chosen, delta, reason, f);
    }
    setBusy(false);
    if (r.kind !== 'ok') return setMsg({ key: actionErrorKey(r), error: true });
    setAmount('');
    setReason('');
    setMsg({ key: 'A-new.prof_saved', error: false });
    await onChanged();
  }
  return (
    <section className="adm-card" aria-labelledby="prof-adjust" data-testid="prof-adjust">
      <h2 id="prof-adjust">{t('A-0117')}</h2>
      <form onSubmit={(e) => void submit(e)} className="adm-form">
        <label className="adm-field">
          <span>{t('A-new.prof_adjust_what')}</span>
          <select value={what} onChange={(e) => { setWhat(e.target.value as 'wallet' | 'credit'); setMsg(null); }} data-testid="adjust-what">
            <option value="wallet">{t('A-0055')}</option>
            <option value="credit">{t('A-0118')}</option>
          </select>
        </label>
        {what === 'credit' ? (
          packages.length === 0 ? <p className="adm-muted" data-testid="adjust-no-package">{t('A-new.prof_adjust_no_package')}</p> : (
            <label className="adm-field">
              <span>{t('A-new.prof_adjust_package')}</span>
              <select value={chosen} onChange={(e) => setPkg(e.target.value)} data-testid="adjust-package">
                {packages.map((p) => <option key={p.packageId} value={p.packageId}>{packageName(p, lang)}</option>)}
              </select>
            </label>
          )
        ) : null}
        <label className="adm-field">
          <span>{what === 'wallet' ? t('A-new.prof_adjust_wallet_hint', { amount: formatBaht(20000) }) : t('A-new.prof_adjust_credit_hint', { credits: 1 })}</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="adjust-amount" />
        </label>
        <label className="adm-field"><span>{t('A-0120')}</span><input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid="adjust-reason" /></label>
        {say(msg, t)}
        <button type="submit" className="adm-btn" disabled={busy || (what === 'credit' && packages.length === 0)} data-testid="adjust-save">{t('A-0121')}</button>
      </form>
    </section>
  );
}

export function ExtendPanel({ value, onChanged }: { value: Value | null; onChanged(): Promise<void> }) {
  const { slug, lang, t, owner } = useAdmin();
  const [pkg, setPkg] = useState('');
  const [day, setDay] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const packages = (value?.packages ?? []).filter((p) => p.status !== 'used_up');
  const chosen = pkg || nextPackage(packages)?.packageId || packages[0]?.packageId || '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const d = parseDay(day);
    if (reason.trim() === '') return setMsg({ key: 'A-new.prof_err_reason', error: true });
    if (!d || !chosen) return setMsg({ key: 'A-new.prof_err_input', error: true });
    setBusy(true);
    const r = await extendPackage(slug, chosen, d, reason, window.fetch.bind(window));
    setBusy(false);
    if (r.kind !== 'ok') return setMsg({ key: actionErrorKey(r), error: true });
    setDay('');
    setReason('');
    setMsg({ key: 'A-new.prof_saved', error: false });
    await onChanged();
  }
  return (
    <section className="adm-card" aria-labelledby="prof-extend" data-testid="prof-extend">
      <h2 id="prof-extend">{t('A-0122')} <span className="adm-chip">{t('A-0123')}</span></h2>
      <form onSubmit={(e) => void submit(e)} className="adm-form">
        <label className="adm-field">
          <span>{t('A-new.prof_adjust_package')}</span>
          <select value={chosen} disabled={!owner || packages.length === 0} onChange={(e) => setPkg(e.target.value)} data-testid="extend-package">
            {packages.map((p) => <option key={p.packageId} value={p.packageId}>{packageName(p, lang)}</option>)}
          </select>
        </label>
        <label className="adm-field"><span>{t('A-new.prof_extend_day')}</span><input type="date" value={day} disabled={!owner} onChange={(e) => setDay(e.target.value)} data-testid="extend-day" /></label>
        <label className="adm-field"><span>{t('A-new.prof_extend_reason')}</span><input value={reason} disabled={!owner} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid="extend-reason" /></label>
        {say(msg, t)}
        <button type="submit" className="adm-btn" disabled={busy || !owner || packages.length === 0} data-testid="extend-save">{t('A-0122')}</button>
      </form>
    </section>
  );
}
