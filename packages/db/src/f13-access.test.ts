import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F13-T11: who can read what in receipts, closes and reports (D35, PLAT-02, CC-1; R2-AC11). The grants and policies are in the
// table migrations (0701, 0705) and the function grants of 0702 to 0707; this suite pins the whole picture in one place, so a later
// migration cannot widen it without a test failing.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const ACC = '55555555-5555-4555-8555-555555555555';
const COACH = '66666666-6666-4666-8666-666666666666';
const OWNER_B = '77777777-7777-4777-8777-777777777777';

let tdb: TestDatabase;
let web: Db;
const ctx = (user: string, roles: string[], club = A) => ({ clubId: club, userId: user, roles, source: 'admin' as const });
const ROLES = {
  owner: ctx(OWNER, ['owner', 'player']),
  accountant: ctx(ACC, ['accountant', 'player']),
  front_desk: ctx(DESK, ['front_desk', 'player']),
  coach: ctx(COACH, ['coach', 'player']),
  player: ctx(PLAYER, ['player']),
};
const count = async (c: ReturnType<typeof ctx>, table: string) => (await web.withClubTx(c, (tx) => tx.query(`select count(*)::int as n from public.${table}`))).rows[0]!.n as number;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status, receipt_prefix) values ($1,'a','ก','A','live','HTC'), ($2,'b','ข','B','live','BBB')`, [A, B]);
  for (const [club, u, roles] of [[A, PLAYER, ['player']], [A, OTHER, ['player']], [A, DESK, ['front_desk', 'player']], [A, OWNER, ['owner', 'player']], [A, ACC, ['accountant', 'player']], [A, COACH, ['coach', 'player']], [B, OWNER_B, ['owner', 'player']]] as const) {
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
  // Two receipts in club A (one for the player, one for another), one in club B, and one close in club A.
  for (const [club, customer, n] of [[A, PLAYER, 1], [A, OTHER, 2], [B, OWNER_B, 1]] as const) {
    const o = (await tdb.query(`insert into public.orders (club_id, customer_id, source, status) values ($1,$2,'online','paid') returning id`, [club, customer])).rows[0].id as string;
    await tdb.query(
      `insert into public.receipt (club_id, order_id, kind, series, seq_no, number, vat_flag, customer_id, customer_name_snapshot, lines, total_satang)
       values ($1,$2,'sale','2026',$3,$4,false,$5,'Name','{"items":[]}'::jsonb,1000)`,
      [club, o, n, `X-2026-00000${n}`, customer],
    );
  }
  await tdb.query(`insert into public.daily_close (club_id, day, run_by, totals, receipt_count) values ($1,'2026-12-29',$2,'{}'::jsonb,0)`, [A, OWNER]);
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});

describe('receipts', () => {
  it('owner, accountant and front desk read the club\'s two; the player reads only their own; a coach with no staff right sees only their own (none)', async () => {
    expect(await count(ROLES.owner, 'receipt')).toBe(2);
    expect(await count(ROLES.accountant, 'receipt')).toBe(2);
    expect(await count(ROLES.front_desk, 'receipt')).toBe(2);
    expect(await count(ROLES.player, 'receipt')).toBe(1);
    expect(await count(ROLES.coach, 'receipt')).toBe(0);
  });
  it('another club\'s owner reads nothing of this club, and this club never sees theirs', async () => {
    expect(await count(ctx(OWNER_B, ['owner', 'player'], B), 'receipt')).toBe(1);
  });
});

describe('daily closes', () => {
  it('only the owner and the accountant read them', async () => {
    expect(await count(ROLES.owner, 'daily_close')).toBe(1);
    expect(await count(ROLES.accountant, 'daily_close')).toBe(1);
    for (const r of ['front_desk', 'coach', 'player'] as const) expect(await count(ROLES[r], 'daily_close'), r).toBe(0);
    expect(await count(ctx(OWNER_B, ['owner', 'player'], B), 'daily_close')).toBe(0);
  });
});

describe('BOOQ staff and the platform roles see nothing', () => {
  it('no privilege of any kind on the F13 tables for booq_platform, anon and authenticated; no execute on any F13 function', async () => {
    for (const role of ['booq_platform', 'anon', 'authenticated']) {
      for (const t of ['receipt', 'receipt_void', 'receipt_counter', 'daily_close']) {
        const r = await tdb.query(`select has_table_privilege($1, $2, 'select,insert,update,delete,truncate') as ok`, [role, `public.${t}`]);
        expect(r.rows[0].ok, `${role} ${t}`).toBe(false);
      }
    }
    const fns = (await tdb.query(
      `select p.oid::regprocedure::text as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname in ('issue_receipt', 'void_receipt', 'run_daily_close', 'preview_daily_close', 'daily_close_totals', 'report_cash_by_type', 'report_package_sales', 'report_online_vs_staff', 'report_no_show_rate', 'report_new_vs_returning', 'report_revenue_earned', 'report_value_owed', 'report_occupancy', 'report_partner')`)).rows.map((r) => r.f as string);
    expect(fns.length).toBe(14);
    for (const f of fns) {
      for (const role of ['booq_platform', 'booq_worker', 'anon', 'authenticated']) {
        expect((await tdb.query(`select has_function_privilege($1, $2, 'execute') as ok`, [role, f])).rows[0].ok, `${role} ${f}`).toBe(false);
      }
    }
  });
  it('the app role may run exactly the owner and accountant entry points, and nothing else of F13', async () => {
    const may = (await tdb.query(
      `select p.oid::regprocedure::text as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname in ('issue_receipt', 'void_receipt', 'run_daily_close', 'preview_daily_close', 'daily_close_totals', 'report_cash_by_type', 'report_package_sales', 'report_online_vs_staff', 'report_no_show_rate', 'report_new_vs_returning', 'report_revenue_earned', 'report_value_owed', 'report_occupancy', 'report_partner')
          and has_function_privilege('booq_app', p.oid, 'execute') order by 1`)).rows.map((r) => r.f);
    expect(may).toEqual([
      'app.preview_daily_close(date)', 'app.report_cash_by_type(date,date)', 'app.report_new_vs_returning(date,date)', 'app.report_no_show_rate(date,date)',
      'app.report_occupancy(date,date)', 'app.report_online_vs_staff(date,date)', 'app.report_package_sales(date,date)', 'app.report_partner(date,date)',
      'app.report_revenue_earned(date,date)', 'app.report_value_owed(date)', 'app.run_daily_close(date)', 'app.void_receipt(uuid,text)',
    ]);
  });
});

describe('no role writes a receipt or a close directly (RCPT-01-AC12)', () => {
  it('the app and worker roles hold no insert, update, delete or truncate on any F13 table', async () => {
    for (const role of ['booq_app', 'booq_worker']) {
      for (const t of ['receipt', 'receipt_void', 'receipt_counter', 'daily_close']) {
        expect((await tdb.query(`select has_table_privilege($1, $2, 'insert,update,delete,truncate') as ok`, [role, `public.${t}`])).rows[0].ok, `${role} ${t}`).toBe(false);
      }
    }
  });
});
