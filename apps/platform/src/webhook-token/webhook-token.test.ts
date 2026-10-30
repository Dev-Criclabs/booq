import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashInviteToken } from '@booq/auth';
import { createPlatformDb, type PlatformDb } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { createWebhookTokenService } from './webhook-token';

// F02-T17 follow-up: BOOQ staff make or replace the webhook token of a club's LINE or Beam connection (F02 design 5.4; FA 6.5).
// The plain token and the full address are shown once; only the hash is stored. Admin plus a fresh second factor; audited.
const TEST = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LIVE = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const BASE = 'https://app.booq.example';
let tdb: TestDatabase;
let pdb: PlatformDb;
let svc: ReturnType<typeof createWebhookTokenService>;
let admin: string;
let spec: string;

const staff = async (email: string, role: string, auth: string, name: string) =>
  (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1,$2,$3,$4) returning id`, [auth, email, name, role])).rows[0].id as string;
const issue = (who: string, kind: unknown, over: { fresh?: boolean; club?: string } = {}) =>
  svc.issue({ staffId: who, stepUpFresh: over.fresh ?? true }, over.club ?? TEST, kind);
const hashOf = async (table: string, col: string, club = TEST) => (await tdb.query(`select ${col} as h from public.${table} where club_id = $1`, [club])).rows[0]?.h ?? null;
const p6 = async () => (await tdb.query(`select action, staff_name_at_time as name, club_id, detail from platform.audit_log where action = 'club.webhook_token_issued' order by occurred_at, id`)).rows;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'testing','ข','Testing','testing'), ($2,'live','ก','Live','live')`, [TEST, LIVE]);
  admin = await staff('admin@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000001', 'Ada Admin');
  spec = await staff('spec@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000002', 'Sam Specialist');
  await tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1,$2)`, [spec, TEST]);
  pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
  svc = createWebhookTokenService({ db: pdb, baseUrl: BASE + '/' });
});
afterEach(async () => {
  await pdb.end();
  await tdb.close();
});

describe('issuing a webhook token', () => {
  it('LINE: returns the token and the full address once; the table holds only the hash', async () => {
    const r = await issue(admin, 'line');
    expect(r).toMatchObject({ ok: true, replaced: false });
    const { token, url } = r as { token: string; url: string };
    expect(url).toBe(`${BASE}/api/webhooks/line/${token}`);
    expect(await hashOf('line_connection', 'webhook_token_hash')).toBe(hashInviteToken(token));
    expect(JSON.stringify((await tdb.query(`select * from public.line_connection`)).rows)).not.toContain(token);
  });

  it('Beam test and live sets are separate tokens in their own columns (D32)', async () => {
    const t = (await issue(admin, 'beam_test')) as { token: string; url: string };
    const l = (await issue(admin, 'beam_live')) as { token: string; url: string };
    expect(t.url).toBe(`${BASE}/api/webhooks/beam/${t.token}`);
    expect(t.token).not.toBe(l.token);
    expect(await hashOf('payment_connection', 'webhook_token_hash_test')).toBe(hashInviteToken(t.token));
    expect(await hashOf('payment_connection', 'webhook_token_hash_live')).toBe(hashInviteToken(l.token));
  });

  it('a second call replaces the token: the old hash is gone and the answer says so', async () => {
    const a = (await issue(admin, 'line')) as { token: string };
    const b = (await issue(admin, 'line')) as { token: string; replaced: boolean };
    expect(b.replaced).toBe(true);
    expect(b.token).not.toBe(a.token);
    expect(await hashOf('line_connection', 'webhook_token_hash')).toBe(hashInviteToken(b.token));
  });

  it('keeps the rest of an existing connection row', async () => {
    await tdb.query(`insert into public.line_connection (club_id, liff_id, tested_at) values ($1, 'liff-1', app.now())`, [TEST]);
    await issue(admin, 'line');
    expect((await tdb.query(`select liff_id, tested_at is not null as t from public.line_connection`)).rows[0]).toEqual({ liff_id: 'liff-1', t: true });
  });
});

describe('who and when', () => {
  it('admin only: an assigned specialist is forbidden, and nothing is stored', async () => {
    expect(await issue(spec, 'line')).toEqual({ ok: false, code: 'forbidden' });
    expect(await hashOf('line_connection', 'webhook_token_hash')).toBeNull();
  });

  it('needs a fresh second factor (SR-16)', async () => {
    expect(await issue(admin, 'line', { fresh: false })).toEqual({ ok: false, code: 'step_up_required' });
    expect(await hashOf('line_connection', 'webhook_token_hash')).toBeNull();
  });

  it('an unknown kind or club is refused; a deactivated or unknown staff member is not found', async () => {
    expect(await issue(admin, 'slack')).toEqual({ ok: false, code: 'invalid' });
    expect(await issue(admin, 5)).toEqual({ ok: false, code: 'invalid' });
    expect(await issue(admin, 'line', { club: 'aaaaaaaa-0000-4000-8000-0000000000ff' })).toEqual({ ok: false, code: 'not_found' });
    expect(await issue(admin, 'line', { club: 'nope' })).toEqual({ ok: false, code: 'not_found' });
    expect(await issue('aaaaaaaa-1111-4111-8111-111111111111', 'line')).toEqual({ ok: false, code: 'not_found' });
    await tdb.query(`update platform.platform_staff set active = false where id = $1`, [admin]);
    expect(await issue(admin, 'line')).toEqual({ ok: false, code: 'not_found' });
  });

  it('a Live club is look only unless the owner opened the window (SR-02)', async () => {
    expect(await issue(admin, 'line', { club: LIVE })).toEqual({ ok: false, code: 'look_only' });
    await tdb.query(`update public.club set allow_booq_changes_set_at = app.now(), allow_booq_changes_until = app.now() + interval '1 hour' where id = $1`, [LIVE]);
    expect(await issue(admin, 'line', { club: LIVE })).toMatchObject({ ok: true });
  });
});

describe('audit', () => {
  it('P6 names the staff member, the club and which connection, never the token or its hash; the club log has a note', async () => {
    const r = (await issue(admin, 'beam_live')) as { token: string };
    await issue(admin, 'beam_live');
    const log = await p6();
    expect(log).toEqual([
      { action: 'club.webhook_token_issued', name: 'Ada Admin', club_id: TEST, detail: { connection: 'beam_live', replaced: false } },
      { action: 'club.webhook_token_issued', name: 'Ada Admin', club_id: TEST, detail: { connection: 'beam_live', replaced: true } },
    ]);
    const everything = JSON.stringify([log, (await tdb.query(`select * from public.audit_entry`)).rows]);
    expect(everything).not.toContain(r.token);
    expect(everything).not.toContain(hashInviteToken(r.token));
    expect((await tdb.query(`select count(*)::int as n from public.audit_entry where action = 'support.webhook_token_issued'`)).rows[0].n).toBe(2);
  });
});
