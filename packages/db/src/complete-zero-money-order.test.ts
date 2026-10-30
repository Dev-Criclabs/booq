import { createDb, type Db } from './tx';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { A, log, order, PLAYER, setup, tdb, teardown } from './testing/payment-fixtures';

// F04-T12d-db / migration 0319: app.complete_zero_money_order (PAY-07-AC1 to AC6, D64).
const OTHER = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
let web: Db;

const ctx = (user: string | null, roles: string[]) => ({ clubId: A, userId: user, roles: roles as never, source: 'player_app' as const });
const complete = (o: string, c = ctx(PLAYER, ['player'])) => web.withClubTx(c, async (tx) => (await tx.query(`select app.complete_zero_money_order($1) as id`, [o])).rows[0]?.id as string);
/** A priced order paid in full by credit (money 0) whose hour reserve_court has already confirmed. */
async function zero(opts: { confirmed?: boolean } = {}) {
  const o = await order('held', { credit: 50000 });
  if (opts.confirmed !== false) {
    await tdb.query(`update public.booking set status = 'confirmed', confirmed_at = app.now(), hold_expires_at = null where order_id = $1`, [o]);
    await tdb.query(`update public.occupancy set state = 'confirmed', hold_expires_at = null where booking_id in (select id from public.booking where order_id = $1)`, [o]);
  }
  return o;
}
const status = async (o: string) => (await tdb.query(`select status from public.orders where id = $1`, [o])).rows[0].status;

beforeEach(async () => {
  await setup();
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    for (const [u, roles] of [[OTHER, ['player']], [DESK, ['front_desk', 'player']]] as const) {
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [A, u, 'L' + u.slice(0, 3)]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [A, u, r]);
    }
    await c.query('commit');
  } finally {
    c.release();
  }
  web = createDb({ connectionString: tdb.url, max: 3 });
});
afterEach(async () => {
  await web.end();
  await teardown();
});

describe('app.complete_zero_money_order', () => {
  it('marks the order paid, issues the receipt with no payment, and tells the player the booking is confirmed', async () => {
    const o = await zero();
    const id = await complete(o);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await status(o)).toBe('paid');
    expect(await log()).toEqual([
      { port: 'issue_receipt', args: [o, null, 'order'] },
      { port: 'enqueue_message', args: ['booking_confirmed', PLAYER, { order_id: o }, `confirmed:${o}`] },
    ]);
  });

  it('a second call returns the same receipt id and issues nothing more', async () => {
    const o = await zero();
    const id = await complete(o);
    expect(await complete(o)).toBe(id);
    expect((await log()).filter((l) => l.port === 'issue_receipt')).toHaveLength(1);
  });

  it('staff may complete any order of the club; another player may not, and a guest may not', async () => {
    const o = await zero();
    await expect(complete(o, ctx(OTHER, ['player']))).rejects.toThrow(/no such order/);
    await expect(complete(o, ctx(null, ['guest']))).rejects.toThrow(/not allowed/);
    await expect(complete('99999999-9999-4999-8999-999999999999')).rejects.toThrow(/no such order/);
    expect(await complete(o, ctx(DESK, ['front_desk', 'player']))).toBeTruthy();
    expect(await status(o)).toBe('paid');
  });

  it('refuses an order that still has money due, is unpriced, or is cancelled; nothing changes', async () => {
    const due = await order('held');                                             // money 50000
    await expect(complete(due)).rejects.toThrow(/nothing to pay/);
    const unpriced = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, PLAYER])).rows[0].id;
    await expect(complete(unpriced)).rejects.toThrow(/nothing to pay/);
    const gone = await zero();
    await tdb.query(`update public.orders set status = 'cancelled' where id = $1`, [gone]);
    await expect(complete(gone)).rejects.toThrow(/nothing to pay/);
    expect(await status(due)).toBe('open');
    expect(await log()).toEqual([]);
  });

  it('refuses an order whose booking is still awaiting payment, or that has no lines', async () => {
    const held = await zero({ confirmed: false });
    await expect(complete(held)).rejects.toThrow(/not confirmed/);
    expect(await status(held)).toBe('open');
    const bare = await zero();
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local session_replication_role = replica');
      await c.query(`delete from public.order_line where order_id = $1`, [bare]);   // line removal is blocked by the append-only trigger otherwise
      await c.query('commit');
    } finally {
      c.release();
    }
    await expect(complete(bare)).rejects.toThrow(/no lines/);
  });

  it('a paid order with money due is not a zero money order', async () => {
    const o = await order('held');
    await tdb.query(`update public.orders set status = 'paid' where id = $1`, [o]).catch(() => undefined);
    await expect(complete(o)).rejects.toThrow(/nothing to pay/);
  });

  it('fails closed when the receipt port is not registered', async () => {
    await tdb.query(`delete from app.payment_ports where port = 'issue_receipt'`);
    const o = await zero();
    await expect(complete(o)).rejects.toThrow(/port_missing:issue_receipt/);
    expect(await status(o)).toBe('open');
  });

  it('is granted to booq_app only', async () => {
    const f = (r: string) => tdb.query(`select has_function_privilege($1, 'app.complete_zero_money_order(uuid)', 'execute') as ok`, [r]).then((x) => x.rows[0].ok);
    expect(await f('booq_app')).toBe(true);
    expect(await f('booq_worker')).toBe(false);
    expect(await f('booq_platform')).toBe(false);
  });
});
