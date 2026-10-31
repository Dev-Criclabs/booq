'use client';
import { useEffect, useMemo, useState } from 'react';
import { ConsoleNav } from './ConsoleNav';
import { counts, FILTER_KEY, FILTERS, loadClubs, STATUS_KEY, visible, type ClubRow, type Filter } from './clubs';
import { t } from './i18n';

// /clubs (P1): every club on BOOQ this staff member may see, with its status and bookings of the last 30 days. A row opens
// the club (P3). Specialists see only the clubs assigned to them (the server decides). English only.

export function ClubsScreen() {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error'; key: string; signIn?: boolean } | { kind: 'ready'; clubs: ClubRow[] }>({ kind: 'loading' });
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    let live = true;
    void loadClubs(window.fetch.bind(window)).then((r) => live && setState(r.kind === 'ok' ? { kind: 'ready', clubs: r.clubs } : { kind: 'error', key: r.key, ...(r.signIn ? { signIn: true } : {}) }));
    return () => {
      live = false;
    };
  }, []);

  const clubs = state.kind === 'ready' ? state.clubs : [];
  const n = useMemo(() => counts(clubs), [clubs]);
  const rows = useMemo(() => visible(clubs, filter), [clubs, filter]);

  return (
    <>
      <ConsoleNav current="clubs" />
      <main className="page wide" data-testid="clubs">
        <h1>{t('X-0002')}</h1>
        <p className="lede">{t('X-0007')}</p>
        {state.kind === 'loading' ? <p aria-busy="true">…</p> : null}
        {state.kind === 'error' ? (
          <p role="alert" data-testid="load-error">
            {t(state.key)} {state.signIn ? <a href="/sign-in?next=/clubs" data-testid="sign-in-link">{t('X-new.signin_link')}</a> : null}
          </p>
        ) : null}
        {state.kind === 'ready' ? (
          <>
            <div className="tabs" role="group" aria-label={t('X-new.clubs_filter_label')}>
              {FILTERS.map((f) => (
                <button key={f} type="button" className="btn small secondary" aria-pressed={filter === f} onClick={() => setFilter(f)} data-testid={`filter-${f}`}>
                  {t(FILTER_KEY[f], { count: n[f] })}
                </button>
              ))}
            </div>
            {clubs.length === 0 ? <p data-testid="empty">{t('X-new.clubs_empty')}</p> : null}
            {clubs.length > 0 && rows.length === 0 ? <p data-testid="filter-empty">{t('X-new.clubs_filter_empty')}</p> : null}
            {rows.length > 0 ? (
              <table className="team" data-testid="club-list">
                <thead>
                  <tr>
                    <th scope="col">{t('X-0014')}</th>
                    <th scope="col">{t('X-0015')}</th>
                    <th scope="col">{t('X-0016')}</th>
                    <th scope="col">{t('X-0017')}</th>
                    <th scope="col">{t('X-0018')}</th>
                    <th scope="col">{t('X-0019')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.clubId} data-testid={`club-${c.clubId}`}>
                      <th scope="row">
                        <a href={`/clubs/${c.clubId}`} aria-label={t('X-new.clubs_open', { name: c.nameEn })}>{c.nameEn}</a>
                        <span className="sub">{c.nameTh}</span>
                      </th>
                      <td><span className={`pill ${c.status}`}>{t(STATUS_KEY[c.status])}</span></td>
                      <td data-testid="col-setup">{t('X-new.clubs_setup_cell', { done: c.setup.done, total: c.setup.total })}</td>
                      <td>{c.bookingsConfirmed30d}</td>
                      <td data-testid="col-line">{c.line.limit === null ? t('X-new.clubs_line_used', { used: c.line.used }) : t('X-new.clubs_line_cell', { used: c.line.used, limit: c.line.limit })}</td>
                      <td data-testid="col-alerts">{c.alerts === 0 ? t('X-0022') : t('X-new.clubs_alerts_cell', { count: c.alerts })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </>
        ) : null}
      </main>
    </>
  );
}
