import { describe, expect, it } from 'vitest';
import { checkoutPath, dayFullInfo, endTime, startTime, stillOpen, tap, windowDates, type ScheduleDay, type SlotState } from './schedule';

// F03-T24: BOOK-01-AC6, AC7, AC14; consecutive hours on one court only.

const h = (hour: number, state: SlotState = 'open', waitlist = false) => ({ start: `2027-01-09T${String(hour).padStart(2, '0')}:00:00+07:00`, state, waitlist });
const day = (c1: ReturnType<typeof h>[], c2: ReturnType<typeof h>[] = c1.map((x) => ({ ...x }))): ScheduleDay => ({
  date: '2027-01-09',
  courts: [
    { id: 'c1', name: '1', sport: 'tennis', hours: c1 },
    { id: 'c2', name: '2', sport: 'tennis', hours: c2 },
  ],
  dayFull: false,
  waitlist: false,
});
const s = (hour: number) => h(hour).start;

describe('choosing hours', () => {
  const d = day([h(16), h(17), h(18), h(19, 'taken'), h(20)]);

  it('a tap chooses an open hour; next to it on the same court extends the choice, both ways', () => {
    let sel = tap(null, d, 'c1', s(17));
    expect(sel).toEqual({ courtId: 'c1', starts: [s(17)] });
    sel = tap(sel, d, 'c1', s(18));
    sel = tap(sel, d, 'c1', s(16));
    expect(sel).toEqual({ courtId: 'c1', starts: [s(16), s(17), s(18)] });
  });

  it('non-consecutive hours cannot be chosen: a gap or another court starts a new choice', () => {
    const sel = tap(null, d, 'c1', s(16));
    expect(tap(sel, d, 'c1', s(18))).toEqual({ courtId: 'c1', starts: [s(18)] });
    expect(tap(sel, d, 'c2', s(17))).toEqual({ courtId: 'c2', starts: [s(17)] });
  });

  it('BOOK-01-AC7: held, taken, closed, past and my booking cannot be chosen, and cannot bridge a choice', () => {
    for (const state of ['held', 'taken', 'closed', 'past', 'mine'] as const) {
      const dd = day([h(16), h(17, state), h(18)]);
      expect(tap(null, dd, 'c1', s(17))).toBeNull();
      const sel = tap(null, dd, 'c1', s(16));
      expect(tap(sel, dd, 'c1', s(17))).toEqual(sel);
    }
    const sel = { courtId: 'c1', starts: [s(18)] };
    expect(tap(sel, d, 'c1', s(20))).toEqual({ courtId: 'c1', starts: [s(20)] }); // 19 is taken: no bridge
  });

  it('a tap on an end takes it off; on the middle keeps that hour alone; the last one clears', () => {
    const sel = { courtId: 'c1', starts: [s(16), s(17), s(18)] };
    expect(tap(sel, d, 'c1', s(18))).toEqual({ courtId: 'c1', starts: [s(16), s(17)] });
    expect(tap(sel, d, 'c1', s(16))).toEqual({ courtId: 'c1', starts: [s(17), s(18)] });
    expect(tap(sel, d, 'c1', s(17))).toEqual({ courtId: 'c1', starts: [s(17)] });
    expect(tap({ courtId: 'c1', starts: [s(16)] }, d, 'c1', s(16))).toBeNull();
  });

  it('a refresh that takes an hour away drops the choice', () => {
    const sel = { courtId: 'c1', starts: [s(16), s(17)] };
    expect(stillOpen(sel, d)).toBe(sel);
    expect(stillOpen(sel, day([h(16), h(17, 'held')]))).toBeNull();
  });
});

describe('dates and times', () => {
  it('BOOK-01-AC6: the strip runs from today to the window, day N inclusive; an unset window offers none', () => {
    expect(windowDates('2027-01-30', 3)).toEqual(['2027-01-30', '2027-01-31', '2027-02-01', '2027-02-02']);
    expect(windowDates('2027-01-30', null)).toEqual([]);
  });
  it('the last hour of the day ends at 24:00', () => {
    expect(startTime(s(23))).toBe('23:00');
    expect(endTime(s(23))).toBe('24:00');
  });
  it('Continue carries the choice to checkout, inside the club', () => {
    expect(checkoutPath('hunter', { id: 'c2', name: '2', sport: 'tennis' }, '2027-01-09', { courtId: 'c2', starts: [s(18), s(19)] })).toBe(
      '/c/hunter/checkout?court=2&courtId=c2&date=2027-01-09&from=18%3A00&to=20%3A00',
    );
  });
});

describe('Day full (BOOK-01-AC14)', () => {
  it('says from which hour, and offers the next date in the window that has open hours', () => {
    const full: ScheduleDay = { ...day([h(15, 'past'), h(16, 'taken', true), h(17, 'closed')]), dayFull: true, waitlist: true };
    const days = [
      { date: '2027-01-09', courts: [{ id: 'c1', openHours: 0 }], dayFull: true, waitlist: true },
      { date: '2027-01-10', courts: [{ id: 'c1', openHours: 0 }, { id: 'c2', openHours: 0 }], dayFull: true, waitlist: false },
      { date: '2027-01-11', courts: [{ id: 'c1', openHours: 4 }, { id: 'c2', openHours: 5 }], dayFull: false, waitlist: false },
    ];
    expect(dayFullInfo(full, days)).toEqual({ fromTime: '16:00', next: { date: '2027-01-11', hours: 9 } });
    expect(dayFullInfo(full, []).next).toBeNull();
  });
});
