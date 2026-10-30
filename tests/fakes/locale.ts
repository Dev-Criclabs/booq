// Locale helper for assertions. Tests never assert literal wording (TEXT-01, TEXT-04):
// they resolve a key from locales/en.json or locales/th.json and compare with that.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type Lang = 'th' | 'en';
export type Vars = Record<string, string | number>;

const cache = new Map<Lang, Record<string, string>>();

export function localesDir(): string {
  // tests/fakes -> repo root -> locales. Override with BOOQ_LOCALES_DIR in CI if the layout changes.
  return process.env['BOOQ_LOCALES_DIR'] ?? resolve(__dirname, '..', '..', 'locales');
}

export function loadLocale(lang: Lang): Record<string, string> {
  let file = cache.get(lang);
  if (!file) {
    file = JSON.parse(readFileSync(resolve(localesDir(), `${lang}.json`), 'utf8')) as Record<string, string>;
    cache.set(lang, file);
  }
  return file;
}

/** Variables used in a template, written {name}. TEXT-03 requires the same names in both languages. */
export function variablesOf(template: string): string[] {
  return [...template.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1] as string);
}

/** Resolve a key for a language and fill the variables. A missing key or variable throws: that is a bug. */
export function t(lang: Lang, key: string, vars: Vars = {}): string {
  const template = loadLocale(lang)[key];
  if (template === undefined) throw new Error(`locale: key ${key} missing in ${lang}.json`);
  return template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) => {
    const v = vars[name];
    if (v === undefined) throw new Error(`locale: variable {${name}} not supplied for ${key} (${lang})`);
    return String(v);
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Turn a template into a regex so a rendered message can be matched back to its key. */
export function templateToRegex(template: string): RegExp {
  const parts = template.split(/\{[A-Za-z_][A-Za-z0-9_]*\}/g).map(escapeRegex);
  return new RegExp(`^${parts.join('.+?')}$`, 's');
}

/** Which key (if any) produced this rendered text in this language? */
/** A template that is only variables, such as "{dateLong}", matches any text in any language. */
export function isBareVariableTemplate(template: string): boolean {
  return variablesOf(template).length > 0 && template.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, '').trim() === '';
}

export function findKeyFor(lang: Lang, rendered: string, opts: { ignoreBareVariables?: boolean } = {}): string | undefined {
  const file = loadLocale(lang);
  for (const [key, template] of Object.entries(file)) {
    if (template === rendered && !(opts.ignoreBareVariables && isBareVariableTemplate(template))) return key;
  }
  for (const [key, template] of Object.entries(file)) {
    if (opts.ignoreBareVariables && isBareVariableTemplate(template)) continue;
    if (variablesOf(template).length > 0 && templateToRegex(template).test(rendered)) return key;
  }
  return undefined;
}

/**
 * Thai LETTERS only: consonants, vowels, tone marks (U+0E01 to U+0E3A, U+0E40 to U+0E4E). The baht sign ฿ (U+0E3F),
 * Thai digits and Thai symbols sit in the same Unicode block but are not language: an English card shows ฿1,300.
 */
export const THAI_CHAR = /[\u0E01-\u0E3A\u0E40-\u0E4E]/;

export function containsThai(text: string): boolean {
  return THAI_CHAR.test(text);
}
