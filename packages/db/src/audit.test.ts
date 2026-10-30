import type { PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectRegistry } from './registry';
import { checkTableClasses } from './registry/check';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F01-T10 / migration 0005: audit entries (F01 design 8; FA 8.1; PLAT-04-AC1, AC2, AC6, AC11;
// SR-04, D104). The context settings (app.source, app.actor_label ...) are set by hand here;
// F01-T11 makes withClubTx set them.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const USER = '11111111-2222-4333-8444-555555555555';
const STAFF = '77777777-7777-4777-8777-777777777777';
const SESSION = '88888888-8888-4888-8888-888888888888';

let tdb: TestDatabase;

beforeEach(async () => {
  tdb = await createTestDatabase();
  // Fixture clubs are inserted without triggers so the tests see only the entries they cause.
  const c = await tdb.pool.connect();
  try {
    await c.query('set session_replication_role = replica');
    await c.query(`insert into public.club (id, slug, name_th, name_en) values ($1, 'club-a', 'ก', 'Club A'), ($2, 'club-b', 'ข', 'Club B')`, [A, B]);
    await c.query('set session_replication_role = origin');
  } finally {
    c.release();
  }
});
afterEach(async () => {
  await tdb.close();
});

/** Run fn in one transaction as the given role with the given context settings. */
async function as<T>(role: string | null, settings: Record<string, string>, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    if (role) await c.query(`set local role ${role}`);
    for (const [k, v] of Object.entries(settings)) await c.query('select set_config($1, $2, true)', [k, v]);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const owner = { 'app.club_id': A, 'app.user_id': USER, 'app.roles': 'owner', 'app.source': 'admin', 'app.actor_label': 'Nok' };
const entries = async (where = 'true') =>
  (await tdb.query(`select * from public.audit_entry where ${where} order by seq`)).rows;

describe('one entry per audited change, same transaction (PLAT-04-AC1, AC2)', () => {
  it('insert, update and delete each write one entry with the changed columns only', async () => {
    await as('booq_app', owner, async (c) => {
      await c.query(`insert into public.club_setting (club_id, key, value) values ($1, 'hold', '{"minutes":15}')`, [A]);
      await c.query(`update public.club_setting set value = '{"minutes":20}' where key = 'hold'`);
      await c.query(`delete from public.club_setting where key = 'hold'`);
    });
    const rows = await entries("record_type = 'club_setting'");
    expect(rows.map((r) => r.action)).toEqual(['insert', 'update', 'delete']);
    const [ins, upd, del] = rows;
    expect(ins).toMatchObject({ club_id: A, record_key: 'hold', old_value: null, actor_type: 'club_user', actor_user_id: USER, actor_label: 'Nok', source: 'admin' });
    expect(ins.new_value).toMatchObject({ key: 'hold', value: { minutes: 15 } });
    expect(upd.old_value).toEqual({ value: { minutes: 15 } });
    expect(upd.new_value).toEqual({ value: { minutes: 20 } });
    expect(del.new_value).toBeNull();
    expect(del.old_value).toMatchObject({ value: { minutes: 20 } });
    expect(new Set(rows.map((r) => r.record_id)).size).toBe(1);
  });

  it('an update that changes nothing writes nothing', async () => {
    await as('booq_app', owner, (c) => c.query(`insert into public.club_setting (club_id, key, value) values ($1, 'k', '1')`, [A]));
    await tdb.query('select 1');
    const before = (await entries()).length;
    await as('booq_app', owner, (c) => c.query(`update public.club_setting set value = '1' where key = 'k'`));
    expect((await entries()).length).toBe(before);
  });

  it('a rolled back change leaves no entry', async () => {
    await expect(
      as('booq_app', owner, async (c) => {
        await c.query(`insert into public.club_setting (club_id, key, value) values ($1, 'k', '1')`, [A]);
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');
    expect(await entries("record_type = 'club_setting'")).toEqual([]);
  });

  it('a change whose audit entry cannot be written is rolled back', async () => {
    // A club user with no source cannot be recorded, so the change is refused.
    await expect(
      as('booq_app', { ...owner, 'app.source': '' }, (c) => c.query(`insert into public.club_setting (club_id, key, value) values ($1, 'k', '1')`, [A])),
    ).rejects.toThrow(/audit/i);
    expect((await tdb.query('select count(*)::int as n from public.club_setting')).rows[0].n).toBe(0);
  });

  it('every audited table of migration 0002 has an entry on insert', async () => {
    await as('booq_app', owner, async (c) => {
      await c.query(`insert into public.club_feature (club_id, feature_key, enabled) values ($1, 'coach_add_at_checkout', true)`, [A]);
      await c.query(`insert into public.location (club_id, id, name) values ($1, gen_random_uuid(), 'Main')`, [A]);
      await c.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1, 1, '06:00', '24:00')`, [A]);
      await c.query(`update public.club set name_en = 'Renamed'`);
    });
    const types = (await entries()).map((r) => r.record_type).sort();
    expect(types).toEqual(['club', 'club_feature', 'location', 'opening_hours']);
  });
});

describe('who and when (PLAT-04-AC11)', () => {
  it('a job with no user is a system actor', async () => {
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1, 'k', '1')`, [A]);
    expect((await entries("record_type = 'club_setting'"))[0]).toMatchObject({ actor_type: 'system', source: 'job', actor_label: 'system', actor_user_id: null });
  });

  it('a platform edit names the BOOQ staff member and the support session', async () => {
    await as(null, { 'app.club_id': A, 'app.actor_platform_staff_id': STAFF, 'app.actor_label': 'BOOQ staff: Mali', 'app.support_session_id': SESSION, 'app.reason': 'fix typo' }, (c) =>
      c.query(`insert into public.club_setting (club_id, key, value) values ($1, 'k', '1')`, [A]),
    );
    expect((await entries("record_type = 'club_setting'"))[0]).toMatchObject({
      actor_type: 'platform_staff', actor_platform_staff_id: STAFF, actor_user_id: null, actor_label: 'BOOQ staff: Mali', support_session_id: SESSION, source: 'platform', reason: 'fix typo',
    });
  });

  it('the time comes from the clock (10:00 in Bangkok for 03:00 UTC)', async () => {
    await tdb.setNow('2026-12-29T03:00:00Z');
    await as('booq_app', owner, (c) => c.query(`insert into public.club_setting (club_id, key, value) values ($1, 'k', '1')`, [A]));
    // The roles carry TimeZone=Asia/Bangkok (roles.test); the stored instant is what matters here.
    const r = await tdb.query(
      `select to_char(occurred_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') as bangkok from public.audit_entry where record_type = 'club_setting'`,
    );
    expect(r.rows[0].bangkok).toBe('2026-12-29 10:00');
  });
});

describe('append-only (PLAT-04-AC6)', () => {
  beforeEach(async () => {
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1, 'k', '1')`, [A]);
  });
  for (const role of [null, 'booq_owner', 'booq_app', 'booq_worker', 'booq_platform', 'booq_anonymiser']) {
    it(`update, delete and truncate of audit_entry fail for ${role ?? 'the superuser'}`, async () => {
      for (const sql of [`update public.audit_entry set action = 'x'`, 'delete from public.audit_entry', 'truncate public.audit_entry']) {
        // Either refused, or (a role with no update policy) matches no rows; the data never changes.
        const out = await as(role, { 'app.club_id': A }, (c) => c.query(sql)).then((r) => r.rowCount ?? 0, (e: Error) => e.message);
        expect(typeof out === 'string' ? out : '', sql).toMatch(out === 0 ? /^$/ : /append-only|permission denied|row-level security/i);
        expect((await tdb.query('select count(*)::int as n, count(*) filter (where action = \'x\')::int as x from public.audit_entry')).rows[0], sql).toMatchObject({ x: 0 });
        expect((await tdb.query('select count(*)::int as n from public.audit_entry')).rows[0].n, sql).toBeGreaterThan(0);
      }
    });
  }

  it('app roles cannot insert an entry directly', async () => {
    for (const role of ['booq_app', 'booq_worker', 'booq_platform', 'booq_owner']) {
      await expect(
        as(role, { 'app.club_id': A }, (c) =>
          c.query(`insert into public.audit_entry (club_id, actor_type, actor_label, source, action, record_type, record_id) values ($1, 'system', 'x', 'job', 'insert', 'club', gen_random_uuid())`, [A]),
        ),
        role,
      ).rejects.toThrow(/permission denied|row-level security/i);
    }
  });
});

describe('reading (PLAT-04, owner only; BOOQ staff never)', () => {
  beforeEach(async () => {
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1, 'k', '1'), ($2, 'k', '2')`, [A, B]);
  });
  it('the owner reads own club entries only; other roles read none; the platform role has no privilege', async () => {
    const read = (roles: string, club = A) => as('booq_app', { ...owner, 'app.club_id': club, 'app.roles': roles }, (c) => c.query('select club_id from public.audit_entry'));
    expect((await read('owner')).rows.every((r) => r.club_id === A)).toBe(true);
    expect((await read('owner')).rows.length).toBeGreaterThan(0);
    for (const roles of ['front_desk', 'accountant', 'coach', 'player']) expect((await read(roles)).rows, roles).toEqual([]);
    await expect(as('booq_platform', { 'app.club_id': A }, (c) => c.query('select * from public.audit_entry'))).rejects.toThrow(/permission denied/i);
  });
});

describe('personal values live in pii_old and pii_new only (SR-04, D104)', () => {
  it('an owner contact change is recorded in the pii columns, not in old_value or new_value', async () => {
    await as('booq_app', owner, (c) => c.query(`update public.club set owner_phone = '0812345678', owner_name = 'Somchai', name_en = 'Club A2'`));
    const e = (await entries("record_type = 'club' and action = 'update'"))[0];
    expect(e.new_value).toEqual({ name_en: 'Club A2' });
    expect(e.pii_new).toEqual({ owner_phone: '0812345678', owner_name: 'Somchai' });
    expect(e.pii_old).toEqual({ owner_phone: null, owner_name: null });
    expect(JSON.stringify([e.old_value, e.new_value])).not.toContain('0812345678');
  });

  it('anonymising replaces the values, leaves every other column, and writes an audit_erasure row', async () => {
    await as('booq_app', owner, (c) => c.query(`update public.club set owner_phone = 'MARKER-0812345678'`));
    const before = (await entries("record_type = 'club'"))[0];
    const n = await as('booq_owner', { 'app.club_id': A }, async (c) => (await c.query(`select audit.erase_pii('club', $1) as n`, [A])).rows[0].n);
    expect(n).toBeGreaterThan(0);
    const rows = await entries("record_type = 'club'");
    expect(JSON.stringify(rows)).not.toContain('MARKER-0812345678');
    const after = rows[0];
    const strip = ({ pii_old, pii_new, ...rest }: Record<string, unknown>) => rest;
    expect(strip(after)).toEqual(strip(before));
    expect(after.pii_new).toEqual({ owner_phone: '[erased]' });
    const er = (await tdb.query('select * from public.audit_erasure')).rows;
    expect(er).toHaveLength(1);
    expect(er[0]).toMatchObject({ club_id: A, record_type: 'club', record_id: A, entries_changed: n });
    await expect(tdb.query('update public.audit_erasure set entries_changed = 0')).rejects.toThrow(/append-only/i);
  });

  it('no role can change the pii columns except through the function', async () => {
    await as('booq_app', owner, (c) => c.query(`update public.club set owner_phone = '0812345678'`));
    for (const role of [null, 'booq_owner', 'booq_app', 'booq_worker', 'booq_platform']) {
      const out = await as(role, { 'app.club_id': A }, (c) => c.query(`update public.audit_entry set pii_new = '{}'`)).then((r) => r.rowCount ?? 0, (e: Error) => e.message);
      expect(typeof out === 'string' ? out : '', String(role)).toMatch(out === 0 ? /^$/ : /append-only|permission denied|row-level security/i);
    }
    expect((await entries("record_type = 'club'"))[0]?.pii_new).toEqual({ owner_phone: '0812345678' });
    // even the anonymiser role may only write the placeholder
    await expect(as('booq_anonymiser', { 'app.club_id': A }, (c) => c.query(`update public.audit_entry set pii_new = '{"owner_phone":"x"}' where pii_new is not null`))).rejects.toThrow(/append-only|erase/i);
  });

  it('the app roles cannot call the erase function or the writer directly', async () => {
    for (const role of ['booq_app', 'booq_worker', 'booq_platform']) {
      await expect(as(role, { 'app.club_id': A }, (c) => c.query(`select audit.erase_pii('club', $1)`, [A])), role).rejects.toThrow(/permission denied/i);
      await expect(as(role, { 'app.club_id': A }, (c) => c.query(`select audit.write($1, 'x', 'club', $1, null, null, null, null, null)`, [A])), role).rejects.toThrow(/permission denied/i);
    }
  });
});

describe('audit.note (events that are not a row change)', () => {
  it('writes an entry for the club in the context, never for a club passed in', async () => {
    await as('booq_platform', { 'app.club_id': A, 'app.actor_platform_staff_id': STAFF, 'app.actor_label': 'BOOQ staff: Mali' }, (c) =>
      c.query(`select audit.note('support_session.opened', 'support_session', $1, '{"mode":"look"}')`, [SESSION]),
    );
    expect((await entries("action = 'support_session.opened'"))[0]).toMatchObject({ club_id: A, record_id: SESSION, new_value: { mode: 'look' }, actor_type: 'platform_staff' });
  });
  it('fails with no club in the context', async () => {
    await expect(as('booq_app', {}, (c) => c.query(`select audit.note('x', 'club', $1)`, [A]))).rejects.toThrow(/club/i);
  });
});

describe('audit registry (FA 8.1)', () => {
  it('lists every audited table with its trigger, and the table classes are consistent', async () => {
    const reg = (await tdb.query(`select table_schema || '.' || table_name as t from audit.registry order by 1`)).rows.map((r) => r.t);
    // Every feature adds its own tables; this test pins the F01 ones and that the lists agree.
    for (const t of ['public.club', 'public.club_feature', 'public.club_pause', 'public.club_setting', 'public.club_status_change', 'public.location', 'public.opening_hours', 'public.resource']) {
      expect(reg).toContain(t);
    }
    const trig = (await tdb.query(`select c.relname from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.tgname = 'audit_row' and not t.tgisinternal order by 1`)).rows.map((r) => r.relname);
    expect(trig).toEqual(reg.map((t) => t.replace('public.', '')));
    const result = await checkTableClasses(tdb.pool, await collectRegistry());
    expect(result.problems.filter((p) => p.table !== 'app.test_clock')).toEqual([]);
  });
});
