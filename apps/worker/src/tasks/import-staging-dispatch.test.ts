import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { startWorker, type RunningWorker } from '../worker';
import { DEFAULT_JOB_SPEC } from '../policy';
import { IMPORT_STAGING_DISPATCH, IMPORT_STAGING_SWEEP, importStagingDispatch, sweepImportStaging } from './import-staging';
import { quickAddJob } from 'graphile-worker';
import { closeTestDatabase } from '../testing/teardown';

// F01-T34 / T31: one sweep job per club, from one cron line (the club list is injected).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const U_A = '11111111-1111-4111-8111-111111111111';
const U_B = '44444444-4444-4444-8444-444444444444';
let tdb: TestDatabase;
let db: Db;
let worker: RunningWorker | undefined;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A'), ($2,'b','ข','B')`, [A, B]);
  for (const [club, id] of [[A, U_A], [B, U_B]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [club, id, `L-${id.slice(0, 2)}`]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [club, id]);
      await c.query('commit');
    } finally {
      c.release();
    }
    await tdb.query(`insert into public.import_job (club_id, kind, file_name, status, created_by, created_at, expires_at) values ($1,'players','p.csv','validated',$2, now() - interval '2 days', now() - interval '1 day')`, [club, id]);
  }
  db = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await worker?.stop();
  worker = undefined;
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    const { rows } = await tdb.query("select count(*)::int as n from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and (query ilike '%graphile_worker%' or query ilike 'listen%')");
    if (rows[0].n === 0) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  await db.end();
  await closeTestDatabase(tdb);
});

describe('import staging dispatch', () => {
  it('adds one sweep per club and each club is swept in its own context', async () => {
    worker = await startWorker({
      connectionString: tdb.url,
      db,
      tasks: { [IMPORT_STAGING_SWEEP]: sweepImportStaging },
      globalTasks: { [IMPORT_STAGING_DISPATCH]: importStagingDispatch({ listClubIds: async () => [A, B] }) },
    });
    await quickAddJob({ connectionString: tdb.url }, IMPORT_STAGING_DISPATCH, {}, DEFAULT_JOB_SPEC);
    const end = Date.now() + 15000;
    let done = 0;
    while (Date.now() < end && done < 2) {
      done = (await tdb.query(`select count(*)::int n from public.import_job where status = 'cancelled'`)).rows[0].n;
      if (done < 2) await new Promise((r) => setTimeout(r, 100));
    }
    expect(done).toBe(2);
  });

  it('skips anything that is not a club id and adds each sweep with the default retry spec and a key per club', async () => {
    const added: { task: string; payload: unknown; spec: unknown }[] = [];
    const task = importStagingDispatch({ listClubIds: async () => [A, 'not-a-uuid', B, A] });
    await task({}, { addJob: async (task: string, payload: unknown, spec: unknown) => void added.push({ task, payload, spec }) } as never);
    expect(added).toEqual([
      { task: IMPORT_STAGING_SWEEP, payload: { clubId: A }, spec: { ...DEFAULT_JOB_SPEC, jobKey: `${IMPORT_STAGING_SWEEP}:${A}` } },
      { task: IMPORT_STAGING_SWEEP, payload: { clubId: B }, spec: { ...DEFAULT_JOB_SPEC, jobKey: `${IMPORT_STAGING_SWEEP}:${B}` } },
    ]);
  });
});
