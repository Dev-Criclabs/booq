// A timer for work that must run more often than a cron line can (cron has a one minute floor).
// The next wait starts only after the current tick ends, so a slow tick never overlaps itself
// in one process. Several worker processes are safe because each tick's work is guarded in the
// database (hold_release: a status check under a row lock).

export interface TickerOptions {
  everyMs: number;
  run(): Promise<unknown>;
  /** Called with whatever a tick threw. The loop carries on. */
  onError?(error: unknown): void;
}
export interface Ticker {
  /** Stops scheduling and waits for the tick in flight. */
  stop(): Promise<void>;
}

export function startTicker(options: TickerOptions): Ticker {
  if (!Number.isFinite(options.everyMs) || options.everyMs <= 0) throw new Error('startTicker: everyMs must be a positive number');
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      inFlight = (async () => {
        try {
          await options.run();
        } catch (error) {
          options.onError?.(error);
        } finally {
          schedule();
        }
      })();
    }, options.everyMs);
  };
  schedule();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight;
    },
  };
}
