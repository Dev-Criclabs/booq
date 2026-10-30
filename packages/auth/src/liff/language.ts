// Language handling (F02-T16; AUTH-02-AC25 to AC27; design 6.7, assumption A-9). The starting
// language is a guest's own toggle choice (cookie `lang`), else the LINE app language inside LINE
// or the browser language outside, else the club's default. Anything that is not Thai or English
// is ignored. The cookie is first party and functional: no tracking, readable by the page so the
// shared toggle can show the current choice.

export type Lang = 'th' | 'en';
export const LANG_COOKIE = 'lang';

const isLang = (v: unknown): v is Lang => v === 'th' || v === 'en';

function ofTag(tag: string): Lang | null {
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
  return primary === 'th' || primary === 'en' ? primary : null;
}

/**
 * A language tag from `liff.getLanguage()`, or an Accept-Language header: the best Thai or English
 * entry by quality, or null. Quality 0 means "not acceptable".
 */
export function parsePreferredLanguage(raw: unknown): Lang | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const ranked = raw
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p)?.[1]).find((v) => v !== undefined);
      return { lang: ofTag(tag), q: q === undefined ? 1 : Number(q), index };
    })
    .filter((e): e is { lang: Lang; q: number; index: number } => e.lang !== null && Number.isFinite(e.q) && e.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return ranked[0]?.lang ?? null;
}

export function chooseLanguage(input: { guestChoice: Lang | null; preferred: unknown; clubDefault: unknown }): Lang {
  if (input.guestChoice) return input.guestChoice;
  return parsePreferredLanguage(input.preferred) ?? (isLang(input.clubDefault) ? input.clubDefault : 'th');
}

/**
 * One year is an assumption (D147): the spec names the cookie but not its life. The caller may pass another.
 */
export const LANG_COOKIE_SECONDS = 31_536_000;

export function serializeLangCookie(lang: Lang, maxAgeSeconds: number): string {
  if (!isLang(lang)) throw new Error('lang cookie: only th or en');
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 0) throw new Error('lang cookie: bad age');
  return `${LANG_COOKIE}=${lang}; Path=/; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function parseLangCookie(header: string | undefined | null): Lang | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === LANG_COOKIE) {
      const v = rest.join('=');
      return isLang(v) ? v : null;
    }
  }
  return null;
}
