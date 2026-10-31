import { formatDate, formatDayMonthYearLong, formatTime } from '../format';
import type { Lang } from '../i18n';

// Moments the server sends as UTC timestamps, shown as Asia/Bangkok calendar days and hours (CLAUDE.md: all times are Asia/Bangkok;
// the year is international in both languages).

const FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** `{ day: '2027-01-13', time: '00:30' }` for a timestamp, or null when it is not one. */
export function bangkokParts(iso: string): { day: string; time: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(FORMAT.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p['year']}-${p['month']}-${p['day']}`, time: `${p['hour']}:${p['minute']}` };
}
export function dateOf(lang: Lang, iso: string): string {
  const p = bangkokParts(iso);
  return p ? formatDate(lang, p.day) : '';
}
export function timeOf(iso: string): string {
  const p = bangkokParts(iso);
  return p ? formatTime(p.time) : '';
}
/** `{dayMonthYear}` and `{dateOfBirth}`: 9 January 2027. A date given as a day (YYYY-MM-DD) is shown as it is. */
export function longDayOf(lang: Lang, dayOrIso: string): string {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dayOrIso) ? dayOrIso : bangkokParts(dayOrIso)?.day ?? '';
  return day ? formatDayMonthYearLong(lang, day) : '';
}

/** The full weekday of a day (Monday, วันจันทร์), the year not involved: formatting, like the dates, not copy. */
export function weekdayLongOf(lang: Lang, day: string): string {
  return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH-u-ca-gregory' : 'en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
}
