import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// Migration 0007: import staging, exports, data requests, worker heartbeat
// (PLAT-06-AC1, AC10 to AC17; PDPA-01-AC3; F01-T34).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER = '11111111-1111-4111-8111-111111111111';
const DESK = '22222222-2222-4222-8222-222222222222';
const PLAYER = '33333333-3333-4333-8333-333333333333';
const OWNER_B = '44444444-4444-4444-8444-444444444444';

let tdb: TestDatabase;
let web: Db;
let worker: Db;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A'), ($2,'b','ข','B')`, [A, B]);
  for (const [club, id, line, roles] of [
    [A, OWNER, 'L1', ['owner', 'player']], [A, DESK, 'L2', ['front_desk', 'player']], [A, PLAYER, 'L3', ['player']], [B, OWNER_B, 'L4', ['owner', 'player']],
  ] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [club, id, line]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, id, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  web = createDb({ connectionString: tdb.url, max: 2 });
  worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await web.end();
  await worker.end();
  await tdb.close();
});
const ctx = (user: string, roles: string[], club = A) => ({ clubId: club, userId: user, roles, source: 'admin' as const });
const owner = ctx(OWNER, ['owner', 'player']);
const newJob = (c = owner, kind = 'players') =>
  web.withClubTx(c, async (tx) => (await tx.query(`insert into public.import_job (club_id, kind, file_name, created_by, expires_at) values ($1,$2,'players.csv',$3, now() + interval '1 day') returning id`, [c.clubId, kind, c.userId])).rows[0]!.id as string);

describe('import staging (PLAT-06-AC1, AC10)', () => {
  it('only the owner imports; front desk, accountant, coach and player are refused', async () => {
    for (const [user, roles] of [[DESK, ['front_desk', 'player']], [PLAYER, ['player']]] as const) {
      await expect(newJob(ctx(user, [...roles])), roles.join()).rejects.toThrow(/row-level security|permission denied/);
    }
    expect(await newJob()).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('a job is created by the signed-in owner, not in someone else’s name', async () => {
    await expect(
      web.withClubTx(owner, (tx) => tx.query(`insert into public.import_job (club_id, kind, file_name, created_by, expires_at) values ($1,'players','x.csv',$2, now() + interval '1 day')`, [A, DESK])),
    ).rejects.toThrow(/row-level security/);
  });
  it('kind and status are constrained; a confirmed job rejected nothing (all or nothing)', async () => {
    const id = await newJob();
    await expect(tdb.query(`update public.import_job set kind = 'receipts' where id = $1`, [id])).rejects.toThrow(/check/i);
    await expect(tdb.query(`update public.import_job set status = 'done' where id = $1`, [id])).rejects.toThrow(/check/i);
    await expect(tdb.query(`update public.import_job set status = 'confirmed', rows_rejected = 2 where id = $1`, [id])).rejects.toThrow(/confirmed_clean/);
  });
  it('the staging goes when the job is confirmed or cancelled, and stays while it is only validated', async () => {
    for (const final of ['confirmed', 'cancelled']) {
      const id = await newJob();
      await web.withClubTx(owner, async (tx) => {
        await tx.query(`insert into public.import_row (club_id, job_id, row_no, raw) values ($1,$2,1,'{"phone":"0812345678"}'), ($1,$2,2,'{}')`, [A, id]);
        await tx.query(`update public.import_job set status = 'validated' where id = $1`, [id]);
      });
      expect((await tdb.query('select count(*)::int as n from public.import_row where job_id = $1', [id])).rows[0].n).toBe(2);
      await web.withClubTx(owner, (tx) => tx.query(`update public.import_job set status = $2 where id = $1`, [id, final]));
      expect((await tdb.query('select count(*)::int as n from public.import_row where job_id = $1', [id])).rows[0].n, final).toBe(0);
    }
  });
  it('expired jobs are cancelled and lose their staging; unexpired jobs keep it (per club, from the context)', async () => {
    const old = await newJob();
    await web.withClubTx(owner, (tx) => tx.query(`insert into public.import_row (club_id, job_id, row_no, raw) values ($1,$2,1,'{}')`, [A, old]));
    await tdb.query(`update public.import_job set expires_at = now() - interval '1 minute', created_at = now() - interval '2 days' where id = $1`, [old]);
    const fresh = await newJob();
    await web.withClubTx(owner, (tx) => tx.query(`insert into public.import_row (club_id, job_id, row_no, raw) values ($1,$2,1,'{}')`, [A, fresh]));
    const n = await worker.withClubTx({ clubId: A, userId: null, roles: [], source: 'job' }, (tx) => tx.query('select app.sweep_import_staging() as n'));
    expect(n.rows[0]!.n).toBe(1);
    expect((await tdb.query('select job_id from public.import_row')).rows).toEqual([{ job_id: fresh }]);
    expect((await tdb.query('select status from public.import_job where id = $1', [old])).rows[0].status).toBe('cancelled');
  });
  it('the sweep is the worker’s only: not the app role, not BOOQ staff; and it needs a club', async () => {
    for (const role of ['booq_app', 'booq_platform']) {
      expect((await tdb.query(`select has_function_privilege($1, 'app.sweep_import_staging()', 'execute') as ok`, [role])).rows[0].ok, role).toBe(false);
    }
    const c = await tdb.pool.connect();
    try {
      await c.query('set role booq_worker');
      await expect(c.query('select app.sweep_import_staging()')).rejects.toThrow(/club in the context/);
    } finally {
      c.release();
    }
  });
  it('another club sees none of it', async () => {
    const id = await newJob();
    await web.withClubTx(owner, (tx) => tx.query(`insert into public.import_row (club_id, job_id, row_no, raw) values ($1,$2,1,'{}')`, [A, id]));
    const other = ctx(OWNER_B, ['owner', 'player'], B);
    expect((await web.withClubTx(other, (tx) => tx.query('select 1 from public.import_job'))).rowCount).toBe(0);
    expect((await web.withClubTx(other, (tx) => tx.query('select 1 from public.import_row'))).rowCount).toBe(0);
  });
  it('staging raw values never reach the audit log; the job event does', async () => {
    const id = await newJob();
    await web.withClubTx(owner, (tx) => tx.query(`insert into public.import_row (club_id, job_id, row_no, raw) values ($1,$2,1,'{"phone":"MARKER-0812345678"}')`, [A, id]));
    const log = JSON.stringify((await tdb.query('select * from public.audit_entry')).rows);
    expect(log).not.toContain('MARKER-0812345678');
    expect((await tdb.query(`select count(*)::int as n from public.audit_entry where record_type = 'import_job'`)).rows[0].n).toBe(1);
  });
});

describe('exports (PLAT-06-AC11 to AC17)', () => {
  const start = (c = owner) => web.withClubTx(c, (tx) => tx.query(`insert into public.data_export (club_id, kind, requested_by_user) values ($1,'club',$2) returning id`, [A, c.userId]));
  it('the owner starts and reads exports; nobody else', async () => {
    await start();
    expect((await web.withClubTx(owner, (tx) => tx.query('select 1 from public.data_export'))).rowCount).toBe(1);
    await expect(start(ctx(DESK, ['front_desk', 'player']))).rejects.toThrow(/row-level security/);
    expect((await web.withClubTx(ctx(DESK, ['front_desk', 'player']), (tx) => tx.query('select 1 from public.data_export'))).rowCount).toBe(0);
  });
  it('the owner cannot start it as already done, or in someone else’s name', async () => {
    await expect(web.withClubTx(owner, (tx) => tx.query(`insert into public.data_export (club_id, kind, requested_by_user, status) values ($1,'club',$2,'done')`, [A, OWNER]))).rejects.toThrow(/row-level security|check/i);
    await expect(web.withClubTx(owner, (tx) => tx.query(`insert into public.data_export (club_id, kind, requested_by_user) values ($1,'club',$2)`, [A, DESK]))).rejects.toThrow(/row-level security/);
  });
  it('the worker finishes it in the club’s context; the file path must be under the club id', async () => {
    const id = (await start()).rows[0]!.id as string;
    const done = (path: string) =>
      worker.withClubTx({ clubId: A, userId: null, roles: [], source: 'job' }, (tx) =>
        tx.query(`update public.data_export set status = 'done', storage_path = $2, expires_at = now() + interval '1 day', row_count = 10 where id = $1`, [id, path]));
    await expect(done(`${B}/export.zip`)).rejects.toThrow(/path_in_club/);
    expect((await done(`${A}/export.zip`)).rowCount).toBe(1);
  });
  it('a finished export has its file, expiry and count; the worker cannot change who asked', async () => {
    const id = (await start()).rows[0]!.id as string;
    await expect(tdb.query(`update public.data_export set status = 'done' where id = $1`, [id])).rejects.toThrow(/done_has_file/);
    await expect(worker.withClubTx({ clubId: A, userId: null, roles: [], source: 'job' }, (tx) => tx.query(`update public.data_export set requested_by_user = null`))).rejects.toThrow(/permission denied/);
  });
  it('a request has exactly one requester (the owner or a BOOQ staff member)', async () => {
    await expect(tdb.query(`insert into public.data_export (club_id, kind) values ($1,'club')`, [A])).rejects.toThrow(/one_requester/);
  });
  it('BOOQ staff have no privilege on exports or imports (class D); they see status through platform.export_request', async () => {
    for (const t of ['data_export', 'import_job', 'import_row', 'data_request']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        expect((await tdb.query('select has_table_privilege($1, $2, $3) as ok', ['booq_platform', `public.${t}`, priv])).rows[0].ok, `${t} ${priv}`).toBe(false);
      }
    }
  });
});

describe('data requests (PDPA-01-AC3)', () => {
  const ask = (kind = 'copy', user = PLAYER) => web.withClubTx(ctx(user, ['player']), (tx) => tx.query(`insert into public.data_request (club_id, user_id, kind) values ($1,$2,$3) returning id`, [A, user, kind]));
  it('a player makes a request for themselves and reads only their own', async () => {
    const id = (await ask()).rows[0]!.id as string;
    expect(id).toBeTruthy();
    await expect(web.withClubTx(ctx(PLAYER, ['player']), (tx) => tx.query(`insert into public.data_request (club_id, user_id, kind) values ($1,$2,'copy')`, [A, OWNER]))).rejects.toThrow(/row-level security/);
    expect((await web.withClubTx(ctx(PLAYER, ['player']), (tx) => tx.query('select 1 from public.data_request'))).rowCount).toBe(1);
    expect((await web.withClubTx(ctx(DESK, ['player']), (tx) => tx.query('select 1 from public.data_request'))).rowCount).toBe(0);
  });
  it('owner and front desk read and handle; a player cannot mark their own request done', async () => {
    const id = (await ask('delete')).rows[0]!.id as string;
    const own = await web.withClubTx(ctx(PLAYER, ['player']), (tx) => tx.query(`update public.data_request set status = 'done', handled_by = $2, handled_at = now() where id = $1`, [id, PLAYER]));
    expect(own.rowCount).toBe(0);
    expect((await tdb.query('select status from public.data_request where id = $1', [id])).rows[0].status).toBe('requested');
    const handled = await web.withClubTx(ctx(DESK, ['front_desk', 'player']), (tx) => tx.query(`update public.data_request set status = 'done', handled_by = $2, handled_at = now() where id = $1`, [id, DESK]));
    expect(handled.rowCount).toBe(1);
  });
  it('done or declined needs a handler; a player cannot start a request as already handled', async () => {
    const id = (await ask()).rows[0]!.id as string;
    await expect(tdb.query(`update public.data_request set status = 'declined' where id = $1`, [id])).rejects.toThrow(/done_is_handled/);
    await expect(web.withClubTx(ctx(PLAYER, ['player']), (tx) => tx.query(`insert into public.data_request (club_id, user_id, kind, status) values ($1,$2,'copy','done')`, [A, PLAYER]))).rejects.toThrow(/row-level security|check/i);
  });
  it('a request and its handling are audited; the note is a pii value', async () => {
    const id = (await ask()).rows[0]!.id as string;
    await web.withClubTx(ctx(DESK, ['front_desk', 'player']), (tx) => tx.query(`update public.data_request set note = 'MARKER-called her', status = 'in_progress' where id = $1`, [id]));
    const rows = (await tdb.query(`select * from public.audit_entry where record_type = 'data_request' order by seq`)).rows;
    expect(rows.map((r) => r.action)).toEqual(['insert', 'update']);
    expect(JSON.stringify(rows.map((r) => [r.old_value, r.new_value]))).not.toContain('MARKER-called her');
    expect(rows[1].pii_new).toEqual({ note: 'MARKER-called her' });
  });
});

describe('worker heartbeat (F01-T34)', () => {
  it('the worker records counts per task type; BOOQ staff read them; nobody else', async () => {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role booq_worker');
      await c.query(`insert into platform.worker_heartbeat (task_name, last_started_at, runs) values ('release_holds', now(), 1)`);
      await c.query(`update platform.worker_heartbeat set last_succeeded_at = now(), runs = runs + 1, lag_seconds = 4, dead_jobs = 0 where task_name = 'release_holds'`);
      await c.query('commit');
    } finally {
      c.release();
    }
    await tdb.query(`insert into platform.platform_staff (id, auth_user_id, email, display_name, role) values ('77777777-7777-4777-8777-777777777777', gen_random_uuid(), 'm@booq.test', 'Mali', 'onboarding_specialist')`);
    const read = async (role: string, staff = '') => {
      const cl = await tdb.pool.connect();
      try {
        await cl.query('begin');
        await cl.query(`set local role ${role}`);
        await cl.query(`select set_config('app.actor_platform_staff_id', $1, true)`, [staff]);
        return await cl.query('select task_name, runs from platform.worker_heartbeat');
      } finally {
        await cl.query('rollback');
        cl.release();
      }
    };
    expect((await read('booq_platform', '77777777-7777-4777-8777-777777777777')).rows).toEqual([{ task_name: 'release_holds', runs: '2' }]);
    expect((await read('booq_platform')).rows).toEqual([]); // no staff member in the transaction, no rows
    await expect(read('booq_app')).rejects.toThrow(/permission denied/);
  });
  it('holds no club id and no free text: it cannot carry data', async () => {
    const cols = (await tdb.query(`select column_name, data_type from information_schema.columns where table_schema = 'platform' and table_name = 'worker_heartbeat'`)).rows;
    expect(cols.map((c) => c.column_name)).not.toContain('club_id');
    expect(cols.filter((c) => ['text', 'jsonb'].includes(c.data_type)).map((c) => c.column_name)).toEqual(['task_name']);
  });
  it('the worker cannot delete rows or rename a task', async () => {
    const c = await tdb.pool.connect();
    try {
      await c.query('set role booq_worker');
      await expect(c.query('delete from platform.worker_heartbeat')).rejects.toThrow(/permission denied/);
      await expect(c.query(`update platform.worker_heartbeat set task_name = 'x'`)).rejects.toThrow(/permission denied/);
    } finally {
      c.release();
    }
  });
});

describe('platform config keys with no default (migration 0016)', () => {
  it('the import limits exist and are null, so they read as not configured', async () => {
    const r = await tdb.query(`select key, value from platform.config where key in ('import_max_rows', 'import_staging_hours') order by key`);
    expect(r.rows).toEqual([{ key: 'import_max_rows', value: null }, { key: 'import_staging_hours', value: null }]);
  });
});

describe('BOOQ staff start an export, and only start it (migration 0017; PLAT-06-AC12)', () => {
  const ADMIN = '77777777-7777-4777-8777-777777777771';
  const OTHER = '77777777-7777-4777-8777-777777777772';
  beforeEach(async () => {
    await tdb.query(`insert into platform.platform_staff (id, auth_user_id, email, display_name, role) values ($1, gen_random_uuid(), 'a@b.test', 'Ann', 'platform_admin'), ($2, gen_random_uuid(), 'o@b.test', 'Oli', 'platform_admin')`, [ADMIN, OTHER]);
  });
  const asStaff = async <T,>(staff: string, club: string, fn: (q: (sql: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>) => Promise<T>) => {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role booq_platform');
      await c.query(`select set_config('app.actor_platform_staff_id', $1, true), set_config('app.club_id', $2, true), set_config('app.actor_label', 'BOOQ staff: x', true)`, [staff, club]);
      const out = await fn((sql, p) => c.query(sql, p));
      await c.query('commit');
      return out;
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  };
  const request = (staff = ADMIN) => asStaff(staff, A, async (q) => (await q(`insert into platform.export_request (club_id, requested_by_staff) values ($1,$2) returning id`, [A, staff])).rows[0]!.id as string);
  const start = (id: string, staff = ADMIN, club = A) => asStaff(staff, club, async (q) => (await q('select app.start_staff_export($1) as id', [id])).rows[0]!.id as string);

  it('turns the staff request into the club’s export, owned by the staff request, and is idempotent', async () => {
    const r = await request();
    const id = await start(r);
    expect(await start(r)).toBe(id);
    const e = (await tdb.query('select club_id, kind, requested_by_staff, requested_by_user, status, request_id from public.data_export')).rows;
    expect(e).toEqual([{ club_id: A, kind: 'club', requested_by_staff: ADMIN, requested_by_user: null, status: 'requested', request_id: r }]);
    expect((await tdb.query('select status from platform.export_request where id = $1', [r])).rows[0].status).toBe('running');
  });
  it('only the staff member who asked, for a club they can see; everything else is "not found"', async () => {
    const r = await request();
    await expect(start(r, OTHER)).rejects.toThrow(/not_found/);
    await expect(start(r, ADMIN, B)).rejects.toThrow(/not_found/);
    await expect(start('00000000-0000-4000-8000-00000000ffff')).rejects.toThrow(/not_found/);
    expect((await tdb.query('select count(*)::int as n from public.data_export')).rows[0].n).toBe(0);
  });
  it('the status of the request follows the export; staff never read the export itself', async () => {
    const r = await request();
    const id = await start(r);
    await worker.withClubTx({ clubId: A, userId: null, roles: [], source: 'job' }, (tx) =>
      tx.query(`update public.data_export set status = 'done', storage_path = $2, expires_at = now() + interval '1 day', row_count = 3 where id = $1`, [id, `${A}/export.zip`]));
    expect((await tdb.query('select status from platform.export_request where id = $1', [r])).rows[0].status).toBe('done');
    await expect(asStaff(ADMIN, A, (q) => q('select * from public.data_export'))).rejects.toThrow(/permission denied/);
    expect((await asStaff(ADMIN, A, (q) => q('select status from platform.export_request'))).rows).toEqual([{ status: 'done' }]);
  });
  it('the app roles cannot call it', async () => {
    for (const role of ['booq_app', 'booq_worker']) {
      expect((await tdb.query(`select has_function_privilege($1, 'app.start_staff_export(uuid)', 'execute') as ok`, [role])).rows[0].ok, role).toBe(false);
    }
  });
});
