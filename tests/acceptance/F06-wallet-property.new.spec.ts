import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../packages/db/src/tx';
import { createTestDatabase, type TestDatabase } from '../../packages/db/src/testing/harness';

// F06-T22 (QA): a seeded random run of wallet movements, in parallel batches, keeps the balance equal to the ledger and never below zero. Setup follows the lane's
// packages/db/src/wallet-functions.test.ts (the definer functions are called as booq_owner in the club's context, as the payment functions call them).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const COACH = '55555555-5555-4555-8555-555555555555';
const IMPORTED = '66666666-6666-4666-8666-666666666666';
const GONE = '77777777-7777-4777-8777-777777777777';
const PLAYER_B = '22222222-2222-4222-8222-222222222222';
const PRODUCT = '00000000-0000-4000-8000-0000000000d1';

let tdb: TestDatabase;
let web: Db;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  const people: [string, string, string[]][] = [
    [A, PLAYER, ['player']], [A, DESK, ['front_desk', 'player']], [A, OWNER, ['owner', 'player']], [A, COACH, ['coach', 'player']],
    [A, GONE, ['player']], [B, PLAYER_B, ['player']],
  ];
  for (const [club, u, roles] of people) {
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
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, claim_state) values ($1,$2,null,'unclaimed')`, [A, IMPORTED]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, IMPORTED]);
    await c.query('commit');
  } finally {
    c.release();
  }
  await tdb.query(`update public.app_user set active = false where id = $1`, [GONE]);
  await tdb.query(`insert into public.package_product (club_id, id, name_th, name_en, credit_type, credits, validity_months, price_satang)
                   values ($1,$2,'10 ชั่วโมง','10 hours','court_hour',10,3,450000)`, [A, PRODUCT]);
  web = createDb({ connectionString: tdb.url, max: 4 });
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});
const ctx = (user: string, roles: string[], club = A) => ({ clubId: club, userId: user, roles, source: 'admin' as const });

/** Runs SQL as the definer functions' callers do: inside another definer function, as booq_owner, in a club's context. */
async function asDefiner<T = Record<string, unknown>>(sql: string, args: unknown[] = [], club = A, client?: Awaited<ReturnType<TestDatabase['pool']['connect']>>): Promise<T[]> {
  const c = client ?? (await tdb.pool.connect());
  try {
    await c.query('begin');
    await c.query('set local role booq_owner');
    await c.query(`select set_config('app.club_id', $1, true)`, [club]);
    const r = (await c.query(sql, args)).rows as T[];
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    if (!client) c.release();
  }
}
const one = async <T = unknown>(sql: string, args: unknown[] = [], club = A) => Object.values((await asDefiner(sql, args, club))[0] ?? {})[0] as T;

/** A priced order with one package line whose wallet part is `wallet` satang (sums checked off: a fixture). */
async function lineWithWallet(wallet: number, customer = PLAYER) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    const o = (await c.query(`insert into public.orders (club_id, customer_id, source, price_group_snapshot, subtotal_satang, discount_satang, total_satang, credit_value_satang, wallet_satang, money_satang, quote_hash, priced_at)
                              values ($1,$2,'online','{}',$3,0,$3,0,$3,0,repeat('a',64),now()) returning id`, [A, customer, wallet])).rows[0].id as string;
    const l = (await c.query(`insert into public.order_line (club_id, order_id, position, kind, package_product_id, description_key, name_th, name_en, unit_price_satang, net_satang, wallet_satang)
                              values ($1,$2,1,'package',$3,'k','ก','x',$4,$4,$4) returning id`, [A, o, PRODUCT, wallet])).rows[0].id as string;
    await c.query('commit');
    return { order: o, line: l };
  } finally {
    c.release();
  }
}
const balance = async (customer = PLAYER) =>
  Number((await tdb.query(`select coalesce(sum(change_satang), 0) as n from public.wallet_ledger where club_id = $1 and customer_id = $2`, [A, customer])).rows[0].n);
const credit = (amount: number, key: string, customer = PLAYER, reason = 'refund') =>
  one<string>('select app.wallet_credit($1, $2, $3, $4)', [customer, amount, reason, key]);
const spend = (amount: number, o: { order: string; line: string }, customer = PLAYER) =>
  one<string>('select app.wallet_spend($1, $2, $3, $4)', [customer, amount, o.order, o.line]);

/** A small seeded generator, so a failing run can be repeated: mulberry32. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEEDS = [1, 2, 3, 4, 5];

describe('F06-T22 property: the wallet balance equals the ledger and is never negative (PKG-01-AC1, AC7, AC8)', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: 8 batches of 4 parallel credits, spends and returns`, async () => {
      const rand = rng(seed);
      let credited = 0;
      let spent = 0;
      let k = 0;
      const orders: Array<{ order: string; line: string; amount: number }> = [];
      for (let batch = 0; batch < 8; batch++) {
        const ops: Array<() => Promise<void>> = [];
        for (let i = 0; i < 4; i++) {
          const pick = rand();
          if (pick < 0.4) {
            const amount = 100 * (1 + Math.floor(rand() * 50));
            const key = `qa:${seed}:${k++}`;
            ops.push(async () => { await asDefiner('select app.wallet_credit($1, $2, $3, $4)', [PLAYER, amount, 'refund', key]); credited += amount; });
          } else if (pick < 0.85) {
            const amount = 100 * (1 + Math.floor(rand() * 60));
            ops.push(async () => {
              const l = await lineWithWallet(amount);
              try {
                await asDefiner('select app.wallet_spend($1, $2, $3, $4)', [PLAYER, amount, l.order, l.line]);
                spent += amount;
                orders.push({ ...l, amount });
              } catch (e) {
                expect(String(e), 'a spend may fail only for want of balance').toMatch(/wallet:insufficient/);
              }
            });
          } else if (orders.length > 0) {
            const o = orders.splice(Math.floor(rand() * orders.length), 1)[0]!;
            ops.push(async () => { await asDefiner('select app.wallet_return($1, $2)', [o.order, 'cancel']); spent -= o.amount; });
          }
        }
        const settled = await Promise.allSettled(ops.map((f) => f()));
        const bad = settled.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
        expect(bad.map((r) => String(r.reason)), `seed ${seed} batch ${batch}`).toEqual([]);
        const sum = await balance();
        expect(sum, `seed ${seed} batch ${batch}: never negative`).toBeGreaterThanOrEqual(0);
        expect(sum, `seed ${seed} batch ${batch}: the ledger equals what was credited less what was spent`).toBe(credited - spent);
      }
    }, 120_000);
  }
});
