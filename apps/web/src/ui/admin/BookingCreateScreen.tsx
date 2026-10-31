'use client';
import { useEffect, useRef, useState } from 'react';
import { formatBaht } from '../../client/admin/api';
import { loadCourts, type Courts } from '../../client/admin/calendar';
import {
  bookErrorKey, canBook, dayText, hoursFrom, hourText, loadAddOns, newKey, orderState, payBooking, quoteBooking, searchCustomers, startFrom,
  type AddOn, type Choice, type CustomerHit, type Qr, type Quote,
} from '../../client/admin/booking';
import { adminPath } from '../../client/admin/shell';
import { longDayOf, timeOf } from '../../client/admin/time';
import { useAdmin } from './AdminFrame';

// A02 Booking create (F11-T14; ADMIN-04; board H-A02-Booking-create): the desk picks a customer who has signed in, the court and hours (from the calendar's click),
// add-ons and a code; the server quotes; Sell places the booking: the QR shows here until the order is paid, or nothing was left to pay and it is confirmed. The
// price always comes from the server and a changed price asks again. Not here: walk-ins without a sign-in (their age is unknown, so they cannot be priced),
// cash for a court booking, adding a coach (done on the booking afterwards).

type Msg = { key: string; vars?: Record<string, string | number> } | null;
type Done = { kind: 'confirmed'; bookingId?: string } | { kind: 'paid' } | { kind: 'ended' };

export function BookingCreateScreen() {
  const { slug, lang, t } = useAdmin();
  const f = () => window.fetch.bind(window);
  const [courts, setCourts] = useState<Courts | null>(null);
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [courtId, setCourtId] = useState('');
  const [start, setStart] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<CustomerHit[] | null>(null);
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [err, setErr] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<{ orderId: string; payment: Qr; holdExpiresAt: string | null; state: 'waiting' | 'paid' | 'ended' } | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [offline, setOffline] = useState(false);
  const key = useRef(newKey());
  const ticket = useRef(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setCourtId(params.get('court') ?? '');
    setStart(startFrom(params.get('start')));
    void loadCourts(slug, f()).then((r) => (r.kind === 'ok' ? setCourts(r.body) : setOffline(true)));
    void loadAddOns(slug, f()).then(setAddOns);
  }, [slug]);

  // The search waits for typing to stop, and an older answer never replaces a newer one.
  useEffect(() => {
    if (q.trim().length < 2) return setHits(null);
    const mine = ++ticket.current;
    const timer = setTimeout(() => {
      void searchCustomers(slug, q, f()).then((r) => {
        if (mine === ticket.current) setHits(r.kind === 'ok' ? r.body : []);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [slug, q]);

  const hours = start ? hoursFrom(start, count) : [];
  const ready = !!customer && !!courtId && hours.length > 0;
  const choice: Choice = { customerId: customer?.customerId ?? '', courtId, hours, addOnIds: picked, code };

  // Any change of the choice makes the old quote stale, and a new key for a new order.
  useEffect(() => {
    setQuote(null);
    key.current = newKey();
  }, [customer?.customerId, courtId, start, count, picked, code]);

  // While the QR is on screen the order is read every few seconds until it is paid or ended.
  useEffect(() => {
    if (!qr || qr.state !== 'waiting') return;
    const timer = setInterval(() => {
      void orderState(slug, qr.orderId, f()).then((s) => {
        if (s === 'paid') setQr((x) => (x ? { ...x, state: 'paid' } : x));
        else if (s === 'released' || s === 'cancelled') setQr((x) => (x ? { ...x, state: 'ended' } : x));
      });
    }, 3000);
    return () => clearInterval(timer);
  }, [qr, slug]);

  if (offline) return <div role="alert" data-testid="book-error"><p>{t('A-new.book_load_failed')}</p><button type="button" className="adm-btn" onClick={() => window.location.reload()}>{t('A-new.set_retry')}</button></div>;
  if (!courts) return <p aria-busy="true" className="adm-muted">…</p>;
  const court = courts.courts.find((c) => c.id === courtId);

  async function check() {
    if (!ready) return;
    setBusy(true);
    setErr(null);
    const r = await quoteBooking(slug, choice, f());
    setBusy(false);
    if (r.kind !== 'ok') return setErr(bookErrorKey(r));
    setQuote(r.body);
  }
  async function sell() {
    if (!quote) return;
    setBusy(true);
    setErr(null);
    const r = await payBooking(slug, choice, quote.quoteHash, key.current, f());
    setBusy(false);
    if (r.kind !== 'ok') return setErr(bookErrorKey(r));
    if ('priceChanged' in r.body) {
      setQuote(r.body.quote);
      return setErr({ key: 'A-new.book_price_changed' });
    }
    if (r.body.confirmed || !r.body.payment) return setDone({ kind: 'confirmed' });
    setQr({ orderId: r.body.orderId, payment: r.body.payment, holdExpiresAt: r.body.holdExpiresAt, state: 'waiting' });
  }

  const calendar = <p><a href={adminPath(slug, 'calendar')} data-testid="book-back">{t('A-new.book_back')}</a></p>;
  if (done || qr?.state === 'paid') {
    return (
      <section data-testid="book-done">
        {calendar}
        <p role="status" className="adm-ok" data-testid="book-done-msg">{t(done?.kind === 'confirmed' ? 'A-new.book_done_confirmed' : 'A-new.book_done_paid')}</p>
        <a className="adm-btn" href={adminPath(slug, 'calendar')}>{t('A-0002')}</a>
      </section>
    );
  }
  if (qr) {
    return (
      <section className="adm-card" data-testid="book-qr">
        {calendar}
        <h1>{t('A-0056')}</h1>
        {/* i18n-ignore: the QR image is an inline image from the payment gateway */}
        <img src={`data:image/png;base64,${qr.payment.qrImageBase64}`} alt={t('A-new.book_qr_alt')} width={240} height={240} data-testid="book-qr-img" />
        <p><strong>{t('A-0062')}</strong> {formatBaht(qr.payment.amountSatang)}</p>
        <p className="adm-muted">{qr.state === 'ended' ? t('A-new.book_qr_ended') : t('A-new.book_qr_waiting', { time: timeOf(qr.holdExpiresAt ?? qr.payment.qrExpiresAt) })}</p>
        {qr.state === 'ended' ? <button type="button" className="adm-btn" onClick={() => { setQr(null); key.current = newKey(); }} data-testid="book-again">{t('A-new.book_again')}</button> : null}
      </section>
    );
  }

  return (
    <section data-testid="book" aria-labelledby="book-title">
      {calendar}
      <h1 id="book-title">{t('A-0012')}</h1>

      <fieldset className="adm-card" data-testid="book-slot">
        <legend>{t('A-new.book_slot')}</legend>
        <label className="adm-field"><span>{t('A-new.cal_court_pick')}</span>
          <select value={courtId} onChange={(e) => setCourtId(e.target.value)} data-testid="book-court">
            <option value="">{t('A-new.sell_pick')}</option>
            {courts.courts.map((c) => <option key={c.id} value={c.id}>{t('A-0019', { court: c.name })}</option>)}
          </select>
        </label>
        {start ? (
          <>
            <p data-testid="book-when">{longDayOf(lang, dayText(start))} · {hours.map(hourText).join(', ')}</p>
            <span className="adm-inline">
              <button type="button" className="adm-btn adm-btn-ghost" disabled={count >= 6} onClick={() => setCount(count + 1)} data-testid="book-more">{t('A-new.book_add_hour')}</button>
              <button type="button" className="adm-btn adm-btn-ghost" disabled={count <= 1} onClick={() => setCount(count - 1)} data-testid="book-less">{t('A-new.book_remove_hour')}</button>
            </span>
          </>
        ) : <p className="adm-muted" data-testid="book-no-start">{t('A-new.book_pick_in_calendar')} <a href={adminPath(slug, 'calendar')}>{t('A-0002')}</a></p>}
        {court ? <p className="adm-muted">{t('A-0019', { court: court.name })}</p> : null}
      </fieldset>

      <fieldset className="adm-card" data-testid="book-customer">
        <legend>{t('A-0039')}</legend>
        {customer ? (
          <p data-testid="book-chosen">{customer.name ?? customer.phone}{customer.phone && customer.name ? ` · ${customer.phone}` : ''} <button type="button" className="adm-btn adm-btn-ghost" onClick={() => { setCustomer(null); setQ(''); }} data-testid="book-change">{t('A-new.book_change_customer')}</button></p>
        ) : (
          <>
            <label className="adm-field"><span>{t('A-0067')}</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} data-testid="book-search" /></label>
            {hits && hits.length === 0 ? <p className="adm-muted" data-testid="book-nohits">{t('A-new.cust_no_match')}</p> : null}
            {hits && hits.length > 0 ? (
              <ul className="adm-list" data-testid="book-hits">
                {hits.map((h) => (
                  <li key={h.customerId}>
                    <button type="button" className="adm-btn adm-btn-ghost" disabled={!canBook(h)} onClick={() => { setCustomer(h); setHits(null); }} data-testid={`hit-${h.customerId}`}>{h.name ?? t('A-new.cust_no_name')}{h.phone ? ` · ${h.phone}` : ''}</button>
                    {!canBook(h) ? <span className="adm-muted"> {t('A-new.book_not_signed_in')}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </fieldset>

      {addOns.length > 0 ? (
        <fieldset className="adm-card" data-testid="book-addons">
          <legend>{t('A-new.book_addons')}</legend>
          {addOns.map((a) => (
            <label key={a.id} className="adm-check"><input type="checkbox" checked={picked.includes(a.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, a.id] : picked.filter((x) => x !== a.id))} data-testid={`addon-${a.id}`} /> {lang === 'th' ? a.nameTh : a.nameEn} · {formatBaht(a.priceSatang ?? 0)}</label>
          ))}
        </fieldset>
      ) : null}

      <label className="adm-field"><span>{t('A-0435')}</span><input value={code} onChange={(e) => setCode(e.target.value)} data-testid="book-code" autoCapitalize="characters" /></label>

      {quote ? (
        <section className="adm-card" aria-label={t('A-0062')} data-testid="book-quote">
          <ul className="adm-list">
            {quote.lines.map((l) => (
              <li key={l.position}><span>{l.kind === 'court_hour' ? `${t('A-new.book_line_court')} ${hourText(l.startsAt)}` : l.kind === 'coach' ? t('A-new.book_line_coach') : t('A-new.book_line_addon')}</span><span>{formatBaht(l.netSatang)}</span></li>
            ))}
          </ul>
          {quote.discountSatang > 0 ? <p>{t('A-new.book_discount', { amount: formatBaht(quote.discountSatang) })}</p> : null}
          {quote.codeNotApplied ? <p className="adm-muted">{t('A-new.book_code_not_applied')}</p> : null}
          <p><strong>{t('A-0062')}</strong> {formatBaht(quote.totalSatang)}</p>
          {quote.creditValueSatang > 0 ? <p className="adm-muted">{t('A-new.book_credit_used', { amount: formatBaht(quote.creditValueSatang) })}</p> : null}
          {quote.walletSatang > 0 ? <p className="adm-muted">{t('A-new.book_wallet_used', { amount: formatBaht(quote.walletSatang) })}</p> : null}
          <p data-testid="book-due"><strong>{t('A-new.book_to_pay')}</strong> {formatBaht(quote.moneySatang)}</p>
          {quote.cancelWindowHours !== null ? <p className="adm-muted">{t('A-new.book_policy', { hours: quote.cancelWindowHours })}</p> : null}
        </section>
      ) : null}

      {err ? <p role="alert" className="adm-error" data-testid="book-err">{t(err.key, err.vars)}</p> : null}
      <span className="adm-inline">
        <button type="button" className="adm-btn adm-btn-ghost" disabled={busy || !ready} onClick={() => void check()} data-testid="book-quote-btn">{t('A-new.book_check')}</button>
        <button type="button" className="adm-btn" disabled={busy || !quote} onClick={() => void sell()} data-testid="book-sell">{t(quote && quote.moneySatang === 0 ? 'A-new.book_confirm' : 'A-0439')}</button>
      </span>
    </section>
  );
}
