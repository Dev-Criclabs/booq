import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectRegistry } from './registry';
import { checkTableClasses } from './registry/check';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F13-T01 / migration 0701: receipt, receipt_void, receipt_counter (RCPT-01-AC1, AC2, AC9, AC12, AC15; CC-1; D4, D28, D33, D40, D106).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const ACC = '55555555-5555-4555-8555-555555555555';

let tdb: TestDatabase;
let web: Db;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  for (const [club, u, roles] of [[A, PLAYER, ['player']], [A, OTHER, ['player']], [A, DESK, ['front_desk', 'player']], [A, OWNER, ['owner', 'player']], [A, ACC, ['accountant', 'player']]] as const) {
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
const ctx = (user: string, roles: string[], club = A) => ({ clubId: club, userId: user, roles, source: 'admin' as const });

async function order(customer: string | null = PLAYER, club = A): Promise<string> {
  return (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [club, customer])).rows[0].id as string;
}
let n = 0;
async function receipt(o: string, over: { club?: string; series?: string; seq?: number; number?: string; kind?: string; payment?: string | null; customer?: string | null; test?: boolean } = {}): Promise<string> {
  n += 1;
  const test = over.test ?? false;
  const r = await tdb.query(
    `insert into public.receipt (club_id, order_id, payment_id, kind, series, seq_no, number, vat_flag, customer_id, customer_name_snapshot, lines, total_satang, is_test)
     values ($1,$2,$3,$4,$5,$6,$7,false,$8,'Somchai','{"items":[]}'::jsonb,50000,$9) returning id`,
    [over.club ?? A, o, over.payment ?? null, over.kind ?? 'sale', over.series ?? (test ? 'T2026' : '2026'), over.seq ?? n, over.number ?? `HTC-2026-${String(n).padStart(6, '0')}`, over.customer === undefined ? PLAYER : over.customer, test],
  );
  return r.rows[0].id as string;
}
async function payment(o: string, club = A): Promise<string> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local session_replication_role = replica`);
    const r = await c.query(
      `insert into public.payment (club_id, order_id, method, status, environment, gateway, gateway_charge_id, amount_satang, confirmed_at) values ($1,$2,'beam','succeeded','live','beam',$3,50000, now()) returning id`,
      [club, o, 'chg_' + Math.random().toString(36).slice(2)],
    );
    await c.query('commit');
    return r.rows[0].id as string;
  } finally {
    c.release();
  }
}

describe('append only (RCPT-01-AC12)', () => {
  it('update and delete fail for every role, and number, lines and total never change', async () => {
    const id = await receipt(await order());
    for (const role of ['booq_app', 'booq_worker', 'booq_platform']) {
      const r = await tdb.query(`select has_table_privilege($1, 'public.receipt', 'insert,update,delete,truncate') as ok`, [role]);
      expect(r.rows[0].ok, role).toBe(false);
    }
    for (const sql of [`update public.receipt set number = 'X-1'`, `update public.receipt set lines = '{}'::jsonb`, `update public.receipt set total_satang = 1`, `update public.receipt set series = '2027'`, `update public.receipt set status = 'void', total_satang = 2`, `update public.receipt set status = 'issued'`]) {
      await expect(tdb.query(sql), sql).rejects.toThrow(/never edited/);
    }
    await expect(tdb.query(`delete from public.receipt`)).rejects.toThrow(/append-only/);
    await expect(tdb.query(`truncate public.receipt cascade`)).rejects.toThrow(/append-only/);
  });

  it('only the void mark can be set, and only by the function owner role: status issued to void, nothing else', async () => {
    const id = await receipt(await order());
    await expect(tdb.query(`update public.receipt set status = 'void' where id = $1`, [id])).rejects.toThrow(/never edited/);   // not the function owner
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role booq_owner');
      await expect(c.query(`update public.receipt set status = 'void', number = 'X' where id = $1`, [id])).rejects.toThrow(/never edited/);
      await c.query('rollback');
      await c.query('begin');
      await c.query('set local role booq_owner');
      await c.query(`update public.receipt set status = 'void' where id = $1`, [id]);
      await expect(c.query(`update public.receipt set status = 'issued' where id = $1`, [id])).rejects.toThrow(/never edited/);   // a void is final
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  it('a void record and a counter row: voids never change; roles have no grant on the counter', async () => {
    const id = await receipt(await order());
    await tdb.query(`insert into public.receipt_void (club_id, receipt_id, reason, voided_by) values ($1,$2,'typo',$3)`, [A, id, OWNER]);
    await expect(tdb.query(`update public.receipt_void set reason = 'x'`)).rejects.toThrow(/append-only/);
    await expect(tdb.query(`delete from public.receipt_void`)).rejects.toThrow(/append-only/);
    await expect(tdb.query(`insert into public.receipt_void (club_id, receipt_id, reason, voided_by) values ($1,$2,'again',$3)`, [A, id, OWNER])).rejects.toThrow(/receipt_void_once/);
    await expect(tdb.query(`insert into public.receipt_void (club_id, receipt_id, reason, voided_by) values ($1,$2,'   ',$3)`, [A, await receipt(await order()), OWNER])).rejects.toThrow(/check/i);
    for (const role of ['booq_app', 'booq_worker', 'booq_platform', 'anon', 'authenticated']) {
      const r = await tdb.query(`select has_table_privilege($1, 'public.receipt_counter', 'select,insert,update,delete') as ok`, [role]);
      expect(r.rows[0].ok, role).toBe(false);
    }
  });
});

describe('numbering keys (RCPT-01-AC2, AC4, AC14; D40)', () => {
  it('a second sale receipt for one order is refused; a second wallet credit receipt for one payment is refused', async () => {
    const o = await order();
    await receipt(o);
    await expect(receipt(o)).rejects.toThrow(/receipt_one_sale_per_order/);
    const wo = await order();
    const p = await payment(o);
    await receipt(wo, { kind: 'wallet_credit', payment: p });
    await expect(receipt(await order(), { kind: 'wallet_credit', payment: p })).rejects.toThrow(/receipt_one_credit_per_payment/);
    await expect(receipt(await order(), { kind: 'wallet_credit', payment: null })).rejects.toThrow(/receipt_wallet_credit_has_payment/);
  });

  it('a number and a sequence number are unique per club and series; two clubs and two series are independent', async () => {
    await receipt(await order(), { seq: 1, number: 'HTC-2026-000001' });
    await expect(receipt(await order(), { seq: 2, number: 'HTC-2026-000001' })).rejects.toThrow(/receipt_number_unique/);
    await expect(receipt(await order(), { seq: 1, number: 'HTC-2026-000002' })).rejects.toThrow(/receipt_seq_unique/);
    await receipt(await order(), { series: '2027', seq: 1, number: 'HTC-2027-000001' });
    await receipt(await order(undefined, B), { club: B, seq: 1, number: 'HTC-2026-000001' });
  });

  it('series are a Bangkok year, or T and a year for the test series, and the two never mix', async () => {
    await expect(receipt(await order(), { series: 'X2026' })).rejects.toThrow(/receipt_series_shape/);
    await expect(receipt(await order(), { series: 'T2026', test: false })).rejects.toThrow(/receipt_series_test/);
  });
});

describe('who reads (CC-1, D35)', () => {
  it('staff roles read the club\'s receipts, a player reads their own only, another club\'s are not reachable', async () => {
    await receipt(await order(PLAYER), { customer: PLAYER });
    await receipt(await order(OTHER), { customer: OTHER });
    await receipt(await order(undefined, B), { club: B, customer: null, seq: 1, number: 'HTC-2026-000001' });
    for (const [u, roles, want] of [[OWNER, ['owner', 'player'], 2], [DESK, ['front_desk', 'player'], 2], [ACC, ['accountant', 'player'], 2], [PLAYER, ['player'], 1]] as const) {
      const r = await web.withClubTx(ctx(u, [...roles]), (tx) => tx.query(`select id from public.receipt`));
      expect(r.rows.length, u).toBe(want);
    }
    expect((await web.withClubTx(ctx(PLAYER, ['player']), (tx) => tx.query(`select customer_id from public.receipt`))).rows).toEqual([{ customer_id: PLAYER }]);
  });
  it('nobody writes: no insert, update or delete grant for the app roles', async () => {
    for (const role of ['booq_app', 'booq_worker', 'booq_platform']) {
      for (const t of ['receipt', 'receipt_void']) {
        const r = await tdb.query(`select has_table_privilege($1, $2, 'insert,update,delete') as ok`, [role, `public.${t}`]);
        expect(r.rows[0].ok, `${role} ${t}`).toBe(false);
      }
    }
    expect((await tdb.query(`select has_table_privilege('booq_platform', 'public.receipt', 'select') as ok`)).rows[0].ok).toBe(false);
  });
});

describe('test rows (RCPT-01-AC15; D33)', () => {
  it('are registered to go at Go live before payments and orders, and the registry check passes', async () => {
    const reg = (await tdb.query(`select table_name, delete_order from app.test_tables where table_name like 'receipt%' order by delete_order`)).rows;
    expect(reg).toEqual([{ table_name: 'receipt_void', delete_order: 257 }, { table_name: 'receipt', delete_order: 258 }, { table_name: 'receipt_counter', delete_order: 259 }]);
    expect((await checkTableClasses(tdb.pool, await collectRegistry())).problems.filter((p) => p.table !== 'app.test_clock')).toEqual([]);
  });
});
