import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F06-T04 / migration 0505: wallet_credit, wallet_credit_order, wallet_spend, wallet_return, wallet_adjust
// (PKG-01-AC4, AC7, AC8, R2; D37, D83, D109).
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
async function asDefiner<T = Record<string, unknown>>(sql: string, args: unknown[] = [], club = A, client?: pg.PoolClient): Promise<T[]> {
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

describe('wallet_credit (R2, PKG-01-AC12)', () => {
  it('writes one positive row per dedupe key for a listed reason; a repeat returns the same row', async () => {
    const id = await credit(10000, 'refund:x1');
    expect(await credit(10000, 'refund:x1')).toBe(id);
    expect(await balance()).toBe(10000);
    for (const reason of ['late_payment', 'wrong_amount', 'duplicate_payment', 'referral_reward', 'return', 'import']) {
      await credit(100, `${reason}:1`, PLAYER, reason);
    }
    expect(await balance()).toBe(10600);
    expect(await one('select count(*)::int from public.wallet_account where customer_id = $1', [PLAYER])).toBe(1);
  });
  it('refuses an unlisted reason (adjust, spend, expire), a non-positive amount, a missing key, another club’s customer', async () => {
    for (const reason of ['adjust', 'spend', 'expire', 'withdraw']) await expect(credit(100, `k:${reason}`, PLAYER, reason)).rejects.toThrow(/wallet:reason/);
    await expect(credit(0, 'k0')).rejects.toThrow(/wallet:amount/);
    await expect(credit(-5, 'k1')).rejects.toThrow(/wallet:amount/);
    await expect(one('select app.wallet_credit($1, 100, $2, null)', [PLAYER, 'refund'])).rejects.toThrow(/wallet:dedupe_key/);
    await expect(credit(100, 'kb', PLAYER_B)).rejects.toThrow(/customer_not_found/);
  });
  it('an unclaimed or deleted record can still receive value (import; D109)', async () => {
    await credit(5000, 'import:1', IMPORTED, 'import');
    await credit(5000, 'refund:gone', GONE);
    expect(await balance(IMPORTED)).toBe(5000);
    expect(await balance(GONE)).toBe(5000);
  });
});

describe('wallet_credit_order (D37, design 4.9)', () => {
  it('creates a paid order of kind wallet_credit with one wallet_credit line, and the wallet row tied to both', async () => {
    const o = await one<string>('select app.wallet_credit_order($1, $2, $3, $4)', [PLAYER, 40000, 'late_payment', 'late_payment:p1']);
    const order = (await tdb.query(`select kind, status, customer_id, total_satang, money_satang, credit_value_satang, wallet_satang from public.orders where id = $1`, [o])).rows[0];
    expect(order).toEqual({ kind: 'wallet_credit', status: 'paid', customer_id: PLAYER, total_satang: 40000, money_satang: 40000, credit_value_satang: 0, wallet_satang: 0 });
    const lines = (await tdb.query(`select id, kind, net_satang, money_satang, description_key from public.order_line where order_id = $1`, [o])).rows;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'wallet_credit', net_satang: 40000, money_satang: 40000, description_key: 'L-new.wallet_credit_line' });
    const rows = (await tdb.query(`select reason, change_satang, order_id, order_line_id from public.wallet_ledger where customer_id = $1`, [PLAYER])).rows;
    expect(rows).toEqual([{ reason: 'late_payment', change_satang: '40000', order_id: o, order_line_id: lines[0].id }]);
  });
  it('twice with one key returns the same order id: one order, one row', async () => {
    const a = await one<string>('select app.wallet_credit_order($1, $2, $3, $4)', [PLAYER, 40000, 'duplicate_payment', 'duplicate_payment:p2']);
    const b = await one<string>('select app.wallet_credit_order($1, $2, $3, $4)', [PLAYER, 40000, 'duplicate_payment', 'duplicate_payment:p2']);
    expect(b).toBe(a);
    expect(Number((await tdb.query(`select count(*) from public.orders where kind = 'wallet_credit'`)).rows[0].count)).toBe(1);
    expect(await balance()).toBe(40000);
  });
  it('refuses an unlisted reason and a key already used by a plain credit', async () => {
    await expect(one('select app.wallet_credit_order($1, $2, $3, $4)', [PLAYER, 100, 'referral_reward', 'r:1'])).rejects.toThrow(/wallet:reason/);
    await credit(100, 'refund:shared');
    await expect(one('select app.wallet_credit_order($1, $2, $3, $4)', [PLAYER, 100, 'refund', 'refund:shared'])).rejects.toThrow(/dedupe_key_used/);
  });
});

describe('wallet_spend (PKG-01-AC7, AC8; design 4.1, 4.8)', () => {
  it('two parallel spends of the last ฿100 give exactly one success', async () => {
    await credit(10000, 'refund:last');
    const l1 = await lineWithWallet(10000);
    const l2 = await lineWithWallet(10000);
    const c1 = await tdb.pool.connect();
    const c2 = await tdb.pool.connect();
    try {
      const results = await Promise.allSettled([
        asDefiner('select app.wallet_spend($1, 10000, $2, $3)', [PLAYER, l1.order, l1.line], A, c1),
        asDefiner('select app.wallet_spend($1, 10000, $2, $3)', [PLAYER, l2.order, l2.line], A, c2),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(String(failed.reason)).toMatch(/wallet:insufficient/);
    } finally {
      c1.release();
      c2.release();
    }
    expect(await balance()).toBe(0);
  });
  it('spends the line’s frozen wallet part once; a repeat writes nothing; after a return the next attempt is keyed :2', async () => {
    await credit(30000, 'refund:a');
    const l = await lineWithWallet(10000);
    await expect(spend(5000, l)).rejects.toThrow(/wallet:amount/);
    const first = await spend(10000, l);
    expect(await spend(10000, l)).toBe(first);
    expect(await balance()).toBe(20000);
    expect(await one('select app.wallet_return($1, $2)', [l.order, 'hold_expired'])).toBe(1);
    await spend(10000, l);
    const keys = (await tdb.query(`select dedupe_key from public.wallet_ledger where reason = 'spend' order by created_at, dedupe_key`)).rows.map((r) => r.dedupe_key);
    expect(keys).toEqual([`spend:${l.line}:1`, `spend:${l.line}:2`]);
    expect(await balance()).toBe(20000);
  });
  it('refuses more than the balance, and a line of another order or customer', async () => {
    await credit(5000, 'refund:b');
    const l = await lineWithWallet(10000);
    await expect(spend(10000, l)).rejects.toThrow(/wallet:insufficient/);
    const other = await lineWithWallet(1000, DESK);
    await expect(spend(1000, other)).rejects.toThrow(/line_not_found/);
    await expect(one('select app.wallet_spend($1, 1000, $2, $3)', [PLAYER, l.order, other.line])).rejects.toThrow(/line_not_found/);
    expect(await balance()).toBe(5000);
  });
  it('a spend on an unclaimed or inactive customer is refused (customer_not_claimed)', async () => {
    await credit(10000, 'import:i', IMPORTED, 'import');
    await credit(10000, 'refund:g', GONE);
    const li = await lineWithWallet(1000, IMPORTED);
    const lg = await lineWithWallet(1000, GONE);
    await expect(spend(1000, li, IMPORTED)).rejects.toThrow(/customer_not_claimed/);
    await expect(spend(1000, lg, GONE)).rejects.toThrow(/customer_not_claimed/);
    expect(await balance(IMPORTED)).toBe(10000);
  });
});

describe('wallet_return (design 4.1)', () => {
  it('called twice returns once; returns every spend of the order', async () => {
    await credit(20000, 'refund:c');
    const l = await lineWithWallet(10000);
    await spend(10000, l);
    expect(await balance()).toBe(10000);
    expect(await one('select app.wallet_return($1, $2)', [l.order, 'released'])).toBe(1);
    expect(await one('select app.wallet_return($1, $2)', [l.order, 'released'])).toBe(0);
    expect(await balance()).toBe(20000);
    const r = (await tdb.query(`select reason, change_satang, order_line_id, dedupe_key from public.wallet_ledger where reason = 'return'`)).rows;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ change_satang: '10000', order_line_id: l.line });
  });
  it('an order with no spend writes nothing; an unknown order is refused; a reason is required', async () => {
    const l = await lineWithWallet(1000);
    expect(await one('select app.wallet_return($1, $2)', [l.order, 'released'])).toBe(0);
    await expect(one('select app.wallet_return(gen_random_uuid(), $1)', ['released'])).rejects.toThrow(/order_not_found/);
    await expect(one('select app.wallet_return($1, $2)', [l.order, ' '])).rejects.toThrow(/wallet:reason/);
  });
});

describe('wallet_adjust (PKG-01-AC4, AC7; D83)', () => {
  const adjust = (user: string, roles: string[], customer: string, delta: number, note: string | null) =>
    web.withClubTx(ctx(user, roles), (tx) => tx.query('select app.wallet_adjust($1, $2, $3) as id', [customer, delta, note]));
  it('front desk and owner adjust with a written note; the row names the staff member and is audited', async () => {
    await adjust(DESK, ['front_desk', 'player'], PLAYER, 5000, 'goodwill after a rain-out');
    await adjust(OWNER, ['owner', 'player'], PLAYER, -2000, 'typed twice');
    expect(await balance()).toBe(3000);
    const rows = (await tdb.query(`select staff_id, note from public.wallet_ledger where reason = 'adjust' order by change_satang desc`)).rows;
    expect(rows).toEqual([{ staff_id: DESK, note: 'goodwill after a rain-out' }, { staff_id: OWNER, note: 'typed twice' }]);
    expect(Number((await tdb.query(`select count(*) from public.audit_entry where record_type = 'wallet_ledger'`)).rows[0].count)).toBe(2);
  });
  it('without a note it is refused; a player or coach cannot adjust', async () => {
    await expect(adjust(DESK, ['front_desk', 'player'], PLAYER, 5000, null)).rejects.toThrow(/note_required/);
    await expect(adjust(DESK, ['front_desk', 'player'], PLAYER, 5000, '   ')).rejects.toThrow(/note_required/);
    await expect(adjust(PLAYER, ['player'], PLAYER, 5000, 'me')).rejects.toThrow(/forbidden/);
    await expect(adjust(COACH, ['coach', 'player'], PLAYER, 5000, 'me')).rejects.toThrow(/forbidden/);
    expect(await balance()).toBe(0);
  });
  it('an adjust that would go negative is refused; one that reduces an unclaimed record is refused', async () => {
    await credit(1000, 'refund:d');
    await expect(adjust(OWNER, ['owner', 'player'], PLAYER, -1001, 'too much')).rejects.toThrow(/below_zero/);
    await adjust(OWNER, ['owner', 'player'], PLAYER, -1000, 'exact');
    expect(await balance()).toBe(0);
    await credit(1000, 'import:e', IMPORTED, 'import');
    await expect(adjust(OWNER, ['owner', 'player'], IMPORTED, -500, 'x')).rejects.toThrow(/customer_not_claimed/);
    await adjust(OWNER, ['owner', 'player'], IMPORTED, 500, 'import fix');
  });
  it('the other wallet functions are not callable by the app roles; another club’s customer is out of reach', async () => {
    for (const f of ['app.wallet_credit(uuid, bigint, text, text, uuid, uuid, uuid, uuid)', 'app.wallet_credit_order(uuid, bigint, text, text, uuid)',
      'app.wallet_spend(uuid, bigint, uuid, uuid)', 'app.wallet_return(uuid, text)']) {
      for (const role of ['booq_app', 'booq_worker', 'booq_platform']) {
        expect((await tdb.query('select has_function_privilege($1, $2, $3) as ok', [role, f, 'execute'])).rows[0].ok, `${role} ${f}`).toBe(false);
      }
    }
    await expect(adjust(OWNER, ['owner', 'player'], PLAYER_B, 500, 'x')).rejects.toThrow(/customer_not_found/);
  });
});
