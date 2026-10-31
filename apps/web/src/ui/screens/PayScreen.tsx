'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Lang } from '../../client/i18n';
import { baht, bangkokTime } from '../../client/checkout';
import { clubHome } from '../../client/paths';
import { confirmedPath, isId, loadPayment, mmss, POLL_MS, qrSrc, secondsLeft, type PaymentView } from '../../client/payment';
import { useClub, useLiff } from '../../client/use-club';
import { Loading, StateScreen } from '../StateScreen';
import { PersonGate } from './PersonGate';

// /c/{slug}/pay/{orderId}?payment={id}, C11 Pay by PromptPay through Beam (F05-T11; PAY-01-AC1, AC2, PAY-02-AC6). The QR for the exact amount,
// the countdown to the end of the hold, and a wait for the confirmation: there is no slip to upload, the booking confirms by itself once the
// payment arrives. The screen asks the server for the state until it is final; only a state the server calls confirmed leads to C12. When the
// time runs out or the payment fails, nothing was charged and the hour was released.

export function PayScreen({ slug, initialLang }: { slug: string; initialLang: Lang }) {
  const liff = useLiff();
  const { load, lang, t, retry } = useClub(slug, initialLang, liff);
  if (load.state === 'not_found') return <StateScreen t={t} testId="not-found" textKey="P-new.page_not_found" />;
  if (load.state === 'offline') return <StateScreen t={t} offline testId="offline" titleKey="P-0326" textKey="P-0327" actionKey="P-0328" onAction={retry} />;
  if (load.state === 'loading') return <Loading />;
  return (
    <PersonGate slug={slug} t={t}>
      <PayBody slug={slug} lang={lang} t={t} />
    </PersonGate>
  );
}

function PayBody({ slug, lang, t }: { slug: string; lang: Lang; t: (k: string, v?: Record<string, string | number>) => string }) {
  const f = useMemo(() => (typeof window === 'undefined' ? fetch : window.fetch.bind(window)), []);
  const paymentId = useMemo(() => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('payment')), []);
  const [p, setP] = useState<PaymentView | null>(null);
  const [failure, setFailure] = useState<'offline' | 'not_found' | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const minutes = useRef<number | null>(null);

  // Ask until the state is final; a failed ask keeps the screen and tries again (the hold runs on, nothing was lost).
  useEffect(() => {
    if (!isId(paymentId)) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      const r = await loadPayment(slug, paymentId, f);
      if (!live) return;
      if (r.ok) {
        setFailure(null);
        setP(r.value);
        if (r.value.state === 'confirmed') return window.location.replace(confirmedPath(slug, paymentId));
        if (r.value.state === 'waiting' || r.value.state === 'checking') timer = setTimeout(ask, POLL_MS);
        return;
      }
      if (r.status === 404 || r.status === 403) return setFailure('not_found');
      setFailure('offline');
      timer = setTimeout(ask, POLL_MS);
    };
    void ask();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [slug, paymentId, f]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const home = useCallback(() => window.location.assign(clubHome(slug)), [slug]);
  const again = useCallback(() => window.location.assign(`${clubHome(slug)}/book`), [slug]);

  if (!isId(paymentId) || failure === 'not_found') return <StateScreen t={t} testId="not-found" textKey="P-new.page_not_found" actionKey="P-0332" onAction={home} />;
  if (!p) {
    if (failure === 'offline') return <StateScreen t={t} offline testId="offline" titleKey="P-0326" textKey="P-new.pay_open_failed" actionKey="P-0328" onAction={() => window.location.reload()} />;
    return <Loading />;
  }
  const court = p.booking?.courtName ?? '';
  const time = p.booking ? bangkokTime(p.booking.startAt) : '';
  if (p.state === 'expired') {
    return <StateScreen t={t} testId="expired" titleKey="P-0329" textKey={p.booking ? 'P-new.pay_expired_text' : 'P-new.pay_expired_generic'} actionKey="P-0331" onAction={again} vars={{ court, time }} secondKey="P-0332" onSecond={home} />;
  }
  if (p.state === 'failed') {
    return <StateScreen t={t} testId="failed" titleKey="P-new.pay_failed_title" textKey="P-new.pay_failed_text" actionKey="P-0331" onAction={again} secondKey="P-0332" onSecond={home} />;
  }
  if (p.state === 'wallet') {
    return <StateScreen t={t} testId="wallet" titleKey="P-new.pay_wallet_title" textKey="P-new.pay_wallet_text" actionKey="P-0332" onAction={home} />;
  }
  if (p.state === 'confirmed') return <Loading />;
  const checking = p.state === 'checking';

  const left = secondsLeft(p.holdExpiresAt, now);
  if (minutes.current === null && p.holdExpiresAt) minutes.current = Math.max(1, Math.round(left / 60));
  return (
    <div className="app checkout" data-screen="C11">
      <header className="bar">
        <h1 className="bar-title">{t('P-0083')}</h1>
      </header>
      <main className="form-body" data-testid="pay-body">
        {p.holdExpiresAt ? (
          <div className="pay-hold" data-testid="hold">
            <span>{t('P-0084')}</span>
            <span className="pay-timer" data-testid="timer">{mmss(left)}</span>
          </div>
        ) : null}
        <section className="co-card pay-amount" data-testid="amount">
          <small>{t('P-0085')}</small>
          <strong>{baht(p.amountSatang)}</strong>
        </section>
        {checking ? (
          <div className="co-banner" role="status" data-testid="checking">
            <p><b>{t('P-new.pay_checking_title')}</b></p>
            <p>{t('P-new.pay_checking_text')}</p>
          </div>
        ) : null}
        {p.qrImageBase64 ? (
          <>
            <div className="pay-qr" data-testid="qr">
              {/* The QR of the exact amount; a data image, so saving it needs no network. */}
              <img src={qrSrc(p.qrImageBase64)} alt={t('P-0083')} />
            </div>
            <a className="btn btn-ghost" href={qrSrc(p.qrImageBase64)} download="promptpay-qr.png" data-testid="save-qr"><span>{t('P-0087')}</span></a>
            <p className="co-note">{t('P-new.pay_save_qr_hint')}</p>
          </>
        ) : null}
        {checking ? null : <ol className="pay-steps">
          <li>{t('P-0087')}</li>
          <li>{t('P-0088')}</li>
          <li>{t('P-0089')}</li>
        </ol>}
        {checking ? null : <div className="pay-waiting" role="status" data-testid="waiting">
          <span className="spinner" aria-hidden="true" />
          <span>{t('P-0456')}</span>
        </div>}
        {checking ? null : <p className="co-note">{t('P-0457', { holdMinutes: minutes.current ?? 15 })}</p>}
        {failure === 'offline' ? <p className="co-error" role="alert" data-testid="poll-error">{t('P-new.pay_open_failed')}</p> : null}
        {court ? <p className="co-note">{t('P-0021', { court })} · {time}</p> : null}
      </main>
    </div>
  );
}
