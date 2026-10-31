'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatBaht } from '../../client/admin/api';
import { loadCourts } from '../../client/admin/calendar';
import {
  checkRange, closeCsvHref, defaultRange, KIND_KEY, loadClose, loadReceipts, PAGE, pdfHref, receiptErrorKey, runClose, voidBody, voidReceipt, type Close, type ReceiptRow,
} from '../../client/admin/receipts';
import { dateOf, longDayOf } from '../../client/admin/time';
import { useAdmin } from './AdminFrame';

// A14 Receipts and daily close (F11-T21; ADMIN-15; board H-A14-Receipts): owner and accountant. The list of receipts (search by number or name, a date range, newest first,
// the PDF in Thai or English), Void with a written reason (owner), and the daily close of a finished day: what came in by PromptPay and cash, what was paid from the wallet and
// package credit (not new money), voids, with Run close and Export. Numbers are never reused (A-0299). Not drawn: the Paid by column per receipt (the list does not carry it).

type Msg = { key: string; error: boolean } | null;
type Load = { kind: 'loading' } | { kind: 'ready'; rows: ReceiptRow[]; more: boolean } | { kind: 'error' } | { kind: 'forbidden' };

export function ReceiptsScreen() {
  const { slug, lang, t, owner } = useAdmin();
  const f = () => window.fetch.bind(window);
  const [today, setToday] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [problem, setProblem] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const ticket = useRef(0);

  useEffect(() => {
    void loadCourts(slug, f()).then((r) => {
      if (r.kind === 'forbidden') return setLoad({ kind: 'forbidden' });
      if (r.kind !== 'ok') return setLoad({ kind: 'error' });
      const d = defaultRange(r.body.today);
      setToday(r.body.today);
      setFrom(d.from);
      setTo(d.to);
    });
  }, [slug]);

  const run = useCallback(async (query: { q: string; from: string; to: string }, offset = 0, append: ReceiptRow[] = []) => {
    const mine = ++ticket.current;
    const r = await loadReceipts(slug, { ...query, offset }, window.fetch.bind(window));
    if (mine !== ticket.current) return;
    if (r.kind === 'forbidden') return setLoad({ kind: 'forbidden' });
    if (r.kind !== 'ok') return setLoad({ kind: 'error' });
    const rows = r.body ?? [];
    setLoad({ kind: 'ready', rows: [...append, ...rows], more: rows.length === PAGE });
  }, [slug]);
  useEffect(() => {
    if (from && to) void run({ q, from, to });
    // the search waits for the filters to be applied
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, run]);

  function apply() {
    const c = checkRange({ from, to });
    if (!c.ok) return setProblem(c.key);
    setProblem(null);
    setLoad({ kind: 'loading' });
    void run({ q, from, to });
  }
  async function doVoid(id: string) {
    const b = voidBody(reason);
    if (!b.ok) return setMsg({ key: b.key, error: true });
    setBusy(true);
    const r = await voidReceipt(slug, id, b.body.reason, f());
    setBusy(false);
    if (r.kind !== 'ok') return setMsg({ key: receiptErrorKey(r), error: true });
    setVoiding(null);
    setReason('');
    setMsg({ key: 'A-new.rcpt_voided', error: false });
    await run({ q, from, to });
  }

  if (load.kind === 'forbidden') return <p role="alert" data-testid="rcpt-forbidden">{t('A-new.rcpt_err_forbidden')}</p>;
  return (
    <section data-testid="receipts" aria-labelledby="rcpt-title">
      <header className="adm-head"><h1 id="rcpt-title">{t('A-0102')}</h1></header>
      <p className="adm-muted">{t('A-0299')}</p>
      {today ? <DailyClose today={today} /> : null}

      <div className="adm-filters">
        <label className="adm-field adm-grow"><span className="adm-sr">{t('A-0301')}</span><input type="search" value={q} placeholder={t('A-0301')} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} data-testid="rcpt-search" /></label>
        <label className="adm-field"><span className="adm-sr">{t('A-new.audit_from')}</span><input type="date" aria-label={t('A-new.audit_from')} value={from} onChange={(e) => setFrom(e.target.value)} data-testid="rcpt-from" /></label>
        <label className="adm-field"><span className="adm-sr">{t('A-new.audit_to')}</span><input type="date" aria-label={t('A-new.audit_to')} value={to} onChange={(e) => setTo(e.target.value)} data-testid="rcpt-to" /></label>
        <button type="button" className="adm-btn" onClick={apply} data-testid="rcpt-apply">{t('A-new.audit_apply')}</button>
      </div>
      {problem ? <p role="alert" className="adm-error" data-testid="rcpt-problem">{t(problem)}</p> : null}
      {msg ? <p role={msg.error ? 'alert' : 'status'} className={msg.error ? 'adm-error' : 'adm-ok'} data-testid="rcpt-msg">{t(msg.key)}</p> : null}

      {load.kind === 'loading' ? <p aria-busy="true" className="adm-muted">…</p> : null}
      {load.kind === 'error' ? <div role="alert" data-testid="rcpt-error"><p>{t('A-new.rcpt_load_failed')}</p><button type="button" className="adm-btn" onClick={apply}>{t('A-new.set_retry')}</button></div> : null}
      {load.kind === 'ready' && load.rows.length === 0 ? <p className="adm-muted" data-testid="rcpt-empty">{t('A-new.rcpt_none')}</p> : null}
      {load.kind === 'ready' && load.rows.length > 0 ? (
        <>
          <div className="adm-table-wrap">
            <table className="adm-table" data-testid="rcpt-table" aria-label={t('A-0102')}>
              <thead><tr><th scope="col">{t('A-0302')}</th><th scope="col">{t('A-0303')}</th><th scope="col">{t('A-0039')}</th><th scope="col">{t('A-new.prof_col_what')}</th><th scope="col">{t('A-0305')}</th><th scope="col">{t('A-new.prof_col_status')}</th><th scope="col"><span className="adm-sr">{t('A-new.prof_receipt_pdf')}</span></th></tr></thead>
              <tbody>
                {load.rows.map((r) => (
                  <tr key={r.id} data-testid={`rcpt-${r.id}`}>
                    <th scope="row" className="adm-nowrap">{r.number}{r.is_test ? <span className="adm-chip"> {t('A-new.prof_receipt_test')}</span> : null}</th>
                    <td className="adm-nowrap">{dateOf(lang, r.issued_at)}</td>
                    <td>{r.customer_name ?? ''}</td>
                    <td>{t(KIND_KEY[r.kind] ?? 'A-new.prof_receipt_sale')}</td>
                    <td className="adm-nowrap">{formatBaht(r.total_satang)}</td>
                    <td>{t(r.status === 'void' ? 'A-0307' : 'A-new.prof_receipt_issued')}</td>
                    <td>
                      <span className="adm-inline">
                        <a className="adm-btn adm-btn-ghost" href={pdfHref(slug, r.id, 'th')} target="_blank" rel="noopener noreferrer" data-testid={`pdf-th-${r.id}`}>{t('A-new.rcpt_pdf_th')}</a>
                        <a className="adm-btn adm-btn-ghost" href={pdfHref(slug, r.id, 'en')} target="_blank" rel="noopener noreferrer" data-testid={`pdf-en-${r.id}`}>{t('A-new.rcpt_pdf_en')}</a>
                        {owner && r.status !== 'void' ? <button type="button" className="adm-btn adm-btn-ghost" onClick={() => { setVoiding(voiding === r.id ? null : r.id); setReason(''); setMsg(null); }} data-testid={`void-${r.id}`}>{t('A-0307')}</button> : null}
                      </span>
                      {voiding === r.id ? (
                        <form className="adm-form" onSubmit={(e) => { e.preventDefault(); void doVoid(r.id); }} data-testid={`void-form-${r.id}`}>
                          <label className="adm-field"><span>{t('A-new.rcpt_void_reason')}</span><textarea rows={2} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid={`void-reason-${r.id}`} /></label>
                          <span className="adm-inline"><button type="submit" className="adm-btn" disabled={busy} data-testid={`void-go-${r.id}`}>{t('A-new.rcpt_void_go')}</button><button type="button" className="adm-btn adm-btn-ghost" onClick={() => setVoiding(null)}>{t('A-new.cal_close')}</button></span>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {load.more ? <button type="button" className="adm-btn adm-btn-ghost" onClick={() => void run({ q, from, to }, load.rows.length, load.rows)} data-testid="rcpt-more">{t('A-new.audit_more')}</button> : null}
        </>
      ) : null}
    </section>
  );
}

function DailyClose({ today }: { today: string }) {
  const { slug, lang, t } = useAdmin();
  const [day, setDay] = useState(() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [close, setClose] = useState<Close | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState(false);
  const load = useCallback(async () => {
    const r = await loadClose(slug, day, window.fetch.bind(window));
    if (r.kind === 'ok') {
      setClose(r.body);
      setBad(false);
    } else {
      setClose(null);
      setBad(true);
    }
  }, [slug, day]);
  useEffect(() => {
    void load();
  }, [load]);
  async function run() {
    setBusy(true);
    const r = await runClose(slug, day, window.fetch.bind(window));
    setBusy(false);
    if (r.kind !== 'ok') return setMsg({ key: receiptErrorKey(r), error: true });
    setMsg({ key: 'A-new.rcpt_close_done', error: false });
    await load();
  }
  const tot = close?.totals;
  return (
    <section className="adm-card" aria-labelledby="rcpt-close" data-testid="close">
      <h2 id="rcpt-close">{t('A-0312')}</h2>
      <div className="adm-filters">
        <label className="adm-field"><span className="adm-sr">{t('A-0128')}</span><input type="date" aria-label={t('A-0128')} value={day} max={today} onChange={(e) => setDay(e.target.value)} data-testid="close-day" /></label>
        <a className="adm-btn adm-btn-ghost" href={closeCsvHref(slug, day)} download data-testid="close-export">{t('A-0319')}</a>
      </div>
      <p className="adm-muted">{longDayOf(lang, day)} · {close ? t(close.closed ? 'A-new.rcpt_close_closed' : 'A-new.rcpt_close_open') : ''}</p>
      {bad ? <p role="alert" className="adm-error" data-testid="close-error">{t('A-new.rcpt_close_failed')}</p> : null}
      {tot ? (
        <dl className="adm-dl" data-testid="close-totals">
          <dt>{t('A-0308')}</dt><dd data-testid="close-beam">{formatBaht(tot.methods.beam)}</dd>
          <dt>{t('A-0057')}</dt><dd data-testid="close-cash">{formatBaht(tot.methods.cash)}</dd>
          <dt>{t('A-new.rcpt_money_total')}</dt><dd data-testid="close-money">{formatBaht(tot.money_total_satang)}</dd>
          <dt>{t('A-0315')}</dt><dd>{formatBaht(tot.wallet_used_satang)}</dd>
          <dt>{t('A-0316')}</dt><dd>{formatBaht(tot.credit_used.value_satang)} · {t('A-new.rcpt_credit_count', { count: tot.credit_used.count })}</dd>
          <dt>{t('A-0307')}</dt><dd>{tot.voids_made.length}</dd>
        </dl>
      ) : null}
      <p className="adm-muted">{t('A-0318')}</p>
      {msg ? <p role={msg.error ? 'alert' : 'status'} className={msg.error ? 'adm-error' : 'adm-ok'} data-testid="close-msg">{t(msg.key)}</p> : null}
      {close && !close.closed ? <button type="button" className="adm-btn" disabled={busy} onClick={() => void run()} data-testid="close-run">{t('A-new.rcpt_close_run')}</button> : null}
    </section>
  );
}
