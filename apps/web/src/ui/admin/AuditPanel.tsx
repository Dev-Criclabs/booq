'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { changeLines, checkQuery, loadAudit, loadRecordTypes, type AuditEntry, type AuditQuery } from '../../client/admin/audit';
import type { StaffMember } from '../../client/admin/staff';
import { dateOf, timeOf } from '../../client/admin/time';
import { dayMonthOf } from '../../client/admin/shell';
import { useAdmin } from './AdminFrame';

// A17 Audit log (F11-T23; ADMIN-17): read only, newest first, filters for who, record type and days. A change is shown as what the fields were and
// are; a personal field is named, never shown (SR-04). There is no control that edits or removes an entry.

type State = { kind: 'loading' } | { kind: 'ready'; entries: AuditEntry[]; next: string | null; busy: boolean } | { kind: 'error' } | { kind: 'forbidden' };

export function AuditPanel({ staff }: { staff: StaffMember[] }) {
  const { slug, lang, t } = useAdmin();
  const [q, setQ] = useState<AuditQuery>({ staff: '', type: '', from: '', to: '' });
  const [types, setTypes] = useState<string[]>([]);
  const [applied, setApplied] = useState<AuditQuery>(q);
  const [problem, setProblem] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const ticket = useRef(0);
  useEffect(() => {
    void loadRecordTypes(slug, window.fetch.bind(window)).then(setTypes);
  }, [slug]);

  const run = useCallback(async (query: AuditQuery, append: AuditEntry[] = []) => {
    const mine = ++ticket.current;
    const r = await loadAudit(slug, query, window.fetch.bind(window));
    if (mine !== ticket.current) return;
    if (r.kind === 'ok') setState({ kind: 'ready', entries: [...append, ...r.body.entries], next: r.body.next, busy: false });
    else setState(r.kind === 'forbidden' ? { kind: 'forbidden' } : { kind: 'error' });
  }, [slug]);
  useEffect(() => {
    void run(applied);
  }, [run, applied]);

  const apply = () => {
    const c = checkQuery(q);
    if (!c.ok) return setProblem(c.key);
    setProblem(null);
    setState({ kind: 'loading' });
    setApplied({ ...q });
  };
  const more = () => {
    if (state.kind !== 'ready' || !state.next || state.busy) return;
    setState({ ...state, busy: true });
    void run({ ...applied, cursor: state.next }, state.entries);
  };

  return (
    <section data-testid="audit" aria-labelledby="audit-title">
      <h2 id="audit-title" className="adm-h2">{t('A-0381')}</h2>
      <p className="adm-muted">{t('A-new.audit_note')}</p>
      <div className="adm-filters">
        <label className="adm-field"><span className="adm-sr">{t('A-0014')}</span>
          <select value={q.staff} onChange={(e) => setQ({ ...q, staff: e.target.value })} data-testid="audit-staff">
            <option value="">{t('A-new.audit_staff_all')}</option>
            {staff.map((m) => <option key={m.id} value={m.id}>{m.display_name ?? m.id}</option>)}
          </select>
        </label>
        <label className="adm-field"><span className="adm-sr">{t('A-new.audit_type_label')}</span>
          {types.length > 0 ? (
            <select value={q.type} aria-label={t('A-new.audit_type_label')} onChange={(e) => setQ({ ...q, type: e.target.value })} data-testid="audit-type">
              <option value="">{t('A-new.audit_type_placeholder')}</option>
              {types.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          ) : (
            <input value={q.type} placeholder={t('A-new.audit_type_placeholder')} aria-label={t('A-new.audit_type_label')} onChange={(e) => setQ({ ...q, type: e.target.value })} data-testid="audit-type" />
          )}
        </label>
        <label className="adm-field"><span className="adm-sr">{t('A-new.audit_from')}</span><input type="date" aria-label={t('A-new.audit_from')} value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} data-testid="audit-from" /></label>
        <label className="adm-field"><span className="adm-sr">{t('A-new.audit_to')}</span><input type="date" aria-label={t('A-new.audit_to')} value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} data-testid="audit-to" /></label>
        <button type="button" className="adm-btn" onClick={apply} data-testid="audit-apply">{t('A-new.audit_apply')}</button>
      </div>
      {problem ? <p role="alert" className="adm-error" data-testid="audit-problem">{t(problem)}</p> : null}

      {state.kind === 'loading' ? <p aria-busy="true" className="adm-muted">…</p> : null}
      {state.kind === 'forbidden' ? <p role="alert" data-testid="audit-forbidden">{t('A-new.audit_forbidden')}</p> : null}
      {state.kind === 'error' ? <div role="alert" data-testid="audit-error"><p>{t('A-new.audit_load_failed')}</p><button type="button" className="adm-btn" onClick={() => setApplied({ ...applied })}>{t('A-new.cust_retry')}</button></div> : null}
      {state.kind === 'ready' && state.entries.length === 0 ? <p className="adm-muted" data-testid="audit-empty">{t('A-new.audit_empty')}</p> : null}
      {state.kind === 'ready' && state.entries.length > 0 ? (
        <>
          <div className="adm-table-wrap">
            <table className="adm-table adm-audit" data-testid="audit-table">
              <thead><tr><th scope="col">{t('A-0385')}</th><th scope="col">{t('A-0258')}</th><th scope="col">{t('A-0386')}</th><th scope="col">{t('A-0387')}</th><th scope="col">{t('A-0135')}</th></tr></thead>
              <tbody>
                {state.entries.map((e) => (
                  <tr key={e.entryId} data-testid={`audit-${e.entryId}`}>
                    <td className="adm-nowrap">{t('A-0388', { dayMonth: dayMonthOf(lang, e.at), time: timeOf(e.at) })}<br /><span className="adm-muted">{dateOf(lang, e.at)}</span></td>
                    <td>{e.actorLabel || t('A-new.audit_system')}</td>
                    <td>{e.recordType}{e.recordKey ? ` · ${e.recordKey}` : ''}</td>
                    <td>
                      <strong>{e.action}</strong>
                      {changeLines(e).map((l, i) => <div key={i} className="adm-change">{l}</div>)}
                      {e.piiFields.length > 0 ? <div className="adm-muted">{t('A-new.audit_pii', { fields: e.piiFields.join(', ') })}</div> : null}
                    </td>
                    <td>{e.reason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {state.next ? <button type="button" className="adm-btn adm-btn-ghost" disabled={state.busy} onClick={more} data-testid="audit-more">{t('A-new.audit_more')}</button> : null}
        </>
      ) : null}
    </section>
  );
}
