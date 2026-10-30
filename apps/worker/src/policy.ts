import { TaskRefusedError } from './task-wrapper';

/** A crashed task retries once (F01-T34): the first try and one more. */
export const TASK_MAX_ATTEMPTS = 2;

/** A refused payload cannot get better by waiting, so the queue must not retry it. */
export function isPermanentFailure(error: unknown): boolean {
  return error instanceof TaskRefusedError;
}

/** Every producer adds jobs with this spec, so the queue retries a crash once. */
export const DEFAULT_JOB_SPEC = { maxAttempts: TASK_MAX_ATTEMPTS } as const;
