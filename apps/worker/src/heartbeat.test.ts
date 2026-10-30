import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { recordTaskRun } from './heartbeat';
import { TaskRefusedError } from './task-wrapper';

// F01-T34 heartbeat (FA 5): counts per task type, no club, no data.
let tdb: TestDatabase;
let db: Db;
beforeEach(async () => {
  tdb = await createTestDatabase();
  db = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});
const row = async (name: string) =>
  (await tdb.query('select * from platform.worker_heartbeat where task_name = $1', [name])).rows[0];

describe('recordTaskRun (F01-T34)', () => {
  it('records a success: started, succeeded, one run, no failure', async () => {
    await recordTaskRun(db, 'release_holds', async () => 'done');
    const r = await row('release_holds');
    expect(r).toMatchObject({ runs: '1', failures: '0' });
    expect(r.last_started_at).not.toBeNull();
    expect(r.last_succeeded_at).not.toBeNull();
    expect(r.last_failed_at).toBeNull();
  });

  it('counts runs and failures per task type, and rethrows so the queue can retry', async () => {
    await recordTaskRun(db, 'a', async () => undefined);
    await expect(recordTaskRun(db, 'a', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await recordTaskRun(db, 'b', async () => undefined);
    expect(await row('a')).toMatchObject({ runs: '2', failures: '1' });
    expect((await row('a')).last_failed_at).not.toBeNull();
    expect(await row('b')).toMatchObject({ runs: '1', failures: '0' });
  });

  it('a refused payload is recorded as a failure and keeps its type', async () => {
    await expect(recordTaskRun(db, 'x', async () => { throw new TaskRefusedError('no club'); })).rejects.toBeInstanceOf(TaskRefusedError);
    expect(await row('x')).toMatchObject({ failures: '1' });
  });

  it('a heartbeat write that fails never hides the task result', async () => {
    const broken: Db = { withClubTx: async () => { throw new Error('db down'); }, end: async () => undefined };
    await expect(recordTaskRun(broken, 't', async () => 42)).resolves.toBe(42);
    await expect(recordTaskRun(broken, 't', async () => { throw new Error('task failed'); })).rejects.toThrow('task failed');
  });

  it('writes no club data: the table has no club column and the task name is the only text', async () => {
    await recordTaskRun(db, 'release_holds', async () => undefined);
    expect(Object.keys(await row('release_holds'))).not.toContain('club_id');
  });
});
