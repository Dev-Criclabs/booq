import { describe, expect, it } from 'vitest';
import { adminHasKey } from './i18n';
import {
  addDays, cellAt, createPath, dayCounts, isOpenAt, isoWeekday, lookOf, MOVE_ERROR_KEY, movable, moveErrorKey, openHours, rangeOf, rowHours, shift, staleAfter, startOf, weekStart, whenOf, type Cell, type Courts,
} from './calendar';

// F11-T13 A1 Calendar (ADMIN-03): days and hours are Asia/Bangkok; the grid is the club's open hours; the server decides every move.
const hours: Courts['openingHours'] = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, open: '07:00', close: '22:00' })).concat([{ weekday: 6, open: '08:00', close: '24:00' }]);
const club = { openingHours: hours };
const cell = (over: Partial<Cell> = {}): Cell => ({
  resourceId: 'c1', resourceName: '1', startAt: '2027-01-18T03:00:00Z', endAt: '2027-01-18T04:00:00Z', kind: 'court_booking', state: 'confirmed', holdExpiresAt: null, bookingId: 'b1', bookingStatus: 'confirmed',
  bookingSource: 'online', customerId: 'u1', customerName: 'Pat', coachId: null, coachName: null, classSessionId: null, classNameTh: null, classNameEn: null, closureId: null, ...over,
});

describe('days', () => {
  it('ISO weekdays: 18 January 2027 is a Monday; a week starts on Monday', () => {
    expect(isoWeekday('2027-01-18')).toBe(1);
    expect(isoWeekday('2027-01-24')).toBe(7);
    expect(weekStart('2027-01-21')).toBe('2027-01-18');
    expect(weekStart('2027-01-24')).toBe('2027-01-18');
    expect(addDays('2027-01-31', 1)).toBe('2027-02-01');
  });
  it('a day is one call day, a week seven; moving steps by one of them', () => {
    expect(rangeOf('day', '2027-01-20')).toMatchObject({ from: '2027-01-20', to: '2027-01-20', days: ['2027-01-20'] });
    const w = rangeOf('week', '2027-01-20');
    expect([w.from, w.to, w.days.length]).toEqual(['2027-01-18', '2027-01-24', 7]);
    expect(shift('day', '2027-01-20', -1)).toBe('2027-01-19');
    expect(shift('week', '2027-01-20', 1)).toBe('2027-01-27');
  });
});

describe('open hours', () => {
  it('rows run from the first to the last start hour; a 24:00 close ends at 23:00; a day with no hours is closed', () => {
    expect(openHours(club, '2027-01-18')).toEqual({ first: 7, last: 21 });
    expect(openHours(club, '2027-01-23')).toEqual({ first: 8, last: 23 });
    expect(openHours(club, '2027-01-24')).toBeNull();
    expect(rowHours(club, ['2027-01-24'])).toEqual([]);
    expect(rowHours(club, ['2027-01-18', '2027-01-23'])[0]).toBe(7);
    expect(rowHours(club, ['2027-01-18', '2027-01-23']).at(-1)).toBe(23);
    expect(isOpenAt(club, '2027-01-18', 6)).toBe(false);
    expect(isOpenAt(club, '2027-01-18', 21)).toBe(true);
    expect(isOpenAt(club, '2027-01-18', 22)).toBe(false);
  });
  it('an hour begins at the Bangkok time the move route takes', () => {
    expect(startOf('2027-01-18', 9)).toBe('2027-01-18T09:00:00+07:00');
    expect(new Date(startOf('2027-01-18', 9)).toISOString()).toBe('2027-01-18T02:00:00.000Z');
  });
});

describe('cells', () => {
  it('finds a cell by court, Bangkok day and hour (10:00 Bangkok is 03:00 UTC); late evening UTC is the next Bangkok day', () => {
    expect(whenOf(cell())).toEqual({ day: '2027-01-18', hour: 10 });
    expect(whenOf(cell({ startAt: '2027-01-18T18:00:00Z' }))).toEqual({ day: '2027-01-19', hour: 1 });
    expect(cellAt([cell()], 'c1', '2027-01-18', 10)?.bookingId).toBe('b1');
    expect(cellAt([cell()], 'c2', '2027-01-18', 10)).toBeUndefined();
    expect(cellAt([cell()], 'c1', '2027-01-18', 11)).toBeUndefined();
  });
  it('the colour and words of a cell: online, staff, awaiting payment, solo class, group class, closed', () => {
    expect(lookOf(cell(), 'en')).toMatchObject({ tone: 'online', key: 'A-new.cal_player', vars: { playerName: 'Pat' } });
    expect(lookOf(cell({ bookingSource: 'staff' }), 'en').tone).toBe('staff');
    expect(lookOf(cell({ state: 'held' }), 'en')).toMatchObject({ tone: 'awaiting', key: 'A-new.cal_awaiting' });
    expect(lookOf(cell({ kind: 'solo_class', coachName: 'Coach' }), 'en')).toMatchObject({ tone: 'solo', key: 'A-0029', vars: { coachName: 'Coach', playerName: 'Pat' } });
    expect(lookOf(cell({ kind: 'group_class', classNameEn: 'Clinic', classNameTh: 'คลินิก', coachName: 'C' }), 'th').vars.className).toBe('คลินิก');
    expect(lookOf(cell({ kind: 'closure', customerName: null }), 'en')).toMatchObject({ tone: 'closed', key: 'A-0018' });
  });
  it('only a confirmed court booking is moved here', () => {
    expect(movable(cell())).toBe(true);
    expect(movable(cell({ state: 'held' }))).toBe(false);
    expect(movable(cell({ kind: 'solo_class' }))).toBe(false);
    expect(movable(cell({ bookingId: null }))).toBe(false);
  });
  it('counts the distinct bookings and closed hours of the day', () => {
    const cells = [cell(), cell({ startAt: '2027-01-18T04:00:00Z' }), cell({ bookingId: 'b2', startAt: '2027-01-18T05:00:00Z' }), cell({ kind: 'closure', bookingId: null, closureId: 'x', startAt: '2027-01-18T06:00:00Z' }), cell({ bookingId: 'b3', startAt: '2027-01-19T03:00:00Z' })];
    expect(dayCounts(cells, '2027-01-18')).toEqual({ count: 2, closed: 1 });
  });
  it('a click on a free hour opens the create page with the court and the start', () => {
    expect(createPath('hunter', 'c1', '2027-01-18', 9)).toBe('/c/hunter/admin/bookings/new?court=c1&start=2027-01-18T09%3A00%3A00%2B07%3A00');
  });
});

describe('refusals and text', () => {
  it('each refusal of a move has its own words; the rest hours go in the text; a stale grid is read again', () => {
    expect(moveErrorKey({ kind: 'refused', status: 409, code: 'slot_unavailable' })).toEqual({ key: 'A-new.cal_err_taken', vars: {} });
    expect(moveErrorKey({ kind: 'refused', status: 409, code: 'rest_rule', params: { hours: 6 } })).toEqual({ key: 'A-new.cal_err_rest', vars: { hours: 6 } });
    expect(moveErrorKey({ kind: 'refused', status: 409, code: 'weird' }).key).toBe('A-new.cal_err_general');
    expect(moveErrorKey({ kind: 'offline' }).key).toBe('A-new.cal_err_general');
    expect(staleAfter({ kind: 'refused', status: 409, code: 'slot_unavailable' })).toBe(true);
    expect(staleAfter({ kind: 'refused', status: 409, code: 'rest_rule' })).toBe(false);
  });
  it('every key the page uses exists in both languages', () => {
    const keys = ['A-0002', 'A-0007', 'A-0008', 'A-0009', 'A-0010', 'A-0011', 'A-0012', 'A-0013', 'A-0014', 'A-0015', 'A-0016', 'A-0017', 'A-0018', 'A-0019', 'A-0027', 'A-0029', 'A-0034', 'A-0035', 'A-new.set_retry',
      'P-0040', 'P-0041', 'P-0042', 'P-0043', 'P-0044', 'P-0045', 'P-0138', ...Object.values(MOVE_ERROR_KEY),
      ...['player', 'awaiting', 'class', 'load_failed', 'view_label', 'court_pick', 'key_label', 'closed_day', 'hour', 'details', 'coach', 'player_line', 'open_booking', 'move_title', 'move_day', 'move_do', 'close', 'moved'].map((k) => `A-new.cal_${k}`)];
    for (const lang of ['th', 'en'] as const) for (const k of keys) expect(adminHasKey(lang, k), `${lang} ${k}`).toBe(true);
  });
});
