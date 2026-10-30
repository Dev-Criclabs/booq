import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F06-T03 / migration 0503: wallet_balance, package_balance, package_status (PKG-01-AC1, PKG-03-AC3).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const DESK = '33333333-3333-4333-8333-333333333333';
const PLAYER_B = '22222222-2222-4222-8222-222222222222';
const PRODUCT = '00000000-0000-4000-8000-0000000000d1';
const PRODUCT_B = '00000000-0000-4000-8000-0000000000d2';
const EXPIRES = '2027-04-05T16:59:59.999Z';            // 5 Apr 2027 23:59:59.999 Bangkok

let tdb: TestDatabase;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  for (const [club, u, roles] of [[A, PLAYER, ['player']], [A, DESK, ['front_desk', 'player']], [B, PLAYER_B, ['player']]] as const) {
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
  await tdb.query(`insert into public.package_product (club_id, id, name_th, name_en, credit_type, credits, validity_months, price_satang)
                   values ($1,$3,'10 ชั่วโมง','10 hours','court_hour',10,3,450000), ($2,$4,'10 ชั่วโมง','10 hours','court_hour',10,3,450000)`, [A, B, PRODUCT, PRODUCT_B]);
  await tdb.setNow('2027-02-01T03:00:00Z');
});
afterEach(async () => {
  await tdb.close();
});

const newPackage = async (credits = 10, club = A, customer = PLAYER, product = PRODUCT) =>
  (await tdb.query(`insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, expires_at)
                    values ($1,$2,$3,'{}',$4,'2027-01-04T17:30:00Z',$5) returning id`, [club, customer, product, credits, EXPIRES])).rows[0].id as string;
const credit = (pkg: string, reason: string, change: number, club = A) =>
  tdb.query(`insert into public.credit_ledger (club_id, package_id, change, reason, staff_id, note) values ($1,$2,$3,$4,$5,$6)`,
    [club, pkg, change, reason, reason === 'adjust' ? DESK : null, reason === 'adjust' ? 'n' : null]);
const wallet = (satang: number, customer = PLAYER, club = A) =>
  tdb.query(`insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, staff_id, note) values ($1,$2,$3,$4,$5,$6)`,
    [club, customer, satang, satang > 0 ? 'refund' : 'adjust', satang > 0 ? null : DESK, satang > 0 ? null : 'n']);
/** Reads a view as its owner in a club's context, as the definer functions and later the routes do. */
async function read<T = Record<string, unknown>>(sql: string, args: unknown[] = [], club = A): Promise<T[]> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role booq_owner');
    await c.query(`select set_config('app.club_id', $1, true)`, [club]);
    return (await c.query(sql, args)).rows as T[];
  } finally {
    await c.query('rollback');
    c.release();
  }
}
const ledgerSum = async (pkg: string) =>
  Number((await tdb.query(`select p.credits_total + coalesce((select sum(change) from public.credit_ledger where package_id = p.id), 0) as n from public.customer_package p where id = $1`, [pkg])).rows[0].n);

describe('balances equal the ledger sum (PKG-01-AC1)', () => {
  it('after random movements each view equals its ledger sum', async () => {
    const pkg = await newPackage(10);
    let expectedWallet = 0;
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 30; i++) {
      const r = rnd();
      try {
        if (r < 0.3) await credit(pkg, 'reserve', -1);
        else if (r < 0.45) await credit(pkg, 'return', 1);
        else if (r < 0.55) await credit(pkg, 'use', 0);
        else if (r < 0.65) await credit(pkg, 'adjust', rnd() < 0.5 ? 1 : -1);
        else {
          const amount = (1 + Math.floor(rnd() * 20)) * 100 * (rnd() < 0.4 ? -1 : 1);
          await wallet(amount);
          expectedWallet += amount;
        }
      } catch (e) {
        expect(String(e)).toMatch(/below zero/);
      }
      const [b] = await read<{ credits_left: number }>('select credits_left from public.package_balance where package_id = $1', [pkg]);
      expect(b?.credits_left).toBe(await ledgerSum(pkg));
      const w = await read<{ balance_satang: string }>('select balance_satang from public.wallet_balance where customer_id = $1', [PLAYER]);
      expect(Number(w[0]?.balance_satang ?? 0)).toBe(expectedWallet);
    }
  });
  it('a package with no movements has all its credits; a customer with no wallet rows has no wallet row', async () => {
    const pkg = await newPackage(8);
    expect(await read('select credits_left from public.package_balance where package_id = $1', [pkg])).toEqual([{ credits_left: 8 }]);
    expect(await read('select * from public.wallet_balance')).toEqual([]);
  });
  it('the views show only the club in the context', async () => {
    await newPackage(10);
    await newPackage(5, B, PLAYER_B, PRODUCT_B);
    await wallet(1000);
    await wallet(2000, PLAYER_B, B);
    for (const v of ['wallet_balance', 'package_balance', 'package_status']) {
      expect((await read<{ club_id: string }>(`select club_id from public.${v}`)).map((r) => r.club_id), v).toEqual([A]);
      expect((await read<{ club_id: string }>(`select club_id from public.${v}`, [], B)).map((r) => r.club_id), v).toEqual([B]);
    }
  });
  it('no app role reads the views until F06-T11 grants them; BOOQ staff never', async () => {
    for (const v of ['wallet_balance', 'package_balance', 'package_status']) {
      for (const role of ['booq_app', 'booq_worker', 'booq_platform']) {
        expect((await tdb.query('select has_table_privilege($1, $2, $3) as ok', [role, `public.${v}`, 'select'])).rows[0].ok, `${role} ${v}`).toBe(false);
      }
    }
  });
});

describe('package status is derived from app.now() (PKG-03-AC3)', () => {
  const status = async (pkg: string) => (await read<{ status: string }>('select status from public.package_status where package_id = $1', [pkg]))[0]?.status;
  it('active before expiry, expired from the expiry instant, without any job running', async () => {
    const pkg = await newPackage(10);
    expect(await status(pkg)).toBe('active');
    await tdb.setNow('2027-04-05T16:59:59.998Z');      // 23:59:59.998 Bangkok on the expiry date
    expect(await status(pkg)).toBe('active');
    await tdb.setNow(EXPIRES);
    expect(await status(pkg)).toBe('expired');
    await tdb.setNow('2027-04-05T17:00:00Z');          // 00:00 Bangkok the next day
    expect(await status(pkg)).toBe('expired');
  });
  it('used up when nothing is left (a reserved credit is not left); expired wins after the remainder is written off', async () => {
    const pkg = await newPackage(1);
    await credit(pkg, 'reserve', -1);
    expect(await status(pkg)).toBe('used_up');
    await credit(pkg, 'return', 1);
    expect(await status(pkg)).toBe('active');
    await tdb.setNow('2027-04-06T00:00:00Z');
    await credit(pkg, 'expire', -1);
    expect(await read('select credits_left, status from public.package_status where package_id = $1', [pkg])).toEqual([{ credits_left: 0, status: 'expired' }]);
  });
  it('no view or table stores a balance or a status', async () => {
    const cols = (await tdb.query(`select table_name, column_name from information_schema.columns where table_schema = 'public'
                                     and table_name in ('customer_package','wallet_account','credit_ledger','wallet_ledger','package_product')`)).rows;
    expect(cols.filter((c) => /balance|credits_left|status/.test(c.column_name))).toEqual([]);
  });
});
