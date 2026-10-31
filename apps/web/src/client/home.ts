import type { Lang } from './i18n';

// Home's header (S-C03-Guest; P-0017, P-0448): today's date and a greeting for the time of day, both on
// the Asia/Bangkok clock (CC-6). Morning is 05:00 to 11:59, afternoon 12:00 to 16:59, evening otherwise.

const BANGKOK = 'Asia/Bangkok';

/** The Bangkok hour, 0 to 23. */
export function bangkokHour(now: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: BANGKOK, hour: '2-digit', hourCycle: 'h23' }).format(now));
}

export function greetingKey(now: Date): string {
  const h = bangkokHour(now);
  if (h >= 5 && h < 12) return 'P-new.greeting_morning';
  if (h >= 12 && h < 17) return 'P-new.greeting_afternoon';
  return 'P-0448';
}

/** `{dateLong}`: Saturday 9 January, วันเสาร์ที่ 9 มกราคม (Gregorian, Bangkok date). */
export function formatDateLong(lang: Lang, now: Date): string {
  const f = new Intl.DateTimeFormat(`${lang === 'th' ? 'th-TH' : 'en-GB'}-u-ca-gregory-nu-latn`, { timeZone: BANGKOK, weekday: 'long', day: 'numeric', month: 'long' });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return lang === 'th' ? `${p['weekday']}ที่ ${p['day']} ${p['month']}` : `${p['weekday']} ${p['day']} ${p['month']}`;
}
