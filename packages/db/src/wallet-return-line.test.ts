import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F06-T25 / migration 0515: app.wallet_return_line(order_line, reason) gives back the wallet spend of one order line
// (PKG-01-AC8, R1-AC6, AC7; D158; F09 design 4.4 and A-4). A one hour cancel of a two hour order returns only that
// hour's wallet use. The key is the same as app.wallet_return's (return:{spend_row}), so the two never return a spend
// twice whichever runs first.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const PLAYER_B = '22222222-2222-4222-8222-222222222222';

let tdb: TestDatabase;

/** Runs SQL as F09's definer functions will: as booq_owner, in a club's context. */
async function asDefiner(sql: string, args: unknown[] = [], club = A): Promise<unknown> {
  const c: pg.PoolClient = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role booq_owner');
    await c.query(`select set_config('app.club_id', $1, true)`, [club]);
    const r = await c.query(sql, args);
    await c.query('commit');
    return Object.values(r.rows[0] ?? {})[0];
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

/** An order with `lines` lines (package lines: no booking to point at), each with a wallet part of `wallet` satang (fixture: sums checked off). */
async function order(lines: number, wallet: number, opts: { club?: string; customer?: string | null } = {}) {
  const club = opts.club ?? A;
  const customer = opts.customer === undefined ? PLAYER : opts.customer;
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    const o = (await c.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [club, customer])).rows[0].id as string;
    const ids: string[] = [];
    for (let i = 1; i <= lines; i += 1) {
      ids.push((await c.query(
        `insert into public.order_line (club_id, order_id, position, kind, package_product_id, description_key, name_th, name_en, unit_price_satang, net_satang, wallet_satang)
         values ($1,$2,$3,'package',gen_random_uuid(),'k','ก','x',$4,$4,$4) returning id`, [club, o, i, wallet])).rows[0].id as string);
    }
    await c.query('commit');
    return { order: o, lines: ids };
  } finally {
    c.release();
  }
}
const spend = (customer: string, amount: number, o: string, line: string, club = A) => asDefiner('select app.wallet_spend($1, $2, $3, $4)', [customer, amount, o, line], club);
const credit = (customer: string, amount: number, key: string, club = A) => asDefiner(`select app.wallet_credit($1, $2, 'refund', $3)`, [customer, amount, key], club);
const returnLine = (line: string, reason = 'player_cancel', club = A) => asDefiner('select app.wallet_return_line($1, $2)', [line, reason], club);
const rows = async (reason: string) =>
  (await tdb.query(`select order_line_id, change_satang, dedupe_key from public.wallet_ledger where reason = $1 order by order_line_id`, [reason])).rows;
const balance = async (customer = PLAYER) => Number((await tdb.query(`select coalesce(sum(change_satang), 0) n from public.wallet_ledger where customer_id = $1`, [customer])).rows[0].n);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  for (const [club, u] of [[A, PLAYER], [B, PLAYER_B]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [club, u, 'L' + u.slice(0, 2)]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [club, u]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
});
afterEach(async () => {
  await tdb.close();
});

describe('app.wallet_return_line (F06-T25, D158)', () => {
  it('returns only the wallet spend of the one line, keyed return:{spend_row}', async () => {
    await credit(PLAYER, 20000, 'seed');
    const o = await order(2, 10000);
    await spend(PLAYER, 10000, o.order, o.lines[0]!);
    await spend(PLAYER, 10000, o.order, o.lines[1]!);
    expect(await balance()).toBe(0);
    expect(await returnLine(o.lines[0]!)).toBe(1);
    const spends = (await tdb.query(`select id, order_line_id from public.wallet_ledger where reason = 'spend'`)).rows;
    const first = spends.find((s) => s.order_line_id === o.lines[0])!;
    expect(await rows('return')).toEqual([{ order_line_id: o.lines[0], change_satang: '10000', dedupe_key: `return:${first.id}` }]);
    expect(await balance()).toBe(10000);
  });

  it('a repeat writes nothing, and a later wallet_return of the order returns only the other line', async () => {
    await credit(PLAYER, 20000, 'seed');
    const o = await order(2, 10000);
    await spend(PLAYER, 10000, o.order, o.lines[0]!);
    await spend(PLAYER, 10000, o.order, o.lines[1]!);
    expect(await returnLine(o.lines[0]!)).toBe(1);
    expect(await returnLine(o.lines[0]!)).toBe(0);
    expect(await asDefiner('select app.wallet_return($1, $2)', [o.order, 'release'])).toBe(1);
    expect((await rows('return')).map((r) => r.order_line_id).sort()).toEqual([...o.lines].sort());
    expect(await balance()).toBe(20000);
  });

  it('after wallet_return of the whole order, the line returns nothing more', async () => {
    await credit(PLAYER, 10000, 'seed');
    const o = await order(1, 10000);
    await spend(PLAYER, 10000, o.order, o.lines[0]!);
    expect(await asDefiner('select app.wallet_return($1, $2)', [o.order, 'release'])).toBe(1);
    expect(await returnLine(o.lines[0]!)).toBe(0);
    expect(await balance()).toBe(10000);
  });

  it('a line with no wallet spend, and a walk in line with no customer, return nothing', async () => {
    const o = await order(1, 0);
    expect(await returnLine(o.lines[0]!)).toBe(0);
    const walkIn = await order(1, 0, { customer: null });
    expect(await returnLine(walkIn.lines[0]!)).toBe(0);
  });

  it("refuses a blank reason, an unknown line and another club's line", async () => {
    const o = await order(1, 0);
    await expect(returnLine(o.lines[0]!, '  ')).rejects.toThrow(/wallet:reason/);
    await expect(returnLine('ffffffff-0000-4000-8000-000000000000')).rejects.toThrow(/wallet:line_not_found/);
    const other = await order(1, 0, { club: B, customer: PLAYER_B });
    await expect(returnLine(other.lines[0]!)).rejects.toThrow(/wallet:line_not_found/);
  });

  it('no app role may call it: F09 and F08 call it from their definer functions', async () => {
    for (const role of ['booq_app', 'booq_worker', 'booq_platform']) {
      expect((await tdb.query(`select has_function_privilege($1, 'app.wallet_return_line(uuid, text)', 'execute') as ok`, [role])).rows[0].ok, role).toBe(false);
    }
  });
});
