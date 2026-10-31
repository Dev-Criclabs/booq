'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  canTellDone, cancelImport, confirmable, confirmImport, FILE_ERROR_KEY, FLAG_KEY, importErrorKey, loadSetup, MAX_FILE_BYTES, ROW_ERROR_KEY, showsChecklist, startImport, STEP_KEYS, stepsLeft, tellDone,
  type ImportSummary, type OwnerSetup,
} from '../../client/admin/setup';
import { adminPath, BUILT } from '../../client/admin/shell';
import { useAdmin } from './AdminFrame';

// A0 Setup checklist (F11-T24; ADMIN-02; board H-A0-Setup-checklist; owner, until the club is live). Steps 1 to 5 are BOOQ's; the owner works steps
// 6 to 8 and tells BOOQ when they are done, which unlocks only when all three are. Step 7 holds the players CSV import: validate, read the result,
// confirm or cancel (all or nothing; no bookings are created). Logo, colours and menu labels have no route yet (brand is shown, not edited).
// There is no toggle to show the club address (D54).

type Load = { kind: 'loading' } | { kind: 'ready'; setup: OwnerSetup } | { kind: 'error' } | { kind: 'forbidden' };
type Msg = { key: string; error: boolean; vars?: Record<string, number> } | null;

export function SetupScreen() {
  const { slug, t } = useAdmin();
  const f = () => window.fetch.bind(window);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const r = await loadSetup(slug, f());
    if (r.kind === 'ok') setLoad({ kind: 'ready', setup: r.body });
    else setLoad({ kind: r.kind === 'forbidden' ? 'forbidden' : 'error' });
  }, [slug]);
  useEffect(() => {
    void reload();
  }, [reload]);

  async function told() {
    setBusy(true);
    const r = await tellDone(slug, f());
    setBusy(false);
    if (r.kind !== 'ok') return setMsg({ key: 'A-new.setup_tell_failed', error: true });
    setMsg({ key: 'A-new.setup_told', error: false });
    await reload();
  }

  if (load.kind === 'loading') return <p aria-busy="true" className="adm-muted">…</p>;
  if (load.kind === 'forbidden') return <p role="alert" data-testid="setup-forbidden">{t('A-new.setup_forbidden')}</p>;
  if (load.kind === 'error') return <div role="alert" data-testid="setup-error"><p>{t('A-new.setup_load_failed')}</p><button type="button" className="adm-btn" onClick={() => { setLoad({ kind: 'loading' }); void reload(); }}>{t('A-new.cust_retry')}</button></div>;

  const s = load.setup;
  if (!showsChecklist(s)) return <p data-testid="setup-live">{t('A-new.setup_live')}</p>;
  const left = stepsLeft(s);
  const done = (k: string) => s.steps.find((x) => x.key === k)?.done ?? false;
  return (
    <section data-testid="setup" aria-labelledby="setup-title">
      <header className="adm-head"><h1 id="setup-title">{t('A-0488')}</h1></header>
      <div className="adm-banner" data-testid="setup-banner">
        <div><p className="adm-banner-title">{t('A-0490')}</p><p className="adm-banner-text">{t('A-0491')}</p></div>
        <span className="adm-chip" data-testid="setup-left">{t('A-0492', { count: left })}</span>
      </div>
      <div className="adm-card" data-testid="steps-booq"><h2>{t('A-0493')}</h2><p>{t('A-0494')}</p></div>

      {STEP_KEYS.map((st) => (
        <div key={st.key} className="adm-card" data-testid={`step-${st.key}`}>
          <h2>{t(st.titleKey)} <span className="adm-chip" data-testid={`state-${st.key}`}>{t(done(st.key) ? 'A-new.setup_done' : 'A-new.setup_open')}</span></h2>
          {st.textKey ? <p>{t(st.textKey)}</p> : <p className="adm-muted">{t('A-new.setup_brand_note')}</p>}
          {st.segment && BUILT.has(st.segment) ? <a className="adm-btn adm-btn-ghost" href={adminPath(slug, st.segment)} data-testid={`go-${st.segment}`}>{t(st.segment === 'pricing' ? 'A-new.setup_go_pricing' : 'A-new.setup_go_staff')}</a> : null}
          {st.key === 'products_rules' ? <ImportPanel onSaved={reload} /> : null}
        </div>
      ))}

      <div className="adm-card" data-testid="step-launch"><h2>{t('A-0501')}</h2><p className="adm-muted">{t('A-0502')}</p></div>
      {msg ? <p role={msg.error ? 'alert' : 'status'} className={msg.error ? 'adm-error' : 'adm-ok'} data-testid="setup-msg">{t(msg.key)}</p> : null}
      {s.toldAt ? <p className="adm-ok" data-testid="setup-told">{t('A-new.setup_told')}</p> : null}
      <button type="button" className="adm-btn" disabled={busy || !canTellDone(s)} onClick={() => void told()} data-testid="tell-done">{t('A-0503')}</button>
      {!canTellDone(s) && !s.toldAt ? <p className="adm-muted" data-testid="tell-locked">{t('A-0504')}</p> : null}
    </section>
  );
}

function ImportPanel({ onSaved }: { onSaved(): Promise<void> }) {
  const { slug, t } = useAdmin();
  const f = () => window.fetch.bind(window);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  async function choose(file: File | undefined) {
    if (!file) return;
    setMsg(null);
    setSummary(null);
    if (file.size > MAX_FILE_BYTES) return setMsg({ key: 'A-new.import_too_big', error: true });
    setBusy(true);
    const r = await startImport(slug, file.name, await file.text(), f());
    setBusy(false);
    if (r.kind !== 'ok') return setMsg({ key: importErrorKey(r), error: true });
    setSummary(r.body);
  }
  async function confirm() {
    if (!summary) return;
    setBusy(true);
    const r = await confirmImport(slug, summary.id, f());
    setBusy(false);
    if (r.kind !== 'ok') return setMsg({ key: importErrorKey(r), error: true });
    setSummary(null);
    setMsg({ key: 'A-new.import_saved', error: false, vars: { count: r.body.rowsSaved } });
    await onSaved();
  }
  async function cancel() {
    if (!summary) return;
    setBusy(true);
    const r = await cancelImport(slug, summary.id, f());
    setBusy(false);
    if (r.kind !== 'ok') return setMsg({ key: importErrorKey(r), error: true });
    setSummary(null);
    setMsg({ key: 'A-new.import_cancelled', error: false });
  }

  return (
    <div className="adm-import" data-testid="import">
      <h3>{t('A-new.import_title')}</h3>
      <p className="adm-muted">{t('A-new.import_hint')}</p>
      <label className="adm-btn adm-btn-ghost adm-file">
        <span>{t('A-new.import_choose')}</span>
        <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ''; }} data-testid="import-file" />
      </label>
      {msg ? <p role={msg.error ? 'alert' : 'status'} className={msg.error ? 'adm-error' : 'adm-ok'} data-testid="import-msg">{t(msg.key, msg.vars)}</p> : null}
      {summary ? (
        <div data-testid="import-summary">
          <p>{t('A-new.import_read', { count: summary.rowsRead })}</p>
          {summary.fileErrors.map((c) => <p key={c} role="alert" className="adm-error">{t(FILE_ERROR_KEY[c] ?? 'A-new.import_bad')}</p>)}
          {summary.rowsRejected > 0 ? <p role="alert" className="adm-error">{t('A-new.import_rejected', { count: summary.rowsRejected })}</p> : null}
          {summary.errors.length > 0 ? (
            <ul className="adm-list" data-testid="import-errors">
              {summary.errors.slice(0, 50).map((e) => <li key={e.rowNo}><span>{t('A-new.import_row', { row: e.rowNo })} · {e.codes.map((c) => t(ROW_ERROR_KEY[c] ?? 'A-new.import_bad')).join(' · ')}</span></li>)}
            </ul>
          ) : null}
          {summary.flags.length > 0 ? <ul className="adm-list">{summary.flags.slice(0, 50).map((x) => <li key={x.rowNo}><span>{t('A-new.import_row', { row: x.rowNo })} · {x.flags.map((c) => t(FLAG_KEY[c] ?? 'A-new.import_bad')).join(' · ')}</span></li>)}</ul> : null}
          {confirmable(summary) ? <p className="adm-ok">{t('A-new.import_ready', { count: summary.rowsRead })}</p> : null}
          <div className="adm-row">
            <button type="button" className="adm-btn" disabled={busy || !confirmable(summary)} onClick={() => void confirm()} data-testid="import-confirm">{t('A-new.import_confirm')}</button>
            <button type="button" className="adm-btn adm-btn-ghost" disabled={busy} onClick={() => void cancel()} data-testid="import-cancel">{t('A-new.import_cancel')}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
