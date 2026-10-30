import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlatformDb, type PlatformDb } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { createHealthService } from './health';

// Counts-only worker health for an external uptime monitor (docs/ops/worker.md "Monitoring"; FA 5; PLAT-04 P1 tile).
// No staff session: the monitor presents its own shared token. The answer is numbers and task names, never club data.
const TOKEN = 'monitor-token-for-tests';

let tdb: TestDatabase;
let pdb: PlatformDb;
let svc: ReturnType<typeof createHealthService>;

beforeEach(async () => {
  tdb = await createTestDatabase();
  pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
  svc = createHealthService({ db: pdb, token: TOKEN });
  await tdb.setNow('2026-10-30T03:00:00Z');
});
afterEach(async () => {
  await pdb.end();
  await tdb.close();
});

const beat = (task: string, v: { started?: string; ok?: string; failed?: string; runs?: number; failures?: number; dead?: number; lag?: number | null }) =>
  tdb.query(
    `insert into platform.worker_heartbeat (task_name, last_started_at, last_succeeded_at, last_failed_at, runs, failures, dead_jobs, lag_seconds) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [task, v.started ?? null, v.ok ?? null, v.failed ?? null, v.runs ?? 0, v.failures ?? 0, v.dead ?? 0, v.lag ?? null],
  );

describe('the health route', () => {
  it('refuses a missing or wrong token without reading anything', async () => {
    for (const t of [undefined, '', 'nope', TOKEN + 'x', TOKEN.slice(1)]) {
      expect(await svc.check(t), String(t)).toEqual({ ok: false, code: 'unauthorized' });
    }
  });

  it('with no token configured, nothing is allowed in', async () => {
    const none = createHealthService({ db: pdb, token: '' });
    expect(await none.check('')).toEqual({ ok: false, code: 'unauthorized' });
  });

  it('answers per task with seconds since the last success, failures, dead jobs and lag', async () => {
    await beat('housekeeping', { started: '2026-10-30T02:55:00Z', ok: '2026-10-30T02:55:01Z', runs: 12, failures: 1, dead: 2, lag: 7 });
    await beat('hold_release', { started: '2026-10-30T02:59:50Z', failed: '2026-10-30T02:59:51Z', runs: 3, failures: 3 });
    expect(await svc.check(TOKEN)).toEqual({
      ok: true,
      tasks: [
        { task: 'hold_release', secondsSinceSuccess: null, secondsSinceStart: 10, runs: 3, failures: 3, deadJobs: 0, lagSeconds: null },
        { task: 'housekeeping', secondsSinceSuccess: 299, secondsSinceStart: 300, runs: 12, failures: 1, deadJobs: 2, lagSeconds: 7 },
      ],
      deadJobs: 2,
    });
  });

  it('an empty table is an empty list, not an error: the monitor sees that no task has reported', async () => {
    expect(await svc.check(TOKEN)).toEqual({ ok: true, tasks: [], deadJobs: 0 });
  });

  it('carries no club, no person and no slip: only these keys', async () => {
    await beat('housekeeping', { ok: '2026-10-30T02:55:01Z' });
    const r = await svc.check(TOKEN);
    if (!r.ok) throw new Error('expected ok');
    expect(Object.keys(r).sort()).toEqual(['deadJobs', 'ok', 'tasks']);
    expect(Object.keys(r.tasks[0]!).sort()).toEqual(['deadJobs', 'failures', 'lagSeconds', 'runs', 'secondsSinceStart', 'secondsSinceSuccess', 'task']);
  });

  it('the platform role reads the numbers only through the function, with no staff context', async () => {
    const r = await tdb.query(`select has_function_privilege('booq_platform', 'platform.worker_health()', 'execute') as ok`);
    expect(r.rows[0].ok).toBe(true);
    expect((await tdb.query(`select has_function_privilege('booq_app', 'platform.worker_health()', 'execute') as ok`)).rows[0].ok).toBe(false);
  });
});
