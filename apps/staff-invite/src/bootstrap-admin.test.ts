import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { bootstrapFirstAdmin, type OwnerDb } from './bootstrap-admin';
import type { SupabaseAdmin } from './handler';

// D163: the first admin. Runs as the database owner role, with a fake provider; nothing is created without every argument,
// a second run (or a run on a live team) changes nothing, and the link is in no log.
let tdb: TestDatabase;
let calls: string[];
let providerDown: boolean;

const admin: SupabaseAdmin = {
  async inviteUser(email) {
    calls.push(`invite:${email}`);
    if (providerDown) throw new Error('down');
    return { authUserId: 'aaaaaaaa-1111-4111-8111-' + String(calls.length).padStart(12, '0') };
  },
  async deleteUser(id) { calls.push(`delete:${id}`); },
  async resetFactors() {},
  async banUser() {},
  async emailOf() { return null; },
  async setPassword() { return 'ok'; },
  async removeUnverifiedFactors() {},
};

// The owner role, as DevOps connects: a transaction with the role set, so grants matter as they will in production.
const owner = (): OwnerDb => ({
  async transaction(fn) {
    const client = await tdb.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role booq_owner');
      const out = await fn({ query: (text, params) => client.query(text, params as unknown[]) as never });
      await client.query('commit');
      return out;
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  },
});
const input = { email: 'first@booq.example', displayName: 'First Admin', ttlHours: 24, consoleBaseUrl: 'https://console.example/' };
const run = (over: Partial<typeof input> = {}) => bootstrapFirstAdmin({ db: owner(), admin }, { ...input, ...over });
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const staff = async () => (await tdb.query('select email, display_name, role, active from platform.platform_staff')).rows;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  calls = [];
  providerDown = false;
});
afterEach(async () => tdb.close());

describe('the first admin', () => {
  it('creates the admin and the provider user, and returns one link whose hash is the only thing stored', async () => {
    const r = await run();
    if (!r.ok) throw new Error(r.code);
    expect(await staff()).toEqual([{ email: 'first@booq.example', display_name: 'First Admin', role: 'platform_admin', active: true }]);
    expect(calls).toEqual(['invite:first@booq.example']);
    expect(r.enrolmentLink).toMatch(/^https:\/\/console\.example\/enrol#[A-Za-z0-9_-]{40,}$/);
    const token = r.enrolmentLink.split('#')[1]!;
    const rows = (await tdb.query('select token_hash, staff_id, purpose, expires_at, used_at from platform.staff_enrolment')).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ token_hash: sha(token), staff_id: r.staffId, purpose: 'invite', used_at: null });
    expect(rows[0].expires_at.toISOString()).toBe('2026-12-02T03:00:00.000Z');
    expect(r.expiresAt).toBe('2026-12-02T03:00:00.000Z');
  });

  it('the link opens the enrolment of this admin (the console would accept it), and the setting is left unset', async () => {
    const r = await run();
    if (!r.ok) throw new Error(r.code);
    const token = r.enrolmentLink.split('#')[1]!;
    const open = (await tdb.query('select staff_id, display_name from platform.staff_enrolment_open($1)', [sha(token)])).rows;
    expect(open).toEqual([{ staff_id: r.staffId, display_name: 'First Admin' }]);
    expect((await tdb.query(`select 1 from platform.config where key = 'console_enrolment_ttl_hours'`)).rows).toEqual([]);
  });

  it('writes P6 with the facts and never the link', async () => {
    const r = await run();
    if (!r.ok) throw new Error(r.code);
    const log = (await tdb.query(`select action, staff_name_at_time as name, target_id, detail from platform.audit_log`)).rows;
    expect(log).toEqual([{ action: 'staff.bootstrapped', name: 'First Admin', target_id: r.staffId, detail: { role: 'platform_admin', ttl_hours: 24 } }]);
    expect(JSON.stringify(log)).not.toContain(r.enrolmentLink.split('#')[1]);
  });

  it('refuses a second time: nothing new is created at the provider or in the database', async () => {
    await run();
    calls = [];
    const again = await run({ email: 'second@booq.example' });
    expect(again).toEqual({ ok: false, code: 'admin_exists' });
    expect(calls).toEqual([]);
    expect((await staff()).length).toBe(1);
    expect((await tdb.query('select count(*)::int as n from platform.staff_enrolment')).rows[0].n).toBe(1);
    expect((await tdb.query(`select count(*)::int as n from platform.audit_log where action = 'staff.bootstrapped'`)).rows[0].n).toBe(1);
  });

  it('refuses while any active admin exists, but runs again if every admin is deactivated', async () => {
    await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ('99999999-0000-4000-8000-000000000001','old@booq.example','Old','platform_admin')`);
    expect(await run()).toEqual({ ok: false, code: 'admin_exists' });
    await tdb.query(`update platform.platform_staff set active = false`);
    expect((await run()).ok).toBe(true);
  });

  it('a specialist alone does not stop it; an email that is already a teammate does', async () => {
    await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role, active) values ('99999999-0000-4000-8000-000000000002','first@booq.example','Sam','onboarding_specialist', false)`);
    expect(await run()).toEqual({ ok: false, code: 'email_taken' });
    expect(calls).toEqual([]);
    expect((await run({ email: 'other@booq.example' })).ok).toBe(true);
  });

  it('two runs at the same moment make one admin', async () => {
    const [a, b] = await Promise.all([run({ email: 'a@booq.example' }), run({ email: 'b@booq.example' })]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect((await staff()).length).toBe(1);
  });

  it('nothing is created without every argument: a bad email, name, link life or console address', async () => {
    for (const bad of [{ email: 'nope' }, { email: '' }, { displayName: '  ' }, { ttlHours: 0 }, { ttlHours: -1 }, { ttlHours: Number.NaN }, { ttlHours: 24 * 366 }, { consoleBaseUrl: 'http://console.example' }, { consoleBaseUrl: '' }]) {
      expect(await run(bad), JSON.stringify(bad)).toEqual({ ok: false, code: 'bad_input' });
    }
    expect(calls).toEqual([]);
    expect(await staff()).toEqual([]);
  });

  it('a provider that fails creates nothing; a database failure after the provider removes the provider user again', async () => {
    providerDown = true;
    expect(await run()).toEqual({ ok: false, code: 'provider_failed' });
    expect(await staff()).toEqual([]);
    providerDown = false;
    calls = [];
    // Break the step after the provider call: the audit writer refuses an unknown action? Use a conflicting enrolment hash instead.
    await tdb.query(`alter table platform.staff_enrolment add constraint test_always_fails check (false) not valid`);
    await expect(run()).rejects.toThrow();
    expect(calls.map((c) => c.split(':')[0])).toEqual(['invite', 'delete']);
    expect(await staff()).toEqual([]);
  });
});
