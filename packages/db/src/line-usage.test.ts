import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectRegistry } from './registry';
import { checkTableClasses } from './registry/check';
import { createPlatformDb, type PlatformDb } from './platform-tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F10-T05 / migration 0604: platform.club_line_usage, platform.club_health and the cap thresholds in
// platform.config (FA 2.2, 5.6; F10 design 5.8, 5.9). LINE-06, LINE-07-AC8 (70 and 80 percent are
// platform wide constants, not club settings, not editable by a club owner).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

let tdb: TestDatabase;
let pdb: PlatformDb;
let admin: string;
let spec: string;   // assigned to A only

const staff = async (email: string, role: string, auth: string) =>
  (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1,$2,$3,$4) returning id`, [auth, email, email.split('@')[0], role])).rows[0].id as string;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  admin = await staff('admin@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000001');
  spec = await staff('spec@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000002');
  await tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1,$2)`, [spec, A]);
  pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await pdb.end();
  await tdb.close();
});

const asStaff = (staffId: string, sql: string, params: unknown[] = []) =>
  pdb.withPlatformTx({ staffId, staffLabel: 'Test Staff', requestId: 'r1' }, async (tx) => (await tx.query(sql, params)).rows);
const usage = (club: string, o: { month?: string; used?: number; limit?: number | null; plan?: string | null; source?: string } = {}) =>
  tdb.query(
    `insert into platform.club_line_usage (club_id, month, used, message_limit, plan_kind, source, synced_at) values ($1,$2,$3,$4,$5,$6, now())`,
    [club, o.month ?? '2026-11-01', o.used ?? 700, o.limit === undefined ? 1000 : o.limit, o.plan === undefined ? 'free' : o.plan, o.source ?? 'line'],
  );
/** Runs one statement as an application role, in a transaction that is rolled back. */
async function asRole(role: string, sql: string) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local role ${role}`);
    await c.query(`select set_config('app.club_id', $1, true)`, [A]);
    return await c.query(sql);
  } finally {
    await c.query('rollback');
    c.release();
  }
}

describe('cap thresholds (LINE-07-AC8)', () => {
  it('70, 80 and 100 percent are platform config rows, the decided LINE-07 numbers', async () => {
    const r = await tdb.query(`select key, value from platform.config where key like 'line_cap_%' order by key`);
    expect(r.rows).toEqual([
      { key: 'line_cap_alert_percent', value: 70 },
      { key: 'line_cap_over_limit_percent', value: 100 },
      { key: 'line_cap_reminders_stop_percent', value: 80 },
    ]);
  });

  it('no club role can read or write them', async () => {
    for (const role of ['booq_app', 'booq_worker']) {
      await expect(asRole(role, `select value from platform.config where key = 'line_cap_alert_percent'`)).rejects.toThrow(/permission denied/);
      await expect(asRole(role, `update platform.config set value = '50' where key = 'line_cap_alert_percent'`)).rejects.toThrow(/permission denied/);
    }
  });

  it('they are constants of the product: not even a platform admin changes them', async () => {
    // The admin's only way to change config is platform.set_config_value (migration 0046).
    await expect(asStaff(admin, `select platform.set_config_value('line_cap_alert_percent', '50')`)).rejects.toThrow(/constant/);
    await expect(tdb.query(`update platform.config set value = '90' where key = 'line_cap_reminders_stop_percent'`)).rejects.toThrow(/constant/);
    await expect(tdb.query(`delete from platform.config where key = 'line_cap_over_limit_percent'`)).rejects.toThrow(/constant/);
    // Other keys stay editable by the admin, as before.
    await asStaff(admin, `select platform.set_config_value('import_max_rows', '5000')`);
    expect((await tdb.query(`select value from platform.config where key = 'import_max_rows'`)).rows[0].value).toBe(5000);
  });
});

describe('platform.club_line_usage (LINE-06, FA 5.6)', () => {
  it('one row per club and Bangkok calendar month, keyed on the first day', async () => {
    await usage(A);
    await expect(usage(A)).rejects.toThrow(/club_line_usage_pkey/);
    await usage(A, { month: '2026-12-01' });
    await usage(B);
    await expect(usage(A, { month: '2026-11-15' })).rejects.toThrow(/club_line_usage_month_first_day/);
  });

  it('counts are whole and not negative; plan, source and limit take their values', async () => {
    await expect(usage(A, { used: -1 })).rejects.toThrow(/club_line_usage_used_non_negative/);
    await expect(usage(A, { limit: 0 })).rejects.toThrow(/club_line_usage_limit_positive/);
    await expect(usage(A, { plan: 'gold' })).rejects.toThrow(/club_line_usage_plan_kind_values/);
    await expect(usage(A, { source: 'guess' })).rejects.toThrow(/club_line_usage_source_values/);
    await usage(A, { limit: null, plan: null, source: 'own_count' });   // no limit known: the state stays normal (FA 5.6)
  });

  it('the state is derived, never stored, and the row holds counts only', async () => {
    const cols = (await tdb.query(`select column_name from information_schema.columns where table_schema = 'platform' and table_name = 'club_line_usage' order by ordinal_position`)).rows.map((r) => r.column_name);
    expect(cols).toEqual(['club_id', 'month', 'used', 'line_consumption', 'message_limit', 'plan_kind', 'source', 'synced_at']);
  });

  it('the platform reader sees the counts of the clubs it may see, and writes nothing', async () => {
    await usage(A);
    await usage(B);
    expect((await asStaff(spec, `select club_id, used, message_limit from platform.club_line_usage`))).toEqual([{ club_id: A, used: 700, message_limit: 1000 }]);
    expect((await asStaff(admin, `select club_id from platform.club_line_usage order by club_id`)).length).toBe(2);
    await expect(asStaff(admin, `update platform.club_line_usage set used = 0`)).rejects.toThrow(/permission denied/);
    await expect(asStaff(admin, `insert into platform.club_line_usage (club_id, month, used, source) values ($1,'2027-01-01',0,'line')`, [A])).rejects.toThrow(/permission denied/);
  });

  it('club roles cannot reach it directly', async () => {
    await usage(A);
    for (const role of ['booq_app', 'booq_worker']) {
      await expect(asRole(role, `select 1 from platform.club_line_usage`)).rejects.toThrow(/permission denied/);
    }
  });
});

describe('platform.club_health (LINE-06, LINE-07-AC9)', () => {
  const health = (club: string, check: string, status: string, reason: string | null = null) =>
    tdb.query(`insert into platform.club_health (club_id, check_key, status, reason) values ($1,$2,$3,$4)`, [club, check, status, reason]);

  it('one row per club and check; check and status take their values; a failure has a reason', async () => {
    await health(A, 'line_token', 'ok');
    await expect(health(A, 'line_token', 'failed', 'http_401')).rejects.toThrow(/club_health_pkey/);
    await health(A, 'line_usage', 'failed', 'usage_unreadable');
    await expect(health(B, 'beam_mood', 'ok')).rejects.toThrow(/club_health_check_values/);
    await expect(health(B, 'line_token', 'sad')).rejects.toThrow(/club_health_status_values/);
    await expect(health(B, 'line_token', 'failed')).rejects.toThrow(/club_health_failed_has_reason/);
  });

  it('the platform reader sees health for the clubs it may see; club roles cannot reach it', async () => {
    await health(A, 'line_token', 'failed', 'http_401');
    await health(B, 'line_token', 'ok');
    expect(await asStaff(spec, `select club_id, check_key, status, reason from platform.club_health`)).toEqual([{ club_id: A, check_key: 'line_token', status: 'failed', reason: 'http_401' }]);
    await expect(asStaff(admin, `update platform.club_health set status = 'ok'`)).rejects.toThrow(/permission denied/);
    await expect(asRole('booq_app', `select 1 from platform.club_health`)).rejects.toThrow(/permission denied/);
  });
});

describe('classification', () => {
  it('both tables are class P and pass the table class check', async () => {
    const reg = await collectRegistry();
    expect(reg['platform.club_line_usage']).toEqual({ class: 'P' });
    expect(reg['platform.club_health']).toEqual({ class: 'P' });
    const res = await checkTableClasses(tdb.pool, reg);
    expect(res.problems.filter((p) => p.table.startsWith('platform.club_'))).toEqual([]);
  });
});
