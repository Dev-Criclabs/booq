import { describe, expect, it } from 'vitest';
import { ControllableClock } from '../../../time/src/index';
import { checkBookingHour, type HourCheckInput } from './time';

// F03-T03: booking time rules. BOOK-01-AC1, AC3, AC4, AC5, AC12; decisions D39, D42.
// The suite runs under TZ=UTC and TZ=Asia/Bangkok (pnpm test:zones). Bangkok is UTC+7,
// so 18:00 Bangkok is 11:00Z. The window and the opening hours are inputs because they
// are club settings, never typed in the rules (CLAUDE.md).
const HOURS = { open: '06:00', close: '24:00' };
const WINDOW_DAYS = 30;

// The Bangkok wall time on a Bangkok date, as an instant.
const at = (date: string, time: string): Date => new Date(`${date}T${time}+07:00`);

function check(
  clock: ControllableClock,
  start: Date,
  actor: 'player' | 'staff',
  over: Partial<HourCheckInput> = {},
) {
  return checkBookingHour({
    start,
    now: clock.now(),
    actor,
    windowDays: WINDOW_DAYS,
    opening: HOURS,
    ...over,
  });
}

describe('on the hour (BOOK-01-AC1)', () => {
  const clock = new ControllableClock(at('2026-12-01', '10:00:00'));

  it('accepts an hour on the hour', () => {
    expect(check(clock, at('2026-12-02', '18:00:00'), 'player')).toEqual({ ok: true });
  });

  it.each(['18:30:00', '18:01:00', '18:00:01'])('refuses %s', (time) => {
    expect(check(clock, at('2026-12-02', time), 'player')).toEqual({ ok: false, code: 'not_on_the_hour' });
  });

  it('refuses a start with milliseconds', () => {
    const start = new Date(at('2026-12-02', '18:00:00').getTime() + 1);
    expect(check(clock, start, 'staff')).toEqual({ ok: false, code: 'not_on_the_hour' });
  });
});

describe('opening hours and the last start (BOOK-01-AC3, D39)', () => {
  const clock = new ControllableClock(at('2026-12-01', '10:00:00'));

  it('06:00 is the first start and 23:00 the last', () => {
    expect(check(clock, at('2026-12-02', '06:00:00'), 'player').ok).toBe(true);
    expect(check(clock, at('2026-12-02', '23:00:00'), 'player').ok).toBe(true);
  });

  it('05:00 is before opening', () => {
    expect(check(clock, at('2026-12-02', '05:00:00'), 'player')).toEqual({ ok: false, code: 'outside_hours' });
  });

  it('24:00 is never a start: midnight is the next day and outside hours that open at 06:00', () => {
    expect(check(clock, at('2026-12-03', '00:00:00'), 'player')).toEqual({ ok: false, code: 'outside_hours' });
  });

  it('an hour may not end after closing, so a 22:00 close makes 21:00 the last start', () => {
    const closing = { open: '06:00', close: '22:00' };
    expect(check(clock, at('2026-12-02', '21:00:00'), 'player', { opening: closing }).ok).toBe(true);
    expect(check(clock, at('2026-12-02', '22:00:00'), 'player', { opening: closing })).toEqual({
      ok: false,
      code: 'outside_hours',
    });
  });

  it('a club open from 00:00 may start at 00:00 and at 23:00, never at 24:00', () => {
    const allDay = { open: '00:00', close: '24:00' };
    expect(check(clock, at('2026-12-03', '00:00:00'), 'player', { opening: allDay }).ok).toBe(true);
    expect(check(clock, at('2026-12-02', '23:00:00'), 'player', { opening: allDay }).ok).toBe(true);
    expect(() => check(clock, at('2026-12-02', '23:00:00'), 'player', { opening: { open: '00:00', close: '25:00' } })).toThrow();
  });
});

describe('booking window by Bangkok date, day 30 inclusive (BOOK-01-AC4, AC12, D42)', () => {
  // Today is 2026-12-01. Day 30 is 2026-12-31, day 31 is 2027-01-01.
  it('accepts day 30 and refuses day 31 at 23:59 Bangkok', () => {
    const clock = new ControllableClock(at('2026-12-01', '23:59:00'));
    expect(check(clock, at('2026-12-31', '18:00:00'), 'player')).toEqual({ ok: true });
    expect(check(clock, at('2027-01-01', '18:00:00'), 'player')).toEqual({ ok: false, code: 'outside_window' });
  });

  it('after midnight the window moves a day: at 00:01 day 31 is now inside', () => {
    const clock = new ControllableClock(at('2026-12-01', '23:59:00'));
    expect(check(clock, at('2027-01-01', '18:00:00'), 'player').ok).toBe(false);
    clock.set(at('2026-12-02', '00:01:00'));
    expect(check(clock, at('2027-01-01', '18:00:00'), 'player')).toEqual({ ok: true });
    expect(check(clock, at('2027-01-02', '18:00:00'), 'player')).toEqual({ ok: false, code: 'outside_window' });
  });

  it('at 00:01 Bangkok the Bangkok date is already new although UTC is still the old day', () => {
    // 00:01 on 2 Dec in Bangkok is 17:01Z on 1 Dec.
    const clock = new ControllableClock('2026-12-01T17:01:00Z');
    expect(check(clock, at('2027-01-01', '06:00:00'), 'player').ok).toBe(true);
  });

  it('the window length is the setting, not a constant', () => {
    const clock = new ControllableClock(at('2026-12-01', '10:00:00'));
    expect(check(clock, at('2026-12-08', '18:00:00'), 'player', { windowDays: 7 }).ok).toBe(true);
    expect(check(clock, at('2026-12-09', '18:00:00'), 'player', { windowDays: 7 })).toEqual({
      ok: false,
      code: 'outside_window',
    });
  });

  it('refuses a window that is not a whole number of days', () => {
    const clock = new ControllableClock(at('2026-12-01', '10:00:00'));
    expect(() => check(clock, at('2026-12-02', '18:00:00'), 'player', { windowDays: -1 })).toThrow();
    expect(() => check(clock, at('2026-12-02', '18:00:00'), 'player', { windowDays: 1.5 })).toThrow();
  });
});

describe('a started hour: player versus staff (BOOK-01-AC5, D39)', () => {
  it('at 18:10 a player cannot book 18:00 and staff can', () => {
    const clock = new ControllableClock(at('2026-12-01', '18:10:00'));
    const start = at('2026-12-01', '18:00:00');
    expect(check(clock, start, 'player')).toEqual({ ok: false, code: 'hour_started' });
    expect(check(clock, start, 'staff')).toEqual({ ok: true });
  });

  it('a player may book the next full hour', () => {
    const clock = new ControllableClock(at('2026-12-01', '18:10:00'));
    expect(check(clock, at('2026-12-01', '19:00:00'), 'player')).toEqual({ ok: true });
  });

  it('at exactly 18:00:00 the hour has started for a player', () => {
    const clock = new ControllableClock(at('2026-12-01', '18:00:00'));
    expect(check(clock, at('2026-12-01', '18:00:00'), 'player')).toEqual({ ok: false, code: 'hour_started' });
    expect(check(clock, at('2026-12-01', '18:00:00'), 'staff')).toEqual({ ok: true });
  });

  it('at 19:00 nobody can book 18:00', () => {
    const clock = new ControllableClock(at('2026-12-01', '19:00:00'));
    const start = at('2026-12-01', '18:00:00');
    expect(check(clock, start, 'player')).toEqual({ ok: false, code: 'in_the_past' });
    expect(check(clock, start, 'staff')).toEqual({ ok: false, code: 'in_the_past' });
  });

  it('an earlier hour is past for everyone, and yesterday is past after midnight', () => {
    const clock = new ControllableClock(at('2026-12-02', '00:01:00'));
    expect(check(clock, at('2026-12-01', '23:00:00'), 'player')).toEqual({ ok: false, code: 'in_the_past' });
    expect(check(clock, at('2026-12-01', '23:00:00'), 'staff')).toEqual({ ok: false, code: 'in_the_past' });
  });
});

describe('check order (design 4.2)', () => {
  it('reports not on the hour before any later rule', () => {
    const clock = new ControllableClock(at('2026-12-01', '10:00:00'));
    expect(check(clock, at('2020-01-01', '18:30:00'), 'player')).toEqual({ ok: false, code: 'not_on_the_hour' });
  });

  it('reports outside hours before the window', () => {
    const clock = new ControllableClock(at('2026-12-01', '10:00:00'));
    expect(check(clock, at('2027-06-01', '05:00:00'), 'player')).toEqual({ ok: false, code: 'outside_hours' });
  });

  it('reports the window before the past', () => {
    const clock = new ControllableClock(at('2026-12-01', '10:00:00'));
    expect(check(clock, at('2027-06-01', '18:00:00'), 'player')).toEqual({ ok: false, code: 'outside_window' });
  });
});
