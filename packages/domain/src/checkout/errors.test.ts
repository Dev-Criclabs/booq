import { describe, expect, it } from 'vitest';
import { CHECKOUT_TEXT_KEYS } from './errors';
import f04 from '../../../../locales/pending/f04.json';
import f03 from '../../../../locales/pending/f03.json';
import en from '../../../../locales/en.json';
import th from '../../../../locales/th.json';

// CC-5: every checkout refusal maps to a locale key that exists in both languages (a pending file or an
// existing key), with the same variable names in both; no text is built in code.
const files = [f04, f03] as Array<{ en: Record<string, string>; th: Record<string, string> }>;
const text = (key: string, lang: 'en' | 'th') =>
  files.map((f) => f[lang][key]).find((v) => v !== undefined) ?? (lang === 'en' ? (en as Record<string, string>) : (th as Record<string, string>))[key];
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('checkout refusal codes map to locale keys (CC-5, design 5.1)', () => {
  it.each(Object.entries(CHECKOUT_TEXT_KEYS))('%s -> %s exists in both languages', (_code, key) => {
    expect(text(key, 'en')).toBeTypeOf('string');
    expect(text(key, 'th')).toBeTypeOf('string');
    expect(vars(text(key, 'th')!)).toEqual(vars(text(key, 'en')!));
  });
  it('the minimum spend text carries {amount}', () => {
    expect(vars(text(CHECKOUT_TEXT_KEYS.code_below_minimum, 'en')!)).toEqual(['amount']);
  });
  it('the f04 file has the same keys in both languages', () => {
    expect(Object.keys(f04.th).sort()).toEqual(Object.keys(f04.en).sort());
  });
});
