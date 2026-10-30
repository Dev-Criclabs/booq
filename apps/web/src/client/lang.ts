import { isLang, type Lang } from './i18n';

// The language a guest sees (design 6.7, AUTH-02-AC25, AC27; assumption A-9): their own choice
// from the toggle (the functional `lang` cookie), else the LINE app language inside LINE, else the
// browser language, else the club's default language. The server saves the guest's choice to the
// player record at first sign in (F02-T16).

export const LANG_COOKIE = 'lang';
const YEAR_SECONDS = 365 * 24 * 60 * 60;

export function cookieLang(cookie: string): Lang | null {
  for (const part of cookie.split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === LANG_COOKIE && isLang(value)) return value;
  }
  return null;
}

/** `th`, `th-TH`, `en-US` to a supported language, or null. */
export function baseLang(tag: string | null | undefined): Lang | null {
  const base = (tag ?? '').toLowerCase().split(/[-_]/)[0];
  return isLang(base) ? base : null;
}

export interface LangSources {
  cookie: string;
  lineLanguage: string | null;
  browserLanguages: readonly string[];
  clubDefault: string | null;
}

export function pickLang(s: LangSources): Lang {
  return (
    cookieLang(s.cookie) ??
    baseLang(s.lineLanguage) ??
    s.browserLanguages.map(baseLang).find((l): l is Lang => l !== null) ??
    baseLang(s.clubDefault) ??
    'th'
  );
}

export function langCookie(lang: Lang): string {
  return `${LANG_COOKIE}=${lang}; Path=/; Max-Age=${YEAR_SECONDS}; SameSite=Lax`;
}
