'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Lang } from '../../client/i18n';
import { liffPort } from '../../client/liff';
import { clubHome, safeNext } from '../../client/paths';
import { continueKey, missing, submitProfile, type FieldErrors } from '../../client/profile-setup';
import { useClub } from '../../client/use-club';
import { ProfileSetup } from '../ProfileSetup';
import { Loading, StateScreen } from '../StateScreen';

// /c/{slug}/profile-setup?next=... (C2; design 4.3). Reached from sign in when the server answers
// needs_profile. On success the player goes on to `next` with the choice kept (AUTH-02-AC6).

function without(errors: FieldErrors, field: keyof FieldErrors): FieldErrors {
  const { [field]: _gone, ...rest } = errors;
  return rest;
}

export function ProfileSetupScreen({ slug, next: rawNext, initialLang }: { slug: string; next: string | null; initialLang: Lang }) {
  const liff = useMemo(() => liffPort(), []);
  const next = safeNext(slug, rawNext);
  const { load, lang, t, retry, reload: reloadConfig } = useClub(slug, initialLang, liff);
  const [lineName, setLineName] = useState<string | null>(null);
  const [form, setForm] = useState({ fullName: '', phone: '', consent: false });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The greeting uses the LINE display name (AUTH-02-AC7). Without it the screen still works.
  useEffect(() => {
    if (load.state !== 'ready' || !liff || !load.config.liffId) return;
    let live = true;
    liff
      .init(load.config.liffId)
      .then(() => live && setLineName(liff.getDisplayName()))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [liff, load]);

  const onChange = useCallback((field: 'fullName' | 'phone', value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => without(e, field));
  }, []);
  const onConsent = useCallback((consent: boolean) => {
    setForm((f) => ({ ...f, consent }));
    setErrors((e) => without(e, 'consent'));
  }, []);

  const onSubmit = useCallback(async () => {
    setFormError(null);
    const before = missing(form);
    if (Object.keys(before).length) return setErrors(before);
    setBusy(true);
    const version = load.state === 'ready' ? (load.config.noticeVersion ?? null) : null;
    const out = await submitProfile({ slug, next, ...form, language: lang, noticeVersion: version, fetch: window.fetch.bind(window) });
    if (out.kind === 'go') return window.location.replace(out.url);
    setBusy(false);
    if (out.kind === 'fields') setErrors(out.errors);
    else if (out.kind === 'stale') {
      // A new release was published meanwhile: load it, and ask for consent to it (D152).
      setForm((f) => ({ ...f, consent: false }));
      setFormError('P-new.notice_updated');
      reloadConfig();
    } else setFormError(out.key);
  }, [form, slug, next, lang, load, reloadConfig]);

  if (load.state === 'not_found') return <StateScreen t={t} testId="not-found" textKey="P-new.page_not_found" />;
  if (load.state === 'offline') return <StateScreen t={t} offline testId="offline" titleKey="P-0326" textKey="P-0327" actionKey="P-0328" onAction={retry} />;
  if (load.state === 'loading') return <Loading />;
  return (
    <ProfileSetup
      t={t}
      lineName={lineName}
      fullName={form.fullName}
      phone={form.phone}
      consent={form.consent}
      errors={errors}
      formError={formError}
      continueKey={continueKey(next)}
      termsHref={`${clubHome(slug)}/terms`}
      privacyHref={`${clubHome(slug)}/privacy`}
      busy={busy}
      onChange={onChange}
      onConsent={onConsent}
      onSubmit={() => void onSubmit()}
    />
  );
}
