import { describe, expect, it } from 'vitest';
import { normalizePhone, validateFullName, validatePhone } from './phone';

// F02-T08 (AUTH-02-AC2, AC28; design 6.9, assumption A-12, D11). One place to change the rules.
describe('Thai mobile numbers normalise to E.164', () => {
  it.each([
    ['0812345678', '+66812345678'],
    ['081-234-5678', '+66812345678'],
    ['081 234 5678', '+66812345678'],
    ['(081) 234-5678', '+66812345678'],
    ['+66812345678', '+66812345678'],
    ['+66 81 234 5678', '+66812345678'],
    ['+66-81-234-5678', '+66812345678'],
  ])('%s', (raw, e164) => {
    expect(validatePhone(raw)).toEqual({ ok: true, value: e164 });
    expect(normalizePhone(raw)).toBe(e164);
  });

  it('the same number typed two ways is the same value (duplicate flag, AC28)', () => {
    expect(normalizePhone('081-234-5678')).toBe(normalizePhone('+66 81 234 5678'));
  });
});

describe('other international numbers', () => {
  it('are accepted in E.164 form up to 15 digits', () => {
    expect(validatePhone('+44 20 7946 0958')).toEqual({ ok: true, value: '+442079460958' });
    expect(validatePhone('+123456789012345').ok).toBe(true);
  });
  it.each(['+1234567890123456', '+0123456789', '+', '+12'])('refuses %s', (raw) => {
    expect(validatePhone(raw)).toEqual({ ok: false, code: 'phone_invalid' });
  });
});

describe('invalid values return codes, never text', () => {
  it.each([
    ['', 'phone_missing'],
    ['   ', 'phone_missing'],
    ['12345', 'phone_invalid'],
    ['081234567', 'phone_invalid'], // one digit short
    ['08123456789', 'phone_invalid'], // one digit long
    ['+6681234567', 'phone_invalid'], // +66 with eight digits is not a Thai mobile
    ['+668123456789', 'phone_invalid'],
    ['0812abc678', 'phone_invalid'],
    ['0066812345678', 'phone_invalid'],
  ])('%j -> %s', (raw, code) => {
    expect(validatePhone(raw)).toEqual({ ok: false, code });
    expect(normalizePhone(raw)).toBeNull();
  });
});

describe('full name (A-12)', () => {
  it.each(['Somchai Jaidee', 'สมชาย ใจดี', "Mary-Jane O'Neil Jr.", 'ปริญญา  แก้วมณี', 'A'])('accepts %s', (n) => {
    expect(validateFullName(n).ok).toBe(true);
  });
  it('trims, and collapses nothing else', () => {
    expect(validateFullName('  Somchai Jaidee  ')).toEqual({ ok: true, value: 'Somchai Jaidee' });
  });
  it.each([
    ['', 'name_missing'],
    ['   ', 'name_missing'],
    ['x'.repeat(101), 'name_too_long'],
    ['Somchai 123', 'name_invalid'],
    ['Somchai <b>', 'name_invalid'],
    ['..--', 'name_invalid'], // no letter at all
    ['😀 Somchai', 'name_invalid'],
  ])('%j -> %s', (n, code) => {
    expect(validateFullName(n)).toEqual({ ok: false, code });
  });
  it('100 characters is the limit', () => {
    expect(validateFullName('x'.repeat(100)).ok).toBe(true);
  });
});
