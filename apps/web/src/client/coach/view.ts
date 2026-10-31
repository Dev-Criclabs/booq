import type { Lang } from '../i18n';
import { LEVEL_KEY } from '../profile';
import type { SessionRow } from './api';

// What the coach screens show, decided in plain functions so they are tested without a browser (F12 design 5, 7). Times are Bangkok
// wall times (the server stores instants); a day is a Bangkok day. The year is international in both languages (CC-5).

const BANGKOK = 'Asia/Bangkok';

/** `HH:mm` in Bangkok, the same in both languages. */
export function bangkokTime(iso: string): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: BANGKOK, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return `${get('hour')}:${get('minute')}`;
}

/** `YYYY-MM-DD` of an instant in Bangkok. */
export function bangkokDay(iso: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: BANGKOK, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The Monday of the week of `day` (the week of the K2 board runs Monday to Sunday). */
export function mondayOf(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();   // 0 Sunday
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

/** The first day of the month of `day`, and the month before and after it. */
export const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
export const addMonths = (day: string, n: number): string => {
  const [y, m] = [Number(day.slice(0, 4)), Number(day.slice(5, 7))];
  const d = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  return d.toISOString().slice(0, 10);
};

/** The key of a level for a player or a class (the profile's level labels, reused). Unknown or empty: no label. */
export function levelKey(level: string | null | undefined): string | null {
  return level && Object.hasOwn(LEVEL_KEY, level) ? LEVEL_KEY[level as keyof typeof LEVEL_KEY] : null;
}

export type Phase = 'done' | 'next' | 'later';

/**
 * Done, Next or later for the day's rows, from the clock (F12 design 5.1: computed from `start_at`, never stored): a session whose hour
 * has ended is done; the first one that has not ended is next; the rest are later.
 */
export function phases(rows: readonly Pick<SessionRow, 'end_at'>[], nowMs: number): Phase[] {
  let nextSeen = false;
  return rows.map((r) => {
    if (Date.parse(r.end_at) <= nowMs) return 'done';
    if (!nextSeen) {
      nextSeen = true;
      return 'next';
    }
    return 'later';
  });
}

/** The count of solo and of group sessions in a day's rows. */
export const countKinds = (rows: readonly Pick<SessionRow, 'kind'>[]) => ({
  solo: rows.filter((r) => r.kind === 'solo').length,
  group: rows.filter((r) => r.kind === 'group').length,
});

/** The players across the day's group sessions and the solo students (the K1 tile). */
export const playerTotal = (rows: readonly Pick<SessionRow, 'kind' | 'players'>[]) => rows.reduce((n, r) => n + (r.kind === 'solo' ? 1 : (r.players ?? 0)), 0);

/** The class name in the reader's language. */
export const className = (lang: Lang, r: Pick<SessionRow, 'class_name_th' | 'class_name_en'>) => (lang === 'th' ? r.class_name_th : r.class_name_en) ?? r.class_name_en ?? r.class_name_th ?? '';

/** Initials for the roster avatar: the first letter of the first two words of the name (the board shows "PS"). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = (w: string) => Array.from(w)[0] ?? '';
  return (words.length >= 2 ? first(words[0]!) + first(words[1]!) : Array.from(words[0] ?? '').slice(0, 2).join('')).toUpperCase();
}

/** The long month name, in the reader's language and always with the international calendar: January, มกราคม. */
export function monthName(lang: Lang, day: string): string {
  const f = new Intl.DateTimeFormat(`${lang === 'th' ? 'th-TH' : 'en-GB'}-u-ca-gregory-nu-latn`, { timeZone: 'UTC', month: 'long' });
  return f.format(new Date(`${day}T12:00:00Z`));
}

/** The variables of the week range line of K2: `{startDay} to {endDay} {month}` within a month, or both months when the week crosses one. */
export function weekRange(lang: Lang, monday: string) {
  const sunday = addDays(monday, 6);
  const sameMonth = monday.slice(0, 7) === sunday.slice(0, 7);
  return {
    sameMonth,
    vars: { startDay: Number(monday.slice(8, 10)), endDay: Number(sunday.slice(8, 10)), month: monthName(lang, sunday), startMonth: monthName(lang, monday), endMonth: monthName(lang, sunday) },
  };
}

/** Items grouped by their Bangkok day, in order (each group keeps the order the server gave: by start). */
export function groupByDay<T extends { start_at: string }>(items: readonly T[]): Array<{ day: string; items: T[] }> {
  const out: Array<{ day: string; items: T[] }> = [];
  for (const it of items) {
    const day = bangkokDay(it.start_at);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(it);
    else out.push({ day, items: [it] });
  }
  return out;
}

/** A leave that covers whole days (it starts at Bangkok midnight and ends at a Bangkok midnight). */
export function isFullDay(startIso: string, endIso: string): boolean {
  return bangkokTime(startIso) === '00:00' && bangkokTime(endIso) === '00:00';
}
