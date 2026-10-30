import { describe, expect, it } from 'vitest';
import { ControllableClock } from '../../../time/src/index';
import { HOLD_MINUTES_ALLOWED, holdFor, readHoldMinutes } from './hold';

// F03-T05: the hold setting read (BOOK-03-AC3, AC1, D52, D46). Only 10, 15 or 20 read
// back; an unset setting refuses a payment hold but not a booking that needs no payment.
describe('readHoldMinutes (BOOK-03-AC3, D52)', () => {
  it.each([10, 15, 20])('reads back %i', (m) => {
    expect(readHoldMinutes(m)).toEqual({ ok: true, minutes: m });
    expect(readHoldMinutes(String(m))).toEqual({ ok: true, minutes: m });
  });

  it.each([null, undefined, ''])('treats %s as unset', (raw) => {
    expect(readHoldMinutes(raw)).toEqual({ ok: false, code: 'hold_setting_unset' });
  });

  it.each([0, 5, 12, 30, 60, -10, 15.5, 'abc', '1e1', NaN])('never reads back %s', (raw) => {
    expect(() => readHoldMinutes(raw)).toThrow(RangeError);
  });

  it('lists exactly the allowed values', () => {
    expect([...HOLD_MINUTES_ALLOWED]).toEqual([10, 15, 20]);
  });
});

describe('holdFor (BOOK-03-AC1, AC3, AC9, D46)', () => {
  const clock = new ControllableClock('2026-12-01T03:00:00Z');

  it('a payment due holds until now plus the setting', () => {
    expect(holdFor({ now: clock.now(), setting: 15, paymentDue: true })).toEqual({
      ok: true,
      expiresAt: new Date('2026-12-01T03:15:00Z'),
    });
  });

  it('an unset setting refuses a payment hold', () => {
    expect(holdFor({ now: clock.now(), setting: null, paymentDue: true })).toEqual({
      ok: false,
      code: 'hold_setting_unset',
    });
  });

  it('an unset setting does not stop a booking that needs no payment (PAY-07)', () => {
    expect(holdFor({ now: clock.now(), setting: null, paymentDue: false })).toEqual({ ok: true, expiresAt: null });
  });

  it('a booking that needs no payment has no hold even when the setting is set', () => {
    expect(holdFor({ now: clock.now(), setting: 20, paymentDue: false })).toEqual({ ok: true, expiresAt: null });
  });

  it('a later setting change leaves an existing hold end untouched (D46)', () => {
    const first = holdFor({ now: clock.now(), setting: 10, paymentDue: true });
    clock.advance(60_000);
    const second = holdFor({ now: clock.now(), setting: 20, paymentDue: true });
    expect(first).toEqual({ ok: true, expiresAt: new Date('2026-12-01T03:10:00Z') });
    expect(second).toEqual({ ok: true, expiresAt: new Date('2026-12-01T03:21:00Z') });
  });
});
