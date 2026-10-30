import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlatformDb, type PlatformDb } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { completeSetup, recordLaunchChecks } from '../../../../packages/db/src/setup-fixture';
import { createStatusService } from './status';

// F01-T21: POST /clubs/{id}/status (PLAT-01-AC8, ROLE-AC5; design 5.2; step-up from SR-16).
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

let tdb: TestDatabase;
let pdb: PlatformDb;
let svc: ReturnType<typeof createStatusService>;
let admin: string;
let spec: string;
let loner: string;

async function staff(email: string, role: string, auth: string, name: string): Promise<string> {
  return (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1, $2, $3, $4) returning id`, [auth, email, name, role])).rows[0].id;
}
const status = async (club = CLUB) => (await tdb.query(`select status from public.club where id = $1`, [club])).rows[0].status as string;
const setStatus = (to: string, club = CLUB) => tdb.query(`update public.club set status = $1 where id = $2`, [to, club]);
const p6 = async () => (await tdb.query(`select action, staff_name_at_time as name, club_id, detail from platform.audit_log order by occurred_at, id`)).rows;
const change = (who: string, to: unknown, opts: { club?: string; reason?: unknown; fresh?: boolean } = {}) =>
  svc.changeStatus({ staffId: who, stepUpFresh: opts.fresh ?? true }, opts.club ?? CLUB, { to, ...(opts.reason !== undefined ? { reason: opts.reason } : {}) });

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1, 'a', 'ก', 'A'), ($2, 'b', 'ข', 'B')`, [CLUB, OTHER]);
  admin = await staff('admin@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000001', 'Ada Admin');
  spec = await staff('spec@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000002', 'Sam Specialist');
  loner = await staff('loner@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000003', 'Lee Loner');
  await tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1, $2)`, [spec, CLUB]);
  await completeSetup(tdb, CLUB);
  await completeSetup(tdb, OTHER);
  pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
  svc = createStatusService({ db: pdb });
});
afterEach(async () => {
  await pdb.end();
  await tdb.close();
});

describe('who may change status (PLAT-01-AC8, ROLE-AC5)', () => {
  it('an admin can do every move the route allows; the change is in P6 with the staff name, old and new status', async () => {
    expect(await change(admin, 'testing', { club: OTHER })).toEqual({ ok: true, from: 'draft', to: 'testing' });
    expect(await status(OTHER)).toBe('testing');
    const row = (await p6()).find((r) => r.action === 'club.status_changed');
    expect(row).toMatchObject({ name: 'Ada Admin', club_id: OTHER, detail: { from: 'draft', to: 'testing' } });
  });

  it('an assigned specialist can take a club from Draft to Testing and Testing to Live', async () => {
    expect(await change(spec, 'testing', { reason: 'setup done' })).toEqual({ ok: true, from: 'draft', to: 'testing' });
    await recordLaunchChecks(tdb, CLUB);
    expect(await change(spec, 'live')).toEqual({ ok: true, from: 'testing', to: 'live' });
    expect((await p6()).find((r) => r.detail?.to === 'testing')?.detail).toEqual({ from: 'draft', to: 'testing', reason: 'setup done' });
  });

  it('a specialist on a club that is not assigned gets not_found, the same as a club that does not exist', async () => {
    expect(await change(spec, 'testing', { club: OTHER })).toEqual({ ok: false, code: 'not_found' });
    expect(await change(loner, 'testing')).toEqual({ ok: false, code: 'not_found' });
    expect(await change(admin, 'testing', { club: 'aaaaaaaa-0000-4000-8000-0000000000ff' })).toEqual({ ok: false, code: 'not_found' });
    expect(await change(spec, 'testing', { club: 'not-a-uuid' })).toEqual({ ok: false, code: 'not_found' });
    expect(await status()).toBe('draft');
    expect(await status(OTHER)).toBe('draft');
  });

  it('a specialist can never pause or resume, even their own club', async () => {
    await setStatus('live');
    expect(await change(spec, 'paused', { reason: 'x' })).toEqual({ ok: false, code: 'forbidden' });
    await setStatus('paused');
    expect(await change(spec, 'live', { reason: 'x' })).toEqual({ ok: false, code: 'forbidden' });
    expect(await status()).toBe('paused');
  });

  it('an admin is pointed to the pause and resume routes instead', async () => {
    await setStatus('live');
    expect(await change(admin, 'paused', { reason: 'x' })).toEqual({ ok: false, code: 'use_pause' });
    await setStatus('paused');
    expect(await change(admin, 'live', { reason: 'x' })).toEqual({ ok: false, code: 'use_pause' });
  });

  it('a deactivated or unknown staff member is refused without touching the club', async () => {
    await tdb.query(`update platform.platform_staff set active = false where id = $1`, [admin]);
    expect(await change(admin, 'testing')).toEqual({ ok: false, code: 'not_found' });
    expect(await change('aaaaaaaa-1111-4111-8111-111111111111', 'testing')).toEqual({ ok: false, code: 'not_found' });
    expect(await status()).toBe('draft');
  });
});

describe('what the route refuses (PLAT-01-AC2, AC3, AC9)', () => {
  it('Go live with checks not passed is refused and says which are missing', async () => {
    await setStatus('testing');
    const keys = await recordLaunchChecks(tdb, CLUB, ['pass', 'fail', 'pending']);
    expect(await change(spec, 'live')).toEqual({
      ok: false,
      code: 'blocked',
      missing: [{ item: keys[1], owed_by: 'booq', result: 'fail' }, { item: keys[2], owed_by: 'booq', result: 'pending' }],
    });
    expect(await status()).toBe('testing');
  });

  it('skipping, backward and same-status moves are refused', async () => {
    expect(await change(admin, 'live')).toEqual({ ok: false, code: 'transition_not_allowed' });
    await setStatus('live');
    expect(await change(admin, 'testing')).toEqual({ ok: false, code: 'transition_not_allowed' });
    expect(await change(admin, 'draft')).toEqual({ ok: false, code: 'transition_not_allowed' });
    expect(await change(admin, 'live')).toEqual({ ok: false, code: 'transition_not_allowed' });
    expect(await status()).toBe('live');
  });

  it('a bad body is invalid: unknown status, missing to, extra fields, a reason that is not text', async () => {
    for (const to of ['closed', 'deleted', '', 5, null, undefined]) {
      expect(await change(admin, to), String(to)).toEqual({ ok: false, code: 'invalid' });
    }
    expect(await svc.changeStatus({ staffId: admin, stepUpFresh: true }, CLUB, { to: 'testing', extra: 1 })).toEqual({ ok: false, code: 'invalid' });
    expect(await svc.changeStatus({ staffId: admin, stepUpFresh: true }, CLUB, null)).toEqual({ ok: false, code: 'invalid' });
    expect(await change(admin, 'testing', { reason: 5 })).toEqual({ ok: false, code: 'invalid' });
    expect(await change(admin, 'testing', { reason: 'x'.repeat(501) })).toEqual({ ok: false, code: 'invalid' });
    expect(await status()).toBe('draft');
  });

  it('every status change needs a fresh second factor (SR-16); a stale one is refused and nothing changes', async () => {
    expect(await change(admin, 'testing', { fresh: false })).toEqual({ ok: false, code: 'step_up_required' });
    expect(await status()).toBe('draft');
  });

  it('a refused change is logged in P6 with the reason code, and a successful one is logged once', async () => {
    await change(spec, 'live');
    await change(loner, 'testing');
    await change(spec, 'testing');
    expect((await p6()).map((r) => [r.action, r.name, r.detail?.code ?? r.detail?.to ?? null])).toEqual([
      ['club.status_refused', 'Sam Specialist', 'transition_not_allowed'],
      ['club.status_refused', 'Lee Loner', 'not_found'],
      ['club.status_changed', 'Sam Specialist', 'testing'],
    ]);
  });

  it('writes the change in the club audit log naming the BOOQ staff member', async () => {
    await change(spec, 'testing');
    const a = await tdb.query(`select actor_type, actor_label from public.audit_entry where club_id = $1 and record_type = 'club' and action = 'update' and actor_type = 'platform_staff'`, [CLUB]);
    expect(a.rows).toEqual([{ actor_type: 'platform_staff', actor_label: 'Sam Specialist' }]);
  });
});
