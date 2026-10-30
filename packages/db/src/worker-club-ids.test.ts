import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F01-T33 lane D request / migration 0020: app.worker_club_ids() for the worker start script.
// The ids of Live and Paused clubs and nothing else; no club in the context; booq_worker only.
const ID = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
let tdb: TestDatabase;

async function as<T>(role: string, sql: string): Promise<T[]> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local role ${role}`);
    const r = await c.query(sql);
    await c.query('rollback');
    return r.rows as T[];
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  for (const [i, s] of ['draft', 'testing', 'live', 'paused', 'live'].entries()) {
    await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1, $2, 'ก', 'A', $3)`, [ID(i + 1), `c${i}`, s]);
  }
});
afterEach(async () => {
  await tdb.close();
});

describe('app.worker_club_ids', () => {
  it('returns the ids of Live and Paused clubs only, with no club in the context', async () => {
    const live = (await tdb.query(`select id from public.club where status in ('live', 'paused') order by id`)).rows.map((r) => r.id);
    expect(live).toEqual([ID(3), ID(4), ID(5)]);
    const rows = await as<{ id: string }>('booq_worker', 'select app.worker_club_ids() as id order by 1');
    expect(rows.map((r) => r.id).sort()).toEqual(live);
  });

  it('every other role is refused', async () => {
    for (const role of ['booq_app', 'booq_platform', 'booq_audit', 'booq_anonymiser', 'booq_purge']) {
      const ok = (await tdb.query('select has_function_privilege($1, $2, $3) as ok', [role, 'app.worker_club_ids()', 'execute'])).rows[0].ok;
      expect(ok, role).toBe(false);
    }
    await expect(as('booq_app', 'select app.worker_club_ids()')).rejects.toThrow(/permission denied/);
  });
});
