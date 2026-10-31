import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/harness';
import { createDb, type Db } from './tx';

// F10-T15 / migration 0614: app.line_status() for the owner's banners (GET /staff/line/status; F10 design 5.7 to
// 5.9; LINE-06, LINE-07-AC1, D98, D114). Counts, states and codes only; the owner only.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '4a3c9f1f-8d2e-4b66-8e1b-2d3f4a5b6c7d';
const OWNER = '11111111-1111-4111-8111-111111111111';
const MONTH = `date_trunc('month', now() at time zone 'Asia/Bangkok')::date`;

let tdb: TestDatabase;
let app: Db;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,'L1')`, [A, OWNER]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player'), ($1,$2,'owner')`, [A, OWNER]);
    await c.query('commit');
  } finally {
    c.release();
  }
  await tdb.query(`insert into public.line_connection (club_id, line_plan_kind, plan_message_limit) values ($1,'paid',1000)
                   on conflict (club_id) do update set line_plan_kind = excluded.line_plan_kind, plan_message_limit = excluded.plan_message_limit`, [A]);
  app = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await app?.end();
  await tdb?.close();
});

const status = (roles: string[] = ['player', 'owner'], club = A) =>
  app.withClubTx({ clubId: club, userId: OWNER, roles: roles as never, source: 'admin' }, async (tx) => (await tx.query(`select app.line_status() as s`)).rows[0]!.s);
const usage = (club: string, used: number, limit: number | null) =>
  tdb.query(`insert into platform.club_line_usage (club_id, month, used, message_limit, plan_kind, source) values ($1, ${MONTH}, $2, $3, 'paid', 'line')`, [club, used, limit]);

describe('app.line_status', () => {
  it('no usage yet: normal, nothing used, the plan from P2 step 4, no health rows', async () => {
    const s = await status();
    expect(s).toMatchObject({ state: 'normal', used: 0, limit: null, percent: null, plan: 'paid', token: null, usage: null });
    expect(s.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it('at 70 percent the state is alert for the cap banner (D98); a failed token check shows for the token banner (D114)', async () => {
    await usage(A, 712, 1000);
    await tdb.query(`insert into platform.club_health (club_id, check_key, status, reason) values ($1,'line_token','failed','token_rejected')`, [A]);
    expect(await status()).toMatchObject({ state: 'alert', used: 712, limit: 1000, percent: 71, token: { status: 'failed', reason: 'token_rejected' } });
  });

  it('shows the caller’s own club only', async () => {
    await usage(B, 999, 1000);
    expect(await status()).toMatchObject({ used: 0, state: 'normal' });
  });

  it('is the owner’s: other roles are refused', async () => {
    for (const roles of [['player'], ['player', 'front_desk'], ['player', 'accountant'], ['player', 'coach']]) {
      await expect(status(roles)).rejects.toThrow(/line_status is for the club owner/);
    }
    expect((await tdb.query(`select has_function_privilege('booq_platform', 'app.line_status()', 'execute') as x`)).rows[0].x).toBe(false);
  });
});
