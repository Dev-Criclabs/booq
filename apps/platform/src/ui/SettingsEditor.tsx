'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Failure } from './club';
import { t } from './i18n';
import { DISCOUNT_KINDS, draftOf, FIELDS, labelKey, loadSettings, parseDraft, saveSetting, type SettingRow, type SettingsView } from './settings';

// The club settings of the support view (P3b): every setting with its value or "Not set", and a box to change one at a time while the
// club may be changed (Draft or Testing, or the owner's window). A write needs a fresh second factor: the page opens the step-up and
// runs the same save again. No value is filled in for a setting nobody has set. English only; text by key.

type Load = { kind: 'loading' } | { kind: 'error'; key: string } | { kind: 'ready'; view: SettingsView };

export function SettingsEditor({ id, canEdit, askStepUp, onNotice }: {
  id: string;
  canEdit: boolean;
  askStepUp(run: () => Promise<void>): void;
  onNotice(n: { key: string; error: boolean }): void;
}) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<{ key: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const r = await loadSettings(window.fetch.bind(window), id);
    if (r.kind !== 'ok') return setLoad({ kind: 'error', key: (r as Failure).key });
    setLoad({ kind: 'ready', view: r.view });
    setDrafts(Object.fromEntries(r.view.settings.map((s) => [s.key, draftOf(s)])));
  }, [id]);
  useEffect(() => {
    void reload();
  }, [reload]);

  async function save(row: SettingRow) {
    const p = parseDraft(row, drafts[row.key] ?? '');
    if (!p.ok) return setProblem({ key: row.key, text: p.key });
    setProblem(null);
    const attempt = async (): Promise<void> => {
      setBusy(true);
      const r = await saveSetting(window.fetch.bind(window), id, row.key, p.value);
      setBusy(false);
      if (r.kind === 'error') {
        const f = r as Failure;
        if (f.stepUp) return askStepUp(attempt);
        return onNotice({ key: f.key, error: true });
      }
      onNotice({ key: 'X-new.settings_saved', error: false });
      await reload();
    };
    await attempt();
  }

  if (load.kind === 'loading') return <p aria-busy="true">…</p>;
  if (load.kind === 'error') return <p role="alert" data-testid="settings-error">{t(load.key)}</p>;
  const { view } = load;
  const edit = canEdit && view.editable;
  const set = (key: string, v: string) => setDrafts((d) => ({ ...d, [key]: v }));

  return (
    <div data-testid="settings">
      <p className="sub">{t(edit ? 'X-new.settings_hint' : 'X-new.settings_look')}</p>
      {view.settings.map((row) => {
        const f = FIELDS[row.key];
        const draft = drafts[row.key] ?? '';
        const id_ = `s-${row.key}`;
        const off = !edit || !row.available || busy;
        return (
          <div key={row.key} className="field" data-testid={`setting-${row.key}`}>
            <label htmlFor={id_}>{t(labelKey(row.key))}{row.required ? ` · ${t('X-new.settings_required')}` : ''}</label>
            {!row.available ? <p className="sub">{t('X-new.settings_not_available')}</p> : null}
            {!edit ? (
              <p data-testid={`setting-value-${row.key}`}>{row.unset ? t('X-new.config_not_set') : draftOf(row)}</p>
            ) : f?.kind === 'choice' || f?.kind === 'bool' ? (
              <select id={id_} value={draft} disabled={off} onChange={(e) => set(row.key, e.target.value)}>
                <option value="">{t('X-new.config_not_set')}</option>
                {(f.kind === 'bool' ? ['true', 'false'] : f.options).map((o) => <option key={o} value={o}>{f.kind === 'bool' ? t(o === 'true' ? 'X-new.feature_on' : 'X-new.feature_off') : o}</option>)}
              </select>
            ) : f?.kind === 'discount' ? (
              <div className="row">
                <select id={id_} aria-label={t('X-new.settings_discount_kind')} value={draft.split(' ')[0] ?? ''} disabled={off} onChange={(e) => set(row.key, e.target.value === '' ? '' : `${e.target.value} ${draft.split(' ')[1] ?? ''}`.trim())}>
                  <option value="">{t('X-new.config_not_set')}</option>
                  {DISCOUNT_KINDS.map((k) => <option key={k} value={k}>{t(`X-new.settings_discount_${k}`)}</option>)}
                </select>
                <input aria-label={t('X-new.settings_discount_amount')} inputMode="numeric" value={draft.split(' ')[1] ?? ''} disabled={off} onChange={(e) => set(row.key, `${draft.split(' ')[0] || 'percent'} ${e.target.value}`.trim())} data-testid={`setting-amount-${row.key}`} />
              </div>
            ) : (
              <input id={id_} inputMode="numeric" value={draft} disabled={off} onChange={(e) => set(row.key, e.target.value)} />
            )}
            {problem?.key === row.key ? <p role="alert" className="error" data-testid={`setting-problem-${row.key}`}>{t(problem.text)}</p> : null}
            {edit && row.available ? <button type="button" className="btn secondary" disabled={off} onClick={() => void save(row)} data-testid={`save-setting-${row.key}`}>{t('X-new.config_save')}</button> : null}
          </div>
        );
      })}
    </div>
  );
}
