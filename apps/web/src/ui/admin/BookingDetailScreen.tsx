'use client';
import { useCallback, useEffect, useState } from 'react';
import { formatBaht } from '../../client/admin/api';
import { changeLines } from '../../client/admin/audit';
import { bookErrorKey, loadBooking, loadHistory, loadOrder, type OrderView, releaseHold, STATUS_KEY, type BookingView, type HistoryRow } from '../../client/admin/booking';
import { adminPath } from '../../client/admin/shell';
import { dateOf, longDayOf, timeOf } from '../../client/admin/time';
import { useAdmin } from './AdminFrame';

// A02b Booking detail (F11-T14; ADMIN-04; board G-A02b-Booking-detail): what the booking is (court, day, hour, status, the hold while it waits for payment), the
// order's amounts, and its history (who changed what and when; a personal field is only named). A booking waiting for payment can be let go (released). Not here: cancel
// and no-show (F09's routes are not mounted yet) and adding a coach.

type Load = { kind: 'loading' } | { kind: 'ready'; booking: BookingView; history: HistoryRow[]; order: OrderView | null } | { kind: 'not_found' } | { kind: 'error' } | { kind: 'forbidden' };

export function BookingDetailScreen({ id }: { id: string }) {
  const { slug, lang, t } = useAdmin();
  const f = () => window.fetch.bind(window);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [msg, setMsg] = useState<{ key: string; error: boolean; vars?: Record<string, string | number> } | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const [b, h] = await Promise.all([loadBooking(slug, id, f()), loadHistory(slug, id, f())]);
    if (b.kind === 'forbidden' || h.kind === 'forbidden') return setLoad({ kind: 'forbidden' });
    if (b.kind === 'not_found') return setLoad({ kind: 'not_found' });
    if (b.kind !== 'ok' || h.kind !== 'ok') return setLoad({ kind: 'error' });
    const o = await loadOrder(slug, b.body.orderId, f());
    setLoad({ kind: 'ready', booking: b.body, history: h.body, order: o });
  }, [slug, id]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const back = <p><a href={adminPath(slug, 'calendar')} data-testid="bd-back">{t('A-new.book_back')}</a></p>;
  if (load.kind === 'loading') return <p aria-busy="true" className="adm-muted">…</p>;
  if (load.kind === 'forbidden') return <p role="alert" data-testid="bd-forbidden">{t('A-new.book_err_forbidden')}</p>;
  if (load.kind === 'not_found') return <div data-testid="bd-missing">{back}<p>{t('A-new.book_err_gone')}</p></div>;
  if (load.kind === 'error') return <div role="alert" data-testid="bd-error"><p>{t('A-new.book_load_failed')}</p><button type="button" className="adm-btn" onClick={() => { setLoad({ kind: 'loading' }); void reload(); }}>{t('A-new.set_retry')}</button></div>;
  const { booking: b, history, order } = load;

  async function release() {
    if (!window.confirm(t('A-new.book_release_confirm'))) return;
    setBusy(true);
    const r = await releaseHold(slug, id, f());
    setBusy(false);
    if (r.kind !== 'ok') return setMsg({ ...bookErrorKey(r), error: true });
    setMsg({ key: 'A-new.book_released', error: false });
    await reload();
  }
  const money = (n: number | null) => (n === null ? '' : formatBaht(n));

  return (
    <section data-testid="bd" aria-labelledby="bd-title">
      {back}
      <h1 id="bd-title">{t('A-0019', { court: b.court.name })} · {longDayOf(lang, b.start)} {timeOf(b.start)}–{timeOf(b.end)}</h1>
      <p data-testid="bd-status"><span className="adm-chip">{t(STATUS_KEY[b.status] ?? 'A-new.book_status_other')}</span>{b.status === 'awaiting_payment' && b.holdExpiresAt && !b.holdEnded ? <span className="adm-muted"> {t('A-new.book_hold_until', { time: timeOf(b.holdExpiresAt) })}</span> : null}{b.holdEnded && b.status === 'awaiting_payment' ? <span className="adm-muted"> {t('A-new.book_hold_ended')}</span> : null}</p>
      {msg ? <p role={msg.error ? 'alert' : 'status'} className={msg.error ? 'adm-error' : 'adm-ok'} data-testid="bd-msg">{t(msg.key, msg.vars)}</p> : null}
      {b.status === 'awaiting_payment' ? <button type="button" className="adm-btn adm-btn-ghost" disabled={busy} onClick={() => void release()} data-testid="bd-release">{t('A-new.book_release')}</button> : null}

      {order && order.totalSatang !== null ? (
        <section className="adm-card" aria-label={t('A-0062')} data-testid="bd-order">
          <p><strong>{t('A-0062')}</strong> {money(order.totalSatang)}</p>
          {order.discountSatang ? <p className="adm-muted">{t('A-new.book_discount', { amount: money(order.discountSatang) })}</p> : null}
          {order.creditValueSatang ? <p className="adm-muted">{t('A-new.book_credit_used', { amount: money(order.creditValueSatang) })}</p> : null}
          {order.walletSatang ? <p className="adm-muted">{t('A-new.book_wallet_used', { amount: money(order.walletSatang) })}</p> : null}
          <p className="adm-muted">{t('A-new.book_to_pay')} {money(order.moneySatang)}</p>
        </section>
      ) : null}

      <section className="adm-card" aria-labelledby="bd-history" data-testid="bd-history">
        <h2 id="bd-history">{t('A-new.book_history')}</h2>
        {history.length === 0 ? <p className="adm-muted">{t('A-new.book_history_none')}</p> : (
          <ul className="adm-list">
            {history.map((h, i) => (
              <li key={`${h.at}-${i}`} data-testid="bd-hist-row">
                <span><strong>{h.action}</strong> · {h.actor ?? t('A-new.book_system')} · {dateOf(lang, h.at)} {timeOf(h.at)}</span>
                {h.reason ? <span className="adm-muted"> · {h.reason}</span> : null}
                {h.kind === 'audit' ? changeLines({ oldValue: h.detail?.old, newValue: h.detail?.new, piiFields: h.piiFields }).map((l) => <span key={l} className="adm-muted adm-change"> {l}</span>) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
