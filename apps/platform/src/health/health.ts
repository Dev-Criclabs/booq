import { timingSafeEqual } from 'node:crypto';
import type { PlatformDb } from '@booq/db';

// Counts-only worker health for an external uptime monitor (docs/ops/worker.md "Monitoring"; FA 5).
// The monitor has no staff session; it presents a shared token that is configured per deployment. Thresholds
// (what is "late") belong to the monitor and to Ops, not to this route: it reports numbers and nothing else.

export interface TaskHealth {
  task: string;
  secondsSinceSuccess: number | null;
  secondsSinceStart: number | null;
  runs: number;
  failures: number;
  deadJobs: number;
  lagSeconds: number | null;
}
export type HealthResult = { ok: true; tasks: TaskHealth[]; deadJobs: number } | { ok: false; code: 'unauthorized' };

function sameToken(given: string | undefined, expected: string): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createHealthService(deps: { db: PlatformDb; token: string }) {
  async function check(token: string | undefined): Promise<HealthResult> {
    if (!sameToken(token, deps.token)) return { ok: false, code: 'unauthorized' };
    const tasks = await deps.db.withPlatformTx({ staffId: null }, async (tx) =>
      (await tx.query<{ r: TaskHealth[] }>('select platform.worker_health() as r')).rows[0]?.r ?? []);
    return { ok: true, tasks, deadJobs: tasks.reduce((n, t) => n + t.deadJobs, 0) };
  }
  return { check };
}
