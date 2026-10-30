'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Lang } from '../../client/i18n';
import { safeNext } from '../../client/paths';
import { loadProfile, saveProfile } from '../../client/profile';
import { useClub, useLiff } from '../../client/use-club';
import { DobStep } from '../DobStep';
import { Loading, StateScreen } from '../StateScreen';

// /c/{slug}/date-of-birth?next=... The checkout sends a player here when a Student item needs a date
// of birth (dob_required, AUTH-02-AC11). The date is saved on the profile like any other (never
// locked), and the price group in the server's answer decides: student goes on to `next` with the
// choice kept; adult means the item is for under 18 (AC12). The screen never works out the age.

export function DobStepScreen({ slug, next: rawNext, initialLang }: { slug: string; next: string | null; initialLang: Lang }) {
  const liff = useLiff();
  const next = safeNext(slug, rawNext);
  const { load, lang, t, retry } = useClub(slug, initialLang, liff);
  const [ready, setReady] = useState(false);
  const [value, setValue] = useState<string | null | 'invalid'>(null);
  const [errorKey, setErrorKey] = useState<string | undefined>(undefined);
  const [tooOld, setTooOld] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const here = () => window.location.pathname + window.location.search;

  useEffect(() => {
    if (load.state !== 'ready') return;
    let live = true;
    void loadProfile(slug, here(), window.fetch.bind(window)).then((r) => {
      if (!live) return;
      if (r.kind === 'sign_in') return window.location.replace(r.url);
      if (r.kind === 'error') return setPageError(r.key);
      setValue(r.profile.dateOfBirth);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [load, slug]);

  const onChange = useCallback((v: string | null | 'invalid') => {
    setValue(v);
    setErrorKey(undefined);
    setTooOld(false);
  }, []);

  const onContinue = useCallback(async () => {
    if (value === null) return setErrorKey('P-new.dob_required');
    if (value === 'invalid') return setErrorKey('P-new.profile_dob_invalid');
    setBusy(true);
    const r = await saveProfile(slug, here(), { dateOfBirth: value }, window.fetch.bind(window));
    setBusy(false);
    if (r.kind === 'sign_in') return window.location.replace(r.url);
    if (r.kind === 'fields') return setErrorKey(r.errors.dateOfBirth ?? 'P-new.profile_dob_invalid');
    if (r.kind === 'error') return setPageError(r.key);
    if (r.profile.priceGroup === 'student') return window.location.replace(next);
    setTooOld(true);
  }, [value, slug, next]);

  const onBack = useCallback(() => {
    if (window.history.length > 1) window.history.back();
    else window.location.assign(next);
  }, [next]);

  if (load.state === 'not_found') return <StateScreen t={t} testId="not-found" textKey="P-new.page_not_found" />;
  if (load.state === 'offline' || pageError === 'P-0327') return <StateScreen t={t} offline testId="offline" titleKey="P-0326" textKey="P-0327" actionKey="P-0328" onAction={retry} />;
  if (pageError) return <StateScreen t={t} testId="page-error" textKey={pageError} />;
  if (load.state === 'loading' || !ready) return <Loading />;
  return <DobStep t={t} lang={lang} value={value} errorKey={errorKey} tooOld={tooOld} busy={busy} onChange={onChange} onContinue={() => void onContinue()} onBack={onBack} />;
}
