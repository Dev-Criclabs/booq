'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Lang, T } from '../../client/i18n';
import {
  bangkokTime, baht, billRows, codeRefusalKey, dateYear, isCodeRefusal, loadQuote, newKey, parseChoice, pay, payPath, refusalFor,
  type Choice, type QuoteView, type Refusal, type Wanted,
} from '../../client/checkout';
import { formatDate } from '../../client/format';
import { clubHome } from '../../client/paths';
import { startTime, endTime } from '../../client/schedule';
import { useClub, useLiff } from '../../client/use-club';
import { Loading, StateScreen } from '../StateScreen';
import { PersonGate } from './PersonGate';

// /c/{slug}/checkout, C10 Checkout (F04-T17, T18; R3-AC3, R4-AC5, R5-AC6, R8-AC1 to AC4). The summary of the choice, an optional coach, the add-ons,
// a code, and the bill the server prices. Nothing here computes a price: every amount is the server's. The hour is held only when the player taps
// pay, and Pay is told the hash of the quote that was on the screen, so a changed price comes back as a new quote and nothing is charged (R5-AC6).
// An offline or refused request says nothing was booked or charged and never leaves a half made order on the screen.

interface AddOn { id: string; nameTh: string; nameEn: string; priceSatang: number }
interface CoachCard { coachId: string; displayName: string | null; tier: { nameTh: string; nameEn: string } | null; priceSatang: number | null }

const api = (slug: string) => `/api/c/${encodeURIComponent(slug)}`;
async function getJson<T>(f: typeof fetch, url: string): Promise<T | null> {
  try {
    const r = await f(url, { credentials: 'same-origin', cache: 'no-store' });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

type Fatal = { kind: 'offline' } | { kind: 'refused'; refusal: Refusal } | { kind: 'bad_choice' } | { kind: 'generic' };

export function CheckoutScreen({ slug, initialLang }: { slug: string; initialLang: Lang }) {
  const liff = useLiff();
  const { load, lang, t, retry } = useClub(slug, initialLang, liff);
  if (load.state === 'not_found') return <StateScreen t={t} testId="not-found" textKey="P-new.page_not_found" />;
  if (load.state === 'offline') return <StateScreen t={t} offline testId="offline" titleKey="P-0326" textKey="P-0327" actionKey="P-0328" onAction={retry} />;
  if (load.state === 'loading') return <Loading />;
  return (
    <PersonGate slug={slug} t={t}>
      <CheckoutBody slug={slug} lang={lang} t={t} paused={load.config.status === 'paused'} />
    </PersonGate>
  );
}

function CheckoutBody({ slug, lang, t, paused }: { slug: string; lang: Lang; t: T; paused: boolean }) {
  const f = useMemo(() => (typeof window === 'undefined' ? fetch : window.fetch.bind(window)), []);
  const choice = useMemo<Choice | null>(() => (typeof window === 'undefined' ? null : parseChoice(window.location.search)), []);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [fatal, setFatal] = useState<Fatal | null>(paused ? { kind: 'refused', refusal: { key: 'P-0442', pickAgain: false, vars: {} } } : choice ? null : { kind: 'bad_choice' });
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [coaches, setCoaches] = useState<CoachCard[] | null>(null);
  const [coachId, setCoachId] = useState<string | null>(null);
  const [addOnIds, setAddOnIds] = useState<string[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [payError, setPayError] = useState<{ key: string; vars: Record<string, string | number> } | null>(null);
  const [paying, setPaying] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);
  const payKey = useRef<{ hash: string; key: string } | null>(null);

  const want: Wanted = useMemo(() => ({ coachId, addOnIds, code }), [coachId, addOnIds, code]);

  // The add-ons and the free coaches for exactly these hours; neither is a price, only what can be picked.
  useEffect(() => {
    if (!choice || paused) return;
    let live = true;
    void getJson<AddOn[]>(f, `${api(slug)}/add-ons`).then((a) => live && setAddOns(a ?? []));
    const starts = encodeURIComponent(choice.hours.join(','));
    void getJson<CoachCard[]>(f, `${api(slug)}/coaches/offerable?starts=${starts}&resourceId=${choice.courtId}`).then((c) => live && setCoaches(c ?? []));
    return () => {
      live = false;
    };
  }, [choice, slug, f, paused, attempt]);

  // The quote, again whenever the coach, the add-ons or the code change. A late answer for an older request is dropped.
  useEffect(() => {
    if (!choice || paused) return;
    const mine = ++seq.current;
    void loadQuote(slug, choice, want, f).then((r) => {
      if (mine !== seq.current) return;
      if (r.ok) {
        setQuote(r.value);
        setFatal(null);
        return;
      }
      if (isCodeRefusal(r.code) && want.code) {
        setCodeError(codeRefusalKey(r.code));
        setCode(null);
        return;
      }
      if (r.code === 'offline') return setFatal({ kind: 'offline' });
      const refusal = refusalFor(r.code, r.params);
      if (refusal && refusal.pickAgain === false && (r.code === 'coach_price_not_set' || r.code === 'coach_unavailable' || r.code === 'add_on_not_for_sale') && (want.coachId || want.addOnIds.length)) {
        // The pick is the problem, not the booking: drop it, say why, and price the court alone.
        setNotice(refusal.key);
        setCoachId(null);
        setAddOnIds([]);
        return;
      }
      setFatal(refusal ? { kind: 'refused', refusal } : { kind: 'generic' });
    });
  }, [choice, want, slug, f, paused, attempt]);

  const applyCode = useCallback(() => {
    setCodeError(null);
    setNotice(null);
    setCode(codeInput.trim() === '' ? null : codeInput.trim());
  }, [codeInput]);

  const toggleAddOn = (id: string) => setAddOnIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));

  const back = useCallback(() => {
    if (window.history.length > 1) window.history.back();
    else window.location.assign(`${clubHome(slug)}/book`);
  }, [slug]);

  const onPay = useCallback(async () => {
    if (!choice || !quote || paying) return;
    setPaying(true);
    setPayError(null);
    setNotice(null);
    // One key for the same quote: a second tap is the same Pay (D47), a new quote is a new Pay.
    if (!payKey.current || payKey.current.hash !== quote.quoteHash) payKey.current = { hash: quote.quoteHash, key: newKey() };
    const r = await pay(slug, choice, want, quote.quoteHash, payKey.current.key, f);
    setPaying(false);
    if (!r.ok) {
      if (r.code === 'offline') return setPayError({ key: 'P-0327', vars: {} });
      const refusal = refusalFor(r.code, r.params);
      if (!refusal) return setPayError({ key: 'P-0327', vars: {} });
      if (refusal.pickAgain || r.code === 'club_paused') return setFatal({ kind: 'refused', refusal });
      return setPayError({ key: refusal.key, vars: refusal.vars });
    }
    if (r.value.kind === 'price_changed') {
      setQuote(r.value.quote);
      return setNotice('P-new.checkout_price_changed');
    }
    // Confirmed with no money to pay goes to the bookings; a running payment goes to C11 by its order (F05).
    window.location.assign(r.value.kind === 'confirmed' ? `${clubHome(slug)}/bookings` : payPath(slug, r.value.started.orderId));
  }, [choice, quote, paying, want, slug, f]);

  const again = useCallback(() => {
    setFatal(null);
    setAttempt((n) => n + 1);
  }, []);

  if (fatal?.kind === 'offline') return <StateScreen t={t} offline testId="offline" titleKey="P-0326" textKey="P-0327" actionKey="P-0328" onAction={again} />;
  if (fatal?.kind === 'refused') {
    const { refusal } = fatal;
    return (
      <StateScreen
        t={(k, v) => t(k, { ...refusal.vars, ...v })}
        testId={refusal.key === 'P-0442' ? 'paused' : 'refused'}
        textKey={refusal.key}
        actionKey={refusal.pickAgain ? 'P-new.checkout_back_to_courts' : refusal.key === 'P-0442' ? 'P-0332' : 'P-0328'}
        onAction={refusal.pickAgain || refusal.key === 'P-0442' ? () => window.location.assign(refusal.pickAgain ? `${clubHome(slug)}/book` : clubHome(slug)) : again}
      />
    );
  }
  if (fatal?.kind === 'bad_choice' || fatal?.kind === 'generic' || !choice) {
    return <StateScreen t={t} testId="bad-choice" textKey="P-new.checkout_bad_input" actionKey="P-new.checkout_back_to_courts" onAction={() => window.location.assign(`${clubHome(slug)}/book`)} />;
  }

  const hours = choice.hours.length;
  const rows = quote ? billRows(quote.lines) : null;
  const courtPrice = rows?.courtHours[0] ? rows.courtHours[0].unitPriceSatang : null;
  const nameOf = (a: AddOn) => (lang === 'th' ? a.nameTh : a.nameEn);
  const due = quote?.moneySatang ?? 0;
  return (
    <div className="app checkout" data-screen="C10">
      <header className="bar">
        <button type="button" className="icon-btn" aria-label={t('P-0058')} onClick={back}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <h1 className="bar-title">{t('P-0060')}</h1>
      </header>
      <main className="form-body" data-testid="checkout-body">
        <section className="co-card" data-testid="summary">
          <h2 className="co-title">{t('P-0061', { court: choice.courtName, hours })}</h2>
          <p className="co-sub">{t('P-0062', { dateYear: dateYear(choice.date, formatDate(lang, choice.date)), startTime: startTime(`${choice.date}T${choice.from}`), endTime: endTime(`${choice.date}T${String(Number(choice.to.slice(0, 2)) - 1).padStart(2, '0')}:00`) })}</p>
        </section>

        {notice ? (
          <div className="co-banner" role="status" data-testid="notice">
            <p>{t(notice)}</p>
          </div>
        ) : null}

        {coaches === null || coaches.length > 0 ? (
          <section className="co-section" data-testid="coaches">
            <div className="co-head">
              <h2 className="co-h">{t('P-0063')}</h2>
              <span className="co-opt">{t('P-0064')}</span>
            </div>
            {coaches === null ? <div className="co-skeleton" aria-hidden="true" /> : (
              <div className="co-options" role="radiogroup" aria-label={t('P-0063')}>
                <button type="button" role="radio" aria-checked={coachId === null} className="co-option" onClick={() => setCoachId(null)} data-testid="coach-none">
                  <span className="co-option-main"><b>{t('P-new.checkout_no_coach')}</b></span>
                </button>
                {coaches.map((c) => (
                  <button key={c.coachId} type="button" role="radio" aria-checked={coachId === c.coachId} className="co-option" disabled={c.priceSatang === null} onClick={() => setCoachId(c.coachId)} data-testid="coach">
                    <span className="co-option-main">
                      <b>{c.displayName ?? ''}</b>
                      {c.tier ? <span>{lang === 'th' ? c.tier.nameTh : c.tier.nameEn}</span> : null}
                    </span>
                    {c.priceSatang !== null ? <span className="co-price">{t('P-0070', { price: baht(c.priceSatang) })}</span> : null}
                  </button>
                ))}
              </div>
            )}
            {coachId !== null && courtPrice !== null ? <p className="co-note">{t('P-0065', { date: formatDate(lang, choice.date), time: choice.from, courtPrice: baht(courtPrice) })}</p> : null}
          </section>
        ) : null}

        {addOns.length > 0 ? (
          <section className="co-section" data-testid="add-ons">
            <h2 className="co-h">{t('P-0071')}</h2>
            <div className="co-options">
              {addOns.map((a) => (
                <button key={a.id} type="button" aria-pressed={addOnIds.includes(a.id)} className="co-option" onClick={() => toggleAddOn(a.id)} data-testid="add-on">
                  <span className="co-option-main"><b>{nameOf(a)}</b></span>
                  <span className="co-price">{t('P-0070', { price: baht(a.priceSatang) })}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="co-section">
          <label className="co-h" htmlFor="co-code">{t('P-0074')}</label>
          <div className="co-code">
            <input id="co-code" value={codeInput} onChange={(e) => setCodeInput(e.target.value)} maxLength={40} autoCapitalize="characters" autoComplete="off" spellCheck={false} data-testid="code-input" />
            <button type="button" className="btn btn-ghost" onClick={applyCode} data-testid="code-apply"><span>{t('P-0075')}</span></button>
          </div>
          {codeError ? <p className="co-error" role="alert" data-testid="code-error">{t(codeError, { amount: '' })}</p> : null}
          {quote?.codeNotApplied ? <p className="co-ok">{t('P-new.checkout_code_hint_not_applied')}</p> : null}
        </section>

        <section className="co-card co-bill" data-testid="bill" aria-busy={quote === null}>
          {rows && quote ? (
            <>
              {rows.courtHours.map((l) => (
                <div className="co-row" key={l.position}>
                  <span>{t('P-0076')}{hours > 1 ? <small>{bangkokTime(l.startsAt)}</small> : null}</span>
                  <span>{t('P-0077', { price: baht(l.unitPriceSatang) })}</span>
                </div>
              ))}
              {rows.coaching.map((l) => (
                <div className="co-row" key={l.position}>
                  <span>{t('P-0143')}</span>
                  <span>{t('P-0077', { price: baht(l.unitPriceSatang) })}</span>
                </div>
              ))}
              {rows.addOns.length > 0 ? (
                <details className="co-details">
                  <summary className="co-row">
                    <span>{t('P-0071')}</span>
                    <span>{t('P-0077', { price: baht(rows.addOns.reduce((n, l) => n + l.unitPriceSatang, 0)) })}</span>
                  </summary>
                  <ul className="co-sublines">
                    {rows.addOns.map((l) => {
                      const a = addOns.find((x) => x.id === l.addOnId);
                      return <li key={l.position}>{a ? nameOf(a) : ''}</li>;
                    })}
                  </ul>
                </details>
              ) : null}
              {quote.discountSatang > 0 ? (
                <div className="co-row"><span>{t('P-new.checkout_discount')}</span><span>{t('P-0436', { amount: baht(quote.discountSatang) })}</span></div>
              ) : null}
              <div className="co-row">
                <span>{t('P-0078')}</span>
                <span>{quote.creditValueSatang > 0 ? t('P-0436', { amount: baht(quote.creditValueSatang) }) : t('P-0079')}</span>
              </div>
              <div className="co-row">
                <span>{t('P-0029')}</span>
                <span>{quote.walletSatang > 0 ? t('P-0436', { amount: baht(quote.walletSatang) }) : baht(0)}</span>
              </div>
              <div className="co-row co-row-due" data-testid="due">
                <span>{t('P-0080')}</span>
                <span>{t('P-0081', { total: baht(due) })}</span>
              </div>
            </>
          ) : (
            <div className="co-skeleton" aria-hidden="true" />
          )}
        </section>
        {quote && due === 0 ? <p className="co-note">{t('P-0365')}</p> : <p className="co-note">{t('P-new.checkout_hold_note')}</p>}
      </main>
      <footer className="form-foot co-pay">
        {payError ? <p className="co-error" role="alert" data-testid="pay-error">{t(payError.key, payError.vars)}</p> : null}
        <button type="button" className="btn btn-primary" disabled={!quote || paying} onClick={() => void onPay()} data-testid="pay">
          <span>{paying ? t('P-new.checkout_working') : due === 0 ? t('P-0364') : t('P-0082')}</span>
        </button>
      </footer>
    </div>
  );
}
