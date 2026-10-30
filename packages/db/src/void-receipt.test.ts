import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F13-T05 / migration 0704: app.void_receipt (RCPT-01-AC9, AC10, AC13; PLAT-04).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const ACC = '55555555-5555-4555-8555-555555555555';
const COACH = '66666666-6666-4666-8666-666666666666';
const OWNER_B = '77777777-7777-4777-8777-777777777777';

let tdb: TestDatabase;
let web: Db;
let rid: string;
let oid: string;
const ctx = (user: string, roles: string[], club = A) => ({ clubId: club, userId: user, roles, source: 'admin' as const });
const owner = ctx(OWNER, ['owner', 'player']);
const voidIt = (c = owner, id = rid, reason: string | null = 'issued to the wrong person') => web.withClubTx(c, (tx) => tx.query('select app.void_receipt($1, $2)', [id, reason]));

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  for (const [club, u, roles] of [[A, PLAYER, ['player']], [A, DESK, ['front_desk', 'player']], [A, OWNER, ['owner', 'player']], [A, ACC, ['accountant', 'player']], [A, COACH, ['coach', 'player']], [B, OWNER_B, ['owner', 'player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id, display_name) values ($1,$2,$3,$3)', [club, u, 'L' + u.slice(0, 2)]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  oid = (await tdb.query(`insert into public.orders (club_id, customer_id, source, status) values ($1,$2,'online','paid') returning id`, [A, PLAYER])).rows[0].id as string;
  rid = (
    await tdb.query(
      `insert into public.receipt (club_id, order_id, kind, series, seq_no, number, vat_flag, customer_id, customer_name_snapshot, lines, total_satang)
       values ($1,$2,'sale','2026',1,'HTC-2026-000001',false,$3,'Somchai','{"items":[]}'::jsonb,50000) returning id`,
      [A, oid, PLAYER],
    )
  ).rows[0].id as string;
  web = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});

describe('void (RCPT-01-AC9, AC13)', () => {
  it('the owner voids with a reason: the receipt keeps its number, lines and total and shows void; the void record names the owner', async () => {
    await tdb.setNow('2026-12-30T04:00:00Z');
    await voidIt();
    const r = (await tdb.query(`select number, status, total_satang, lines, seq_no from public.receipt where id = $1`, [rid])).rows[0];
    expect(r).toMatchObject({ number: 'HTC-2026-000001', status: 'void', total_satang: 50000, lines: { items: [] }, seq_no: 1 });
    const v = (await tdb.query(`select reason, voided_by, voided_at from public.receipt_void where receipt_id = $1`, [rid])).rows[0];
    expect(v).toMatchObject({ reason: 'issued to the wrong person', voided_by: OWNER });
    expect(new Date(v.voided_at).toISOString()).toBe('2026-12-30T04:00:00.000Z');
  });

  it('is audited with the owner as the actor, and the reason text is not copied into the audit log', async () => {
    await voidIt();
    const a = (await tdb.query(`select actor_type, actor_user_id, action, new_value from public.audit_entry where action = 'receipt.voided'`)).rows;
    expect(a).toEqual([{ actor_type: 'club_user', actor_user_id: OWNER, action: 'receipt.voided', new_value: { number: 'HTC-2026-000001' } }]);
  });

  it('only marks the receipt: no order, payment or other receipt changes, and the number is never reused', async () => {
    const before = JSON.stringify((await tdb.query(`select * from public.orders`)).rows);
    await voidIt();
    expect(JSON.stringify((await tdb.query(`select * from public.orders`)).rows)).toBe(before);
    expect((await tdb.query(`select status from public.orders where id = $1`, [oid])).rows[0].status).toBe('paid');
    expect((await tdb.query(`select count(*)::int as n from public.receipt`)).rows[0].n).toBe(1);
    expect((await tdb.query(`select count(*)::int as n from public.receipt_void`)).rows[0].n).toBe(1);
  });
});

describe('who and what is refused (RCPT-01-AC9, AC10)', () => {
  it('front desk, accountant, coach and player cannot void', async () => {
    for (const c of [ctx(DESK, ['front_desk', 'player']), ctx(ACC, ['accountant', 'player']), ctx(COACH, ['coach', 'player']), ctx(PLAYER, ['player'])]) {
      await expect(voidIt(c), c.roles.join()).rejects.toThrow(/receipt:forbidden/);
    }
    expect((await tdb.query(`select status from public.receipt where id = $1`, [rid])).rows[0].status).toBe('issued');
  });

  it('a missing, blank or too short reason is refused and nothing changes', async () => {
    for (const reason of [null, '', '   ', '\n\t']) await expect(voidIt(owner, rid, reason), String(reason)).rejects.toThrow(/receipt:reason_required/);
    expect((await tdb.query(`select status from public.receipt where id = $1`, [rid])).rows[0].status).toBe('issued');
    expect((await tdb.query(`select count(*)::int as n from public.receipt_void`)).rows[0].n).toBe(0);
  });

  it('a second void is refused', async () => {
    await voidIt();
    await expect(voidIt(owner, rid, 'again')).rejects.toThrow(/receipt:already_void/);
    expect((await tdb.query(`select count(*)::int as n from public.receipt_void`)).rows[0].n).toBe(1);
  });

  it('another club\'s receipt and an unknown id are not found; another club\'s owner cannot void', async () => {
    await expect(voidIt(ctx(OWNER_B, ['owner', 'player'], B))).rejects.toThrow(/receipt:not_found/);
    await expect(voidIt(owner, 'aaaaaaaa-0000-4000-8000-0000000000ff')).rejects.toThrow(/receipt:not_found/);
  });

  it('the reason is trimmed and kept as written otherwise', async () => {
    await voidIt(owner, rid, '  typed twice  ');
    expect((await tdb.query(`select reason from public.receipt_void`)).rows[0].reason).toBe('typed twice');
  });
});

describe('who can call the function', () => {
  it('the app role only', async () => {
    for (const [role, want] of [['booq_app', true], ['booq_worker', false], ['booq_platform', false], ['anon', false], ['authenticated', false]] as const) {
      const r = await tdb.query(`select has_function_privilege($1, 'app.void_receipt(uuid, text)', 'execute') as ok`, [role]);
      expect(r.rows[0].ok, role).toBe(want);
    }
  });
});
