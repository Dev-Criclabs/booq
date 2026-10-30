import type { Language } from './copy';

// Numbers and dates for the receipt. Dates are the Asia/Bangkok calendar day with the international (Gregorian) year in both
// languages, never the Buddhist year (CLAUDE.md). Month names come from the platform's locale data, not from this code.

const BANGKOK = 'Asia/Bangkok';
const dateFormats: Record<Language, Intl.DateTimeFormat> = {
  th: new Intl.DateTimeFormat('th-TH-u-ca-gregory-nu-latn', { timeZone: BANGKOK, day: 'numeric', month: 'short', year: 'numeric' }),
  en: new Intl.DateTimeFormat('en-GB', { timeZone: BANGKOK, day: 'numeric', month: 'short', year: 'numeric' }),
};

/** `{dayMonthYear}` of the language files: 29 Dec 2026, or 29 ธ.ค. 2026. */
export function dayMonthYear(at: Date | string, language: Language): string {
  return dateFormats[language].format(typeof at === 'string' ? new Date(at) : at).replace(/\s+/g, ' ');
}

const amountFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Integer satang as baht for a table cell: 450000 gives 4,500.00. */
export function baht(satang: number): string {
  // i18n-ignore: an internal assertion, never shown
  if (!Number.isSafeInteger(satang)) throw new Error('an amount is integer satang');
  const sign = satang < 0 ? '-' : '';
  return sign + amountFormat.format(Math.abs(satang) / 100);
}
