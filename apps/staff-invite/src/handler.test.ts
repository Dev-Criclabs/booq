import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signInternalCall } from '@booq/auth';
import { createPlatformDb, type PlatformDb } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { createStaffInviteHandler, type SupabaseAdmin } from './handler';

// F01-T17b: the one place that can invite, reset a second factor for, and deactivate BOOQ staff (ROLE-02-AC4 to AC6, SR-06, D123, D148).
// Every call is signed by apps/platform, checked against the database (the actor must be an active platform admin), and logged to P6.
const SECRET = 'shared-between-the-two-apps';
const NOW = new Date('2026-10-30T10:00:00Z');
let tdb: TestDatabase;
let pdb: PlatformDb;
let admin: string;
let admin2: string;
let spec: string;
let calls: string[];
let failNext: string | null;

const fake: SupabaseAdmin = {
  async inviteUser(email) {
    calls.push(`invite:${email}`);
    if (failNext === 'invite') throw new Error('provider down');
    return { authUserId: 'aaaaaaaa-1111-4111-8111-' + String(calls.length).padStart(12, '0') };
  },
  async resetFactors(authUserId) { calls.push(`reset:${authUserId}`); if (failNext === 'reset') throw new Error('provider down'); },
  async banUser(authUserId) { calls.push(`ban:${authUserId}`); if (failNext === 'ban') throw new Error('provider down'); },
  async deleteUser(authUserId) { calls.push(`delete:${authUserId}`); },
};
const staff = async (email: string, role: string, auth: string, name: string) =>
  (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1,$2,$3,$4) returning id`, [auth, email, name, role])).rows[0].id as string;
const handler = () => createStaffInviteHandler({ admin: fake, db: pdb, signingSecret: SECRET, maxSkewSeconds: 30, maxBodyBytes: 10_000, now: () => NOW });
const call = (path: string, body: unknown, over: { secret?: string; at?: Date; raw?: string } = {}) => {
  const raw = over.raw ?? JSON.stringify(body);
  return handler()(new Request('https://staff-invite.internal' + path, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', ...signInternalCall(over.secret ?? SECRET, over.at ?? NOW, raw) } }));
};
const p6 = async () => (await tdb.query(`select action, staff_name_at_time as name, target_id, detail from platform.audit_log order by occurred_at, id`)).rows;

beforeEach(async () => {
  tdb = await createTestDatabase();
  admin = await staff('admin@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000001', 'Ada Admin');
  admin2 = await staff('admin2@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000004', 'Bo Admin');
  spec = await staff('spec@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000002', 'Sam Specialist');
  pdb = createPlatformDb({ connectionString: tdb.url, max: 2 });
  calls = [];
  failNext = null;
});
afterEach(async () => {
  await pdb.end();
  await tdb.close();
});

describe('who may call', () => {
  it('a wrong secret, a missing signature, a stale timestamp or a changed body is 401 and nothing happens', async () => {
    const body = { actorStaffId: admin, stepUpFresh: true, email: 'new@booq.example', displayName: 'New', role: 'onboarding_specialist' };
    expect((await call('/invite', body, { secret: 'other' })).status).toBe(401);
    expect((await call('/invite', body, { at: new Date(NOW.getTime() - 120_000) })).status).toBe(401);
    const unsigned = await handler()(new Request('https://x/invite', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
    expect(unsigned.status).toBe(401);
    expect(calls).toEqual([]);
    expect(await p6()).toEqual([]);
  });

  it('the actor must be an active platform admin: a specialist, an unknown id and a deactivated admin are 403', async () => {
    const mk = (actorStaffId: string) => ({ actorStaffId, stepUpFresh: true, email: 'new@booq.example', displayName: 'New', role: 'onboarding_specialist' });
    expect((await call('/invite', mk(spec))).status).toBe(403);
    expect((await call('/invite', mk('aaaaaaaa-0000-4000-8000-0000000000ff'))).status).toBe(403);
    await tdb.query(`update platform.platform_staff set active = false where id = $1`, [admin2]);
    expect((await call('/invite', mk(admin2))).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('every call needs a fresh second factor on the actor (SR-16): the platform says so, and a stale one is 401 step_up_required', async () => {
    const r = await call('/invite', { actorStaffId: admin, stepUpFresh: false, email: 'new@booq.example', displayName: 'New', role: 'onboarding_specialist' });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ code: 'step_up_required' });
    expect(calls).toEqual([]);
  });

  it('only POST on the three paths; an unknown path is 404 and a body that is not an object is 400', async () => {
    expect((await call('/nope', {})).status).toBe(404);
    expect((await handler()(new Request('https://x/invite', { method: 'GET' }))).status).toBe(405);
    expect((await call('/invite', null, { raw: '[1]' })).status).toBe(400);
    expect((await call('/invite', null, { raw: '{nope' })).status).toBe(400);
  });
});

describe('invite', () => {
  const body = { actorStaffId: '', stepUpFresh: true, email: 'new@booq.example', displayName: 'New Person', role: 'onboarding_specialist' };
  it('asks the provider to invite, records the new staff member, and writes P6 with the role and not the email', async () => {
    const r = await call('/invite', { ...body, actorStaffId: admin });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { staffId: string };
    expect((await tdb.query(`select email, display_name, role, active, auth_user_id from platform.platform_staff where id = $1`, [j.staffId])).rows[0]).toMatchObject({ email: 'new@booq.example', display_name: 'New Person', role: 'onboarding_specialist', active: true });
    expect(calls).toEqual(['invite:new@booq.example']);
    const log = await p6();
    expect(log).toEqual([{ action: 'staff.invited', name: 'Ada Admin', target_id: j.staffId, detail: { role: 'onboarding_specialist' } }]);
    expect(JSON.stringify(log)).not.toContain('new@booq.example');
  });
  it('validates the body: an email, a name, a role of the two; extra fields are refused', async () => {
    for (const bad of [{ email: 'nope' }, { displayName: '' }, { role: 'owner' }, { extra: 1 }]) {
      expect((await call('/invite', { ...body, actorStaffId: admin, ...bad })).status, JSON.stringify(bad)).toBe(400);
    }
    expect(calls).toEqual([]);
  });
  it('an email already on the team is 409 and the provider is not called', async () => {
    expect((await call('/invite', { ...body, actorStaffId: admin, email: 'SPEC@booq.example' })).status).toBe(409);
    expect(calls).toEqual([]);
  });
  it('a provider failure is 502 with nothing recorded; a database failure afterwards removes the provider user again', async () => {
    failNext = 'invite';
    expect((await call('/invite', { ...body, actorStaffId: admin })).status).toBe(502);
    expect(await p6()).toEqual([]);
    failNext = null;
    await tdb.query(`create or replace function platform.write_audit(p_action text, p_club uuid, p_target_type text, p_target_id text, p_detail jsonb, p_reason text, p_support_session uuid) returns void language plpgsql as $$ begin raise exception 'p6 down'; end $$`);
    const r = await call('/invite', { ...body, actorStaffId: admin, email: 'third@booq.example' });
    expect(r.status).toBe(500);
    expect(calls.filter((c) => c.startsWith('delete:'))).toHaveLength(1);
    expect((await tdb.query(`select count(*)::int as n from platform.platform_staff where email = 'third@booq.example'`)).rows[0].n).toBe(0);
  });
});

describe('reset the second factor (D123)', () => {
  it('another admin resets it: the provider drops the factors, P6 names both people', async () => {
    const r = await call('/reset-factor', { actorStaffId: admin, stepUpFresh: true, targetStaffId: spec });
    expect(r.status).toBe(200);
    expect(calls).toEqual(['reset:99999999-0000-4000-8000-000000000002']);
    expect(await p6()).toEqual([{ action: 'staff.factor_reset', name: 'Ada Admin', target_id: spec, detail: { target_name: 'Sam Specialist' } }]);
  });
  it('the same admin resetting their own factor is refused (409 same_person) and nothing is called or logged as done', async () => {
    const r = await call('/reset-factor', { actorStaffId: admin, stepUpFresh: true, targetStaffId: admin });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ code: 'same_person' });
    expect(calls).toEqual([]);
    expect((await p6()).map((x) => x.action)).toEqual(['staff.factor_reset_refused']);
  });
  it('an unknown or deactivated target is 404', async () => {
    expect((await call('/reset-factor', { actorStaffId: admin, stepUpFresh: true, targetStaffId: 'aaaaaaaa-0000-4000-8000-0000000000ff' })).status).toBe(404);
    await tdb.query(`update platform.platform_staff set active = false where id = $1`, [spec]);
    expect((await call('/reset-factor', { actorStaffId: admin, stepUpFresh: true, targetStaffId: spec })).status).toBe(404);
    expect(calls).toEqual([]);
  });
  it('a provider failure is 502 and no done entry is written', async () => {
    failNext = 'reset';
    expect((await call('/reset-factor', { actorStaffId: admin, stepUpFresh: true, targetStaffId: spec })).status).toBe(502);
    expect((await p6()).map((x) => x.action)).not.toContain('staff.factor_reset');
  });
});

describe('deactivate (ROLE-02-AC4)', () => {
  it('marks the member inactive, bans them at the provider and writes P6', async () => {
    const r = await call('/deactivate', { actorStaffId: admin, stepUpFresh: true, targetStaffId: spec });
    expect(r.status).toBe(200);
    expect((await tdb.query(`select active from platform.platform_staff where id = $1`, [spec])).rows[0].active).toBe(false);
    expect(calls).toEqual(['ban:99999999-0000-4000-8000-000000000002']);
    expect(await p6()).toEqual([{ action: 'staff.deactivated', name: 'Ada Admin', target_id: spec, detail: { target_name: 'Sam Specialist' } }]);
  });
  it('never yourself, and never the last active admin', async () => {
    expect((await call('/deactivate', { actorStaffId: admin, stepUpFresh: true, targetStaffId: admin })).status).toBe(409);
    await call('/deactivate', { actorStaffId: admin, stepUpFresh: true, targetStaffId: admin2 });
    const last = await call('/deactivate', { actorStaffId: admin, stepUpFresh: true, targetStaffId: admin });
    expect(last.status).toBe(409);
    expect((await tdb.query(`select active from platform.platform_staff where id = $1`, [admin])).rows[0].active).toBe(true);
  });
  it('if the provider fails the member is still inactive here (sign in is refused) and the answer is 502', async () => {
    failNext = 'ban';
    const r = await call('/deactivate', { actorStaffId: admin, stepUpFresh: true, targetStaffId: spec });
    expect(r.status).toBe(502);
    expect((await tdb.query(`select active from platform.platform_staff where id = $1`, [spec])).rows[0].active).toBe(false);
  });
  it('an unknown target is 404', async () => {
    expect((await call('/deactivate', { actorStaffId: admin, stepUpFresh: true, targetStaffId: 'aaaaaaaa-0000-4000-8000-0000000000ff' })).status).toBe(404);
  });
});
