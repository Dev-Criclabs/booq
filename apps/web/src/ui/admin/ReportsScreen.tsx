'use client';
import { useCallback, useEffect, useState } from 'react';
import { formatBaht } from '../../client/admin/api';
import { loadCourts } from '../../client/admin/calendar';
import {
  adjust, adjustBody, csvHref, FLAG_KEY, heatmap, loadOverview, loadPayouts, markPaid, MONTH, monthOfDay, partnersOf, payoutsCsvHref, payoutTotals, reportErrorKey, sessionsOf, tilesOf,
  type OverviewLoad, type Payout, type ReportName,
} from '../../client/admin/reports';
import { formatMonthYear, weekdayKey } from '../../client/format';
import { dateOf } from '../../client/admin/time';
import { useAdmin } from './AdminFrame';

// A13 Reports and A13b Coach payouts (F11-T21; ADMIN-14; boards H-A13-Reports, G-A13b-Coach-payouts): owner and accountant. The month's cash received, revenue earned, what is
// owed to customers, court occupancy, no-show rate, new and returning customers and the share booked online, the occupancy by day and hour, and the partners; each with its CSV.
// Coach payouts for a month: sessions, adjustments (a written reason) and what is owed; the owner marks a coach paid. Test data is left out by the reports. Not drawn: Referrals
// (F14), Undo of a paid mark (no route), pay model text per coach (the pay set-up is on Coaches).

type Msg = { key: string; error: boolean } | null;
const money = (n: number | null) => (n === null ? '' : formatBaht(n));

export function ReportsScreen() {
  const { slug, t } = useAdmin();
  const [month, setMonth] = useState('');
  const [view, setView] = useState<'overview' | 'payouts'>('overview');
  const [fail, setFail] = useState<'forbidden' | 'error' | null>(null);
  useEffect(() => {
    void loadCourts(slug, window.fetch.bind(window)).then((r) => {
      if (r.kind === 'ok') setMonth(monthOfDay(r.body.today));
      else setFail(r.kind === 'forbidden' ? 'forbidden' : 'error');
    });
  }, [slug]);
  if (fail === 'forbidden') return <p role="alert" data-testid="rep-forbidden">{t('A-new.rep_err_forbidden')}</p>;
  if (fail === 'error') return <div role="alert" data-testid="rep-error"><p>{t('A-new.rep_load_failed')}</p><button type="button" className="adm-btn" onClick={() => window.location.reload()}>{t('A-new.set_retry')}</button></div>;
  return (
    <section data-testid="reports" aria-labelledby="rep-title">
      <header className="adm-head"><h1 id="rep-title">{t('A-0165')}</h1></header>
      <div className="adm-filters">
        <label className="adm-field"><span className="adm-sr">{t('A-new.rep_month')}</span><input type="month" aria-label={t('A-new.rep_month')} value={month} onChange={(e) => MONTH.test(e.target.value) && setMonth(e.target.value)} data-testid="rep-month" /></label>
        <div role="group" aria-label={t('A-new.rep_view')} className="adm-chips">
          <button type="button" className="adm-chip-btn" aria-pressed={view === 'overview'} onClick={() => setView('overview')} data-testid="rep-tab-overview">{t('A-0097')}</button>
          <button type="button" className="adm-chip-btn" aria-pressed={view === 'payouts'} onClick={() => setView('payouts')} data-testid="rep-tab-payouts">{t('A-0282')}</button>
        </div>
      </div>
      {month ? (view === 'overview' ? <Overview month={month} /> : <Payouts month={month} />) : <p aria-busy="true" className="adm-muted">…</p>}
    </section>
  );
}

function Overview({ month }: { month: string }) {
  const { slug, t } = useAdmin();
  const [o, setO] = useState<OverviewLoad | null>(null);
  useEffect(() => {
    let live = true;
    setO(null);
    void loadOverview(slug, month, window.fetch.bind(window)).then((r) => live && setO(r));
    return () => {
      live = false;
    };
  }, [slug, month]);
  if (!o) return <p aria-busy="true" className="adm-muted">…</p>;
  if (o.forbidden) return <p role="alert" data-testid="rep-forbidden">{t('A-new.rep_err_forbidden')}</p>;
  const tiles = tilesOf(o.data);
  const map = heatmap(o.data['occupancy']);
  const partners = partnersOf(o.data['partner']);
  const link = (name: ReportName) => <a className="adm-btn adm-btn-ghost" href={csvHref(slug, name, month)} download data-testid={`csv-${name}`}>{t('A-0066')}</a>;
  const pct = (n: number | null) => (n === null ? t('A-new.rep_none') : String(n));
  const monday = '2027-01-18'; // only to pick a weekday word: 1 = Monday ... 7 = Sunday
  const weekdayWord = (n: number) => t(weekdayKey(new Date(Date.parse(`${monday}T12:00:00Z`) + (n - 1) * 86_400_000).toISOString().slice(0, 10)));
  return (
    <div data-testid="rep-overview">
      {o.failed.length > 0 ? <p role="alert" className="adm-error" data-testid="rep-failed">{t('A-new.rep_failed', { count: o.failed.length })}</p> : null}
      <div className="adm-tiles">
        <div className="adm-tile" data-testid="tile-cash"><p className="adm-tile-label">{t('A-0283')}</p><p className="adm-tile-value">{money(tiles.cashReceivedSatang) || t('A-new.rep_none')}</p><p className="adm-muted">{t('A-0284')}</p>{link('cash-by-type')}</div>
        <div className="adm-tile" data-testid="tile-revenue"><p className="adm-tile-label">{t('A-0285')}</p><p className="adm-tile-value">{money(tiles.revenueEarnedSatang) || t('A-new.rep_none')}</p><p className="adm-muted">{t('A-0286')}</p>{link('revenue-earned')}</div>
        <div className="adm-tile" data-testid="tile-owed"><p className="adm-tile-label">{t('A-0287')}</p>
          <p className="adm-tile-value">{tiles.unusedCreditSatang === null || tiles.walletBalancesSatang === null ? t('A-new.rep_none') : money(tiles.unusedCreditSatang + tiles.walletBalancesSatang)}</p>
          <p className="adm-muted">{tiles.unusedCreditSatang === null ? '' : t('A-0288', { unusedCredit: money(tiles.unusedCreditSatang), walletBalances: money(tiles.walletBalancesSatang) })}</p>{link('value-owed')}</div>
        <div className="adm-tile" data-testid="tile-occupancy"><p className="adm-tile-label">{t('A-0289')}</p><p className="adm-tile-value">{tiles.occupancyPercent === null ? t('A-new.rep_none') : `${tiles.occupancyPercent}%`}</p><p className="adm-muted">{t('A-0290', { percent: pct(tiles.noShowPercent) })}</p>{link('occupancy')}</div>
        <div className="adm-tile" data-testid="tile-customers"><p className="adm-tile-label">{t('A-new.rep_customers')}</p><p className="adm-tile-value">{tiles.newCustomers === null ? t('A-new.rep_none') : t('A-0291', { count: tiles.newCustomers })}</p>
          <p className="adm-muted">{t('A-0292', { returningCount: tiles.returningCustomers ?? 0, percent: pct(tiles.onlinePercent) })}</p>{link('new-vs-returning')}</div>
      </div>

      <section className="adm-card" aria-labelledby="rep-heat" data-testid="rep-heat">
        <h2 id="rep-heat">{t('A-0293')}</h2>
        {map.cells.length === 0 ? <p className="adm-muted">{t('A-new.rep_none')}</p> : (
          <div className="adm-table-wrap">
            <table className="adm-table adm-heat" aria-label={t('A-0293')}>
              <thead><tr><th scope="col"><span className="adm-sr">{t('A-new.cal_hour')}</span></th>{[1, 2, 3, 4, 5, 6, 7].map((d) => <th key={d} scope="col">{weekdayWord(d)}</th>)}</tr></thead>
              <tbody>
                {map.hours.map((h) => (
                  <tr key={h}>
                    <th scope="row" className="adm-nowrap">{String(h).padStart(2, '0')}:00</th>
                    {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                      const c = map.cells.find((x) => x.weekday === d && x.hour === h);
                      return <td key={d} className="adm-heat-cell" style={c?.percent != null ? { background: `rgba(31, 90, 58, ${Math.max(0.06, c.percent / 100)})`, color: c.percent > 55 ? '#fff' : undefined } : undefined} data-testid={`heat-${d}-${h}`}>{c?.percent == null ? '' : `${c.percent}%`}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="adm-card" aria-labelledby="rep-partners" data-testid="rep-partners">
        <h2 id="rep-partners">{t('A-0281')}</h2>
        {partners.length === 0 ? <p className="adm-muted">{t('A-new.rep_none')}</p> : (
          <ul className="adm-list">{partners.map((p) => <li key={p.name}><span>{p.name}</span><span className="adm-muted">{t('A-0297', { used: p.redemptions, amount: money(p.revenueSatang) })}</span></li>)}</ul>
        )}
        {link('partner')}
      </section>
    </div>
  );
}

function Payouts({ month }: { month: string }) {
  const { slug, lang, t, owner } = useAdmin();
  const f = () => window.fetch.bind(window);
  const [rows, setRows] = useState<Payout[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    const r = await loadPayouts(slug, month, window.fetch.bind(window));
    if (r.kind === 'forbidden') return setForbidden(true);
    setRows(r.kind === 'ok' ? r.body : []);
  }, [slug, month]);
  useEffect(() => {
    setRows(null);
    void reload();
  }, [reload]);
  if (forbidden) return <p role="alert" data-testid="pay-forbidden">{t('A-new.rep_err_forbidden')}</p>;
  if (!rows) return <p aria-busy="true" className="adm-muted">…</p>;
  const tot = payoutTotals(rows);

  async function addAdjust(p: Payout) {
    const b = adjustBody(amount, reason);
    if (!b.ok) return setMsg({ key: b.key, error: true });
    setBusy(true);
    const r = await adjust(slug, p.payout_id!, b.body, f());
    setBusy(false);
    if (r.kind !== 'ok') return setMsg({ key: reportErrorKey(r), error: true });
    setOpen(null);
    setAmount('');
    setReason('');
    setMsg({ key: 'A-new.rep_adjusted', error: false });
    await reload();
  }
  async function pay(p: Payout) {
    setBusy(true);
    const r = await markPaid(slug, p.payout_id!, f());
    setBusy(false);
    if (r.kind !== 'ok') return setMsg({ key: reportErrorKey(r), error: true });
    setMsg({ key: 'A-new.rep_paid_done', error: false });
    await reload();
  }
  return (
    <div data-testid="rep-payouts">
      <div className="adm-tiles">
        <div className="adm-tile" data-testid="pay-owed"><p className="adm-tile-label">{t('A-new.rep_owed_for', { monthYear: formatMonthYear(lang, `${month}-01`) })}</p><p className="adm-tile-value">{money(tot.owed)}</p>{tot.unset > 0 ? <p className="adm-muted">{t('A-new.rep_unset_count', { count: tot.unset })}</p> : null}</div>
        <div className="adm-tile" data-testid="pay-sessions"><p className="adm-tile-label">{t('A-0444')}</p><p className="adm-tile-value">{tot.sessions}</p></div>
        <div className="adm-tile" data-testid="pay-paid"><p className="adm-tile-label">{t('A-0445')}</p><p className="adm-tile-value">{money(tot.paid)}</p><p className="adm-muted">{t('A-0446', { amount: money(tot.paid), paid: tot.paidCount, total: tot.coaches })}</p></div>
      </div>
      <a className="adm-btn adm-btn-ghost" href={payoutsCsvHref(slug, month)} download data-testid="csv-payouts">{t('A-0066')}</a>
      {msg ? <p role={msg.error ? 'alert' : 'status'} className={msg.error ? 'adm-error' : 'adm-ok'} data-testid="pay-msg">{t(msg.key)}</p> : null}
      {rows.length === 0 ? <p className="adm-muted" data-testid="pay-none">{t('A-new.rep_no_payouts')}</p> : (
        <div className="adm-table-wrap">
          <table className="adm-table" data-testid="pay-table" aria-label={t('A-0282')}>
            <thead><tr><th scope="col">{t('A-0193')}</th><th scope="col">{t('A-0444')}</th><th scope="col">{t('A-0449')}</th><th scope="col">{t('A-0450')}</th><th scope="col">{t('A-0373')}</th>{owner ? <th scope="col"><span className="adm-sr">{t('A-0452')}</span></th> : null}</tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.coach_id} data-testid={`pay-${p.coach_id}`}>
                  <th scope="row">{p.coach_name ?? t('A-new.coach_no_name')}{p.flags.length > 0 ? <span className="adm-muted"> · {p.flags.map((x) => t(FLAG_KEY[x] ?? 'A-new.rep_flag_other')).join(', ')}</span> : null}</th>
                  <td>{sessionsOf(p)}</td>
                  <td className="adm-nowrap">{p.adjustments_satang === 0 ? '' : `${p.adjustments_satang > 0 ? '+' : ''}${money(p.adjustments_satang)}`}</td>
                  <td className="adm-nowrap" data-testid={`owed-${p.coach_id}`}>{p.total_satang === null ? t('A-new.coach_not_set') : money(p.total_satang)}</td>
                  <td>{p.status === 'paid' && p.paid_at ? t('A-0454', { dayMonth: dateOf(lang, p.paid_at) }) : t('A-0451')}</td>
                  {owner ? (
                    <td>
                      {p.status !== 'paid' && p.payout_id ? (
                        <span className="adm-inline">
                          <button type="button" className="adm-btn adm-btn-ghost" disabled={busy || p.total_satang === null} onClick={() => void pay(p)} data-testid={`markpaid-${p.coach_id}`}>{t('A-0452')}</button>
                          <button type="button" className="adm-btn adm-btn-ghost" onClick={() => { setOpen(open === p.coach_id ? null : p.coach_id); setAmount(''); setReason(''); setMsg(null); }} data-testid={`adj-${p.coach_id}`}>{t('A-new.rep_adjust')}</button>
                        </span>
                      ) : null}
                      {open === p.coach_id ? (
                        <form className="adm-form" onSubmit={(e) => { e.preventDefault(); void addAdjust(p); }} data-testid={`adj-form-${p.coach_id}`}>
                          <label className="adm-field"><span>{t('A-new.rep_adj_amount')}</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid={`adj-amount-${p.coach_id}`} /></label>
                          <label className="adm-field"><span>{t('A-new.rep_adj_reason')}</span><input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid={`adj-reason-${p.coach_id}`} /></label>
                          <button type="submit" className="adm-btn" disabled={busy} data-testid={`adj-go-${p.coach_id}`}>{t('A-new.rep_adj_go')}</button>
                        </form>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="adm-muted">{t('A-0456')}</p>
    </div>
  );
}
