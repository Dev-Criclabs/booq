import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlatformDb, type PlatformDb } from './platform-tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// Migration 0055: single-use first-factor links for BOOQ staff (ROLE-02-AC1, AC4, D123, D148).
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
let tdb: TestDatabase;
let pdb: PlatformDb;
let admin: string;
let spec: string;
const ctx = (staffId: string) => ({ staffId, staffLabel: 'x' });
const issue = (who: string, target: string, hash: string, purpose = 'invite') =>
  pdb.withPlatformTx(ctx(who), (tx) => tx.query('select platform.issue_staff_enrolment($1,$2,$3) as e', [target, hash, purpose]));
const open = (hash: string) => pdb.withPlatformTx({ staffId: null }, async (tx) => (await tx.query('select * from platform.staff_enrolment_open($1)', [hash])).rows);
const finish = (who: string, hash: string) => pdb.withPlatformTx(ctx(who), async (tx) => (await tx.query('select platform.staff_enrolment_finish($1) as ok', [hash])).rows[0]!.ok as boolean);
const p6 = async () => (await tdb.query(`select action, detail from platform.audit_log where action like 'staff.enrol%' order by occurred_at, id`)).rows;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  const mk = async (email: string, role: string, auth: string) => (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1,$2,$2,$3) returning id`, [auth, email, role])).rows[0].id as string;
  admin = await mk('admin@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000001');
  spec = await mk('spec@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000002');
  pdb = createPlatformDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await pdb.end();
  await tdb.close();
});
const ttl = (hours: unknown) => tdb.query(`insert into platform.config (key, value) values ('console_enrolment_ttl_hours', $1::jsonb) on conflict (key) do update set value = excluded.value`, [JSON.stringify(hours)]);

describe('issuing a link', () => {
  it('needs the setting; none is shipped', async () => {
    await expect(issue(admin, spec, H1)).rejects.toThrow(/enrolment:not_configured/);
    await ttl('soon');
    await expect(issue(admin, spec, H1)).rejects.toThrow(/enrolment:not_configured/);
    await ttl(0);
    await expect(issue(admin, spec, H1)).rejects.toThrow(/enrolment:not_configured/);
  });
  it('is admin only, for an active member, with a well formed hash and purpose', async () => {
    await ttl(24);
    await expect(issue(spec, admin, H1)).rejects.toThrow(/enrolment:forbidden/);
    await expect(issue(admin, '99999999-9999-4999-8999-999999999999', H1)).rejects.toThrow(/enrolment:not_found/);
    await tdb.query(`update platform.platform_staff set active = false where id = $1`, [spec]);
    await expect(issue(admin, spec, H1)).rejects.toThrow(/enrolment:not_found/);
    await expect(issue(admin, admin, 'short')).rejects.toThrow(/enrolment:invalid/);
    await expect(issue(admin, admin, H1, 'other')).rejects.toThrow(/enrolment:invalid/);
  });
  it('lives for the configured hours, only one link is live per member, and P6 holds the purpose and never the token', async () => {
    await ttl(24);
    const e = (await issue(admin, spec, H1)).rows[0]!.e as Date;
    expect(e.toISOString()).toBe('2026-12-02T03:00:00.000Z');
    await issue(admin, spec, H2, 'reset');
    expect(await open(H1)).toEqual([]);
    expect(await open(H2)).toHaveLength(1);
    const log = JSON.stringify(await p6());
    expect(log).toContain('staff.enrolment_issued');
    expect(log).toContain('reset');
    expect(log).not.toContain(H1);
    expect(log).not.toContain(H2);
  });
});

describe('opening and finishing a link', () => {
  beforeEach(async () => {
    await ttl(24);
    await issue(admin, spec, H1);
  });
  it('opens before sign-in to the member behind it, until it expires', async () => {
    expect(await open(H1)).toMatchObject([{ staff_id: spec, auth_user_id: '99999999-0000-4000-8000-000000000002' }]);
    expect(await open(H2)).toEqual([]);
    await tdb.advance('24 hours 1 minute');
    expect(await open(H1)).toEqual([]);
    expect(await finish(spec, H1)).toBe(false);
  });
  it('is used once, only by the member it was issued for, and logged', async () => {
    expect(await finish(admin, H1)).toBe(false); // somebody else's link
    expect(await open(H1)).toHaveLength(1);
    expect(await finish(spec, H1)).toBe(true);
    expect(await finish(spec, H1)).toBe(false);
    expect(await open(H1)).toEqual([]);
    expect((await p6()).map((r) => r.action).sort()).toEqual(['staff.enrolled', 'staff.enrolment_issued']); // the test clock is frozen: equal times have no fixed order
  });
  it('a deactivated member cannot use a link', async () => {
    await tdb.query(`update platform.platform_staff set active = false where id = $1`, [spec]);
    expect(await open(H1)).toEqual([]);
    expect(await finish(spec, H1)).toBe(false);
  });
  it('the console role cannot read or change the table itself', async () => {
    for (const sql of ['select * from platform.staff_enrolment', 'delete from platform.staff_enrolment', `update platform.staff_enrolment set used_at = now()`]) {
      await expect(pdb.withPlatformTx(ctx(admin), (tx) => tx.query(sql))).rejects.toThrow(/permission denied/);
    }
  });
});
