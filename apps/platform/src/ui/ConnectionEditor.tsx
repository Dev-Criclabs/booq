'use client';
import { useState, type FormEvent } from 'react';
import type { Failure } from './club';
import { beamFields, buildBody, MODES, LINE_FIELDS, probeKey, sendConnection, type ConnectionKind, type Mode, type Values } from './connections';
import { t } from './i18n';

// The LINE or the Beam connection of a club (wizard steps 4 and 5, support view): type the values, test them, save. A failed test saves
// nothing; the staff member may save anyway, and the failed check then shows in P1 (D167). Secrets are typed and sent, never shown again.
// A write needs a fresh second factor: the page opens the step-up and runs the same save again. English only; text by key.

export function ConnectionEditor({ id, kind, canEdit, option, askStepUp, onNotice, onSaved }: {
  id: string;
  kind: ConnectionKind;
  canEdit: boolean;
  /** Payments: the payment option chosen for the club. Beam fields show for Beam only. */
  option?: 'beam' | 'slip' | '';
  askStepUp(run: () => Promise<void>): void;
  onNotice(n: { key: string; error: boolean }): void;
  onSaved?(): void | Promise<void>;
}) {
  const [values, setValues] = useState<Values>({});
  const [mode, setMode] = useState<Mode>('test');
  const [planKind, setPlanKind] = useState('');
  const [limit, setLimit] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ code: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<'pass' | 'fail' | null>(null);

  const defs = kind === 'line' ? LINE_FIELDS : beamFields(mode);
  const applies = kind === 'line' || option === 'beam';

  async function run(saveAnyway: boolean) {
    const b = buildBody(kind, values, { mode, ...(option !== undefined ? { option } : {}), planKind, limit });
    if (!b.ok) return setProblem(b.key);
    setProblem(null);
    const attempt = async (): Promise<void> => {
      setBusy(true);
      const r = await sendConnection(window.fetch.bind(window), id, kind, b.body, { saveAnyway });
      setBusy(false);
      if (r.kind === 'error') {
        const f = r as Failure;
        if (f.stepUp) return askStepUp(attempt);
        return onNotice({ key: f.key, error: true });
      }
      if (r.kind === 'test_failed') return setFailed({ code: r.code });
      setFailed(null);
      setSaved(r.tested);
      setValues({}); // typed secrets are not kept on screen once sent
      onNotice({ key: r.tested === 'pass' ? 'X-new.conn_saved_passed' : 'X-new.conn_saved_failed', error: r.tested !== 'pass' });
      await onSaved?.();
    };
    await attempt();
  }
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFailed(null);
    void run(false);
  };

  if (!applies) return <p className="sub" data-testid="conn-na">{t('X-new.conn_not_for_option')}</p>;
  const off = !canEdit || busy;
  return (
    <form onSubmit={onSubmit} className="form" data-testid={`conn-${kind}`} noValidate>
      <p className="sub">{t('X-new.conn_hint')}</p>
      {kind === 'payments' ? (
        <div className="field">
          <label htmlFor="conn-mode">{t('X-new.conn_mode')}</label>
          <select id="conn-mode" value={mode} disabled={off} onChange={(e) => setMode(e.target.value as Mode)}>
            {MODES.map((m) => <option key={m} value={m}>{t(`X-new.conn_mode_${m}`)}</option>)}
          </select>
        </div>
      ) : null}
      {defs.map((d) => (
        <div className="field" key={d.name}>
          <label htmlFor={`conn-${d.name}`}>{t(d.labelKey)}{d.testNeeds ? '' : ` · ${t('X-new.conn_optional')}`}</label>
          <input id={`conn-${d.name}`} data-testid={`conn-${d.name}`} type={d.secret ? 'password' : 'text'} autoComplete="off" value={values[d.name] ?? ''} disabled={off}
            onChange={(e) => setValues({ ...values, [d.name]: e.target.value })} />
        </div>
      ))}
      {kind === 'line' ? (
        <>
          <div className="field">
            <label htmlFor="conn-plan-kind">{t('X-new.conn_plan_kind')}</label>
            <select id="conn-plan-kind" value={planKind} disabled={off} onChange={(e) => setPlanKind(e.target.value)}>
              <option value="">{t('X-new.config_not_set')}</option>
              <option value="free">{t('X-new.conn_plan_free')}</option>
              <option value="paid">{t('X-new.conn_plan_paid')}</option>
            </select>
          </div>
          <div className="field"><label htmlFor="conn-limit">{t('X-new.conn_plan_limit')}</label><input id="conn-limit" inputMode="numeric" value={limit} disabled={off} onChange={(e) => setLimit(e.target.value)} /></div>
        </>
      ) : null}
      {problem ? <p role="alert" className="error" data-testid="conn-problem">{t(problem)}</p> : null}
      {failed ? (
        <div role="alert" className="notice" data-testid="conn-failed">
          <p>{t(probeKey(failed.code), { code: failed.code })}</p>
          <p className="sub">{t('X-new.conn_failed_not_saved')}</p>
          <button type="button" className="btn secondary" disabled={off} onClick={() => void run(true)} data-testid="conn-save-anyway">{t('X-new.conn_save_anyway')}</button>
        </div>
      ) : null}
      {saved ? <p className="sub" data-testid="conn-result">{t(saved === 'pass' ? 'X-0102' : 'X-new.conn_result_failed')}</p> : null}
      {canEdit ? <button type="submit" className="btn" disabled={busy} data-testid="conn-submit">{t('X-new.conn_test_and_save')}</button> : null}
    </form>
  );
}
