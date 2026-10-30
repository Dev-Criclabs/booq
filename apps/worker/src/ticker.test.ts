import { describe, expect, it } from 'vitest';
import { startTicker } from './ticker';

// The in-process hold_release timer (DevOps worker.md): a cron line cannot run every 20 seconds.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('startTicker', () => {
  it('runs repeatedly and never overlaps itself, even when a tick is slower than the interval', async () => {
    let running = 0;
    let maxRunning = 0;
    let runs = 0;
    const t = startTicker({
      everyMs: 5,
      run: async () => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        runs += 1;
        await sleep(25);
        running -= 1;
      },
    });
    await sleep(150);
    await t.stop();
    expect(runs).toBeGreaterThanOrEqual(3);
    expect(maxRunning).toBe(1);
  });

  it('the wait starts after a tick ends, so ticks are at least the interval apart', async () => {
    const starts: number[] = [];
    const t = startTicker({ everyMs: 30, run: async () => void starts.push(Date.now()) });
    await sleep(160);
    await t.stop();
    expect(starts.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < starts.length; i += 1) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(25);
  });

  it('a failing tick is reported and the loop carries on', async () => {
    const errors: string[] = [];
    let runs = 0;
    const t = startTicker({
      everyMs: 5,
      run: async () => {
        runs += 1;
        if (runs === 1) throw new Error('boom');
      },
      onError: (e) => void errors.push((e as Error).message),
    });
    await sleep(80);
    await t.stop();
    expect(errors).toEqual(['boom']);
    expect(runs).toBeGreaterThan(1);
  });

  it('stop waits for the tick in flight and starts no more', async () => {
    let finished = false;
    let runs = 0;
    const t = startTicker({
      everyMs: 1,
      run: async () => {
        runs += 1;
        await sleep(40);
        finished = true;
      },
    });
    await sleep(10);
    await t.stop();
    expect(finished).toBe(true);
    const after = runs;
    await sleep(40);
    expect(runs).toBe(after);
  });

  it('refuses an interval that is not a positive number', () => {
    expect(() => startTicker({ everyMs: 0, run: async () => undefined })).toThrow();
    expect(() => startTicker({ everyMs: Number.NaN, run: async () => undefined })).toThrow();
  });
});
