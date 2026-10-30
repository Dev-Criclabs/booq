'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { translator, type Lang, type T } from './i18n';
import { langCookie, pickLang } from './lang';
import type { LiffPort } from './liff';

// What every player page needs first (design 4.2 step 2): the club's public config from
// GET /api/c/{slug}/public/config, the language to show, and the text function for it.

export interface ClubConfig {
  nameTh: string;
  nameEn: string;
  defaultLanguage: string;
  status: string;
  liffId: string | null;
  languages: Lang[];
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

export function useClub(slug: string, initialLang: Lang, liff: LiffPort | null) {
  const [load, setLoad] = useState<ClubLoad>({ state: 'loading' });
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setLoad({ state: 'loading' });
    void loadClub(slug, fetch).then((r) => {
      if (!live) return;
      setLoad(r);
      if (r.state === 'ready') {
        setLangState(
          pickLang({
            cookie: document.cookie,
            lineLanguage: liff?.isInClient() ? liff.getLanguage() : null,
            browserLanguages: navigator.languages ?? [navigator.language],
            clubDefault: r.config.defaultLanguage,
          }),
        );
      }
    });
    return () => {
      live = false;
    };
  }, [slug, liff, attempt]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    document.cookie = langCookie(l);
    setLangState(l);
  }, []);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const t: T = useMemo(() => translator(lang), [lang]);
  return { load, lang, setLang, t, retry };
}
