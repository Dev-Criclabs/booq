import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { quickAddJob } from 'graphile-worker';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { startWorker, type RunningWorker } from './worker';
import { TASK_MAX_ATTEMPTS } from './policy';

// F01-T34 bootstrap (FA 5): Graphile Worker on a direct connection, tasks in the club context,
// a crashed task retried once, a heartbeat per task type.
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
let tdb: TestDatabase;
let db: Db;
let worker: RunningWorker | undefined;

beforeEach(async () => {
  tdb = await createTestDatabase();
  db = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await worker?.stop();
  worker = undefined;
  await db.end();
  await tdb.close();
});

const waitFor = async (check: () => boolean | Promise<boolean>, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out waiting');
};
const hb = async (name: string) => (await tdb.query('select * from platform.worker_heartbeat where task_name = $1', [name])).rows[0];
const add = (task: string, payload: unknown) => quickAddJob({ connectionString: tdb.url }, task, payload, { maxAttempts: TASK_MAX_ATTEMPTS });

describe('worker bootstrap (F01-T34)', () => {
  it('runs a task in the right club context and records the heartbeat', async () => {
    const seen: string[] = [];
    worker = await startWorker({
      connectionString: tdb.url,
      db,
      tasks: { probe: async (tx) => { seen.push((await tx.query<{ c: string }>('select app.club_id()::text as c')).rows[0]!.c); } },
    });
    await add('probe', { clubId: CLUB });
    await waitFor(async () => (await hb('probe'))?.last_succeeded_at != null);
    expect(seen).toEqual([CLUB]);
    expect(await hb('probe')).toMatchObject({ runs: '1', failures: '0' });
  });

  it('a crashed task runs twice and then stops; both failures are counted', async () => {
    let calls = 0;
    worker = await startWorker({
      connectionString: tdb.url,
      db,
      tasks: { crash: async () => { calls += 1; throw new Error('boom'); } },
    });
    await add('crash', { clubId: CLUB });
    await waitFor(async () => Number((await hb('crash'))?.failures ?? 0) >= 2);
    await new Promise((r) => setTimeout(r, 500));
    expect(calls).toBe(2);
    expect(await hb('crash')).toMatchObject({ runs: '2', failures: '2' });
  });

  it('a task without a club id is refused and not retried', async () => {
    let ran = 0;
    worker = await startWorker({ connectionString: tdb.url, db, tasks: { nope: async () => { ran += 1; } } });
    await add('nope', {});
    await waitFor(async () => Number((await hb('nope'))?.failures ?? 0) >= 1);
    await new Promise((r) => setTimeout(r, 500));
    expect(ran).toBe(0);
    expect(await hb('nope')).toMatchObject({ runs: '1', failures: '1' });
  });

  it('the housekeeping task records queue lag and dead jobs', async () => {
    worker = await startWorker({ connectionString: tdb.url, db, tasks: {} });
    await add('housekeeping', {});
    await waitFor(async () => (await hb('housekeeping'))?.last_succeeded_at != null);
    expect(await hb('housekeeping')).toMatchObject({ dead_jobs: 0 });
    expect((await hb('housekeeping')).lag_seconds).not.toBeNull();
  });
});
