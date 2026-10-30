import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { clubTask } from '../task-wrapper';
import { IMPORT_STAGING_SWEEP, sweepImportStaging } from './import-staging';

// F01-T31 staging clean-up job (PLAT-06-AC10): expired jobs lose their staging, in the club's context.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER_A = '11111111-1111-4111-8111-111111111111';
const OWNER_B = '44444444-4444-4444-8444-444444444444';
let tdb: TestDatabase;
let db: Db;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A'), ($2,'b','ข','B')`, [A, B]);
  for (const [club, id] of [[A, OWNER_A], [B, OWNER_B]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [club, id, `L-${id.slice(0, 2)}`]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [club, id]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  for (const [club, owner] of [[A, OWNER_A], [B, OWNER_B]] as const) {
    await tdb.query(`insert into public.import_job (club_id, id, kind, file_name, status, created_by, created_at, expires_at) values ($1, gen_random_uuid(), 'players', 'p.csv', 'validated', $2, now() - interval '2 days', now() - interval '1 day')`, [club, owner]);
    await tdb.query(`insert into public.import_job (club_id, id, kind, file_name, status, created_by, expires_at) values ($1, gen_random_uuid(), 'players', 'live.csv', 'validated', $2, now() + interval '1 day')`, [club, owner]);
  }
  await tdb.query(`insert into public.import_row (club_id, job_id, row_no, raw) select club_id, id, 1, '{}' from public.import_job`);
  db = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('import staging sweep (F01-T31)', () => {
  it('cancels only this club’s expired jobs and clears their staging', async () => {
    await clubTask(db, sweepImportStaging, { actorLabel: IMPORT_STAGING_SWEEP })({ clubId: A }, {});
    const jobs = (await tdb.query('select club_id, file_name, status from public.import_job order by club_id, file_name')).rows;
    expect(jobs.map((j) => [j.club_id === A ? 'A' : 'B', j.file_name, j.status])).toEqual([
      ['A', 'live.csv', 'validated'],
      ['A', 'p.csv', 'cancelled'],
      ['B', 'live.csv', 'validated'],
      ['B', 'p.csv', 'validated'], // club B is swept by its own task
    ]);
    const staged = (await tdb.query('select club_id, count(*)::int n from public.import_row group by club_id order by club_id')).rows;
    expect(staged.map((r) => [r.club_id === A ? 'A' : 'B', r.n])).toEqual([['A', 1], ['B', 2]]);
  });

  it('is repeatable: a second run finds nothing', async () => {
    const run = clubTask(db, sweepImportStaging, { actorLabel: IMPORT_STAGING_SWEEP });
    await run({ clubId: A }, {});
    await run({ clubId: A }, {});
    expect((await tdb.query(`select count(*)::int n from public.import_job where club_id = $1 and status = 'cancelled'`, [A])).rows[0].n).toBe(1);
  });
});
