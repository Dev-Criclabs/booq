import type { MessageLanguage } from '../sender/types';

// Values for the message variables of locales/README.md. Asia/Bangkok; the international year in both languages, never
// the Buddhist year (CLAUDE.md); 24 hour times. Day and month names come from the platform's locale data, not this code.

const BANGKOK = 'Asia/Bangkok';
const LOCALE: Record<MessageLanguage, string> = { th: 'th-TH-u-ca-gregory-nu-latn', en: 'en-GB' };

const dateYearFormat: Record<MessageLanguage, Intl.DateTimeFormat> = {
  th: new Intl.DateTimeFormat(LOCALE.th, { timeZone: BANGKOK, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
  en: new Intl.DateTimeFormat(LOCALE.en, { timeZone: BANGKOK, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
};
const dateFormat: Record<MessageLanguage, Intl.DateTimeFormat> = {
  th: new Intl.DateTimeFormat(LOCALE.th, { timeZone: BANGKOK, weekday: 'short', day: 'numeric', month: 'short' }),
  en: new Intl.DateTimeFormat(LOCALE.en, { timeZone: BANGKOK, weekday: 'short', day: 'numeric', month: 'short' }),
};
const dayMonthYearFormat: Record<MessageLanguage, Intl.DateTimeFormat> = {
  th: new Intl.DateTimeFormat(LOCALE.th, { timeZone: BANGKOK, day: 'numeric', month: 'short', year: 'numeric' }),
  en: new Intl.DateTimeFormat(LOCALE.en, { timeZone: BANGKOK, day: 'numeric', month: 'short', year: 'numeric' }),
};
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: BANGKOK, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
// The baht sign and separators come from the Thai number format; the same form in both languages (locales/README.md).
const wholeBaht = new Intl.NumberFormat('th-TH-u-nu-latn', { style: 'currency', currency: 'THB', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const bahtSatang = new Intl.NumberFormat('th-TH-u-nu-latn', { style: 'currency', currency: 'THB', minimumFractionDigits: 2, maximumFractionDigits: 2 });

const clean = (s: string) => s.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
const at = (v: Date | string) => (typeof v === 'string' ? new Date(v) : v);

/** `{dateYear}`: Sat 9 Jan 2027. */
export const dateYear = (v: Date | string, lang: MessageLanguage) => clean(dateYearFormat[lang].format(at(v)));
/** `{date}`: Sat 9 Jan. */
export const date = (v: Date | string, lang: MessageLanguage) => clean(dateFormat[lang].format(at(v)));
/** `{dayMonthYear}`: 9 Jan 2027. */
export const dayMonthYear = (v: Date | string, lang: MessageLanguage) => clean(dayMonthYearFormat[lang].format(at(v)));
/** `{time}`, `{startTime}`, `{endTime}`: 18:00. */
export const time = (v: Date | string) => timeFormat.format(at(v));

/** Money from integer satang: whole baht when whole, otherwise two decimals (D69). */
export function money(satang: number): string {
  // i18n-ignore internal assertion, never shown
  if (!Number.isSafeInteger(satang)) throw new Error('an amount is integer satang');
  return clean((satang % 100 === 0 ? wholeBaht : bahtSatang).format(satang / 100));
}
