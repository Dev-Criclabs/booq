import en from '../../../../locales/en.json';
import f01Console from '../../../../locales/pending/f01-console.json';

// The console's text (CLAUDE.md: no text in code). The console is English only (X keys). Every string on a screen comes from
// the language file by key; this module only looks a key up and fills its named variables. Keys still waiting for the Content
// role live in locales/pending/<feature>.json (D81) and are read before the main file so a merged key always wins.
// A missing key shows the key itself, never invented text.

export type Vars = Record<string, string | number>;
export type T = (key: string, vars?: Vars) => string;

const pending = [(f01Console as { en: Record<string, string> }).en];
const catalogue = Object.assign({}, ...pending, en as Record<string, string>) as Record<string, string>;
const VAR = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

export function fill(text: string, vars: Vars = {}): string {
  return text.replace(VAR, (whole, name: string) => (Object.hasOwn(vars, name) ? String(vars[name]) : whole));
}

export const t: T = (key, vars) => fill(Object.hasOwn(catalogue, key) ? catalogue[key]! : key, vars);
export const hasKey = (key: string): boolean => Object.hasOwn(catalogue, key);
