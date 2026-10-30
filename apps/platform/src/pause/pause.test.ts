import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlatformDb, type PlatformDb } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { createPauseService, createStubOwnerNotifier, type OwnerNotice } from './pause';

// F01-T22: POST /clubs/{id}/pause and /resume (PLAT-03-AC1 to AC3, AC10, AC11; PLAT-01-AC8, AC10).
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';

let tdb: TestDatabase;
let pdb: PlatformDb;
let svc: ReturnType<typeof createPauseService>;
let notices: OwnerNotice[];
let admin: string;
let spec: string;

async function staff(email: string, role: string, auth: string, name: string): Promise<string> {
  return (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1, $2, $3, $4) returning id`, [auth, email, name, role])).rows[0].id;
}
const status = async () => (await tdb.query(`select status from public.club where id = $1`, [CLUB])).rows[0].status as string;
const p6 = async () => (await tdb.query(`select action, staff_name_at_time as name, club_id, reason, detail from platform.audit_log order by occurred_at, id`)).rows;
const pause = (who: string, body: unknown, fresh = true, club = CLUB) => svc.pauseClub({ staffId: who, stepUpFresh: fresh }, club, body);
const resume = (who: string, body: unknown, fresh = true, club = CLUB) => svc.resumeClub({ staffId: who, stepUpFresh: fresh }, club, body);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status, owner_line, default_language) values ($1, 'a', 'ก', 'Club A', 'live', '@owner', 'en')`, [CLUB]);
  admin = await staff('admin@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000001', 'Ada Admin');
  spec = await staff('spec@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000002', 'Sam Specialist');
  await tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1, $2)`, [spec, CLUB]);
  pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
  notices = [];
  svc = createPauseService({ db: pdb, notifier: createStubOwnerNotifier(notices) });
});
afterEach(async () => {
  await pdb.end();
  await tdb.close();
});

describe('pause (PLAT-03-AC1 to AC3, AC10)', () => {
  it('an admin pauses a Live club with a reason; P6 has the reason and the staff name; the owner is told', async () => {
    const r = await pause(admin, { reason: 'payment problem' });
    expect(r).toMatchObject({ ok: true, ownerNotified: true });
    expect(await status()).toBe('paused');
    const row = (await p6()).find((x) => x.action === 'club.paused');
    expect(row).toMatchObject({ name: 'Ada Admin', club_id: CLUB, reason: 'payment problem' });
    expect(notices).toEqual([{ clubId: CLUB, kind: 'club_paused', templateKey: 'L-new.club_paused', params: { clubName: 'Club A', reason: 'payment problem' }, ownerLine: '@owner' }]);
  });

  it('refuses a missing or blank reason (PLAT-03-AC2): nothing changes and the owner is not told', async () => {
    for (const body of [{}, { reason: '' }, { reason: '   ' }]) {
      expect(await pause(admin, body), JSON.stringify(body)).toEqual({ ok: false, code: 'reason_required' });
    }
    expect(await status()).toBe('live');
    expect(notices).toEqual([]);
  });

  it('refuses a specialist on any club (PLAT-03-AC3, PLAT-01-AC8), assigned or not, before saying anything about the club', async () => {
    expect(await pause(spec, { reason: 'x' })).toEqual({ ok: false, code: 'forbidden' });
    expect(await pause(spec, { reason: 'x' }, true, 'aaaaaaaa-0000-4000-8000-0000000000ff')).toEqual({ ok: false, code: 'forbidden' });
    expect(await status()).toBe('live');
  });

  it('answers not_found for an unknown or malformed club, invalid for a bad body, step_up_required for a stale factor', async () => {
    expect(await pause(admin, { reason: 'x' }, true, 'aaaaaaaa-0000-4000-8000-0000000000ff')).toEqual({ ok: false, code: 'not_found' });
    expect(await pause(admin, { reason: 'x' }, true, 'nope')).toEqual({ ok: false, code: 'not_found' });
    expect(await pause(admin, { reason: 5 })).toEqual({ ok: false, code: 'invalid' });
    expect(await pause(admin, { reason: 'x', extra: 1 })).toEqual({ ok: false, code: 'invalid' });
    expect(await pause(admin, { reason: 'x'.repeat(501) })).toEqual({ ok: false, code: 'invalid' });
    expect(await pause(admin, null)).toEqual({ ok: false, code: 'invalid' });
    expect(await pause(admin, { reason: 'x' }, false)).toEqual({ ok: false, code: 'step_up_required' });
    expect(await status()).toBe('live');
  });

  it('only a Live club can be paused: a second pause is refused', async () => {
    await pause(admin, { reason: 'a' });
    expect(await pause(admin, { reason: 'b' })).toEqual({ ok: false, code: 'transition_not_allowed' });
    await tdb.query(`update public.club set status = 'testing' where id = $1`, [CLUB]);
    expect(await pause(admin, { reason: 'b' })).toEqual({ ok: false, code: 'transition_not_allowed' });
  });

  it('a failed owner message does not undo the pause, and is recorded in P6', async () => {
    const failing = createPauseService({ db: pdb, notifier: { notifyOwner: async () => { throw new Error('line down'); } } });
    const r = await failing.pauseClub({ staffId: admin, stepUpFresh: true }, CLUB, { reason: 'x' });
    expect(r).toMatchObject({ ok: true, ownerNotified: false });
    expect(await status()).toBe('paused');
    expect((await p6()).map((x) => x.action)).toEqual(['club.paused', 'club.owner_notice_failed']);
  });

  it('every refusal is logged in P6 with the code', async () => {
    await pause(spec, { reason: 'x' });
    await pause(admin, {});
    expect((await p6()).map((x) => [x.action, x.name, x.detail?.code])).toEqual([
      ['club.pause_refused', 'Sam Specialist', 'forbidden'],
      ['club.pause_refused', 'Ada Admin', 'reason_required'],
    ]);
  });
});

describe('resume (PLAT-01-AC10, PLAT-03-AC11)', () => {
  it('an admin resumes with a reason: Live, the reason in P6, the pause length returned, the owner told', async () => {
    await tdb.setNow('2026-12-29T03:00:00Z');
    await pause(admin, { reason: 'a' });
    await tdb.advance('2 days');
    const r = await resume(admin, { reason: 'fixed' });
    expect(r).toEqual({ ok: true, pausedAt: '2026-12-29T03:00:00.000Z', resumedAt: '2026-12-31T03:00:00.000Z', handlersRun: 0, ownerNotified: true });
    expect(await status()).toBe('live');
    expect((await p6()).find((x) => x.action === 'club.resumed')).toMatchObject({ name: 'Ada Admin', reason: 'fixed', club_id: CLUB });
    expect(notices.at(-1)).toMatchObject({ kind: 'club_resumed', templateKey: 'L-new.club_resumed', params: { clubName: 'Club A' } });
  });

  it('refuses a specialist, a missing reason, a stale factor and a club that is not paused', async () => {
    expect(await resume(admin, { reason: 'x' })).toEqual({ ok: false, code: 'transition_not_allowed' });
    await pause(admin, { reason: 'a' });
    expect(await resume(spec, { reason: 'x' })).toEqual({ ok: false, code: 'forbidden' });
    expect(await resume(admin, {})).toEqual({ ok: false, code: 'reason_required' });
    expect(await resume(admin, { reason: 'x' }, false)).toEqual({ ok: false, code: 'step_up_required' });
    expect(await status()).toBe('paused');
  });

  it('runs the registered handlers once and reports how many', async () => {
    await tdb.query(`create function public.__h(p_club uuid, p_paused timestamptz, p_resumed timestamptz) returns void language plpgsql as $$ begin null; end $$`);
    await tdb.query(`insert into app.pause_handlers (handler_key, handler) values ('h', 'public.__h(uuid, timestamptz, timestamptz)'::regprocedure)`);
    await pause(admin, { reason: 'a' });
    expect(await resume(admin, { reason: 'b' })).toMatchObject({ ok: true, handlersRun: 1 });
  });
});
