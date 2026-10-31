'use client';
import { useEffect, useState } from 'react';
import { DEFS, DISCOUNT_KINDS, draftOf, GROUPS, parseDraft, rowsOf, ruleErrorKey, saveRule, type SettingRow } from '../../client/admin/rules';
import { useAdmin } from './AdminFrame';

// A16 Settings: the rules of the club (booking, payment and waitlist, coaches and classes, packages and wallet), one card per group of the board. Each
// setting saves on its own. A setting nobody has set stays empty: no value is filled in. The server checks every value again and refuses a wrong one.

type Msg = { key: string; error: boolean } | null;

export function RulesCards({ rows, canEdit, onChanged }: { rows: SettingRow[]; canEdit: boolean; onChanged(): Promise<void> }) {
  const { slug, t } = useAdmin();
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.key, draftOf(r)])));
  const [msgs, setMsgs] = useState<Record<string, Msg>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => setDrafts(Object.fromEntries(rows.map((r) => [r.key, draftOf(r)]))), [rows]);
  const set = (k: string, v: string) => setDrafts((d) => ({ ...d, [k]: v }));
  const say = (k: string, m: Msg) => setMsgs((x) => ({ ...x, [k]: m }));

  async function save(row: SettingRow) {
    const p = parseDraft(row, drafts[row.key] ?? '');
    if (!p.ok) return say(row.key, { key: p.key, error: true });
    setBusy(true);
    const r = await saveRule(slug, row.key, p.value, window.fetch.bind(window));
    setBusy(false);
    if (r.kind !== 'ok') return say(row.key, { key: ruleErrorKey(r), error: true });
    say(row.key, { key: 'A-new.set_saved', error: false });
    await onChanged();
  }

  return (
    <>
      {GROUPS.map((g) => {
        const list = rowsOf(rows, g.id);
        if (list.length === 0) return null;
        return (
          <section key={g.id} className="adm-card" aria-labelledby={`set-g-${g.id}`} data-testid={`set-group-${g.id}`}>
            <h2 id={`set-g-${g.id}`}>{t(g.titleKey)}</h2>
            {list.map((row) => {
              const def = DEFS[row.key]!;
              const f = def.field;
              const draft = drafts[row.key] ?? '';
              const off = !canEdit || !row.available || busy;
              const id = `s-${row.key}`;
              return (
                <div key={row.key} className="adm-rule" data-testid={`rule-${row.key}`}>
                  <label htmlFor={id} className="adm-rule-label">{t(def.labelKey)}{row.required ? ` · ${t('A-new.set_required')}` : ''}</label>
                  {!row.available ? <p className="adm-muted">{t('A-new.set_err_not_available')}</p> : null}
                  <div className="adm-rule-control">
                    {f.kind === 'choice' || f.kind === 'bool' ? (
                      <select id={id} value={draft} disabled={off} onChange={(e) => set(row.key, e.target.value)}>
                        <option value="">{t('A-new.set_not_set')}</option>
                        {f.kind === 'bool'
                          ? [<option key="t" value="true">{t('A-new.set_option_on')}</option>, <option key="f" value="false">{t('A-new.set_option_off')}</option>]
                          : f.options.map((o) => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
                      </select>
                    ) : f.kind === 'discount' ? (
                      <span className="adm-inline">
                        <select id={id} aria-label={t('A-new.set_discount_kind')} value={draft.split(' ')[0] ?? ''} disabled={off} onChange={(e) => set(row.key, e.target.value === '' ? '' : `${e.target.value} ${draft.split(' ')[1] ?? ''}`.trim())}>
                          <option value="">{t('A-new.set_not_set')}</option>
                          {DISCOUNT_KINDS.map((k) => <option key={k} value={k}>{t(`A-new.set_discount_${k}`)}</option>)}
                        </select>
                        <input aria-label={t('A-new.set_discount_amount')} inputMode="numeric" value={draft.split(' ')[1] ?? ''} disabled={off} onChange={(e) => set(row.key, `${draft.split(' ')[0] || 'percent'} ${e.target.value}`.trim())} data-testid={`rule-${row.key}-amount`} />
                      </span>
                    ) : (
                      <span className="adm-inline">
                        <input id={id} inputMode="numeric" value={draft} disabled={off} onChange={(e) => set(row.key, e.target.value)} data-testid={`rule-${row.key}-input`} />
                        {f.kind === 'whole' && f.unit ? <span className="adm-muted">{t(f.unit)}</span> : null}
                      </span>
                    )}
                    {canEdit && row.available ? <button type="button" className="adm-btn adm-btn-ghost" disabled={off} onClick={() => void save(row)} data-testid={`rule-${row.key}-save`}>{t('A-0321')}</button> : null}
                  </div>
                  {msgs[row.key] ? <p role={msgs[row.key]!.error ? 'alert' : 'status'} className={msgs[row.key]!.error ? 'adm-error' : 'adm-ok'} data-testid={`rule-${row.key}-msg`}>{t(msgs[row.key]!.key)}</p> : null}
                </div>
              );
            })}
          </section>
        );
      })}
    </>
  );
}
