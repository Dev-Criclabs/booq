import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlatformDb, type PlatformDb } from './platform-tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';
import { recordLaunchChecks, requiredLaunchKeys } from './setup-fixture';

// F01-T23 part a / migration 0034: setup steps for Draft to Testing, required launch checks for
// Testing to Live (review T20 R2), and the P3 progress list (PLAT-01-AC2, AC3, AC9, AC12).
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

let tdb: TestDatabase;
let pdb: PlatformDb;
let admin: string;
let spec: string;
let loner: string;

async function staff(email: string, role: string, auth: string, name: string): Promise<string> {
  return (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1, $2, $3, $4) returning id`, [auth, email, name, role])).rows[0].id;
}
const as = (staffId: string, club = CLUB) => ({ staffId, staffLabel: 'Staff', clubId: club });
const setStatus = (who: string, to: string) =>
  pdb.withPlatformTx(as(who), async (tx) => (await tx.query(`select app.set_club_status($1, null) as s`, [to])).rows[0]?.s as string);
const blockers = (who: string, to: string) => setStatus(who, to).then(() => null, (e: { message: string; detail?: string }) => ({ message: e.message, items: JSON.parse(e.detail ?? '[]') as Array<{ item: string; owed_by: string; result?: string }> }));
const progress = (who: string, club = CLUB) =>
  pdb.withPlatformTx(as(who, club), async (tx) => (await tx.query(`select platform.club_progress($1) as p`, [club])).rows[0]?.p);

const owner = `owner_name = 'Nok', owner_phone = '0812345678', owner_line = 'U00000000000000000000000000000002', owner_email = 'nok@example.com'`;
async function completeStep(step: string, club = CLUB) {
  switch (step) {
    case 'basics': {
      const t = await tdb.query(`insert into platform.template (key, name) values ('t' || gen_random_uuid()::text, 'T') returning id`);
      await tdb.query(`update public.club set ${owner}, template_id = $2 where id = $1`, [club, t.rows[0].id]);
      break;
    }
    case 'plan': await tdb.query(`update public.club set billing_starts_at = '2027-02-01T00:00:00Z' where id = $1`, [club]); break;
    case 'courts_hours': {
      await tdb.query(`insert into public.location (club_id, id, name) values ($1, gen_random_uuid(), 'Main')`, [club]);
      await tdb.query(`insert into public.resource (club_id, location_id, name, sport) select $1, id, 'Court 1', 'tennis' from public.location where club_id = $1`, [club]);
      await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1, 1, '06:00', '24:00')`, [club]);
      break;
    }
    case 'line': await tdb.query(`insert into public.line_connection (club_id, tested_at) values ($1, app.now())`, [club]); break;
    case 'payments': {
      await tdb.query(`update public.club set payment_option = 'beam' where id = $1`, [club]);
      await tdb.query(`insert into public.payment_connection (club_id, tested_at) values ($1, app.now())`, [club]);
      break;
    }
    case 'legal_notice': {
      // platform-wide, not per club: one published release is enough (D152)
      if ((await tdb.query(`select 1 from platform.legal_release`)).rowCount === 0) {
        const st = (await tdb.query(`select id from platform.platform_staff limit 1`)).rows[0].id;
        await tdb.query(`insert into platform.legal_release (seq, published_by) values (1, $1)`, [st]);
        for (const kind of ['privacy', 'terms']) for (const lang of ['th', 'en']) await tdb.query(`insert into platform.legal_text (seq, kind, language, title, body) values (1, $1, $2, 't', 'b')`, [kind, lang]);
      }
      break;
    }
  }
}
const ALL_STEPS = ['basics', 'plan', 'courts_hours', 'line', 'payments', 'legal_notice'];

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1, 'a', 'ก', 'A'), ($2, 'b', 'ข', 'B')`, [CLUB, OTHER]);
  admin = await staff('admin@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000001', 'Ada Admin');
  spec = await staff('spec@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000002', 'Sam Specialist');
  loner = await staff('loner@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000003', 'Lee Loner');
  await tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1, $2)`, [spec, CLUB]);
  pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await pdb.end();
  await tdb.close();
});

describe('Draft to Testing needs the setup steps (PLAT-01-AC2, AC9)', () => {
  it('a new club is refused and the answer says what is missing and who owes it', async () => {
    const b = await blockers(spec, 'testing');
    expect(b?.message).toMatch(/blocked/);
    expect(b?.items).toEqual(ALL_STEPS.map((item) => ({ item, owed_by: 'booq' })));
  });

  it('each step clears when its data is in; the last one lets the move through', async () => {
    for (const [i, step] of ALL_STEPS.entries()) {
      await completeStep(step);
      const b = await blockers(spec, 'testing');
      if (i < ALL_STEPS.length - 1) expect(b?.items.map((x) => x.item), step).toEqual(ALL_STEPS.slice(i + 1));
      else expect(b).toBeNull();
    }
    expect((await tdb.query(`select status from public.club where id = $1`, [CLUB])).rows[0].status).toBe('testing');
  });

  it('a step is not done by half its data: an untested LINE connection, hours but no court, one missing owner field', async () => {
    await completeStep('basics');
    await tdb.query(`update public.club set owner_email = null where id = $1`, [CLUB]);
    await tdb.query(`insert into public.line_connection (club_id) values ($1)`, [CLUB]);
    await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1, 1, '06:00', '24:00')`, [CLUB]);
    const items = (await blockers(spec, 'testing'))?.items.map((x) => x.item);
    expect(items).toEqual(ALL_STEPS);
  });

  it('the steps are a registry: a later feature registers another and it blocks too', async () => {
    for (const s of ALL_STEPS) await completeStep(s);
    await tdb.query(`create function public.__step_products(p_club uuid) returns boolean language sql stable as $$ select false $$`);
    await tdb.query(`select app.register_setup_step('products', 60, 'owner', 'public.__step_products(uuid)'::regprocedure)`);
    expect((await blockers(spec, 'testing'))?.items).toEqual([{ item: 'products', owed_by: 'owner' }]);
  });

  it('the registry is writable by nobody but the owner role', async () => {
    for (const role of ['booq_app', 'booq_worker', 'booq_platform', 'anon', 'authenticated']) {
      const r = await tdb.query(`select has_table_privilege($1, 'app.setup_steps', 'select,insert,update,delete') as ok, has_function_privilege($1, 'app.register_setup_step(text, integer, text, regprocedure)', 'execute') as fn`, [role]);
      expect(r.rows[0], role).toEqual({ ok: false, fn: false });
    }
  });
});

describe('Testing to Live needs the required launch checks from config (review T20 R2; PLAT-01-AC3, AC12)', () => {
  const required = async () => (await tdb.query(`select value from platform.config where key = 'required_launch_checks'`)).rows[0].value as Array<{ key: string; owed_by: string }>;
  async function toTesting() {
    for (const s of ALL_STEPS) await completeStep(s);
    await setStatus(admin, 'testing');
  }
  const pass = (keys: string[]) => Promise.all(keys.map((k) => tdb.query(`insert into platform.launch_check (club_id, check_key, result) values ($1, $2, 'pass') on conflict (club_id, check_key) do update set result = 'pass'`, [CLUB, k])));

  it('the list is data in platform.config and holds the Go live checks of D108 with who owes each', async () => {
    const keys = (await required()).map((r) => r.key);
    // The ten of D108 come first, in order; later features append their own (line_send_retry_set, F10).
    expect(keys.slice(0, 10)).toEqual(['line_test', 'pay_tap_limit_set', 'beam_key_swap', 'receipt_prefix_set', 'owner_signed_in', 'owner_verified', 'product_priced', 'template_required_settings', 'test_booking_completed', 'no_open_launch_failure']);
    expect(keys).toContain('line_send_retry_set');
    expect((await required()).every((r) => r.owed_by === 'booq' || r.owed_by === 'owner')).toBe(true);
  });

  it('with no check recorded, Go live is refused and lists every required check', async () => {
    await toTesting();
    const b = await blockers(admin, 'live');
    // the LINE test is derived from the connection, which toTesting() completed, and no failure is open; everything else is still open
    expect(b?.items.map((x) => x.item)).toEqual((await required()).map((r) => r.key).filter((k) => k !== 'line_test' && k !== 'no_open_launch_failure'));
    expect(b?.items.every((x) => x.result === 'pending')).toBe(true);
  });

  it('one required check not passing blocks; extra unknown keys do not count; a recorded failure says fail', async () => {
    await toTesting();
    const keys = (await required()).map((r) => r.key);
    await recordLaunchChecks(tdb, CLUB, ['pending']);
    await pass(['some_other_check']);
    expect((await blockers(admin, 'live'))?.items).toEqual([{ item: keys[0], owed_by: (await required())[0]?.owed_by, result: 'pending' }]);
    await recordLaunchChecks(tdb, CLUB, ['pass', 'pass', 'pass', 'pass', 'pass', 'fail']);
    expect((await blockers(admin, 'live'))?.items[0]).toMatchObject({ item: 'owner_verified', result: 'fail' });
    await recordLaunchChecks(tdb, CLUB);
    expect(await setStatus(admin, 'live')).toBe('live');
  });

  it('owner_verified is among them: a Go live without it is refused (SR-01)', async () => {
    await toTesting();
    await recordLaunchChecks(tdb, CLUB, ['pass', 'pass', 'pass', 'pass', 'pass', 'pending']);
    expect((await blockers(admin, 'live'))?.items.map((x) => x.item)).toEqual(['owner_verified']);
  });

  it('fails closed: no configured list means no Go live', async () => {
    await toTesting();
    await tdb.query(`delete from platform.config where key = 'required_launch_checks'`);
    await pass(['line_test']);
    expect((await blockers(admin, 'live'))?.items).toEqual([{ item: 'required_launch_checks_not_configured', owed_by: 'booq', result: 'missing' }]);
  });
});

describe('platform.club_progress (P3: what is missing and who owes it)', () => {
  it('lists every setup step and every required launch check with done and owner', async () => {
    await completeStep('basics');
    const p = await progress(spec);
    expect(p.setup).toEqual([
      { item: 'basics', done: true, owed_by: 'booq' },
      { item: 'plan', done: false, owed_by: 'booq' },
      { item: 'courts_hours', done: false, owed_by: 'booq' },
      { item: 'line', done: false, owed_by: 'booq' },
      { item: 'payments', done: false, owed_by: 'booq' },
      { item: 'legal_notice', done: false, owed_by: 'booq' },
    ]);
    expect(p.launch.map((x: { item: string }) => x.item)).toEqual(await requiredLaunchKeys(tdb));
    expect(p.launch[0]).toEqual({ item: 'line_test', result: 'pending', owed_by: 'booq' });
  });

  it('shows computed and recorded results, and nothing about a club the caller cannot see', async () => {
    await tdb.query(`insert into platform.launch_check (club_id, check_key, result) values ($1, 'owner_signed_in', 'pass'), ($1, 'line_test', 'pass')`, [CLUB]);
    const launch = (await progress(spec)).launch as Array<{ item: string; result: string }>;
    expect(launch.find((x) => x.item === 'owner_signed_in')).toMatchObject({ result: 'pass' });
    expect(launch.find((x) => x.item === 'line_test')).toMatchObject({ result: 'pending' });   // derived: a typed row does not count
    expect(await progress(loner)).toBeNull();
    expect(await progress(spec, OTHER)).toBeNull();
    expect((await progress(admin, OTHER)).setup).toHaveLength(6);
    expect(await progress(admin, 'aaaaaaaa-0000-4000-8000-0000000000ff')).toBeNull(); // an admin sees every club, but not one that does not exist
  });
});

describe('a specialist who creates a club is assigned to it', () => {
  it('can add their own assignment to a club they created, and to no other', async () => {
    const id = 'bbbbbbbb-0000-4000-8000-000000000001';
    await pdb.withPlatformTx(as(loner, id), (tx) =>
      tx.query(`insert into public.club (id, slug, name_th, name_en, created_by_staff) values ($1, 'new', 'ก', 'New', $2)`, [id, loner]),
    );
    await pdb.withPlatformTx(as(loner, id), (tx) => tx.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1, $2)`, [loner, id]));
    expect((await pdb.withPlatformTx(as(loner, id), (tx) => tx.query(`select slug from public.club`))).rows).toEqual([{ slug: 'new' }]);
    await expect(pdb.withPlatformTx(as(loner, OTHER), (tx) => tx.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1, $2)`, [loner, OTHER]))).rejects.toThrow(/row-level security/i);
    await expect(pdb.withPlatformTx(as(loner, id), (tx) => tx.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1, $2)`, [spec, id]))).rejects.toThrow(/row-level security/i);
  });
});
