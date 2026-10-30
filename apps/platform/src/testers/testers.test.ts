import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashInviteToken } from '@booq/auth';
import { createPlatformDb, type PlatformDb } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { createTesterService } from './testers';

// F01-T28: GET/PUT /clubs/{id}/testers for BOOQ staff (PLAT-07-AC5, AC6; design 5.2).
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LIVE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

let tdb: TestDatabase;
let pdb: PlatformDb;
let svc: ReturnType<typeof createTesterService>;
let admin: string;
let spec: string;
let loner: string;

async function staff(email: string, role: string, auth: string, name: string): Promise<string> {
  return (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1, $2, $3, $4) returning id`, [auth, email, name, role])).rows[0].id;
}
const tokenOf = (link: string) => new URL(link).searchParams.get('invite') as string;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1, 'club-a', 'ก', 'A', 'testing'), ($2, 'club-b', 'ข', 'B', 'live')`, [CLUB, LIVE]);
  admin = await staff('admin@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000001', 'Ada Admin');
  spec = await staff('spec@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000002', 'Sam Specialist');
  loner = await staff('loner@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000003', 'Lee Loner');
  await tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1, $2)`, [spec, CLUB]);
  await tdb.query(`insert into platform.config (key, value) values ('tester_invite_ttl_hours', '720')`);   // set by a person; nothing is seeded
  pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
  svc = createTesterService({ db: pdb, baseUrl: 'https://app.example.test/' });
});
afterEach(async () => {
  await pdb.end();
  await tdb.close();
});

describe('creating a tester link', () => {
  it('returns the link once for the staff member to hand to a BOOQ tester; only the hash is stored and nothing logs the token', async () => {
    const r = await svc.createTesterInvite(spec, CLUB);
    if (!r.ok) throw new Error(r.code);
    expect(r.link).toMatch(/^https:\/\/app\.example\.test\/c\/club-a\/join\?invite=[A-Za-z0-9_-]{43}$/);
    const token = tokenOf(r.link);
    expect((await tdb.query(`select kind, roles, token_hash from public.club_invite`)).rows).toEqual([{ kind: 'tester', roles: ['player'], token_hash: hashInviteToken(token) }]);
    const everywhere = JSON.stringify([(await tdb.query(`select * from platform.audit_log`)).rows, (await tdb.query(`select * from public.audit_entry`)).rows]);
    expect(everywhere).not.toContain(token);
    expect((await tdb.query(`select action, staff_name_at_time as n from platform.audit_log where action = 'club.tester_invite_created'`)).rows).toEqual([{ action: 'club.tester_invite_created', n: 'Sam Specialist' }]);
    const status = await svc.listTesters(spec, CLUB);
    expect(status).toEqual({ ok: true, testers: [], pendingInvites: 1 });
    expect(JSON.stringify(status)).not.toContain(token);                       // no read-back of a link
  });

  it('without a configured link life no link is made (not_configured)', async () => {
    await tdb.query(`delete from platform.config where key = 'tester_invite_ttl_hours'`);
    expect(await svc.createTesterInvite(spec, CLUB)).toEqual({ ok: false, code: 'not_configured' });
    expect((await tdb.query(`select count(*)::int as n from public.club_invite`)).rows[0].n).toBe(0);
  });

  it('each call is a new link; an admin can make one for any club', async () => {
    const a = await svc.createTesterInvite(admin, CLUB);
    const b = await svc.createTesterInvite(admin, CLUB);
    if (!a.ok || !b.ok) throw new Error('x');
    expect(tokenOf(a.link)).not.toBe(tokenOf(b.link));
    expect((await svc.listTesters(admin, CLUB))).toMatchObject({ pendingInvites: 2 });
  });

  it('refuses an unassigned specialist and an unknown club (not_found), a launched club, a deactivated account', async () => {
    expect(await svc.createTesterInvite(loner, CLUB)).toEqual({ ok: false, code: 'not_found' });
    expect(await svc.createTesterInvite(admin, 'aaaaaaaa-0000-4000-8000-0000000000ff')).toEqual({ ok: false, code: 'not_found' });
    expect(await svc.createTesterInvite(admin, 'nope')).toEqual({ ok: false, code: 'not_found' });
    expect(await svc.createTesterInvite(admin, LIVE)).toEqual({ ok: false, code: 'not_available' });
    await tdb.query(`update platform.platform_staff set active = false where id = $1`, [admin]);
    expect(await svc.createTesterInvite(admin, CLUB)).toEqual({ ok: false, code: 'not_found' });
    expect((await tdb.query(`select count(*)::int as n from public.club_invite`)).rows[0].n).toBe(0);
  });
});

describe('the list and removal', () => {
  async function joinTester() {
    const r = await svc.createTesterInvite(spec, CLUB);
    if (!r.ok) throw new Error(r.code);
    const hash = hashInviteToken(tokenOf(r.link));
    const user = '22222222-2222-4222-8222-222222222222';
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into public.app_user (club_id, id, line_user_id, display_name, is_test) values ($1,$2,'U00000000000000000000000000000002','Pat Tester', true)`, [CLUB, user]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [CLUB, user]);
      await c.query('commit');
      await c.query('begin');
      await c.query(`select set_config('app.club_id', $1, true), set_config('app.user_id', $2, true), set_config('app.source', 'player_app', true)`, [CLUB, user]);
      await c.query(`select * from app.redeem_invite($1, 'U00000000000000000000000000000002', $2)`, [hash, user]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }

  it('shows a BOOQ tester masked and lets the staff member remove them; unassigned staff see nothing', async () => {
    await joinTester();
    const l = await svc.listTesters(spec, CLUB);
    if (!l.ok) throw new Error(l.code);
    expect(l.testers).toEqual([{ id: expect.any(String), added_at: expect.any(String), removed_at: null, display_name: 'Pat Tester' }]);
    expect(l.pendingInvites).toBe(0);
    expect(await svc.listTesters(loner, CLUB)).toEqual({ ok: false, code: 'not_found' });
    expect(await svc.removeTester(loner, CLUB, l.testers[0]?.id as string)).toEqual({ ok: false, code: 'not_found' });
    expect(await svc.removeTester(spec, CLUB, l.testers[0]?.id as string)).toEqual({ ok: true });
    expect(await svc.removeTester(spec, CLUB, l.testers[0]?.id as string)).toEqual({ ok: false, code: 'not_found' });
    const after = await svc.listTesters(spec, CLUB);
    expect(after).toMatchObject({ ok: true, testers: [{ display_name: 'Pat Tester' }] });
    expect((after as { testers: Array<{ removed_at: string | null }> }).testers[0]?.removed_at).not.toBeNull();
    expect((await tdb.query(`select action from platform.audit_log where action like 'club.tester%' order by occurred_at, id`)).rows.map((x) => x.action))
      .toEqual(['club.tester_invite_created', 'club.tester_added', 'club.tester_removed']);
  });

  it('answers not_found for a malformed id', async () => {
    expect(await svc.removeTester(spec, CLUB, 'nope')).toEqual({ ok: false, code: 'not_found' });
    expect(await svc.listTesters(spec, 'nope')).toEqual({ ok: false, code: 'not_found' });
  });
});
