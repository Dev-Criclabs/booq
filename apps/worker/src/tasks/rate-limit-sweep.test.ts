import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { rateLimitSweep } from './rate-limit-sweep';

// The sweep removes sign-in rate-limit windows older than the keep time, in every club, and nothing else.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const HASH = 'a'.repeat(64);
let tdb: TestDatabase;
let worker: Db;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A'), ($2,'b','ข','B')`, [A, B]);
  worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await worker.end();
  await tdb.close();
});

const rows = async () => (await tdb.query('select club_id, window_start from public.rate_limit_hit order by club_id, window_start')).rows;

describe('rate_limit_sweep', () => {
  it('removes windows older than the keep time in every club and keeps newer ones', async () => {
    for (const club of [A, B]) {
      await tdb.query(`insert into public.rate_limit_hit (club_id, key_hash, window_start, hits) values ($1,$2, app.now() - interval '2 hours', 3), ($1,$2, app.now() - interval '10 minutes', 1)`, [club, HASH]);
    }
    expect(await rateLimitSweep({ db: worker, keepSeconds: 3600 })()).toBe(2);
    const left = await rows();
    expect(left).toHaveLength(2);
    expect(left.map((r) => r.club_id).sort()).toEqual([A, B].sort());
  });
  it('refuses a keep time that is not a whole number above zero', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => rateLimitSweep({ db: worker, keepSeconds: bad })).toThrow(/keepSeconds/);
  });
});
