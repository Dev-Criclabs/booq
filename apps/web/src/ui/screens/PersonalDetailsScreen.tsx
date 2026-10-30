'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Lang } from '../../client/i18n';
import { clubHome } from '../../client/paths';
import { changesFrom, loadProfile, saveProfile, type Profile, type ProfileErrors } from '../../client/profile';
import { useClub, useLiff } from '../../client/use-club';
import { PersonalDetails, type PersonalDetailsForm } from '../PersonalDetails';
import { Loading, StateScreen } from '../StateScreen';

// /c/{slug}/profile/personal-details (C17). Needs a person: a guest signs in first and comes back
// (AUTH-01-AC9). Only changed fields are sent; every saved change is audited by the server (AC21).

const formOf = (p: Profile): PersonalDetailsForm => ({ fullName: p.fullName ?? '', phone: p.phone ?? '', dateOfBirth: p.dateOfBirth, level: p.level });

export function PersonalDetailsScreen({ slug, initialLang }: { slug: string; initialLang: Lang }) {
  const liff = useLiff();
  const { load, lang, setLang, t, retry } = useClub(slug, initialLang, liff);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<PersonalDetailsForm | null>(null);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [pageError, setPageError] = useState<string | null>(null);
  const [lineName, setLineName] = useState<string | null>(null);
  const here = () => window.location.pathname + window.location.search;

  useEffect(() => {
    if (load.state !== 'ready') return;
    let live = true;
    void loadProfile(slug, here(), window.fetch.bind(window)).then((r) => {
      if (!live) return;
      if (r.kind === 'sign_in') return window.location.replace(r.url);
      if (r.kind === 'error') return setPageError(r.key);
      setProfile(r.profile);
      setForm(formOf(r.profile));
      // The player's saved language wins over the guest choice on this device (AUTH-02-AC26).
      if (r.profile.language && r.profile.language !== lang) setLang(r.profile.language);
    });
    return () => {
      live = false;
    };
    // Load once per club load; the language follows the profile, not the other way round.
  }, [load, slug]);

  useEffect(() => {
    if (!liff || load.state !== 'ready' || !load.config.liffId) return;
    let live = true;
    liff
      .init({ liffId: load.config.liffId })
      .then(() => live && setLineName(liff.getDisplayName()))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [liff, load]);

  const onChange = useCallback((c: Partial<PersonalDetailsForm>) => {
    setForm((f) => (f ? { ...f, ...c } : f));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(c)) delete next[k as keyof ProfileErrors];
      return next;
    });
    setStatus('idle');
  }, []);

  // The Profile language toggle saves on the player record at once (AUTH-02-AC26).
  const onLang = useCallback(
    (l: Lang) => {
      setLang(l);
      if (profile) void saveProfile(slug, here(), { language: l }, window.fetch.bind(window)).then((r) => r.kind === 'ok' && setProfile(r.profile));
    },
    [profile, setLang, slug],
  );

  const onSave = useCallback(async () => {
    if (!profile || !form) return;
    setFormError(null);
    if (form.dateOfBirth === 'invalid') return setErrors({ dateOfBirth: 'P-new.profile_dob_invalid' });
    const change = changesFrom(profile, { ...form, dateOfBirth: form.dateOfBirth });
    if (Object.keys(change).length === 0) return setStatus('saved');
    setStatus('saving');
    const r = await saveProfile(slug, here(), change, window.fetch.bind(window));
    if (r.kind === 'sign_in') return window.location.replace(r.url);
    if (r.kind === 'ok') {
      setProfile(r.profile);
      setForm(formOf(r.profile));
      return setStatus('saved');
    }
    setStatus('idle');
    if (r.kind === 'fields') setErrors(r.errors);
    else setFormError(r.key);
  }, [profile, form, slug]);

  const onBack = useCallback(() => {
    if (window.history.length > 1) window.history.back();
    else window.location.assign(clubHome(slug));
  }, [slug]);

  if (load.state === 'not_found') return <StateScreen t={t} testId="not-found" textKey="P-new.page_not_found" />;
  if (load.state === 'offline' || pageError === 'P-0327') return <StateScreen t={t} offline testId="offline" titleKey="P-0326" textKey="P-0327" actionKey="P-0328" onAction={retry} />;
  if (pageError) return <StateScreen t={t} testId="page-error" textKey={pageError} />;
  if (load.state === 'loading' || !form) return <Loading />;
  return <PersonalDetails t={t} lang={lang} onLang={onLang} form={form} errors={errors} lineName={lineName} status={status} formError={formError} onChange={onChange} onSave={() => void onSave()} onBack={onBack} />;
}
