import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlatformDb, type PlatformDb } from './platform-tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';
import { completeSetup } from './setup-fixture';

// F01-T27b / migration 0046: every Go live check has a producer, the result of a derived check is computed
// (never typed in), recorded checks are written by one audited function, and the list is changed by one
// audited function (PLAT-01-AC3 to AC5, AC12; PLAT-07-AC4; D32, D106, D108; review T22-T23).
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const TESTER = '11111111-1111-4111-8111-111111111111';

let tdb: TestDatabase;
let pdb: PlatformDb;
let admin: string;
let spec: string;
let loner: string;

const staff = async (email: string, role: string, auth: string, name: string) =>
  (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1,$2,$3,$4) returning id`, [auth, email, name, role])).rows[0].id as string;
const as = (staffId: string, club = CLUB) => ({ staffId, staffLabel: 'Staff', clubId: club });
const call = <T = unknown>(who: string, sql: string, params: unknown[] = [], club = CLUB) =>
  pdb.withPlatformTx(as(who, club), async (tx) => (await tx.query(sql, params)).rows[0] as T);
const goLive = (who: string) => call(who, `select app.set_club_status('live', null)`);
const blockers = (who: string) =>
  goLive(who).then(() => null, (e: { message: string; detail?: string }) => ({ message: e.message, items: JSON.parse(e.detail ?? '[]') as Array<{ item: string; owed_by: string; result: string }> }));
const result = async (key: string, club = CLUB) => (await tdb.query(`select app.launch_result($1, $2) as r`, [club, key])).rows[0].r as string;
const p6 = async (action: string) => (await tdb.query(`select staff_name_at_time as name, club_id, detail from platform.audit_log where action = $1 order by occurred_at, id`, [action])).rows;

const REQUIRED = ['hold_minutes', 'booking_window_days', 'cancel_window_hours', 'waitlist_claim_minutes', 'waitlist_no_offer_hours', 'rest_cap_hours',
  'group_min_players', 'group_max_players', 'package_expiry_reminder_days', 'package_qr_minutes', 'vat_enabled', 'resource_label'];
const setting = (key: string, value: unknown, club = CLUB) => tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,$2,$3::jsonb) on conflict (club_id, key) do update set value = excluded.value`, [club, key, JSON.stringify(value)]);
async function allRequiredSettings(club = CLUB) {
  for (const k of REQUIRED) await setting(k, k === 'package_expiry_reminder_days' ? [14, 3] : k === 'vat_enabled' ? false : k === 'resource_label' ? 'court' : k === 'hold_minutes' ? 15 : 5, club);
}
const payTap = async () => {
  await tdb.query(`insert into platform.config (key, value) values ('pay_tap_limit_count', '5'), ('pay_tap_limit_window_seconds', '60') on conflict (key) do update set value = excluded.value`);
};
async function liveBeamKeys(club = CLUB) {
  await tdb.query(`update public.payment_connection set merchant_id_live = 'm-live' where club_id = $1`, [club]);
  for (const kind of ['beam_api_key_live', 'beam_hmac_key_live']) {
    await tdb.query(`insert into public.club_secret (club_id, kind, ciphertext, key_id, written_by_staff) values ($1, $2, 'booq1.x', 'k1', $3)`, [club, kind, admin]);
  }
}
const record = (who: string, key: string, res: string, club = CLUB) => call(who, `select platform.record_launch_check($1, $2, $3)`, [club, key, res], club);
/** Everything a club needs for Go live, by the real producers. */
async function ready(club = CLUB) {
  await tdb.query(`update public.club set receipt_prefix = 'HTC' where id = $1`, [club]);
  await allRequiredSettings(club);
  await payTap();
  await liveBeamKeys(club);
  for (const [key, res] of [['beam_key_swap', 'pass'], ['owner_signed_in', 'pass'], ['owner_verified', 'pass'], ['product_priced', 'pass'], ['test_booking_completed', 'pass']] as const) {
    await tdb.query(`insert into platform.launch_check (club_id, check_key, result) values ($1,$2,$3) on conflict (club_id, check_key) do update set result = excluded.result`, [club, key, res]);
  }
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','testing'), ($2,'b','ข','B','testing')`, [CLUB, OTHER]);
  admin = await staff('admin@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000001', 'Ada Admin');
  spec = await staff('spec@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000002', 'Sam Specialist');
  loner = await staff('loner@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000003', 'Lee Loner');
  await tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1,$2)`, [spec, CLUB]);
  await completeSetup(tdb, CLUB);
  await completeSetup(tdb, OTHER);
  pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await pdb.end();
  await tdb.close();
});

describe('every required check has a producer (review T22-T23)', () => {
  it('each key in required_launch_checks names a producer, and the producers are the ten of D108', async () => {
    const keys = ((await tdb.query(`select value from platform.config where key = 'required_launch_checks'`)).rows[0].value as Array<{ key: string }>).map((x) => x.key);
    const prod = (await tdb.query(`select check_key, kind, task from app.launch_producers order by check_key`)).rows;
    for (const k of keys) expect(prod.map((p) => p.check_key), k).toContain(k);
    expect(prod.every((p) => p.task && p.task.length > 0)).toBe(true);
  });

  it('the checks still waiting for the feature that owns the data are named, so they cannot be forgotten', async () => {
    const waiting = (await tdb.query(`select check_key from app.launch_producers where kind = 'recorded' and task like 'awaiting:%' order by check_key`)).rows.map((r) => r.check_key);
    expect(waiting).toEqual(['product_priced', 'test_booking_completed']);
  });

  it('a key with no producer can never pass: it is named in the refusal', async () => {
    await tdb.query(`update platform.config set value = value || '[{"key":"made_up","owed_by":"booq"}]'::jsonb where key = 'required_launch_checks'`);
    const b = await blockers(admin);
    expect(b?.items.find((i) => i.item === 'made_up')).toEqual({ item: 'made_up', owed_by: 'booq', result: 'no_producer' });
  });
});

describe('derived checks are computed, never typed in', () => {
  it('a typed pass row is ignored for a derived key', async () => {
    await tdb.query(`insert into platform.launch_check (club_id, check_key, result) values ($1,'receipt_prefix_set','pass'), ($1,'line_test','pass')`, [CLUB]);
    expect(await result('receipt_prefix_set')).toBe('pending');
    await tdb.query(`delete from public.line_connection where club_id = $1`, [CLUB]);
    expect(await result('line_test')).toBe('pending');
  });

  it('line_test follows the connection test; receipt_prefix_set follows the club prefix (D106)', async () => {
    expect(await result('line_test')).toBe('pass');
    expect(await result('receipt_prefix_set')).toBe('pending');
    await tdb.query(`update public.club set receipt_prefix = '  ' where id = $1`, [CLUB]);
    expect(await result('receipt_prefix_set')).toBe('pending');
    await tdb.query(`update public.club set receipt_prefix = 'HTC' where id = $1`, [CLUB]);
    expect(await result('receipt_prefix_set')).toBe('pass');
  });

  it('pay_tap_limit_set needs both platform values, positive numbers (D61, A-11); nothing is invented', async () => {
    expect(await result('pay_tap_limit_set')).toBe('pending');
    await tdb.query(`insert into platform.config (key, value) values ('pay_tap_limit_count', '5')`);
    expect(await result('pay_tap_limit_set')).toBe('pending');
    await tdb.query(`insert into platform.config (key, value) values ('pay_tap_limit_window_seconds', 'null')`);
    expect(await result('pay_tap_limit_set')).toBe('pending');
    await tdb.query(`update platform.config set value = '60' where key = 'pay_tap_limit_window_seconds'`);
    expect(await result('pay_tap_limit_set')).toBe('pass');
    await tdb.query(`update platform.config set value = '0' where key = 'pay_tap_limit_count'`);
    expect(await result('pay_tap_limit_set')).toBe('pending');
  });

  it('template_required_settings: a blank club fails, every required setting set passes, a null value is not set (PLAT-05-AC8, AC16)', async () => {
    expect(await result('template_required_settings')).toBe('pending');
    await allRequiredSettings();
    expect(await result('template_required_settings')).toBe('pass');
    await setting('rest_cap_hours', null);
    expect(await result('template_required_settings')).toBe('pending');
  });

  it('the TBD settings are not required, and the slip setting only for a slip club', async () => {
    await allRequiredSettings();
    expect(await result('template_required_settings')).toBe('pass');   // max_future_court_hours, below_min_alert_minutes, wallet_expiry_months unset
    await tdb.query(`update public.club set payment_option = 'slip' where id = $1`, [CLUB]);
    expect(await result('template_required_settings')).toBe('pending');
    await setting('auto_slip_check', true);
    expect(await result('template_required_settings')).toBe('pass');
  });

  it('no_open_launch_failure: any recorded failure for this club keeps it open, another club does not', async () => {
    expect(await result('no_open_launch_failure')).toBe('pass');
    await tdb.query(`insert into platform.launch_check (club_id, check_key, result) values ($1, 'owner_verified', 'fail')`, [OTHER]);
    expect(await result('no_open_launch_failure')).toBe('pass');
    await tdb.query(`insert into platform.launch_check (club_id, check_key, result) values ($1, 'owner_verified', 'fail')`, [CLUB]);
    expect(await result('no_open_launch_failure')).toBe('pending');
  });
});

describe('the Beam key swap (D32, A-23)', () => {
  it('fails while the live key set is not in place, even if a smoke test pass was recorded', async () => {
    await record(admin, 'beam_key_swap', 'pass');
    expect(await result('beam_key_swap')).toBe('fail');
    await tdb.query(`update public.payment_connection set merchant_id_live = 'm-live' where club_id = $1`, [CLUB]);
    expect(await result('beam_key_swap')).toBe('fail');   // the live API key and HMAC key are still missing
    await liveBeamKeys();
    expect(await result('beam_key_swap')).toBe('pass');
  });

  it('with the live keys in place it still waits for the smoke test result', async () => {
    await liveBeamKeys();
    expect(await result('beam_key_swap')).toBe('pending');
    await record(admin, 'beam_key_swap', 'fail');
    expect(await result('beam_key_swap')).toBe('fail');
  });

  it('a slip club has no Beam key swap to do (Gaps A2)', async () => {
    await tdb.query(`update public.club set payment_option = 'slip' where id = $1`, [CLUB]);
    expect(await result('beam_key_swap')).toBe('pass');
  });
});

describe('recording a result (admin only, Testing only, recorded keys only)', () => {
  it('an admin records a smoke test; it is in P6 with the staff name and the check, no more', async () => {
    await record(admin, 'beam_key_swap', 'pass');
    expect((await tdb.query(`select result, checked_by from platform.launch_check where club_id = $1 and check_key = 'beam_key_swap'`, [CLUB])).rows).toEqual([{ result: 'pass', checked_by: admin }]);
    expect(await p6('launch_check.recorded')).toEqual([{ name: 'Ada Admin', club_id: CLUB, detail: { check_key: 'beam_key_swap', result: 'pass' } }]);
  });

  it('a specialist cannot mark a check as passed, and a club the staff member cannot see is not found', async () => {
    await expect(record(spec, 'beam_key_swap', 'pass')).rejects.toThrow(/launch_check:forbidden/);
    await expect(record(loner, 'beam_key_swap', 'pass', CLUB)).rejects.toThrow(/launch_check:not_found/);
    await expect(record(admin, 'beam_key_swap', 'pass', 'aaaaaaaa-0000-4000-8000-0000000000ff')).rejects.toThrow(/launch_check:not_found/);
    expect((await tdb.query(`select count(*)::int as n from platform.launch_check`)).rows[0].n).toBe(0);
  });

  it('a derived key cannot be recorded, an unknown key cannot, a bad result cannot, and only a Testing club takes one', async () => {
    await expect(record(admin, 'line_test', 'pass')).rejects.toThrow(/launch_check:not_recorded/);
    await expect(record(admin, 'made_up', 'pass')).rejects.toThrow(/launch_check:not_recorded/);
    await expect(record(admin, 'beam_key_swap', 'ok')).rejects.toThrow(/launch_check:invalid_result/);
    await tdb.query(`update public.club set status = 'draft' where id = $1`, [CLUB]);
    await expect(record(admin, 'beam_key_swap', 'pass')).rejects.toThrow(/launch_check:not_testing/);
  });

  it('no role can write launch_check rows directly any more', async () => {
    await expect(pdb.withPlatformTx(as(admin), (tx) => tx.query(`insert into platform.launch_check (club_id, check_key, result) values ($1,'beam_key_swap','pass')`, [CLUB]))).rejects.toThrow(/permission denied/i);
    await expect(pdb.withPlatformTx(as(admin), (tx) => tx.query(`update platform.launch_check set result = 'pass'`))).rejects.toThrow(/permission denied/i);
  });
});

describe('Go live runs the checks, then the purge, then sets Live (PLAT-01-AC3, PLAT-07-AC4)', () => {
  it('a club with every check passing goes Live', async () => {
    await ready();
    expect(await goLive(spec)).toEqual({ set_club_status: 'live' });
    expect((await tdb.query(`select status from public.club where id = $1`, [CLUB])).rows[0].status).toBe('live');
  });

  it('a failed check refuses Live whatever else is true, names it with who owes it, and keeps the test data', async () => {
    await ready();
    await tdb.query(
      `with u as (insert into public.app_user (club_id, id, line_user_id, is_test) values ($1, $2, 'Utest', true) returning club_id, id)
       insert into public.app_user_role (club_id, user_id, role) select club_id, id, 'player' from u`, [CLUB, TESTER]);
    await tdb.query(`update public.club set receipt_prefix = null where id = $1`, [CLUB]);
    const b = await blockers(spec);
    expect(b?.items).toEqual([{ item: 'receipt_prefix_set', owed_by: 'booq', result: 'pending' }]);
    expect((await tdb.query(`select status from public.club where id = $1`, [CLUB])).rows[0].status).toBe('testing');
    expect((await tdb.query(`select count(*)::int as n from public.app_user where id = $1`, [TESTER])).rows[0].n).toBe(1);
  });

  it('P3 shows the computed result of each check, not a stored one', async () => {
    const p = (await call<{ p: { launch: Array<{ item: string; result: string }> } }>(admin, `select platform.club_progress($1) as p`, [CLUB])).p;
    const by = Object.fromEntries(p.launch.map((x) => [x.item, x.result]));
    expect(by).toMatchObject({ line_test: 'pass', receipt_prefix_set: 'pending', template_required_settings: 'pending', no_open_launch_failure: 'pass' });
  });
});

describe('changing the list or a config value is one audited function (review T22-T23)', () => {
  const setCfg = (who: string, key: string, value: unknown) => call(who, `select platform.set_config_value($1, $2::jsonb)`, [key, JSON.stringify(value)]);

  it('the table grant for update and insert is gone: no direct write by anyone', async () => {
    await expect(pdb.withPlatformTx(as(admin), (tx) => tx.query(`update platform.config set value = '[]'::jsonb where key = 'required_launch_checks'`))).rejects.toThrow(/permission denied/i);
    await expect(pdb.withPlatformTx(as(admin), (tx) => tx.query(`insert into platform.config (key, value) values ('x', '1')`))).rejects.toThrow(/permission denied/i);
  });

  it('only an admin sets a value; the change is in P6 with the key', async () => {
    await expect(setCfg(spec, 'tester_invite_ttl_hours', 720)).rejects.toThrow(/config:forbidden/);
    await setCfg(admin, 'tester_invite_ttl_hours', 720);
    expect((await tdb.query(`select value from platform.config where key = 'tester_invite_ttl_hours'`)).rows).toEqual([{ value: 720 }]);
    await setCfg(admin, 'tester_invite_ttl_hours', 48);
    expect((await p6('config.changed')).map((r) => [r.name, r.detail])).toEqual([['Ada Admin', { config: 'tester_invite_ttl_hours' }], ['Ada Admin', { config: 'tester_invite_ttl_hours' }]]);
  });

  it('a link life must be a positive number', async () => {
    for (const bad of [0, -1, 'x', null]) await expect(setCfg(admin, 'tester_invite_ttl_hours', bad), String(bad)).rejects.toThrow(/config:invalid_value/);
  });

  it('shortening the launch list is logged with the keys removed and added', async () => {
    const list = (await tdb.query(`select value from platform.config where key = 'required_launch_checks'`)).rows[0].value as Array<{ key: string; owed_by: string }>;
    const shorter = list.filter((x) => x.key !== 'beam_key_swap');
    await setCfg(admin, 'required_launch_checks', shorter);
    expect(await p6('config.changed')).toEqual([{ name: 'Ada Admin', club_id: null, detail: { config: 'required_launch_checks', removed: ['beam_key_swap'], added: [] } }]);
  });

  it('the list must be a non-empty array of {key, owed_by} where every key has a producer, no duplicates', async () => {
    for (const bad of [[], 'x', [{ key: 'line_test' }], [{ key: 'line_test', owed_by: 'someone' }], [{ key: 'made_up', owed_by: 'booq' }], [{ key: 'line_test', owed_by: 'booq' }, { key: 'line_test', owed_by: 'booq' }]]) {
      await expect(setCfg(admin, 'required_launch_checks', bad), JSON.stringify(bad)).rejects.toThrow(/config:invalid_value/);
    }
    expect((await p6('config.changed')).length).toBe(0);
  });
});
