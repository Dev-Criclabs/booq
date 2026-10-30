import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHealthService } from './health';
import { healthRoutes } from './routes';
import { createHarness, type Harness } from '../http/testkit';

// The health route for the external monitor (docs/ops/worker.md): token only, counts only.
let h: Harness;
beforeEach(async () => {
  h = await createHarness((pdb) => healthRoutes({ health: createHealthService({ db: pdb, token: 'monitor-token-123' }) }));
  await h.tdb.query(`insert into platform.worker_heartbeat (task_name, last_started_at, last_succeeded_at, runs, dead_jobs, lag_seconds) values ('hold_release', now(), now(), 5, 0, 3)`);
});
afterEach(async () => h.close());

describe('GET /health', () => {
  it('answers task counts to the monitor’s token, and nothing to anyone else', async () => {
    const ok = await h.call('GET', '/health', { headers: { authorization: 'Bearer monitor-token-123' } });
    expect(ok.status).toBe(200);
    expect(ok.body.deadJobs).toBe(0);
    expect(ok.body.tasks).toEqual([expect.objectContaining({ task: 'hold_release', runs: 5 })]);
    for (const authorization of ['Bearer wrong', 'monitor-token-123', 'Basic monitor-token-123', '']) {
      const r = await h.call('GET', '/health', { headers: authorization ? { authorization } : {} });
      expect([r.status, r.body], authorization).toEqual([401, { code: 'unauthorized' }]);
    }
  });
  it('holds no club, player or payment data', async () => {
    const r = await h.call('GET', '/health', { headers: { authorization: 'Bearer monitor-token-123' } });
    expect(JSON.stringify(r.body)).not.toMatch(/club_id|player|phone|booking|payment/i);
  });
});
