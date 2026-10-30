import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectRegistry } from './registry';
import { checkTableClasses } from './registry/check';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F10-T03 / migration 0602: notification_pref, the two C17 switches (LINE-05, D94; F10 design 4.1, 5.10,
// assumption A-2: reminders on, promotions off until the player opts in).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const OWNER = '44444444-4444-4444-8444-444444444444';
const PB = '55555555-5555-4555-8555-555555555555';

let tdb: TestDatabase;
let web: Db;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  for (const [club, u, roles] of [[A, P1, ['player']], [A, P2, ['player']], [A, OWNER, ['owner', 'player']], [B, PB, ['player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [club, u, 'L' + u.slice(0, 2)]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  web = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});
const as = (user: string, roles: string[], club = A) => ({ clubId: club, userId: user, roles, source: 'player_app' as const });

describe('notification_pref (F10-T03, LINE-05, D94)', () => {
  it('a new row has reminders on and promotions off (A-2)', async () => {
    const r = await web.withClubTx(as(P1, ['player']), (tx) =>
      tx.query(`insert into public.notification_pref (club_id, user_id) values ($1,$2) returning reminders, promotions`, [A, P1]));
    expect(r.rows[0]).toEqual({ reminders: true, promotions: false });
  });

  it('one row per person', async () => {
    await tdb.query(`insert into public.notification_pref (club_id, user_id) values ($1,$2)`, [A, P1]);
    await expect(tdb.query(`insert into public.notification_pref (club_id, user_id) values ($1,$2)`, [A, P1])).rejects.toThrow(/notification_pref_one_per_user/);
  });

  it('a player writes and reads only their own row', async () => {
    await tdb.query(`insert into public.notification_pref (club_id, user_id) values ($1,$2)`, [A, P2]);
    const me = as(P1, ['player']);
    await expect(web.withClubTx(me, (tx) => tx.query(`insert into public.notification_pref (club_id, user_id) values ($1,$2)`, [A, P2])))
      .rejects.toThrow(/row-level security/);
    await web.withClubTx(me, (tx) => tx.query(`insert into public.notification_pref (club_id, user_id, promotions) values ($1,$2,true)`, [A, P1]));
    const upd = await web.withClubTx(me, (tx) => tx.query(`update public.notification_pref set reminders = false`));
    expect(upd.rowCount).toBe(1);
    const seen = await web.withClubTx(me, (tx) => tx.query(`select user_id, reminders, promotions from public.notification_pref`));
    expect(seen.rows).toEqual([{ user_id: P1, reminders: false, promotions: true }]);
    await expect(web.withClubTx(me, (tx) => tx.query(`update public.notification_pref set user_id = $1`, [P2]))).rejects.toThrow(/row-level security/);
    await expect(web.withClubTx(me, (tx) => tx.query(`delete from public.notification_pref`))).rejects.toThrow(/permission denied/);
  });

  it('staff, the owner and another club read nothing of a player’s switches', async () => {
    await tdb.query(`insert into public.notification_pref (club_id, user_id) values ($1,$2)`, [A, P1]);
    expect((await web.withClubTx(as(OWNER, ['owner', 'player']), (tx) => tx.query(`select 1 from public.notification_pref`))).rowCount).toBe(0);
    expect((await web.withClubTx(as(PB, ['player'], B), (tx) => tx.query(`select 1 from public.notification_pref`))).rowCount).toBe(0);
  });

  it('only the two switches exist (confirmations and payment results are always sent, CC-3)', async () => {
    const cols = (await tdb.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'notification_pref' order by ordinal_position`)).rows.map((r) => r.column_name);
    expect(cols).toEqual(['club_id', 'id', 'user_id', 'reminders', 'promotions', 'is_test']);
  });

  it('is_test follows the person (a tester in a live club), and the table passes the class and audit checks', async () => {
    const TESTER = '66666666-6666-4666-8666-666666666666';
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into public.app_user (club_id, id, line_user_id, is_test) values ($1,$2,'Ltester',true)`, [A, TESTER]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, TESTER]);
      await c.query('commit');
    } finally {
      c.release();
    }
    const flags = (await tdb.query(`insert into public.notification_pref (club_id, user_id) values ($1,$2), ($1,$3) returning user_id, is_test`, [A, TESTER, P1])).rows;
    expect(Object.fromEntries(flags.map((r) => [r.user_id, r.is_test]))).toEqual({ [TESTER]: true, [P1]: false });
    const reg = await collectRegistry();
    expect(reg['public.notification_pref']).toEqual({ class: 'D', audited: true });
    const res = await checkTableClasses(tdb.pool, reg);
    expect(res.problems.filter((p) => p.table === 'public.notification_pref')).toEqual([]);
    const t = (await tdb.query(`select delete_order, auto_flag from app.test_tables where table_name = 'notification_pref'`)).rows[0];
    expect(t).toEqual({ delete_order: 800, auto_flag: false });
  });
});
