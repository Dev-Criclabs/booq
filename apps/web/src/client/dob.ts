// The date of birth as the player types it: day, month and year separately, so the year is always
// the international year in both languages (CC-5, AUTH-02-AC15) whatever the phone's calendar. Only
// the future is refused here and by the server; no oldest age is set (assumption A-8, F02 Q7).

export interface DobParts {
  day: string;
  month: string;
  year: string;
}

export const emptyParts: DobParts = { day: '', month: '', year: '' };

export function partsOf(iso: string | null): DobParts {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  return m ? { year: m[1]!, month: String(Number(m[2])), day: String(Number(m[3])) } : emptyParts;
}

/** The ISO date; null when every part is empty; 'invalid' when partly filled or not a real date. */
export function isoOf(p: DobParts): string | null | 'invalid' {
  if (!p.day && !p.month && !p.year) return null;
  if (!/^\d{1,2}$/.test(p.day) || !/^\d{1,2}$/.test(p.month) || !/^\d{4}$/.test(p.year)) return 'invalid';
  const iso = `${p.year}-${p.month.padStart(2, '0')}-${p.day.padStart(2, '0')}`;
  const d = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : 'invalid';
}

/** Month names for the language, Gregorian, from the platform (no text in code). */
export function monthNames(lang: 'th' | 'en'): string[] {
  const f = new Intl.DateTimeFormat(`${lang === 'th' ? 'th-TH' : 'en-GB'}-u-ca-gregory`, { month: 'long', timeZone: 'UTC' });
  return Array.from({ length: 12 }, (_, i) => f.format(new Date(Date.UTC(2001, i, 15))));
}
