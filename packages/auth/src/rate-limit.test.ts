import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit';

// F02-T24: a limit on sign-in attempts. The numbers are platform config; none is invented here.
describe('createRateLimiter', () => {
  const at = { t: 1_000_000 };
  const make = (limit = 3, windowSeconds = 60) => createRateLimiter({ limit, windowSeconds, now: () => new Date(at.t) });

  it('allows up to the limit in a window, then says how long to wait', () => {
    at.t = 1_000_000;
    const l = make();
    expect([l.hit('a').allowed, l.hit('a').allowed, l.hit('a').allowed]).toEqual([true, true, true]);
    const fourth = l.hit('a');
    expect(fourth).toEqual({ allowed: false, retryAfterSeconds: 60 });
    at.t += 10_000;
    expect(l.hit('a')).toEqual({ allowed: false, retryAfterSeconds: 50 });
  });
  it('opens again when the window has passed', () => {
    at.t = 2_000_000;
    const l = make(1, 30);
    l.hit('a');
    expect(l.hit('a').allowed).toBe(false);
    at.t += 30_000;
    expect(l.hit('a').allowed).toBe(true);
  });
  it('counts each key on its own', () => {
    at.t = 3_000_000;
    const l = make(1);
    expect(l.hit('club-a|1.2.3.4').allowed).toBe(true);
    expect(l.hit('club-a|1.2.3.4').allowed).toBe(false);
    expect(l.hit('club-b|1.2.3.4').allowed).toBe(true);
    expect(l.hit('club-a|5.6.7.8').allowed).toBe(true);
  });
  it('forgets old keys so memory does not grow without bound', () => {
    at.t = 4_000_000;
    const l = createRateLimiter({ limit: 1, windowSeconds: 1, now: () => new Date(at.t), maxKeys: 50 });
    for (let i = 0; i < 40; i += 1) l.hit(`k${i}`);
    at.t += 5_000;
    for (let i = 0; i < 40; i += 1) l.hit(`n${i}`);
    expect(l.size()).toBeLessThanOrEqual(50);
  });
  it('refuses nonsense settings', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => createRateLimiter({ limit: bad, windowSeconds: 60, now: () => new Date() })).toThrow();
      expect(() => createRateLimiter({ limit: 1, windowSeconds: bad, now: () => new Date() })).toThrow();
    }
  });
});
