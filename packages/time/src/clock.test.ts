import { describe, expect, it } from 'vitest';
import { ControllableClock, bangkokDate, bangkokTime, systemClock } from './index';

// F01-T02: a controllable clock and Bangkok wall-time reads. The suite runs under
// TZ=UTC and TZ=Asia/Bangkok (pnpm test:zones) and must give the same answers (FA 7).
describe('Bangkok date and time (PLAT-04-AC11, CC-6)', () => {
  it('23:59:59 Bangkok is still the same Bangkok day, 00:00:01 is the next', () => {
    // 2026-12-29T16:59:59Z is 23:59:59 on 29 Dec in Bangkok (UTC+7, no DST).
    expect(bangkokDate(new Date('2026-12-29T16:59:59Z'))).toBe('2026-12-29');
    expect(bangkokTime(new Date('2026-12-29T16:59:59Z'))).toBe('23:59:59');
    expect(bangkokDate(new Date('2026-12-29T17:00:01Z'))).toBe('2026-12-30');
    expect(bangkokTime(new Date('2026-12-29T17:00:01Z'))).toBe('00:00:01');
  });

  it('00:30 Bangkok is still the previous UTC day', () => {
    const d = new Date('2026-12-29T17:30:00Z');
    expect(bangkokDate(d)).toBe('2026-12-30');
    expect(d.toISOString().slice(0, 10)).toBe('2026-12-29');
  });

  it('always prints the international (Gregorian) year, never a Thai year', () => {
    expect(bangkokDate(new Date('2026-01-01T00:00:00Z'))).toMatch(/^2026-/);
  });
});

describe('ControllableClock', () => {
  it('returns the instant it was given and can be moved', () => {
    const c = new ControllableClock('2026-12-29T16:59:59Z');
    expect(c.now().toISOString()).toBe('2026-12-29T16:59:59.000Z');
    c.advance(2000);
    expect(bangkokDate(c.now())).toBe('2026-12-30');
    c.set('2027-01-09T02:00:00Z');
    expect(c.now().toISOString()).toBe('2027-01-09T02:00:00.000Z');
  });

  it('does not move on its own', () => {
    const c = new ControllableClock('2026-12-29T16:59:59Z');
    const a = c.now().getTime();
    const b = c.now().getTime();
    expect(a).toBe(b);
  });

  it('system clock follows real time', () => {
    const before = Date.now();
    const t = systemClock.now().getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(Date.now());
  });
});
