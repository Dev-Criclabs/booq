import { describe, expect, it } from 'vitest';
import en from '../../../../locales/en.json';
import th from '../../../../locales/th.json';
import f02 from '../../../../locales/pending/f02.json';
import { formatDate, formatDayMonthYearLong, formatTime } from './format';
import { fill, hasKey, translator } from './i18n';
import { baseLang, cookieLang, pickLang } from './lang';
import { profileSetupPath, safeNext, signInPath, slotFromNext } from './paths';

describe('text comes from the language files (CC-5)', () => {
  it('fills named variables and leaves unknown ones', () => {
    expect(fill('Court {court} · {date}', { court: 2, date: 'Sat 9 Jan' })).toBe('Court 2 · Sat 9 Jan');
    expect(fill('{a} {b}', { a: 'x' })).toBe('x {b}');
  });
  it('reads the main files, then pending keys, and never invents text', () => {
    expect(translator('en')('P-0004')).toBe(en['P-0004']);
    expect(translator('th')('P-0004')).toBe(th['P-0004']);
    expect(translator('th')('P-new.signin_failed')).toBe(f02.th['P-new.signin_failed']);
    expect(translator('en')('P-9999')).toBe('P-9999');
  });
  it('every pending F02 key is in both languages with the same variables', () => {
    const vars = (s: string) => [...s.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((m) => m[1]).sort();
    expect(Object.keys(f02.en).sort()).toEqual(Object.keys(f02.th).sort());
    for (const k of Object.keys(f02.en)) {
      expect(hasKey('th', k)).toBe(true);
      expect(vars((f02.th as Record<string, string>)[k]!)).toEqual(vars((f02.en as Record<string, string>)[k]!));
    }
  });
});

describe('dates use the international year in both languages (CC-5, AUTH-02-AC15)', () => {
  it('formats {date} in each language', () => {
    expect(formatDate('en', '2027-01-09')).toBe('Sat 9 Jan');
    expect(formatDate('th', '2027-01-09')).toMatch(/^ส\. 9 ม\.ค\.$/);
  });
  it('never prints a Thai year', () => {
    expect(formatDayMonthYearLong('en', '1994-03-14')).toBe('14 March 1994');
    expect(formatDayMonthYearLong('th', '1994-03-14')).toBe('14 มีนาคม 1994');
    expect(formatDayMonthYearLong('th', '2026-12-29')).not.toContain('2569');
  });
  it('refuses a date that does not exist and keeps 24 hour times', () => {
    expect(formatDate('en', '2027-02-30')).toBe('');
    expect(formatTime('18:00')).toBe('18:00');
    expect(formatTime('6pm')).toBe('');
  });
});

describe('language (design 6.7, AUTH-02-AC25, AC27)', () => {
  it('the guest choice wins, then LINE, then the browser, then the club default', () => {
    const base = { cookie: '', lineLanguage: null, browserLanguages: [] as string[], clubDefault: 'th' };
    expect(pickLang({ ...base, cookie: 'a=1; lang=en', lineLanguage: 'th' })).toBe('en');
    expect(pickLang({ ...base, lineLanguage: 'en-US', browserLanguages: ['th-TH'] })).toBe('en');
    expect(pickLang({ ...base, browserLanguages: ['ja', 'en-GB'] })).toBe('en');
    expect(pickLang({ ...base, browserLanguages: ['ja'], clubDefault: 'en' })).toBe('en');
    expect(cookieLang('lang=fr')).toBeNull();
    expect(baseLang('th_TH')).toBe('th');
  });
});

describe('club path in every link (AUTH-01-AC14, design 6.3)', () => {
  it('keeps a return path only inside this club', () => {
    expect(safeNext('hunter', '/c/hunter/bookings?tab=1')).toBe('/c/hunter/bookings?tab=1');
    expect(safeNext('hunter', '/c/hunterx/bookings')).toBe('/c/hunter');
    expect(safeNext('hunter', '/c/hunter/../other')).toBe('/c/hunter');
    expect(safeNext('hunter', '//evil.test/c/hunter')).toBe('/c/hunter');
    expect(safeNext('hunter', null)).toBe('/c/hunter');
  });
  it('builds C1 and C2 links that carry the club and the return path', () => {
    expect(signInPath('hunter', '/c/hunter/x?a=1')).toBe('/c/hunter/sign-in?next=%2Fc%2Fhunter%2Fx%3Fa%3D1');
    expect(profileSetupPath('hunter', '/c/other')).toBe('/c/hunter/profile-setup?next=%2Fc%2Fhunter');
  });
  it('reads the chosen slot from the return path for the C1 line', () => {
    expect(slotFromNext('/c/hunter/checkout?court=2&date=2027-01-09&from=18:00&to=19:00')).toEqual({ court: '2', date: '2027-01-09', startTime: '18:00', endTime: '19:00' });
    expect(slotFromNext('/c/hunter/bookings')).toBeNull();
  });
});
