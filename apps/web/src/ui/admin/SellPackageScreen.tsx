'use client';
import { useEffect, useRef, useState } from 'react';
import { formatBaht } from '../../client/admin/api';
import { loadProfile, type Profile } from '../../client/admin/profile';
import { adminPath } from '../../client/admin/shell';
import { timeOf } from '../../client/admin/time';
import {
  byType, cashBody, loadProducts, newKey, orderStatus, payPackageByQr, quotePackage, REASON_KEY, REASONS, sellErrorKey, sellForCash, TYPE_KEY, type CashDraft, type PackageQuote, type Product, type QrPayment,
} from '../../client/admin/sell';
import { useAdmin } from './AdminFrame';

// A02c Sell a package (F11-T14; ADMIN-04; board G-A02c-Sell-package): front desk and owner sell a package at the counter. The player pays by PromptPay QR
// shown on this screen (the page waits and says when it is paid), or the desk takes cash with a reason (and a note when the reason is "other"). The
// wallet is used up to the price by the server and the quote shows it. Credits reach the player after payment; the receipt goes to their LINE. Not drawn: a
// promo code (the cash route takes none) and the list limited to the customer's audience (the quote refuses a package that is not for the customer).

type Load = { kind: 'loading' } | { kind: 'ready'; profile: Profile; products: Product[] } | { kind: 'not_found' } | { kind: 'error' } | { kind: 'forbidden' };
type Done = { kind: 'cash'; cash: number; wallet: number } | { kind: 'paid' } | { kind: 'wallet' };
type Qr = { orderId: string; payment: QrPayment; state: 'waiting' | 'paid' | 'ended' };

export function SellPackageScreen({ id }: { id: string }) {
  const { slug, lang, t } = useAdmin();
  const f = () => window.fetch.bind(window);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [productId, setProductId] = useState('');
  const [method, setMethod] = useState<'qr' | 'cash'>('qr');
  const [cash, setCash] = useState<CashDraft>({ reason: '', note: '' });
  const [quote, setQuote] = useState<PackageQuote | null>(null);
  const [qr, setQr] = useState<Qr | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newKey());

  useEffect(() => {
    let live = true;
    void Promise.all([loadProfile(slug, id, f()), loadProducts(slug, f())]).then(([p, pr]) => {
      if (!live) return;
      if (p.kind === 'forbidden' || pr.kind === 'forbidden') return setLoad({ kind: 'forbidden' });
      if (p.kind === 'not_found') return setLoad({ kind: 'not_found' });
      setLoad(p.kind === 'ok' && pr.kind === 'ok' ? { kind: 'ready', profile: p.body, products: pr.body } : { kind: 'error' });
    });
    return () => {
      live = false;
    };
  }, [slug, id]);

  // While the QR is on screen the order is read every few seconds until it is paid or ended.
  useEffect(() => {
    if (!qr || qr.state !== 'waiting') return;
    const timer = setInterval(() => {
      void orderStatus(slug, qr.orderId, f()).then((s) => {
        if (s === 'paid') setQr((q) => (q ? { ...q, state: 'paid' } : q));
        else if (s === 'released' || s === 'cancelled') setQr((q) => (q ? { ...q, state: 'ended' } : q));
      });
    }, 3000);
    return () => clearInterval(timer);
  }, [qr, slug]);

  const back = <p><a href={`${adminPath(slug, 'customers')}/${encodeURIComponent(id)}`} data-testid="sell-back">{t('A-0428')}</a></p>;
  if (load.kind === 'loading') return <p aria-busy="true" className="adm-muted">…</p>;
  if (load.kind === 'forbidden') return <p role="alert" data-testid="sell-forbidden">{t('A-new.sell_err_forbidden')}</p>;
  if (load.kind === 'not_found') return <div data-testid="sell-missing">{back}<p>{t('A-new.sell_err_customer')}</p></div>;
  if (load.kind === 'error') return <div role="alert" data-testid="sell-error"><p>{t('A-new.sell_load_failed')}</p><button type="button" className="adm-btn" onClick={() => window.location.reload()}>{t('A-new.set_retry')}</button></div>;
  const { profile, products } = load;
  const name = (profile.fullName ?? profile.displayName ?? profile.phone ?? '').trim();
  const chosen = products.find((p) => p.productId === productId);

  async function sell() {
    if (!chosen) return setErr('A-new.sell_err_pick');
    setErr(null);
    setBusy(true);
    if (method === 'cash') {
      const body = cashBody(chosen.productId, cash);
      if (!body.ok) {
        setBusy(false);
        return setErr(body.key);
      }
      const r = await sellForCash(slug, id, body.body, key.current, f());
      setBusy(false);
      if (r.kind !== 'ok') return setErr(sellErrorKey(r));
      return setDone({ kind: 'cash', cash: r.body.cashSatang, wallet: r.body.walletSatang });
    }
    const q = await quotePackage(slug, id, chosen.productId, f());
    if (q.kind !== 'ok') {
      setBusy(false);
      return setErr(sellErrorKey(q));
    }
    setQuote(q.body);
    const r = await payPackageByQr(slug, id, chosen.productId, q.body.quoteHash, key.current, f());
    setBusy(false);
    if (r.kind !== 'ok') return setErr(sellErrorKey(r));
    if ('priceChanged' in r.body) {
      setQuote(r.body.quote);
      return setErr('A-new.sell_price_changed');
    }
    if (r.body.confirmed) return setDone({ kind: 'wallet' });
    setQr({ orderId: r.body.orderId, payment: r.body.payment, state: 'waiting' });
  }

  const money = (n: number) => formatBaht(n);
  if (done || qr?.state === 'paid') {
    return (
      <section data-testid="sell-done">
        {back}
        <p role="status" className="adm-ok" data-testid="sell-done-msg">
          {done?.kind === 'cash' ? t('A-new.sell_done_cash', { cash: money(done.cash), wallet: money(done.wallet) }) : done?.kind === 'wallet' ? t('A-new.sell_done_wallet') : t('A-new.sell_done_paid')}
        </p>
        <p className="adm-muted">{t('A-0440')}</p>
        <a className="adm-btn" href={`${adminPath(slug, 'customers')}/${encodeURIComponent(id)}`}>{t('A-0428')}</a>
      </section>
    );
  }

  if (qr) {
    return (
      <section className="adm-card" data-testid="sell-qr">
        {back}
        <h1>{t('A-0056')}</h1>
        {/* i18n-ignore: the QR image is an inline image from the payment gateway */}
        <img src={`data:image/png;base64,${qr.payment.qrImageBase64}`} alt={t('A-new.sell_qr_alt')} width={240} height={240} data-testid="sell-qr-img" />
        <p><strong>{t('A-0062')}</strong> {money(qr.payment.amountSatang)}</p>
        <p className="adm-muted">{qr.state === 'ended' ? t('A-new.sell_qr_ended') : t('A-new.sell_qr_waiting', { time: timeOf(qr.payment.qrExpiresAt) })}</p>
        {qr.state === 'ended' ? <button type="button" className="adm-btn" onClick={() => { setQr(null); key.current = newKey(); }} data-testid="sell-again">{t('A-new.sell_again')}</button> : null}
      </section>
    );
  }

  return (
    <section data-testid="sell" aria-labelledby="sell-title">
      {back}
      <h1 id="sell-title">{t('A-0429')}</h1>
      <p className="adm-muted" data-testid="sell-for">{t('A-new.sell_for', { playerName: name })}</p>
      {products.length === 0 ? <p className="adm-muted" data-testid="sell-none">{t('A-new.sell_none')}</p> : null}
      {byType(products).map((g) => (
        <fieldset key={g.type} className="adm-card" data-testid={`sell-group-${g.type}`}>
          <legend>{t(TYPE_KEY[g.type])}</legend>
          {g.items.map((p) => (
            <label key={p.productId} className="adm-check adm-product">
              <input type="radio" name="product" value={p.productId} checked={productId === p.productId} onChange={() => { setProductId(p.productId); setErr(null); }} data-testid={`product-${p.productId}`} />
              <span>
                <strong>{lang === 'th' ? p.nameTh : p.nameEn}</strong>{' '}
                <span className="adm-muted">{g.type === 'court_hour'
                  ? t('A-0432', { hours: p.credits, validityMonths: p.validityMonths, pricePerHour: money(p.pricePerCreditSatang) })
                  : t('A-new.sell_detail', { credits: p.credits, validityMonths: p.validityMonths, price: money(p.priceSatang) })}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ))}

      <fieldset className="adm-card">
        <legend>{t('A-0052')}</legend>
        <label className="adm-check"><input type="radio" name="method" checked={method === 'qr'} onChange={() => setMethod('qr')} data-testid="method-qr" /> {t('A-0056')}</label>
        <label className="adm-check"><input type="radio" name="method" checked={method === 'cash'} onChange={() => setMethod('cash')} data-testid="method-cash" /> {t('A-0438')}</label>
        {method === 'cash' ? (
          <div className="adm-form">
            <label className="adm-field"><span>{t('A-new.sell_reason')}</span>
              <select value={cash.reason} onChange={(e) => setCash({ ...cash, reason: e.target.value as CashDraft['reason'] })} data-testid="cash-reason">
                <option value="">{t('A-new.sell_pick')}</option>
                {REASONS.map((r) => <option key={r} value={r}>{t(REASON_KEY[r])}</option>)}
              </select>
            </label>
            <label className="adm-field"><span>{t('A-new.sell_note')}</span><textarea value={cash.note} rows={2} maxLength={500} onChange={(e) => setCash({ ...cash, note: e.target.value })} data-testid="cash-note" /></label>
          </div>
        ) : null}
      </fieldset>

      {quote ? <p className="adm-muted" data-testid="sell-quote">{t('A-new.sell_quote', { total: money(quote.totalSatang), wallet: money(quote.walletSatang), money: money(quote.moneySatang) })}</p> : null}
      {err ? <p role="alert" className="adm-error" data-testid="sell-err">{t(err)}</p> : null}
      <button type="button" className="adm-btn" disabled={busy || !chosen} onClick={() => void sell()} data-testid="sell-go">{t(method === 'qr' ? 'A-0439' : 'A-new.sell_cash_go')}</button>
    </section>
  );
}
