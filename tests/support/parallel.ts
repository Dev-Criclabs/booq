// Helpers for the concurrency tests (docs/qa/concurrency-tests.md). No dependency on app code.

export type Outcome<T> =
  | { status: 'ok'; value: T; startedAt: number; endedAt: number }
  | { status: 'error'; error: unknown; startedAt: number; endedAt: number };

/**
 * Start all tasks, hold each behind a barrier, release them in the same tick.
 * Always resolves with every outcome; a task that throws is an 'error' outcome, not a rejection.
 * The caller decides which errors are the expected business conflict and which are defects (500, timeout).
 */
export async function raceAll<T>(tasks: Array<() => Promise<T>>, opts: { jitterMs?: number } = {}): Promise<Outcome<T>[]> {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const running = tasks.map(async (task): Promise<Outcome<T>> => {
    await gate;
    if (opts.jitterMs) await new Promise((r) => setTimeout(r, Math.random() * opts.jitterMs!));
    const startedAt = performance.now();
    try {
      const value = await task();
      return { status: 'ok', value, startedAt, endedAt: performance.now() };
    } catch (error) {
      return { status: 'error', error, startedAt, endedAt: performance.now() };
    }
  });
  // Let every task reach the gate, then open it.
  await Promise.resolve();
  release();
  return Promise.all(running);
}

/** Run a scenario many times with a fresh fixture each time. Races fail rarely, so one run proves little. */
export async function repeat(times: number, scenario: (iteration: number) => Promise<void>): Promise<void> {
  for (let i = 0; i < times; i++) {
    try {
      await scenario(i);
    } catch (e) {
      throw new Error(`failed on iteration ${i + 1} of ${times}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/** Counts for the "exactly one succeeds" assertion. `isSuccess` and `isConflict` come from the app's own result shape. */
export function tally<T>(
  outcomes: Outcome<T>[],
  isSuccess: (v: T) => boolean,
  isConflict: (v: T | unknown, fromError: boolean) => boolean,
): { success: number; conflict: number; defect: number } {
  let success = 0;
  let conflict = 0;
  let defect = 0;
  for (const o of outcomes) {
    if (o.status === 'ok') {
      if (isSuccess(o.value)) success++;
      else if (isConflict(o.value, false)) conflict++;
      else defect++;
    } else if (isConflict(o.error, true)) conflict++;
    else defect++;
  }
  return { success, conflict, defect };
}
