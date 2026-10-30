import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F05-T04a / migration 0403: app.start_payment and the release reason payment_unavailable
// (PAY-02-AC1 to AC3, PAY-01-AC7; D47, D72, D75).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const RES = '00000000-0000-4000-8000-0000000000c1';
let tdb: TestDatabase;
let web: Db;

const ctx = (user: string | null, roles: string[]) => ({ clubId: A, userId: user, roles: roles as never, source: 'player_app' as const });
const player = () => ctx(PLAYER, ['player']);

async function setup(status = 'live') {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A',$2)`, [A, status]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, RES, LOC]);
  for (const [u, roles] of [[PLAYER, ['player']], [OTHER, ['player']], [DESK, ['front_desk', 'player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [A, u, 'L' + u.slice(0, 2)]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [A, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  web = createDb({ connectionString: tdb.url, max: 2 });
}
async function order(opts: { money?: number; priced?: boolean; hold?: 'running' | 'expired' | 'none'; customer?: string } = {}) {
  const money = opts.money ?? 50000;
  const o = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, opts.customer ?? PLAYER])).rows[0].id as string;
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local session_replication_role = replica`);
    if (opts.priced !== false) {
      await c.query(`update public.orders set price_group_snapshot='{}', subtotal_satang=$2, discount_satang=0, total_satang=$2, credit_value_satang=0, wallet_satang=0, money_satang=$2, quote_hash=repeat('a',64), priced_at=now() where id=$1`, [o, money]);
    }
    if ((opts.hold ?? 'running') !== 'none') {
      const hold = opts.hold === 'expired' ? `now() - interval '1 minute'` : `now() + interval '10 minutes'`;
      await c.query(`insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, hold_expires_at)
                     values ($1,$2,'court',$3, date_trunc('hour', now()) + interval '30 hours', date_trunc('hour', now()) + interval '31 hours', $4, 'awaiting_payment','online',$4, ${hold})`, [A, o, RES, opts.customer ?? PLAYER]);
    }
    await c.query('commit');
  } finally {
    c.release();
  }
  return o;
}
const start = (o: string, c = player()) => web.withClubTx(c, async (tx) => (await tx.query(`select app.start_payment($1) as id`, [o])).rows[0]?.id as string);
const release = (o: string, reason: string, c = player()) => web.withClubTx(c, async (tx) => (await tx.query(`select app.release_hold($1, $2) as r`, [o, reason])).rows[0]?.r as boolean);

afterEach(async () => {
  await web.end();
  await tdb.close();
});

describe('app.start_payment', () => {
  beforeEach(() => setup());

  it('inserts one pending Beam payment for exactly the money due, in the live key set for a Live club', async () => {
    const o = await order({ money: 123400 });
    const id = await start(o);
    const p = (await tdb.query(`select * from public.payment where id = $1`, [id])).rows[0];
    expect(p).toMatchObject({ order_id: o, method: 'beam', status: 'pending', gateway: 'beam', environment: 'live', amount_satang: 123400, gateway_charge_id: null, is_test: false });
  });

  it('a second call returns the same payment, even from another request (D47, D72)', async () => {
    const o = await order();
    const a = await start(o);
    expect(await start(o)).toBe(a);
    expect((await tdb.query(`select count(*)::int as n from public.payment where order_id = $1`, [o])).rows[0].n).toBe(1);
  });

  it('after a failed payment a new one is created in the same hold', async () => {
    const o = await order();
    const a = await start(o);
    await tdb.query(`update public.payment set status = 'failed', failure_code = 'DECLINED' where id = $1`, [a]);
    const b = await start(o);
    expect(b).not.toBe(a);
  });

  it('an unpriced order, a zero money order, an order without a running hold and a closed order get none', async () => {
    await expect(start(await order({ priced: false }))).rejects.toThrow(/not priced/);
    await expect(start(await order({ money: 0 }))).rejects.toThrow(/nothing to pay|payment_amount|positive/);
    await expect(start(await order({ hold: 'expired' }))).rejects.toThrow(/hold is not running/);
    await expect(start(await order({ hold: 'none' }))).rejects.toThrow(/hold is not running/);
    const paid = await order();
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local session_replication_role = replica');
      await c.query(`update public.orders set status = 'cancelled' where id = $1`, [paid]);
      await c.query('commit');
    } finally {
      c.release();
    }
    await expect(start(paid)).rejects.toThrow(/no open order/);
  });

  it('only the order’s player, staff or the worker may start it; another player and a guest may not', async () => {
    const o = await order();
    await expect(start(o, ctx(OTHER, ['player']))).rejects.toThrow(/not allowed/);
    await expect(start(o, ctx(null, ['guest']))).rejects.toThrow(/not allowed/);
    await expect(start('99999999-9999-4999-8999-999999999999')).rejects.toThrow(/no open order/);
    expect(await start(o, ctx(DESK, ['front_desk', 'player']))).toBeTruthy();
  });
});

describe('the Testing key set', () => {
  it('a Testing club uses the test set and marks the payment as test data', async () => {
    await setup('testing');
    const o = await order();
    const id = await start(o);
    expect((await tdb.query(`select environment, is_test from public.payment where id = $1`, [id])).rows[0]).toEqual({ environment: 'test', is_test: true });
  });
});

describe('release reason payment_unavailable', () => {
  beforeEach(() => setup());

  it('releases the hold for the order’s player, fails the pending payment and clears the QR', async () => {
    const o = await order();
    const id = await start(o);
    await tdb.query(`update public.payment set qr_image = 'abc', qr_expires_at = now() + interval '5 minutes' where id = $1`, [id]);
    expect(await release(o, 'payment_unavailable')).toBe(true);
    expect((await tdb.query(`select status, release_reason, hold_expires_at from public.booking where order_id = $1`, [o])).rows[0]).toEqual({ status: 'released', release_reason: 'payment_unavailable', hold_expires_at: null });
    expect((await tdb.query(`select status, failure_code, qr_image from public.payment where id = $1`, [id])).rows[0]).toEqual({ status: 'failed', failure_code: 'payment_unavailable', qr_image: null });
    expect(await release(o, 'payment_unavailable')).toBe(false);   // nothing left to release
  });

  it('another player may not end it, and the other reasons still behave as before', async () => {
    const o = await order();
    await expect(release(o, 'payment_unavailable', ctx(OTHER, ['player']))).rejects.toThrow(/not allowed/);
    await expect(release(o, 'player', ctx(OTHER, ['player']))).rejects.toThrow(/not allowed/);
    await expect(release(o, 'bogus')).rejects.toThrow(/unknown release reason/);
    expect(await release(o, 'staff', ctx(DESK, ['front_desk', 'player']))).toBe(true);
  });
});

describe('app.flag_key_check_failed (D75)', () => {
  beforeEach(() => setup());
  const flag = (c = player()) => web.withClubTx(c, async (tx) => tx.query(`select app.flag_key_check_failed()`));
  const open = async () => (await tdb.query(`select kind, status from public.owner_flag where club_id = $1`, [A])).rows;

  it('raises one open owner flag of kind key_check_failed; repeats do not pile up', async () => {
    await flag();
    await flag();
    expect(await open()).toEqual([{ kind: 'key_check_failed', status: 'open' }]);
  });

  it('a guest cannot raise it', async () => {
    await expect(flag(ctx(null, ['guest']))).rejects.toThrow(/not allowed/);
  });
});
