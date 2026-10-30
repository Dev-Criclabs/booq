'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { translator, type Lang, type T } from './i18n';
import { langCookie, pickLang } from './lang';
import { liffPort, type LiffPort } from './liff';

// What every player page needs first (design 4.2 step 2): the club's public config from
// GET /api/c/{slug}/public/config, the language to show, and the text function for it.

export interface ClubConfig {
  nameTh: string;
  nameEn: string;
  defaultLanguage: string;
  status: string;
  liffId: string | null;
  languages: Lang[];
  /** The current privacy notice and terms release (D152), or null when none is published. */
  noticeVersion?: string | null;
}

export type ClubLoad = { state: 'loading' } | { state: 'ready'; config: ClubConfig } | { state: 'not_found' } | { state: 'offline' };

export async function loadClub(slug: string, f: typeof fetch): Promise<ClubLoad> {
  try {
    const res = await f(`/api/c/${encodeURIComponent(slug)}/public/config`, { credentials: 'same-origin' });
    if (res.status === 404) return { state: 'not_found' };
    if (!res.ok) return { state: 'offline' };
    return { state: 'ready', config: (await res.json()) as ClubConfig };
  } catch {
    return { state: 'offline' };
  }
}

export function clubName(config: ClubConfig, lang: Lang): string {
  return lang === 'th' ? config.nameTh : config.nameEn;
}

/** The page's LIFF: undefined while it loads, null when it cannot be loaded. */
export function useLiff(): LiffPort | null | undefined {
  const [liff, setLiff] = useState<LiffPort | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void liffPort().then((l) => live && setLiff(l));
    return () => {
      live = false;
    };
  }, []);
  return liff;
}

export function useClub(slug: string, initialLang: Lang, liff: LiffPort | null | undefined) {
  const [load, setLoad] = useState<ClubLoad>({ state: 'loading' });
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setLoad({ state: 'loading' });
    void loadClub(slug, fetch).then((r) => live && setLoad(r));
    return () => {
      live = false;
    };
  }, [slug, attempt]);

  // The starting language needs the club default, and inside LINE the LINE app language.
  const clubDefault = load.state === 'ready' ? load.config.defaultLanguage : null;
  useEffect(() => {
    if (clubDefault === null || liff === undefined) return;
    setLangState(
      pickLang({
        cookie: document.cookie,
        lineLanguage: liff?.isInClient() ? liff.getLanguage() : null,
        browserLanguages: navigator.languages ?? [navigator.language],
        clubDefault,
      }),
    );
  }, [clubDefault, liff]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    document.cookie = langCookie(l);
    setLangState(l);
  }, []);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  /** Fetch the config again behind the current screen (no loading state), e.g. after a new notice release. */
  const reload = useCallback(() => {
    void loadClub(slug, fetch).then((r) => r.state === 'ready' && setLoad(r));
  }, [slug]);
  const t: T = useMemo(() => translator(lang), [lang]);
  return { load, lang, setLang, t, retry, reload };
}
