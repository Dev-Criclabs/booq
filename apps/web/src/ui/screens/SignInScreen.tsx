'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDate, formatTime } from '../../client/format';
import type { Lang } from '../../client/i18n';
import { liffPort } from '../../client/liff';
import { clubHome, safeNext, slotFromNext } from '../../client/paths';
import { ERROR_KEY, exchange, runSignIn, type SignInStep } from '../../client/sign-in';
import { clubName, useClub } from '../../client/use-club';
import { StateScreen, Loading } from '../StateScreen';
import { Welcome } from '../Welcome';

// /c/{slug}/sign-in?next=... (design 4.2, 6.2). Reached when a guest taps Continue, Buy or opens a
// page that needs a person. Inside LINE it signs in with no tap; in a browser it shows C1.

export function SignInScreen({ slug, next: rawNext, initialLang }: { slug: string; next: string | null; initialLang: Lang }) {
  const liff = useMemo(() => liffPort(), []);
  const next = safeNext(slug, rawNext);
  const { load, lang, setLang, t, retry } = useClub(slug, initialLang, liff);
  const [step, setStep] = useState<SignInStep | null>(null);
  const [busy, setBusy] = useState(false);

  const input = useCallback(
    () => ({ liff, liffId: load.state === 'ready' ? load.config.liffId : null, slug, next, here: window.location.href, fetch: window.fetch.bind(window) }),
    [liff, load, slug, next],
  );

  useEffect(() => {
    if (load.state !== 'ready') return;
    let live = true;
    setStep(null);
    void runSignIn(input()).then((s) => live && setStep(s));
    return () => {
      live = false;
    };
  }, [load, input]);

  useEffect(() => {
    if (step?.kind === 'go') window.location.replace(step.url);
  }, [step]);

  const onLogin = useCallback(() => {
    if (!liff) return setStep({ kind: 'error', code: 'offline' });
    setBusy(true);
    if (liff.isLoggedIn()) {
      void exchange(input()).then((s) => {
        setBusy(false);
        setStep(s);
      });
      return;
    }
    liff.login(window.location.href);
  }, [liff, input]);

  // Keep browsing: back to where the guest was; nothing is created (AUTH-01-AC6).
  const onKeepBrowsing = useCallback(() => {
    const from = document.referrer ? new URL(document.referrer) : null;
    if (from && from.origin === window.location.origin && window.history.length > 1) window.history.back();
    else window.location.assign(clubHome(slug));
  }, [slug]);

  const again = useCallback(() => {
    setStep(null);
    retry();
  }, [retry]);

  if (load.state === 'not_found') return <StateScreen t={t} testId="not-found" textKey={ERROR_KEY.not_found} />;
  if (load.state === 'offline') return <StateScreen t={t} offline testId="offline" titleKey="P-0326" textKey="P-0327" actionKey="P-0328" onAction={again} />;
  if (load.state === 'loading' || step === null || step.kind === 'redirecting' || step.kind === 'go') return <Loading />;
  if (step.kind === 'error') {
    if (step.code === 'offline') return <StateScreen t={t} offline testId="offline" titleKey="P-0326" textKey="P-0327" actionKey="P-0328" onAction={again} />;
    if (step.code === 'sign_in_failed') return <StateScreen t={t} testId="sign-in-failed" textKey={ERROR_KEY.sign_in_failed} actionKey="P-0328" onAction={again} />;
    return <StateScreen t={t} testId={step.code} textKey={ERROR_KEY[step.code]} />;
  }

  const choice = slotFromNext(next);
  const slot = choice ? { court: choice.court, date: formatDate(lang, choice.date), startTime: formatTime(choice.startTime), endTime: formatTime(choice.endTime) } : null;
  return (
    <Welcome
      t={t}
      lang={lang}
      onLang={setLang}
      clubName={clubName(load.config, lang)}
      wordmark={load.config.nameEn}
      slot={slot && slot.date && slot.startTime && slot.endTime ? slot : null}
      termsHref={`${clubHome(slug)}/terms`}
      privacyHref={`${clubHome(slug)}/privacy`}
      busy={busy}
      onLogin={onLogin}
      onKeepBrowsing={onKeepBrowsing}
    />
  );
}
