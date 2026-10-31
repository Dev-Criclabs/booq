'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Lang } from '../../client/i18n';
import { baht, bangkokTime } from '../../client/checkout';
import { addFriendUrl, checkFriendship, markAsked, shouldAsk } from '../../client/friend';
import { formatDate } from '../../client/format';
import { clubHome } from '../../client/paths';
import { icsFor, isId, loadPayment, type PaymentView } from '../../client/payment';
import { clubName, useClub, useLiff } from '../../client/use-club';
import { AddFriendAsk } from '../AddFriendAsk';
import { Loading, StateScreen } from '../StateScreen';
import { PersonGate } from './PersonGate';

// /c/{slug}/confirmed?payment={id}, C12 Confirmed (F05-T11; PAY-02). Shown only for a payment the server reports as confirmed: the court and
// time, what was paid and the receipt number. The add-the-account ask appears once per session to a player who is not yet a friend (LINE-01-AC8).
// The text of the line below the title says the confirmation went to LINE; the page itself decides nothing about the booking.

const session = (): Storage | null => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

export function ConfirmedScreen({ slug, initialLang }: { slug: string; initialLang: Lang }) {
  const liff = useLiff();
  const { load, lang, t, retry } = useClub(slug, initialLang, liff);
  if (load.state === 'not_found') return <StateScreen t={t} testId="not-found" textKey="P-new.page_not_found" />;
  if (load.state === 'offline') return <StateScreen t={t} offline testId="offline" titleKey="P-0326" textKey="P-0327" actionKey="P-0328" onAction={retry} />;
  if (load.state === 'loading') return <Loading />;
  const config = load.config;
  return (
    <PersonGate slug={slug} t={t}>
      <ConfirmedBody slug={slug} lang={lang} t={t} clubLabel={clubName(config, lang)} oaBasicId={config.oaBasicId ?? null} liffId={config.liffId} liff={liff} />
    </PersonGate>
  );
}

function ConfirmedBody({ slug, lang, t, clubLabel, oaBasicId, liffId, liff }: { slug: string; lang: Lang; t: (k: string, v?: Record<string, string | number>) => string; clubLabel: string; oaBasicId: string | null; liffId: string | null; liff: ReturnType<typeof useLiff> }) {
  const f = useMemo(() => (typeof window === 'undefined' ? fetch : window.fetch.bind(window)), []);
  const paymentId = useMemo(() => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('payment')), []);
  const [p, setP] = useState<PaymentView | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'offline' | 'not_confirmed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [ask, setAsk] = useState(false);

  useEffect(() => {
    if (!isId(paymentId)) return;
    let live = true;
    void loadPayment(slug, paymentId, f).then((r) => {
      if (!live) return;
      if (!r.ok) return setState(r.status === 404 ? 'not_confirmed' : 'offline');
      if (r.value.state !== 'confirmed') return setState('not_confirmed');
      setP(r.value);
      setState('ok');
    });
    return () => {
      live = false;
    };
  }, [slug, paymentId, f, attempt]);

  // The add-the-account ask: only for a known non friend inside LIFF, once per session.
  useEffect(() => {
    if (state !== 'ok' || !liff || !liffId) return;
    let live = true;
    liff
      .init({ liffId })
      .then(() => (liff.isLoggedIn() ? checkFriendship(liff, slug, window.fetch.bind(window)) : null))
      .then((friend) => live && setAsk(shouldAsk(friend ?? null, session(), slug)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [state, liff, liffId, slug]);
  useEffect(() => {
    if (ask) markAsked(session(), slug);
  }, [ask, slug]);
  const dismiss = useCallback(() => {
    markAsked(session(), slug);
    setAsk(false);
  }, [slug]);

  const done = useCallback(() => window.location.assign(clubHome(slug)), [slug]);
  if (!isId(paymentId) || state === 'not_confirmed') return <StateScreen t={t} testId="not-confirmed" textKey="P-new.page_not_found" actionKey="P-0332" onAction={done} />;
  if (state === 'offline') return <StateScreen t={t} offline testId="offline" titleKey="P-0326" textKey="P-0327" actionKey="P-0328" onAction={() => { setState('loading'); setAttempt((n) => n + 1); }} />;
  if (state === 'loading' || !p) return <Loading />;

  const b = p.booking;
  const day = b ? new Date(Date.parse(b.startAt) + 7 * 3_600_000).toISOString().slice(0, 10) : '';
  const court = b?.courtName ?? '';
  const start = b ? bangkokTime(b.startAt) : '';
  const end = b ? bangkokTime(b.endAt) : '';
  const ics = b ? `data:text/calendar;charset=utf-8,${encodeURIComponent(icsFor(`${clubLabel} · ${t('P-0021', { court })}`, b.startAt, b.endAt, p.paymentId))}` : null;
  const shareText = b ? `${clubLabel} · ${t('P-0021', { court })} · ${formatDate(lang, day)} ${day.slice(0, 4)} · ${start}-${end}` : '';
  return (
    <div className="app checkout" data-screen="C12">
      <main className="form-body conf" data-testid="confirmed">
        <span className="conf-mark" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" focusable="false"><path d="m5 12 5 5 9-10" /></svg>
        </span>
        <div className="conf-head" role="status">
          <h1>{t('P-0105')}</h1>
          <p className="co-sub">{t('P-0106')}</p>
        </div>
        <section className="co-card co-bill" data-testid="conf-card">
          {b ? (
            <>
              <div className="co-row"><span>{t('P-0107')}</span><span>{court}</span></div>
              <div className="co-row"><span>{t('P-0108')}</span><span>{start} – {end}</span></div>
              <div className="co-row"><span>{t('P-0109')}</span><span>{t('P-0110', { dateYear: `${formatDate(lang, day)} ${day.slice(0, 4)}` })}</span></div>
            </>
          ) : null}
          <div className="co-row"><span>{t('P-0111')}</span><span>{baht(p.amountSatang)}</span></div>
          {p.receiptNumber ? <div className="co-row"><span>{t('P-0112', { receiptNumber: p.receiptNumber })}</span><span /></div> : null}
        </section>
        {ask ? <AddFriendAsk t={t} clubName={clubLabel} url={addFriendUrl(oaBasicId)} onDismiss={dismiss} /> : null}
        <div className="conf-actions">
          {ics ? <a className="btn btn-ghost" href={ics} download="booking.ics" data-testid="calendar"><span>{t('P-0113')}</span></a> : null}
          {b ? <a className="btn btn-ghost" href={`https://line.me/R/msg/text/?${encodeURIComponent(shareText)}`} target="_blank" rel="noopener" data-testid="share"><span>{t('P-0114')}</span></a> : null}
        </div>
      </main>
      <footer className="form-foot">
        <button type="button" className="btn btn-primary" onClick={done} data-testid="done"><span>{t('P-0117')}</span></button>
      </footer>
    </div>
  );
}
