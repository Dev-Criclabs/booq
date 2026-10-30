import { describe, expect, it, vi } from 'vitest';
import { isoOf, monthNames, partsOf } from './dob';
import { changesFrom, dobStepFor, dobStepPath, loadProfile, saveProfile, type Profile } from './profile';

// F02-T21: AUTH-02-AC10 to AC12, AC15, AC18, AC19; AUTH-01-AC9.

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const base: Profile = { fullName: 'Ploy Srisuk', phone: '0812345678', dateOfBirth: null, level: null, language: 'th', priceGroup: 'adult' };

describe('date of birth parts (AUTH-02-AC15)', () => {
  it('builds an ISO date from day, month and an international year', () => {
    expect(isoOf({ day: '14', month: '3', year: '1994' })).toBe('1994-03-14');
    expect(isoOf({ day: '', month: '', year: '' })).toBeNull();
    expect(isoOf({ day: '30', month: '2', year: '2010' })).toBe('invalid');
    expect(isoOf({ day: '1', month: '1', year: '94' })).toBe('invalid');
    expect(partsOf('1994-03-14')).toEqual({ day: '14', month: '3', year: '1994' });
  });
  it('month names are Gregorian in both languages', () => {
    expect(monthNames('en')[2]).toBe('March');
    expect(monthNames('th')[2]).toBe('มีนาคม');
  });
});

describe('the Student item step (AUTH-02-AC10 to AC12)', () => {
  it('AC10: an Adult item (no refusal) never asks; AC11: a Student item with no date asks; AC12: 18 or older is refused', () => {
    expect(dobStepFor('ok')).toBe('none');
    expect(dobStepFor('dob_required')).toBe('ask');
    expect(dobStepFor('student_too_old')).toBe('too_old');
    expect(dobStepPath('hunter', '/c/hunter/checkout?package=p1')).toBe('/c/hunter/date-of-birth?next=%2Fc%2Fhunter%2Fcheckout%3Fpackage%3Dp1');
  });
});

describe('profile load and save', () => {
  it('AUTH-01-AC9: a guest is sent to sign in and back to this page', async () => {
    const f = vi.fn(async () => json(401, { code: 'sign_in_required' })) as unknown as typeof fetch;
    expect(await loadProfile('hunter', '/c/hunter/profile/personal-details', f)).toEqual({ kind: 'sign_in', url: '/c/hunter/sign-in?next=%2Fc%2Fhunter%2Fprofile%2Fpersonal-details' });
  });

  it('AUTH-02-AC18, AC19: only changed fields are sent, and a date of birth can be changed or removed', async () => {
    expect(changesFrom(base, { fullName: 'Ploy Srisuk', phone: '0812345678', dateOfBirth: '1994-03-14', level: null })).toEqual({ dateOfBirth: '1994-03-14' });
    expect(changesFrom({ ...base, dateOfBirth: '1994-03-14' }, { fullName: 'Ploy Srisuk', phone: '0812345678', dateOfBirth: null, level: 'beginner' })).toEqual({ dateOfBirth: null, level: 'beginner' });
    const f = vi.fn(async () => json(200, { ...base, dateOfBirth: '2010-01-01', priceGroup: 'student' })) as unknown as typeof fetch;
    expect(await saveProfile('hunter', '/x', { dateOfBirth: '2010-01-01' }, f)).toMatchObject({ kind: 'ok', profile: { priceGroup: 'student' } });
    const [, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ dateOfBirth: '2010-01-01' });
  });

  it('field refusals map to keys', async () => {
    const f = vi.fn(async () => json(400, { code: 'invalid', fields: { dateOfBirth: 'dob_future', level: 'level_invalid', phone: 'something_new' } })) as unknown as typeof fetch;
    expect(await saveProfile('hunter', '/x', { dateOfBirth: '2099-01-01' }, f)).toEqual({
      kind: 'fields',
      errors: { dateOfBirth: 'P-new.profile_dob_future', level: 'P-new.profile_level_invalid', phone: 'P-new.profile_phone_invalid' },
    });
  });
});
