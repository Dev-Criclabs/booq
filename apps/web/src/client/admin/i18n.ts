import en from '../../../../../locales/en.json';
import th from '../../../../../locales/th.json';
import f02 from '../../../../../locales/pending/f02.json';
import f11 from '../../../../../locales/pending/F11.json';
import { fill, type Lang, type T } from '../i18n';

// The club admin console's text (CLAUDE.md, CC-5, D81): the language files by key, then the keys waiting for the Content role in
// locales/pending/F11.json (and f02.json for the language toggle) (a merged key always wins). Kept apart from the player app's translator so the two lists of pending files
// do not meet. A missing key shows the key itself, never invented text.

type Catalogue = Record<string, string>;
interface Pending { en: Catalogue; th: Catalogue }
// f02 holds the language toggle's labels (P-new.language*), shared with the player app.
const pending = [f02, f11] as unknown as Pending[];
const catalogues: Record<Lang, Catalogue> = {
  th: Object.assign({}, ...pending.map((p) => p.th), th as Catalogue),
  en: Object.assign({}, ...pending.map((p) => p.en), en as Catalogue),
};

export function adminHasKey(lang: Lang, key: string): boolean {
  return Object.hasOwn(catalogues[lang], key);
}

export function adminTranslator(lang: Lang): T {
  const c = catalogues[lang];
  return (key, vars) => fill(Object.hasOwn(c, key) ? c[key]! : key, vars);
}
