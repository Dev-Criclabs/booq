import { describe, expect, it } from 'vitest';
import { TASK_MAX_ATTEMPTS, isPermanentFailure } from './policy';
import { TaskRefusedError } from './task-wrapper';

// F01-T34: a crashed task retries once; a refused payload is never retried.
describe('retry policy (F01-T34)', () => {
  it('a task runs at most twice: the first try and one retry', () => {
    expect(TASK_MAX_ATTEMPTS).toBe(2);
  });
  it('a refused payload is permanent, any other error is retried', () => {
    expect(isPermanentFailure(new TaskRefusedError('x'))).toBe(true);
    expect(isPermanentFailure(new Error('boom'))).toBe(false);
  });
});
