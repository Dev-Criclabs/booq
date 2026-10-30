import en from '../../../../locales/en.json';
import th from '../../../../locales/th.json';
import f02 from '../../../../locales/pending/f02.json';
import f03 from '../../../../locales/pending/f03.json';

// The player app's text (CLAUDE.md, CC-5). Every string on a screen comes from the language files
// by key; this module only looks a key up and fills its named variables. Keys still waiting for
// the Content role live in locales/pending/<feature>.json (D81) and are read after the main files,
// so a merged key always wins. A missing key shows the key itself, never invented text.

export type Lang = 'th' | 'en';
export const LANGS: readonly Lang[] = ['th', 'en'];
export type Vars = Record<string, string | number>;
export type T = (key: string, vars?: Vars) => string;

type Catalogue = Record<string, string>;
interface Pending { en: Catalogue; th: Catalogue }
const pending = [f02, f03] as unknown as Pending[];

function catalogue(lang: Lang): Catalogue {
  const main = (lang === 'th' ? th : en) as Catalogue;
  return Object.assign({}, ...pending.map((p) => p[lang]), main) as Catalogue;
}
const catalogues: Record<Lang, Catalogue> = { th: catalogue('th'), en: catalogue('en') };

const VAR = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

export function fill(text: string, vars: Vars = {}): string {
  return text.replace(VAR, (whole, name: string) => (Object.hasOwn(vars, name) ? String(vars[name]) : whole));
}

export function hasKey(lang: Lang, key: string): boolean {
  return Object.hasOwn(catalogues[lang], key);
}

export function translator(lang: Lang): T {
  const c = catalogues[lang];
  return (key, vars) => fill(Object.hasOwn(c, key) ? c[key]! : key, vars);
}

export function isLang(v: unknown): v is Lang {
  return v === 'th' || v === 'en';
}
