export const packageName = '@booq/time';

// All business time is Asia/Bangkok (UTC+7, no daylight saving). Code reads the time
// only through a Clock so tests can move it (decision D30). The server zone never
// matters: these helpers name the zone explicitly (FA 7).
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export class ControllableClock implements Clock {
  private current: Date;

  constructor(start: Date | string) {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(to: Date | string): void {
    this.current = new Date(to);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

const BANGKOK = 'Asia/Bangkok';

// en-CA prints year-month-day with the Gregorian year; never a Thai (Buddhist) year.
const dateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: BANGKOK,
  calendar: 'gregory',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: BANGKOK,
  calendar: 'gregory',
  numberingSystem: 'latn',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** The Bangkok calendar date of an instant, as YYYY-MM-DD. */
export function bangkokDate(at: Date): string {
  return dateFormat.format(at);
}

/** The Bangkok wall time of an instant, as HH:MM:SS (00:00:00 to 23:59:59). */
export function bangkokTime(at: Date): string {
  return timeFormat.format(at);
}
