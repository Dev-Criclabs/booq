import { describe, expect, it } from 'vitest';
import { addDays, addMonths, bangkokDay, bangkokTime, className, countKinds, initials, levelKey, mondayOf, monthStart, phases, playerTotal } from './view';

// F12 coach portal view helpers (CPORT-01, CPORT-02, CPORT-06): Bangkok times and days, the week, Done and Next, the counts.
describe('Bangkok time and day', () => {
  it('shows an instant as the Bangkok wall time and day, across midnight', () => {
    expect(bangkokTime('2026-12-10T00:00:00Z')).toBe('07:00');
    expect(bangkokTime('2026-12-10T16:59:00Z')).toBe('23:59');
    expect(bangkokTime('2026-12-10T17:00:00Z')).toBe('00:00');
    expect(bangkokDay('2026-12-10T16:59:00Z')).toBe('2026-12-10');
    expect(bangkokDay('2026-12-10T17:00:00Z')).toBe('2026-12-11');
  });
});

describe('weeks and months', () => {
  it('the week runs Monday to Sunday: a Sunday belongs to the week before, a Monday to its own', () => {
    expect(mondayOf('2026-01-11')).toBe('2026-01-05');   // a Sunday
    expect(mondayOf('2026-01-12')).toBe('2026-01-12');   // a Monday
    expect(mondayOf('2026-01-15')).toBe('2026-01-12');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
  });
  it('the first of the month and the months before and after, across the year', () => {
    expect(monthStart('2027-01-19')).toBe('2027-01-01');
    expect(addMonths('2027-01-01', -1)).toBe('2026-12-01');
    expect(addMonths('2026-12-01', 1)).toBe('2027-01-01');
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-01');
  });
});

describe('Done, Next and later (from the clock, F12 design 5.1)', () => {
  const at = (h: number) => ({ end_at: new Date(Date.UTC(2026, 11, 10, h)).toISOString() });
  it('a session whose hour has ended is done, the first that has not is next, the rest are later', () => {
    const now = Date.UTC(2026, 11, 10, 10, 30);
    expect(phases([at(1), at(10), at(11), at(12)], now)).toEqual(['done', 'done', 'next', 'later']);
    expect(phases([at(11)], Date.UTC(2026, 11, 10, 11))).toEqual(['done']);             // ended exactly now
    expect(phases([], now)).toEqual([]);
  });
});

describe('counts, names and levels', () => {
  it('counts solo and group, and players (a solo class is one student, a group class its live players)', () => {
    const rows = [{ kind: 'solo' as const, players: 1 }, { kind: 'solo' as const, players: 1 }, { kind: 'group' as const, players: 5 }, { kind: 'group' as const, players: null }];
    expect(countKinds(rows)).toEqual({ solo: 2, group: 2 });
    expect(playerTotal(rows)).toBe(7);
  });
  it('the class name in the reader\'s language, falling back to the other', () => {
    expect(className('th', { class_name_th: 'คลินิก', class_name_en: 'Clinic' })).toBe('คลินิก');
    expect(className('en', { class_name_th: 'คลินิก', class_name_en: 'Clinic' })).toBe('Clinic');
    expect(className('en', { class_name_th: 'คลินิก', class_name_en: null })).toBe('คลินิก');
  });
  it('a level has the profile\'s label key; an unknown or empty level has none', () => {
    expect(levelKey('beginner')).toBe('P-0154');
    expect(levelKey('new')).toBe('P-0409');
    expect(levelKey('expert')).toBeNull();
    expect(levelKey(null)).toBeNull();
  });
  it('initials: two words give two letters, one word its first two, Thai names too', () => {
    expect(initials('Ploy Srisuk')).toBe('PS');
    expect(initials('  ann ')).toBe('AN');
    expect(initials('สมชาย ใจดี')).toBe('สใ');
    expect(initials('')).toBe('');
  });
});
