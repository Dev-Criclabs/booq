// Injectable clock shared by the app (when it exists), the jobs runner and the fakes.
// BOOQ rule: all times are Asia/Bangkok. The clock holds an absolute instant; formatting is the caller's job.

export interface Clock {
  now(): Date;
}

/** Default start of the 7 Dec 2026 test window, 09:00 Asia/Bangkok. */
export const DEFAULT_TEST_START = '2026-12-07T09:00:00+07:00';

export class FakeClock implements Clock {
  private current: number;

  constructor(startIso: string = DEFAULT_TEST_START) {
    this.current = Date.parse(startIso);
    if (Number.isNaN(this.current)) throw new Error(`FakeClock: bad start "${startIso}"`);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(iso: string): void {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) throw new Error(`FakeClock: bad time "${iso}"`);
    this.current = t;
  }

  advanceMs(ms: number): void {
    if (ms < 0) throw new Error('FakeClock: time only moves forward; use set() for a deliberate jump back');
    this.current += ms;
  }

  advanceSeconds(s: number): void {
    this.advanceMs(s * 1000);
  }

  advanceMinutes(m: number): void {
    this.advanceMs(m * 60_000);
  }

  advanceHours(h: number): void {
    this.advanceMs(h * 3_600_000);
  }
}
