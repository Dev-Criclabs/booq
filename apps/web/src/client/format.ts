import type { Lang } from './i18n';

// Formatters for the variables the language files carry (locales/README.md, Variables). Dates are
// Asia/Bangkok calendar dates passed as YYYY-MM-DD, so they are formatted as plain dates (UTC
// noon, UTC zone) and never shift. The year is always international, never a Thai year (CC-5).

const LOCALE: Record<Lang, string> = { en: 'en-GB', th: 'th-TH' };
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function asDate(day: string): Date | null {
  const m = DAY.exec(day);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return d.getUTCDate() === Number(m[3]) && d.getUTCMonth() === Number(m[2]) - 1 ? d : null;
}

function parts(lang: Lang, day: string, opts: Intl.DateTimeFormatOptions): Record<string, string> | null {
  const d = asDate(day);
  if (!d) return null;
  const f = new Intl.DateTimeFormat(`${LOCALE[lang]}-u-ca-gregory-nu-latn`, { timeZone: 'UTC', ...opts });
  return Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
}

/** `{date}`: Sat 9 Jan, ส. 9 ม.ค. */
export function formatDate(lang: Lang, day: string): string {
  const p = parts(lang, day, { weekday: 'short', day: 'numeric', month: 'short' });
  return p ? `${p['weekday']} ${p['day']} ${p['month']}` : '';
}

/** `{dateOfBirth}` and other long dates with a year: 14 March 1994, 14 มีนาคม 1994. */
export function formatDayMonthYearLong(lang: Lang, day: string): string {
  const p = parts(lang, day, { day: 'numeric', month: 'long', year: 'numeric' });
  return p ? `${p['day']} ${p['month']} ${p['year']}` : '';
}

/** `{time}`, `{startTime}`, `{endTime}`: 24 hour HH:mm, the same in both languages. */
export function formatTime(hhmm: string): string {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm) || hhmm === '24:00' ? hhmm : '';
}

/** `{monthYear}`: January 2027, มกราคม 2027. */
export function formatMonthYear(lang: Lang, day: string): string {
  const p = parts(lang, day, { month: 'long', year: 'numeric' });
  return p ? `${p['month']} ${p['year']}` : '';
}

/** The short weekday on the C4 date strip, as a language key (P-0040 Fri to P-0045 Wed, P-0138 Thu). */
const WEEKDAY_KEY = ['P-0042', 'P-0043', 'P-0044', 'P-0045', 'P-0138', 'P-0040', 'P-0041'];
export function weekdayKey(day: string): string {
  return WEEKDAY_KEY[new Date(`${day}T12:00:00Z`).getUTCDay()]!;
}

/** The day of the month as a number, for the date strip. */
export const dayOfMonth = (day: string) => String(Number(day.slice(8, 10)));
