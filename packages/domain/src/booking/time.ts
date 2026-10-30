import { bangkokDate, bangkokTime } from '../../../time/src/index';

// F03-T03: the time rules of a booking hour (BOOK-01-AC1, AC3, AC4, AC5, AC12; D39, D42).
// Pure: the caller passes the instant ("now" from the clock), the opening hours of that
// weekday and the window setting. Nothing here is a club value, and nothing reads the
// system time (decision D30). Order follows design 4.2 steps 3 to 6.

export type Actor = 'player' | 'staff';

export type HourRefusal =
  | 'not_on_the_hour'
  | 'outside_hours'
  | 'outside_window'
  | 'in_the_past'
  | 'hour_started';

export type HourCheck = { ok: true } | { ok: false; code: HourRefusal };

export interface OpeningHours {
  /** Wall time in Bangkok, HH:MM. */
  open: string;
  /** Wall time in Bangkok, HH:MM; 24:00 means midnight at the end of the day. */
  close: string;
}

export interface HourCheckInput {
  /** The first instant of the hour asked for. */
  start: Date;
  now: Date;
  actor: Actor;
  /** The club's booking window setting, in whole days (Hunter 30). */
  windowDays: number;
  /** Opening hours of the Bangkok weekday that `start` falls on. */
  opening: OpeningHours;
}

const HOUR_MS = 3_600_000;
const MINUTES_PER_DAY = 1440;

/** Minutes after midnight for HH:MM; 24:00 is 1440. Throws on anything else. */
export function minutesOfDay(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new RangeError(`not a HH:MM time: ${hhmm}`);
  const total = Number(m[1]) * 60 + Number(m[2]);
  if (Number(m[2]) > 59 || total > MINUTES_PER_DAY) throw new RangeError(`not a time of day: ${hhmm}`);
  return total;
}

/** Whole days from one Bangkok date (YYYY-MM-DD) to another. */
export function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000);
}

/**
 * Checks one bookable hour against the time rules. A selection of several hours calls this
 * once per hour. An hour that has started is refused for a player and allowed for staff
 * until it ends (D39); the window is by Bangkok calendar date, day N inclusive (D42).
 */
export function checkBookingHour(input: HourCheckInput): HourCheck {
  const { start, now, actor, windowDays, opening } = input;
  if (Number.isNaN(start.getTime()) || Number.isNaN(now.getTime())) throw new RangeError('invalid date');
  if (!Number.isInteger(windowDays) || windowDays < 0) throw new RangeError('windowDays must be a whole number of days');
  const open = minutesOfDay(opening.open);
  const close = minutesOfDay(opening.close);

  // 1. On the hour, in Bangkok (BOOK-01-AC1).
  const [hh, mm, ss] = bangkokTime(start).split(':').map(Number) as [number, number, number];
  if (mm !== 0 || ss !== 0 || start.getTime() % 1000 !== 0) return { ok: false, code: 'not_on_the_hour' };

  // 2. Inside that weekday's opening hours; the hour must also end by closing, so with a
  //    24:00 close 23:00 is the last start and 24:00 is never a start (AC3, D39).
  const startMinute = hh * 60;
  if (startMinute < open || startMinute + 60 > Math.min(close, MINUTES_PER_DAY)) {
    return { ok: false, code: 'outside_hours' };
  }

  // 3. Window, by Bangkok calendar date (AC4, AC12, D42).
  if (daysBetween(bangkokDate(now), bangkokDate(start)) > windowDays) return { ok: false, code: 'outside_window' };

  // 4. Past and started hours (AC5, D39).
  const end = start.getTime() + HOUR_MS;
  if (end <= now.getTime()) return { ok: false, code: 'in_the_past' };
  if (actor === 'player' && start.getTime() <= now.getTime()) return { ok: false, code: 'hour_started' };
  return { ok: true };
}

/** An instant as ISO 8601 in Bangkok, whole seconds (FA 9: timestamps carry +07:00). */
export function toBangkokIso(at: Date): string {
  return `${bangkokDate(at)}T${bangkokTime(at)}+07:00`;
}
