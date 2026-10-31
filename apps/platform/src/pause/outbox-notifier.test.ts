import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlatformDb, type PlatformDb } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { createOutboxOwnerNotifier } from './outbox-notifier';
import { createPauseService } from './pause';

// PLAT-03-AC1, LINE-05-AC14: pausing a club puts one owner_paused message in F10's outbox, for the owner, once.
const CLUB = '11111111-1111-4111-8111-111111111111';
const OWNER_LINE = 'U00000000000000000000000000000004';
let tdb: TestDatabase;
let pdb: PlatformDb;
let admin: string;
let svc: ReturnType<typeof createPauseService>;
const outbox = async () => (await tdb.query(`select kind, dedupe_key, status, user_id from public.message_outbox where club_id = $1 order by created_at`, [CLUB])).rows;
const p6 = async (action: string) => (await tdb.query(`select detail from platform.audit_log where action = $1`, [action])).rows;
async function makeOwner(): Promise<string> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    const id = (await c.query(`insert into public.app_user (club_id, line_user_id, display_name) values ($1,$2,'Nok') returning id`, [CLUB, OWNER_LINE])).rows[0].id as string;
    for (const r of ['owner', 'player']) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [CLUB, id, r]);
    await c.query('commit');
    return id;
  } finally {
    c.release();
  }
}
const pause = () => svc.pauseClub({ staffId: admin, stepUpFresh: true }, CLUB, { reason: 'payment problem' });

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status, owner_line, default_language) values ($1, 'a', 'ก', 'Club A', 'live', $2, 'en')`, [CLUB, OWNER_LINE]);
  admin = (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ('99999999-0000-4000-8000-000000000001','a@booq.example','Ada','platform_admin') returning id`)).rows[0].id as string;
  pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
  svc = createPauseService({ db: pdb, notifier: createOutboxOwnerNotifier({ db: pdb }) });
});
afterEach(async () => {
  await pdb.end();
  await tdb.close();
});

describe('the owner notice through the outbox', () => {
  it('a pause queues one owner_paused message for the owner, keyed by the pause', async () => {
    const owner = await makeOwner();
    expect(await pause()).toMatchObject({ ok: true, ownerNotified: true });
    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'owner_paused', status: 'pending', user_id: owner });
    expect(rows[0].dedupe_key).toMatch(new RegExp(`^paused:${CLUB}:[0-9a-f-]{36}$`));
    expect(await p6('club.owner_notice_failed')).toEqual([]);
  });

  it('an owner who has not signed in yet has no LINE user: nothing is queued, P6 records the failed notice, and the pause stands', async () => {
    expect(await pause()).toMatchObject({ ok: true, ownerNotified: false });
    expect(await outbox()).toEqual([]);
    expect(await p6('club.owner_notice_failed')).toEqual([{ detail: { kind: 'club_paused' } }]);
    expect((await tdb.query(`select status from public.club where id = $1`, [CLUB])).rows[0].status).toBe('paused');
  });

  it('a resume has no message kind yet: the notice fails, is logged, and the club is resumed', async () => {
    await makeOwner();
    await pause();
    const r = await svc.resumeClub({ staffId: admin, stepUpFresh: true }, CLUB, { reason: 'fixed' });
    expect(r).toMatchObject({ ok: true, ownerNotified: false });
    expect(await outbox()).toHaveLength(1);
  });

  it('only a platform admin can queue it, and only an owner kind', async () => {
    const spec = (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ('99999999-0000-4000-8000-000000000002','s@booq.example','Sam','onboarding_specialist') returning id`)).rows[0].id as string;
    await makeOwner();
    const call = (who: string, kind: string) => pdb.withPlatformTx({ staffId: who, staffLabel: 'x' }, (tx) => tx.query('select platform.enqueue_owner_message($1,$2,$3)', [CLUB, kind, 'k1']));
    await expect(call(spec, 'owner_paused')).rejects.toThrow(/owner_message:forbidden/);
    await expect(call(admin, 'booking_confirmed')).rejects.toThrow(/owner_message:invalid/);
    await call(admin, 'owner_paused');
    await call(admin, 'owner_paused');
    expect(await outbox()).toHaveLength(1);
    expect((await tdb.query(`select current_setting('app.club_id', true) as c`)).rows[0].c ?? '').toBe('');
  });
});
