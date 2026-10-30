import { describe, expect, it } from 'vitest';
import { bangkokDate } from '../../time/src/index';
import { ageOn, checkStudentItem, priceGroupAt, priceGroupFor } from './price-group';

// F02-T13 (AUTH-02-AC10 to AC14, AC17; D12). Age is worked out on the Asia/Bangkok date.
// Run under pnpm test:zones: the server zone must not change any answer.
describe('priceGroupFor', () => {
  it('no date of birth gives Adult (D12)', () => {
    expect(priceGroupFor(null, '2026-10-30')).toBe('adult');
  });
  it('17 years 364 days is Student; the 18th birthday switches to Adult', () => {
    expect(priceGroupFor('2008-10-31', '2026-10-30')).toBe('student'); // turns 18 tomorrow
    expect(priceGroupFor('2008-10-30', '2026-10-30')).toBe('adult'); // 18 today
    expect(priceGroupFor('2008-10-29', '2026-10-30')).toBe('adult');
  });
  it('a child and a leap day birthday', () => {
    expect(priceGroupFor('2015-06-01', '2026-10-30')).toBe('student');
    expect(ageOn('2008-02-29', '2026-02-28')).toBe(17);
    expect(ageOn('2008-02-29', '2026-03-01')).toBe(18);
  });
  it('the year boundary', () => {
    expect(ageOn('2009-01-01', '2026-12-31')).toBe(17);
    expect(ageOn('2009-01-01', '2027-01-01')).toBe(18);
  });
});

describe('the Bangkok date decides, not the server zone', () => {
  it('23:30 UTC on 29 Oct is already 30 Oct in Bangkok: the 18th birthday has come', () => {
    const at = new Date('2026-10-29T23:30:00Z');
    expect(bangkokDate(at)).toBe('2026-10-30');
    expect(priceGroupAt('2008-10-30', at)).toBe('adult');
  });
  it('17:00 UTC on 30 Oct is 00:00 on 31 Oct in Bangkok', () => {
    const at = new Date('2026-10-30T17:00:00Z');
    expect(priceGroupAt('2008-10-31', at)).toBe('adult');
    expect(priceGroupAt('2008-10-31', new Date('2026-10-30T16:59:59Z'))).toBe('student');
  });
});

describe('checkStudentItem', () => {
  it('no date of birth returns the ask code, not an error text', () => {
    expect(checkStudentItem(null, '2026-10-30')).toEqual({ ok: false, code: 'dob_required' });
  });
  it('under 18 is allowed', () => {
    expect(checkStudentItem('2010-01-01', '2026-10-30')).toEqual({ ok: true });
    expect(checkStudentItem('2008-10-31', '2026-10-30')).toEqual({ ok: true });
  });
  it('18 or older is refused with a code', () => {
    expect(checkStudentItem('2008-10-30', '2026-10-30')).toEqual({ ok: false, code: 'student_too_old' });
    expect(checkStudentItem('1980-01-01', '2026-10-30')).toEqual({ ok: false, code: 'student_too_old' });
  });
  it('a date of birth in the future is refused (AC16)', () => {
    expect(checkStudentItem('2027-01-01', '2026-10-30')).toEqual({ ok: false, code: 'dob_future' });
  });
});
