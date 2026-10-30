'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDate, formatTime } from '../../client/format';
import type { Lang } from '../../client/i18n';
import { clubHome, safeNext, slotFromNext } from '../../client/paths';
import { ERROR_KEY, signInFlow, type SignInStep } from '../../client/sign-in';
import { clubName, useClub, useLiff } from '../../client/use-club';
import { StateScreen, Loading } from '../StateScreen';
import { Welcome } from '../Welcome';

// /c/{slug}/sign-in?next=... (design 4.2, 6.2). Reached when a guest taps Continue, Buy or opens a
// page that needs a person. Inside LINE it signs in with no tap; in a browser it shows C1. LINE's
// login comes back to this page, which then finishes the sign in (F02-T18 client).

export function SignInScreen({ slug, next: rawNext, initialLang }: { slug: string; next: string | null; initialLang: Lang }) {
  const liff = useLiff();
  const next = safeNext(slug, rawNext);
  const { load, lang, setLang, t, retry } = useClub(slug, initialLang, liff);
  const [step, setStep] = useState<SignInStep | null>(null);
  const [attempt, setAttempt] = useState(0);

  const flow = useMemo(
    () => (liff ? signInFlow({ liff, slug, next, origin: window.location.origin, fetch: window.fetch.bind(window) }) : null),
    [liff, slug, next],
  );

  useEffect(() => {
    if (load.state !== 'ready' || liff === undefined) return;
    if (!flow) return setStep({ kind: 'error', code: 'offline' }); // the LIFF SDK could not load
    let live = true;
    setStep(null);
    void flow.run().then((s) => live && setStep(s));
    return () => {
      live = false;
    };
  }, [load, liff, flow, attempt]);

  useEffect(() => {
    if (step?.kind === 'go') window.location.replace(step.url);
  }, [step]);

  const onLogin = useCallback(() => flow?.login(), [flow]);

  // Keep browsing: back to where the guest was; nothing is created (AUTH-01-AC6).
  const onKeepBrowsing = useCallback(() => {
    const from = document.referrer ? new URL(document.referrer) : null;
    if (from && from.origin === window.location.origin && window.history.length > 1) window.history.back();
    else window.location.assign(clubHome(slug));
  }, [slug]);

  const again = useCallback(() => {
    setStep(null);
    setAttempt((n) => n + 1);
    retry();
  }, [retry]);

  if (load.state === 'not_found') return <StateScreen t={t} testId="not-found" textKey={ERROR_KEY.not_found} />;
  if (load.state === 'offline') return <StateScreen t={t} offline testId="offline" titleKey="P-0326" textKey="P-0327" actionKey="P-0328" onAction={again} />;
  if (load.state === 'loading' || step === null || step.kind === 'go') return <Loading />;
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
      busy={false}
      onLogin={onLogin}
      onKeepBrowsing={onKeepBrowsing}
    />
  );
}
