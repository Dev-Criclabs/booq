import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { createExportService, createMemoryStorage } from '@booq/domain';
import { clubTask, TaskRefusedError } from '../task-wrapper';
import { CLUB_EXPORT, clubExportTask } from './club-export';
import { closeTestDatabase } from '../testing/teardown';

// F01-T32 worker task: builds the export in the club's context (PLAT-06-AC11). Payload: ids only.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const OWNER = '11111111-1111-4111-8111-111111111111';
const EXPORT = 'eeeeeeee-0000-4000-8000-000000000001';
let tdb: TestDatabase;
let db: Db;
const storage = createMemoryStorage();

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A')`, [A]);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, full_name) values ($1,$2,'L1','Owner One')`, [A, OWNER]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'owner'), ($1,$2,'player')`, [A, OWNER]);
    await c.query('commit');
  } finally {
    c.release();
  }
  await tdb.query(`insert into public.data_export (club_id, id, kind, requested_by_user) values ($1,$2,'customers',$3)`, [A, EXPORT, OWNER]);
  db = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await db.end();
  await closeTestDatabase(tdb);
});
const task = () => clubTask(db, clubExportTask(createExportService({ storage, linkSeconds: 86400 })), { actorLabel: CLUB_EXPORT });

describe('club_export task (F01-T32)', () => {
  it('builds the requested export for the payload club', async () => {
    await task()({ clubId: A, exportId: EXPORT }, {});
    expect((await tdb.query('select status, storage_path from public.data_export')).rows[0]).toEqual({ status: 'done', storage_path: `${A}/${EXPORT}.zip` });
    expect(storage.read(`${A}/${EXPORT}.zip`)).toBeDefined();
  });
  it('refuses a payload without an export id', async () => {
    await expect(task()({ clubId: A }, {})).rejects.toBeInstanceOf(TaskRefusedError);
    await expect(task()({ clubId: A, exportId: 'x' }, {})).rejects.toBeInstanceOf(TaskRefusedError);
  });
});
