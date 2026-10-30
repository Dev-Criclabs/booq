import { describe, expect, it } from 'vitest';
import { route, serveRoutes } from '@booq/auth';
import type { Db } from '@booq/db';
import { createWebTable } from './context';
import { mounts } from './mounts';

// The registry: a feature mounts its routes with one line; the table is checked as a whole.
const parts = {
  db: {} as Db,
  verifier: { verifyIdToken: async () => ({ ok: false as const, code: 'offline' as const }) },
  now: () => new Date('2026-10-30T00:00:00Z'),
  config: { sessionSeconds: 60, maxBodyBytes: 1000, importLimits: null },
};
const paths = (extra: Parameters<typeof createWebTable>[0]['extraMounts'] = []) =>
  createWebTable({ ...parts, extraMounts: extra }).table.map((r) => `${r.def.method} ${r.def.path}`);

describe('route mounts', () => {
  it('the table holds the sign-in routes and every mounted feature, each declaring access', () => {
    const all = paths();
    for (const p of ['POST /auth/session', 'POST /auth/profile', 'POST /auth/logout', 'GET /public/config', 'POST /imports', 'GET /claims', 'GET /data-requests', 'POST /me/data-requests', 'GET /me/profile', 'PUT /me/profile']) {
      expect(all, p).toContain(p);
    }
    expect(mounts.length).toBeGreaterThanOrEqual(3);
  });
  it('a new feature’s routes join the table through one mount and get the db, the clock and the config', () => {
    let seen: unknown;
    const all = paths([
      (m) => {
        seen = { hasDb: m.db === parts.db, now: m.now().toISOString(), session: m.config.sessionSeconds, clubBySlug: typeof m.clubBySlug };
        return [route({ method: 'GET', path: '/courts', public: true }, async () => 'ok')];
      },
    ]);
    expect(all).toContain('GET /courts');
    expect(seen).toEqual({ hasDb: true, now: '2026-10-30T00:00:00.000Z', session: 60, clubBySlug: 'function' });
  });
  it('a path registered twice, by any two features, stops the app from starting', () => {
    const dup = [(): ReturnType<typeof import('@booq/auth').route>[] => [route({ method: 'POST', path: '/imports', public: true }, async () => 'x')]];
    const built = createWebTable({ ...parts, extraMounts: dup as never });
    expect(() => serveRoutes(built.table, built.deps)).toThrow(/registered twice/);
  });
});
