'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatBaht } from '../../client/admin/api';
import { appendPage, chipGroups, csvHref, loadCustomers, loadPriceGroups, nameOf, profilePath, STATUS_KEY, STATUSES, type CustomerRow, type Status } from '../../client/admin/customers';
import { dayMonthOf } from '../../client/admin/shell';
import { useAdmin } from './AdminFrame';

// A5 Customers (F11-T15; ADMIN-06; board H-A05-Customers): the club's customers by name with search, a tag filter, the chips (All, one chip per price
// group such as Adult and Student, Active package, Expiring soon, No visit in 30 days), the columns type, package, wallet and last visit, tags,
// Export CSV, and a row that opens the profile. Expiring soon uses the club's reminder days; when the club has set none the server says so and the
// page says so (no days are invented). English and Thai from the language files; long text wraps in the cell.

type State = { kind: 'loading' } | { kind: 'ready'; rows: CustomerRow[]; next: string | null; busy: boolean } | { kind: 'error' } | { kind: 'forbidden' } | { kind: 'unset' };

export function CustomersScreen() {
  const { slug, lang, t } = useAdmin();
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [status, setStatus] = useState<Status | ''>('');
  const [group, setGroup] = useState('');
  const [known, setKnown] = useState<Array<{ id: string; nameTh: string; nameEn: string }>>([]);
  const [seen, setSeen] = useState<Array<{ id: string; nameTh: string; nameEn: string }>>([]);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const ticket = useRef(0);

  useEffect(() => {
    void loadPriceGroups(slug, window.fetch.bind(window)).then(setKnown);
  }, [slug]);

  useEffect(() => {
    const mine = ++ticket.current;
    setState((s) => (s.kind === 'ready' ? { ...s, busy: true } : { kind: 'loading' }));
    const timer = setTimeout(() => {
      void loadCustomers(slug, { q, tag, status, group }, window.fetch.bind(window)).then((r) => {
        if (mine !== ticket.current) return;
        if (r.kind === 'ok') {
          setState({ kind: 'ready', rows: r.body.customers, next: r.body.next, busy: false });
          if (!status && !group) setSeen(chipGroups([], r.body.customers));
        } else if (r.kind === 'refused' && r.code === 'setting_unset') setState({ kind: 'unset' });
        else if (r.kind === 'forbidden') setState({ kind: 'forbidden' });
        else setState({ kind: 'error' });
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [slug, q, tag, status, group, attempt]);

  const more = useCallback(async () => {
    if (state.kind !== 'ready' || !state.next || state.busy) return;
    const mine = ++ticket.current;
    setState({ ...state, busy: true });
    const r = await loadCustomers(slug, { q, tag, status, group, cursor: state.next }, window.fetch.bind(window));
    if (mine !== ticket.current) return;
    if (r.kind === 'ok') setState({ kind: 'ready', rows: appendPage(state.rows, r.body), next: r.body.next, busy: false });
    else setState({ ...state, busy: false });
  }, [state, slug, q, tag, status, group]);

  const filtered = q.trim() !== '' || tag.trim() !== '' || status !== '' || group !== '';
  const groups = chipGroups(known, state.kind === 'ready' ? state.rows : []).length > 0 ? chipGroups(known, state.kind === 'ready' ? state.rows : []) : seen;
  const chip = (label: string, on: boolean, click: () => void, id: string) => <button key={id} type="button" className="adm-chip-btn" aria-pressed={on} onClick={click} data-testid={`chip-${id}`}>{label}</button>;
  return (
    <section data-testid="customers" aria-labelledby="cust-title">
      <header className="adm-head">
        <h1 id="cust-title">{t('A-0003')}{state.kind === 'ready' && !state.next ? <span className="adm-count" data-testid="cust-count"> · {t('A-0065', { count: state.rows.length })}</span> : null}</h1>
        <a className="adm-btn adm-btn-ghost" href={csvHref(slug)} download data-testid="cust-export">{t('A-0066')}</a>
      </header>
      <div className="adm-filters">
        <label className="adm-field adm-grow">
          <span className="adm-sr">{t('A-new.cust_search_label')}</span>
          <input type="search" value={q} placeholder={t('A-0067')} onChange={(e) => setQ(e.target.value)} data-testid="cust-search" />
        </label>
        <label className="adm-field">
          <span className="adm-sr">{t('A-new.cust_tag_label')}</span>
          <input type="text" value={tag} placeholder={t('A-new.cust_tag_placeholder')} aria-label={t('A-0074')} onChange={(e) => setTag(e.target.value)} data-testid="cust-tag-filter" />
        </label>
      </div>
      <div className="adm-chips adm-chip-row" role="group" aria-label={t('A-new.cust_chips_label')} data-testid="cust-chips">
        {chip(t('A-0068'), status === '' && group === '', () => { setStatus(''); setGroup(''); }, 'all')}
        {groups.map((g) => chip(lang === 'th' ? g.nameTh : g.nameEn, group === g.id, () => setGroup(group === g.id ? '' : g.id), `group-${g.id}`))}
        {STATUSES.map((x) => chip(t(STATUS_KEY[x]), status === x, () => setStatus(status === x ? '' : x), x))}
      </div>

      {state.kind === 'unset' ? <p role="alert" data-testid="cust-unset">{t('A-new.cust_expiring_unset')}</p> : null}
      {state.kind === 'loading' ? <p aria-busy="true" className="adm-muted">…</p> : null}
      {state.kind === 'forbidden' ? <p role="alert" data-testid="cust-forbidden">{t('A-new.cust_forbidden')}</p> : null}
      {state.kind === 'error' ? (
        <div role="alert" data-testid="cust-error">
          <p>{t('A-new.cust_load_failed')}</p>
          <button type="button" className="adm-btn" onClick={() => setAttempt((n) => n + 1)}>{t('A-new.cust_retry')}</button>
        </div>
      ) : null}
      {state.kind === 'ready' && state.rows.length === 0 ? <p className="adm-muted" data-testid="cust-empty">{t(filtered ? 'A-new.cust_no_match' : 'A-new.cust_empty')}</p> : null}
      {state.kind === 'ready' && state.rows.length > 0 ? (
        <>
          <div className="adm-table-wrap">
            <table className="adm-table" aria-label={t('A-new.cust_list_label')} data-testid="cust-table">
              <thead>
                <tr>
                  <th scope="col">{t('A-0075')}</th>
                  <th scope="col">{t('A-0076')}</th>
                  <th scope="col">{t('A-0077')}</th>
                  <th scope="col">{t('A-0078')}</th>
                  <th scope="col">{t('A-0079')}</th>
                  <th scope="col">{t('A-0080')}</th>
                  <th scope="col">{t('A-0081')}</th>
                </tr>
              </thead>
              <tbody>
                {state.rows.map((c) => (
                  <tr key={c.customerId} data-testid={`cust-${c.customerId}`}>
                    <th scope="row">
                      <a href={profilePath(slug, c.customerId)} aria-label={t('A-new.cust_open', { name: nameOf(c) || c.phone || '' })}>{nameOf(c) || t('A-new.cust_no_name')}</a>
                    </th>
                    <td className="adm-nowrap">{c.phone ?? ''}</td>
                    <td>{c.group ? (lang === 'th' ? c.group.nameTh : c.group.nameEn) : ''}</td>
                    <td data-testid={`pkg-${c.customerId}`}>{c.activePackage ? t('A-new.cust_package', { name: lang === 'th' ? c.activePackage.nameTh : c.activePackage.nameEn, remaining: c.activePackage.creditsLeft }) : ''}</td>
                    <td className="adm-nowrap">{formatBaht(c.walletSatang)}</td>
                    <td>{c.lastVisitAt ? t('A-0083', { dayMonth: dayMonthOf(lang, c.lastVisitAt) }) : ''}</td>
                    <td>
                      <span className="adm-chips">
                        {c.claimState === 'unclaimed' ? <span className="adm-chip adm-chip-walkin">{t('A-0086')}</span> : null}
                        {c.tags.map((x) => <span key={x} className="adm-chip">{x}</span>)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {state.next ? <button type="button" className="adm-btn adm-btn-ghost" disabled={state.busy} onClick={() => void more()} data-testid="cust-more">{t('A-new.cust_more')}</button> : null}
        </>
      ) : null}
    </section>
  );
}
