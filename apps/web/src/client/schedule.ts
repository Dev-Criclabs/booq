import { clubPath } from '@booq/line';

// C4 Book a court (F03-T24; BOOK-01-AC6, AC7, AC13, AC14; BOOK-02-AC4; design 4.6, 5.1). Reads the
// public schedule routes and keeps the player's choice of hours. The server sends six states per
// court and hour; Selected is the client's own. A choice is consecutive hours on one court only, so
// a gap or a second court can never be selected. The choice is only a choice: no hold exists until
// the signed in player taps Pay (BOOK-03, CC-4).

export type SlotState = 'open' | 'held' | 'taken' | 'closed' | 'past' | 'mine';
export interface ScheduleHour {
  start: string;
  state: SlotState;
  waitlist: boolean;
}
export interface Court {
  id: string;
  name: string;
  sport: string;
}
export interface ScheduleDay {
  date: string;
  courts: Array<Court & { hours: ScheduleHour[] }>;
  dayFull: boolean;
  waitlist: boolean;
}
export interface CourtsInfo {
  status: string;
  today: string;
  bookingWindowDays: number | null;
  courts: Court[];
}
export interface DayCount {
  date: string;
  courts: Array<{ id: string; openHours: number }>;
  dayFull: boolean;
  waitlist: boolean;
}

export type Fetched<T> = { ok: true; value: T } | { ok: false; status: number; code: string };

async function get<T>(f: typeof fetch, url: string): Promise<Fetched<T>> {
  try {
    const res = await f(url, { credentials: 'same-origin', cache: 'no-store' });
    const body = (await res.json().catch(() => ({}))) as T & { code?: unknown };
    if (res.ok) return { ok: true, value: body };
    return { ok: false, status: res.status, code: typeof body.code === 'string' ? body.code : 'offline' };
  } catch {
    return { ok: false, status: 0, code: 'offline' };
  }
}

const api = (slug: string) => `/api/c/${encodeURIComponent(slug)}`;
export const loadCourts = (slug: string, f: typeof fetch) => get<CourtsInfo>(f, `${api(slug)}/courts`);
export const loadDays = (slug: string, f: typeof fetch) => get<{ days: DayCount[] }>(f, `${api(slug)}/schedule/days`);
export const loadDay = (slug: string, date: string, f: typeof fetch) => get<ScheduleDay>(f, `${api(slug)}/schedule?date=${encodeURIComponent(date)}`);

/** The dates of the strip: today to today plus the window, day N inclusive (D42). None when the window is unset. */
export function windowDates(today: string, windowDays: number | null): string[] {
  if (windowDays === null || windowDays < 0) return [];
  const start = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: windowDays + 1 }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}

/** HH:mm of an hour's start, and of its end (the next hour; midnight reads 24:00). */
export const startTime = (start: string) => start.slice(11, 16);
export function endTime(start: string): string {
  const h = Number(start.slice(11, 13)) + 1;
  return `${String(h).padStart(2, '0')}:00`;
}

export interface Selection {
  courtId: string;
  /** Hour starts in order, consecutive on one court. */
  starts: string[];
}

/**
 * A tap on an hour. An open hour next to the choice on the same court extends it; any other open hour
 * starts a new choice there. A tap on the first or last chosen hour takes it off; on a middle one, the
 * choice becomes that hour alone. Anything but Open (and Selected) cannot be chosen (BOOK-01-AC7).
 */
export function tap(sel: Selection | null, day: ScheduleDay, courtId: string, start: string): Selection | null {
  const court = day.courts.find((c) => c.id === courtId);
  const i = court?.hours.findIndex((h) => h.start === start) ?? -1;
  if (!court || i < 0) return sel;
  const hours = court.hours;
  if (sel && sel.courtId === courtId && sel.starts.includes(start)) {
    const at = sel.starts.indexOf(start);
    if (sel.starts.length === 1) return null;
    if (at === 0) return { courtId, starts: sel.starts.slice(1) };
    if (at === sel.starts.length - 1) return { courtId, starts: sel.starts.slice(0, -1) };
    return { courtId, starts: [start] };
  }
  if (hours[i]!.state !== 'open') return sel;
  if (sel && sel.courtId === courtId) {
    const first = hours.findIndex((h) => h.start === sel.starts[0]);
    const last = hours.findIndex((h) => h.start === sel.starts[sel.starts.length - 1]);
    if (i === first - 1) return { courtId, starts: [start, ...sel.starts] };
    if (i === last + 1) return { courtId, starts: [...sel.starts, start] };
  }
  return { courtId, starts: [start] };
}

/** A choice still stands only while every hour in it is open (a refresh can take one away). */
export function stillOpen(sel: Selection | null, day: ScheduleDay | null): Selection | null {
  if (!sel || !day) return null;
  const court = day.courts.find((c) => c.id === sel.courtId);
  if (!court) return null;
  const open = new Set(court.hours.filter((h) => h.state === 'open').map((h) => h.start));
  return sel.starts.every((s) => open.has(s)) ? sel : null;
}

/** Where Continue goes: checkout (F04) with the choice in the address, kept only as a choice (AUTH-01-AC2). */
export function checkoutPath(slug: string, court: Court, date: string, sel: Selection): string {
  const q = new URLSearchParams({ court: court.name, courtId: court.id, date, from: startTime(sel.starts[0]!), to: endTime(sel.starts[sel.starts.length - 1]!) });
  return `${clubPath(slug, { page: 'home' })}/checkout?${q.toString()}`;
}

/** Day full (S-C04-Day-full): from which hour, and the next date in the window with open hours. */
export function dayFullInfo(day: ScheduleDay, days: DayCount[]): { fromTime: string | null; next: { date: string; hours: number } | null } {
  const notPast = day.courts.flatMap((c) => c.hours).filter((h) => h.state !== 'past').map((h) => h.start).sort();
  const nextDay = days.find((d) => d.date > day.date && !d.dayFull);
  return {
    fromTime: notPast[0] ? startTime(notPast[0]) : null,
    next: nextDay ? { date: nextDay.date, hours: nextDay.courts.reduce((n, c) => n + c.openHours, 0) } : null,
  };
}
