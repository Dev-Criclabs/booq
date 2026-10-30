import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectRegistry } from './registry';
import { createPlatformDb, type PlatformDb } from './platform-tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F01-T18 / migration 0008: what BOOQ staff may do (PLAT-02-AC1 to AC9, PDPA-01-AC1; SR-02).
const LIVE = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const TEST = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const DRAFT = 'aaaaaaaa-0000-4000-8000-00000000000d';
const PAUSED = 'aaaaaaaa-0000-4000-8000-00000000000e';

let tdb: TestDatabase;
let pdb: PlatformDb;
let admin: string;
let spec: string; // assigned to LIVE, TEST, PAUSED, DRAFT
let loner: string; // assigned to nothing

const as = (staffId: string | null) => (staffId === null ? { staffId, requestId: 'r1' } : { staffId, staffLabel: 'Test Staff', requestId: 'r1' });

async function newStaff(email: string, role: string, auth: string): Promise<string> {
  const r = await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1, $2, $3, $4) returning id`, [auth, email, email.split('@')[0], role]);
  return r.rows[0].id;
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(
    `insert into public.club (id, slug, name_th, name_en, status) values
       ($1, 'live', 'ก', 'Live', 'live'), ($2, 'testing', 'ข', 'Testing', 'testing'),
       ($3, 'draft', 'ค', 'Draft', 'draft'), ($4, 'paused', 'ง', 'Paused', 'paused')`,
    [LIVE, TEST, DRAFT, PAUSED],
  );
  admin = await newStaff('admin@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000001');
  spec = await newStaff('spec@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000002');
  loner = await newStaff('loner@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000003');
  for (const c of [LIVE, TEST, DRAFT, PAUSED]) await tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1, $2)`, [spec, c]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1, 'package_qr_minutes', '1'), ($2, 'package_qr_minutes', '2')`, [LIVE, TEST]);
  pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await pdb.end();
  await tdb.close();
});

const rows = (staffId: string | null, sql: string, params: unknown[] = []) => pdb.withPlatformTx(as(staffId), async (tx) => (await tx.query(sql, params)).rows);

describe('blind to club data (PLAT-02-AC1, PDPA-01-AC1)', () => {
  it('has no privilege at all on any club data (D) table: select, insert, update, delete fail', async () => {
    const registry = await collectRegistry();
    const dTables = Object.entries(registry).filter(([, e]) => e.class === 'D').map(([t]) => t);
    expect(dTables.length).toBeGreaterThan(0);
    for (const table of dTables) {
      const p = await tdb.query(`select has_table_privilege('booq_platform', $1, 'select') or has_table_privilege('booq_platform', $1, 'insert') or has_table_privilege('booq_platform', $1, 'update') or has_table_privilege('booq_platform', $1, 'delete') as any`, [table]);
      expect(p.rows[0].any, table).toBe(false);
      await expect(rows(admin, `select 1 from ${table} limit 1`), table).rejects.toThrow(/permission denied/i);
      await expect(rows(admin, `delete from ${table}`), table).rejects.toThrow(/permission denied/i);
    }
  });

  it('the setup (S) tables expose no player column and the platform role cannot count rows in D tables', async () => {
    await expect(rows(admin, `select count(*) from public.club_status_change`)).rejects.toThrow(/permission denied/i);
  });

  it('has no privilege on a function that reads secrets or writes usage', async () => {
    const r = await tdb.query(`select has_function_privilege('booq_platform', 'app.bump_usage(text, integer)', 'execute') as ok`);
    expect(r.rows[0].ok).toBe(false);
  });
});

describe('who can see which club (PLAT-02-AC9, ROLE-AC5)', () => {
  it('an admin sees every club, a specialist only assigned clubs, an unassigned specialist none', async () => {
    expect((await rows(admin, `select slug from public.club order by slug`)).map((r) => r.slug)).toEqual(['draft', 'live', 'paused', 'testing']);
    expect((await rows(spec, `select slug from public.club order by slug`)).length).toBe(4);
    await tdb.query(`delete from platform.staff_assignment where staff_id = $1 and club_id = $2`, [spec, PAUSED]);
    expect((await rows(spec, `select slug from public.club order by slug`)).map((r) => r.slug)).toEqual(['draft', 'live', 'testing']);
    expect(await rows(loner, `select slug from public.club`)).toEqual([]);
    expect(await rows(loner, `select * from public.club_setting`)).toEqual([]);
  });

  it('no staff context, an unknown id, or a deactivated account sees nothing', async () => {
    expect(await rows(null, `select slug from public.club`)).toEqual([]);
    expect(await rows('aaaaaaaa-1111-4111-8111-111111111111', `select slug from public.club`)).toEqual([]);
    await tdb.query(`update platform.platform_staff set active = false where id = $1`, [admin]);
    expect(await rows(admin, `select slug from public.club`)).toEqual([]);
  });

  it('a specialist reads setup rows of assigned clubs only', async () => {
    await tdb.query(`delete from platform.staff_assignment where staff_id = $1 and club_id = $2`, [spec, TEST]);
    const r = await rows(spec, `select club_id from public.club_setting`);
    expect(r).toEqual([{ club_id: LIVE }]);
  });
});

describe('edit rules by status (PLAT-02-AC2 to AC7, D27)', () => {
  const setValue = (staffId: string, club: string) =>
    pdb.withPlatformTx(as(staffId), (tx) => tx.query(`update public.club_setting set value = '9' where club_id = $1`, [club]));
  const addSetting = (staffId: string, club: string) =>
    pdb.withPlatformTx(as(staffId), (tx) => tx.query(`insert into public.club_setting (club_id, key, value) values ($1, 'rest_cap_hours', '1')`, [club]));

  it('Draft and Testing: edit works; Live: look only; Paused: look only', async () => {
    expect((await setValue(spec, TEST)).rowCount).toBe(1);
    await addSetting(spec, DRAFT);
    expect((await setValue(spec, LIVE)).rowCount).toBe(0);
    await expect(addSetting(spec, LIVE)).rejects.toThrow(/row-level security/i);
    await expect(addSetting(admin, PAUSED)).rejects.toThrow(/row-level security/i);
    const d = await pdb.withPlatformTx(as(admin), (tx) => tx.query(`delete from public.club_setting where club_id = $1`, [LIVE]));
    expect(d.rowCount).toBe(0);
  });

  it('the owner window opens edit for 24 hours at most and closes by itself when the clock moves', async () => {
    await tdb.setNow('2026-12-29T03:00:00Z');
    await tdb.query(`update public.club set allow_booq_changes_set_at = app.now(), allow_booq_changes_until = app.now() + interval '24 hours' where id in ($1, $2)`, [LIVE, PAUSED]);
    expect((await setValue(spec, LIVE)).rowCount).toBe(1);
    await addSetting(spec, PAUSED);
    await tdb.advance('23 hours 59 minutes');
    expect((await setValue(spec, LIVE)).rowCount).toBe(1);
    await tdb.advance('2 minutes');
    expect((await setValue(spec, LIVE)).rowCount).toBe(0);
    await expect(addSetting(spec, LIVE)).rejects.toThrow(/row-level security/i);
  });

  it('an unassigned specialist cannot edit even a Draft club; the club rows are invisible', async () => {
    expect((await setValue(loner, TEST)).rowCount).toBe(0);
    await expect(addSetting(loner, DRAFT)).rejects.toThrow(/row-level security/i);
  });

  it('the pause table is look only for the platform role', async () => {
    await expect(pdb.withPlatformTx(as(admin), (tx) => tx.query(`insert into public.club_pause (club_id, pause_reason, paused_by) values ($1, 'r', $2)`, [LIVE, admin]))).rejects.toThrow(/permission denied/i);
    expect(await rows(admin, `select count(*)::int as n from public.club_pause`)).toEqual([{ n: 0 }]);
  });
});

describe('club row columns (SR-02)', () => {
  it('cannot write status or the support window columns, whatever the club or role', async () => {
    for (const col of ['status', 'allow_booq_changes_until', 'allow_booq_changes_set_at']) {
      const value = col === 'status' ? `'live'` : `app.now()`;
      await expect(pdb.withPlatformTx(as(admin), (tx) => tx.query(`update public.club set ${col} = ${value} where id = $1`, [TEST])), col).rejects.toThrow(/permission denied/i);
    }
  });

  it('cannot create a club in any state but Draft, or set the window on insert', async () => {
    await expect(pdb.withPlatformTx(as(admin), (tx) => tx.query(`insert into public.club (slug, name_th, name_en, status) values ('x', 'x', 'x', 'live')`))).rejects.toThrow(/permission denied/i);
    await expect(pdb.withPlatformTx(as(admin), (tx) => tx.query(`insert into public.club (slug, name_th, name_en, allow_booq_changes_until) values ('x', 'x', 'x', now())`))).rejects.toThrow(/permission denied/i);
  });

  it('creates a Draft club (P2 step 1) naming the creating staff member, and not in somebody else\'s name', async () => {
    const id = 'bbbbbbbb-0000-4000-8000-000000000001';
    await pdb.withPlatformTx(as(spec), (tx) =>
      tx.query(`insert into public.club (id, slug, name_th, name_en, created_by_staff) values ($1, 'new-club', 'ก', 'New', $2)`, [id, spec]),
    );
    expect((await tdb.query(`select status from public.club where id = $1`, [id])).rows).toEqual([{ status: 'draft' }]);
    await expect(
      pdb.withPlatformTx(as(spec), (tx) => tx.query(`insert into public.club (slug, name_th, name_en, created_by_staff) values ('other', 'ก', 'O', $1)`, [admin])),
    ).rejects.toThrow(/row-level security/i);
  });

  it('a window longer than 24 hours is refused by the database', async () => {
    await expect(
      tdb.query(`update public.club set allow_booq_changes_set_at = now(), allow_booq_changes_until = now() + interval '25 hours' where id = $1`, [LIVE]),
    ).rejects.toThrow(/club_booq_window_max|check/i);
  });

  it('edits business columns in Testing but not on a Live club without the window', async () => {
    const edit = (club: string) => pdb.withPlatformTx(as(spec), (tx) => tx.query(`update public.club set name_en = 'Renamed' where id = $1`, [club]));
    expect((await edit(TEST)).rowCount).toBe(1);
    expect((await edit(LIVE)).rowCount).toBe(0);
  });
});

describe('platform schema (P6, team, usage, templates)', () => {
  it('a specialist reads no P6 log, no other staff and no other club usage; an admin reads all', async () => {
    await pdb.withPlatformTx(as(spec), (tx) => tx.query(`select platform.write_audit('club.created', $1, 'club', $2, '{}'::jsonb, null, null)`, [TEST, TEST]));
    expect(await rows(spec, `select * from platform.audit_log`)).toEqual([]);
    expect((await rows(admin, `select action from platform.audit_log`)).map((r) => r.action)).toEqual(['club.created']);
    expect((await rows(spec, `select email from platform.platform_staff`)).map((r) => r.email)).toEqual(['spec@booq.example']);
    expect((await rows(admin, `select email from platform.platform_staff`)).length).toBe(3);
    await tdb.query(`insert into platform.club_usage_daily (club_id, day, metric, value) values ($1, '2026-12-01', 'bookings_confirmed', 4), ($2, '2026-12-01', 'bookings_confirmed', 9)`, [LIVE, TEST]);
    await tdb.query(`delete from platform.staff_assignment where staff_id = $1 and club_id = $2`, [spec, TEST]);
    expect(await rows(spec, `select club_id, value from platform.club_usage_daily`)).toEqual([{ club_id: LIVE, value: 4 }]);
    expect(await rows(loner, `select * from platform.club_usage_daily`)).toEqual([]);
  });

  it('usage rows are counts only and cannot be written by the platform role', async () => {
    await expect(pdb.withPlatformTx(as(admin), (tx) => tx.query(`insert into platform.club_usage_daily (club_id, day, metric, value) values ($1, '2026-12-01', 'bookings_confirmed', 1)`, [LIVE]))).rejects.toThrow(/permission denied/i);
  });

  it('only an admin changes the team or config; everyone active reads templates and config', async () => {
    await tdb.query(`insert into platform.config (key, value) values ('support_window_hours', '24')`);
    const configRows = (await tdb.query(`select count(*)::int as n from platform.config`)).rows[0].n as number; // includes the seeded launch check list
    const t = await tdb.query(`insert into platform.template (key, name) values ('squash', 'Squash') returning id`);
    expect((await rows(spec, `select key from platform.config`)).length).toBe(configRows);
    expect((await rows(spec, `select key from platform.template`)).length).toBe(5); // the four seeded templates and this one
    const upd = await pdb.withPlatformTx(as(spec), (tx) => tx.query(`update platform.config set value = '48'`));
    expect(upd.rowCount).toBe(0);
    const upd2 = await pdb.withPlatformTx(as(admin), (tx) => tx.query(`update platform.config set value = '48'`));
    expect(upd2.rowCount).toBe(configRows);
    await expect(pdb.withPlatformTx(as(admin), (tx) => tx.query(`insert into platform.template (key, name) values ('x', 'x')`))).rejects.toThrow(/permission denied/i);
    const self = await pdb.withPlatformTx(as(spec), (tx) => tx.query(`update platform.platform_staff set role = 'platform_admin' where id = $1`, [spec]));
    expect(self.rowCount).toBe(0);
    expect((await tdb.query(`select role from platform.platform_staff where id = $1`, [spec])).rows[0].role).toBe('onboarding_specialist');
    expect(t.rows).toHaveLength(1);
  });

  it('only an admin writes launch check results; a specialist cannot mark a check as passed (review R2)', async () => {
    const put = (staffId: string) =>
      pdb.withPlatformTx(as(staffId), (tx) => tx.query(`insert into platform.launch_check (club_id, check_key, result, checked_by) values ($1, 'line_test', 'pass', $2)`, [TEST, staffId]));
    await expect(put(spec)).rejects.toThrow(/row-level security/i);
    await put(admin);
    const up = await pdb.withPlatformTx(as(spec), (tx) => tx.query(`update platform.launch_check set result = 'fail' where club_id = $1`, [TEST]));
    expect(up.rowCount).toBe(0);
    expect((await rows(spec, `select result from platform.launch_check`)).map((r) => r.result)).toEqual(['pass']);
  });

  it('every platform table has row security on', async () => {
    const r = await tdb.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'platform' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(r.rows).toEqual([]);
  });

  it('staff lookups for sign in work with no staff context and return only the one row asked for', async () => {
    const byAuth = await rows(null, `select id, active, role from platform.staff_by_auth_user('99999999-0000-4000-8000-000000000001')`);
    expect(byAuth).toEqual([{ id: admin, active: true, role: 'platform_admin' }]);
    expect((await rows(null, `select id from platform.staff_by_id($1)`, [spec])).length).toBe(1);
    expect(await rows(null, `select id from platform.staff_by_auth_user(gen_random_uuid())`)).toEqual([]);
    await expect(rows(null, `select * from platform.platform_staff`)).resolves.toEqual([]);
  });
});

describe('the staff transaction (review R1, PLAT-04-AC4)', () => {
  it('names the staff member in the club audit log: a platform edit of a setting gives an entry with that label', async () => {
    await pdb.withPlatformTx({ staffId: spec, staffLabel: 'Sam Specialist', clubId: TEST, requestId: 'r9' }, (tx) =>
      tx.query(`insert into public.club_setting (club_id, key, value) values ($1, 'rest_cap_hours', '1')`, [TEST]),
    );
    const r = await tdb.query(`select actor_type, actor_label, actor_platform_staff_id as staff, source from public.audit_entry where club_id = $1 and record_type = 'club_setting' order by occurred_at desc limit 1`, [TEST]);
    expect(r.rows[0]).toEqual({ actor_type: 'platform_staff', actor_label: 'Sam Specialist', staff: spec, source: 'platform' });
  });

  it('refuses a staff id without a label, and sets one setting for the acting staff member', async () => {
    await expect(pdb.withPlatformTx({ staffId: spec }, async () => 1)).rejects.toThrow(/label/i);
    await expect(pdb.withPlatformTx({ staffId: spec, staffLabel: '  ' }, async () => 1)).rejects.toThrow(/label/i);
    const r = await pdb.withPlatformTx({ staffId: spec, staffLabel: 'S', clubId: TEST }, async (tx) =>
      (await tx.query(`select current_setting('app.actor_platform_staff_id', true) as a, current_setting('app.platform_staff_id', true) as b, platform.staff_id() as c, app.club_id() as club`)).rows[0]);
    expect(r).toEqual({ a: spec, b: null, c: spec, club: TEST });
  });
});

describe('P6 writer (PLAT-04-AC5)', () => {
  const write = (staffId: string | null, action: string, detail: unknown = {}, club: string | null = TEST) =>
    pdb.withPlatformTx(as(staffId), (tx) => tx.query(`select platform.write_audit($1, $2, 'club', null, $3::jsonb, 'why', null)`, [action, club, JSON.stringify(detail)]));

  it('takes the staff member from the transaction and records the name at that time', async () => {
    await write(spec, 'club.created');
    await tdb.query(`update platform.platform_staff set display_name = 'Renamed' where id = $1`, [spec]);
    const r = await tdb.query(`select staff_id, staff_name_at_time, action, reason from platform.audit_log`);
    expect(r.rows).toEqual([{ staff_id: spec, staff_name_at_time: 'spec', action: 'club.created', reason: 'why' }]);
  });

  it('refuses detail that names player, booking, payment or secret data, at any depth', async () => {
    for (const detail of [{ line_user_id: 'U1' }, { date_of_birth: '2000-01-01' }, { booking_id: 'b' }, { changed: { customer_name: 'x' } }, { rows: [{ wallet_balance: 5 }] }, { api_key: 'k' }, { secret: 's' }]) {
      await expect(write(spec, 'club.setup_changed', detail), JSON.stringify(detail)).rejects.toThrow(/player|not allowed|detail/i);
    }
    expect(await tdb.query(`select 1 from platform.audit_log`).then((r) => r.rowCount)).toBe(0);
  });

  it('accepts setup facts: changed setup columns, the owner contact (D2) and the last four of a secret', async () => {
    await write(spec, 'club.setup_changed', { section: 'basics', changed: { name_en: 'x', owner_phone: '0812345678', payment_option: 'beam', secret_last4: 'abcd' } });
    expect(await tdb.query(`select 1 from platform.audit_log`).then((r) => r.rowCount)).toBe(1);
  });

  it('needs a staff member, except for sign in events that happen before one is known', async () => {
    await expect(write(null, 'club.created')).rejects.toThrow(/staff/i);
    await write(null, 'auth.sign_in_failed', { reason: 'bad_credentials' }, null);
    await write(admin, 'club.created');
    await tdb.query(`update platform.platform_staff set active = false where id = $1`, [admin]);
    await expect(write(admin, 'club.created')).rejects.toThrow(/staff/i);
  });

  it('is the only way to write the log: no direct insert, update or delete', async () => {
    await expect(pdb.withPlatformTx(as(admin), (tx) => tx.query(`insert into platform.audit_log (action) values ('x')`))).rejects.toThrow(/permission denied/i);
    await write(admin, 'club.created');
    await expect(pdb.withPlatformTx(as(admin), (tx) => tx.query(`update platform.audit_log set action = 'x'`))).rejects.toThrow(/permission denied/i);
    await expect(pdb.withPlatformTx(as(admin), (tx) => tx.query(`delete from platform.audit_log`))).rejects.toThrow(/permission denied/i);
  });
});
