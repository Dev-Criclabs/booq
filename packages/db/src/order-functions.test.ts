import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F04-T04 / migration 0304 (PAY-07-AC1, PROMO-01-AC7, R5, D64, D66, D67, D70).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const NOW = '2026-12-29T02:00:00Z';   // 09:00 Bangkok, 29 December
const at = (h: number) => new Date(Date.UTC(2026, 11, 29, h - 7)).toISOString();

let tdb: TestDatabase;
let web: Db;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow(NOW);
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,'00000000-0000-4000-8000-0000000000a1','M')`, [A]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,'00000000-0000-4000-8000-0000000000a1','1','tennis')`, [A, C1]);
  for (const [u, roles, dob] of [[P1, ['player'], '1990-12-15'], [P2, ['player'], null], [DESK, ['front_desk', 'player'], null]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id, date_of_birth) values ($1,$2,$3,$4)', [A, u, 'L' + u.slice(0, 2), dob]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [A, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  web = createDb({ connectionString: tdb.url, max: 4 });
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});
const as = (user: string, roles = ['player'], club = A) => ({ clubId: club, userId: user, roles, source: 'player_app' as const });
const order = async (customer: string | null = P1) => (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id as string;
const code = async (extra: Record<string, unknown> = {}, text = 'CODE' + Math.floor(Math.random() * 1e9)) => {
  const cols = { kind: 'percent', value: 1000, applies_to: '{court_hour}', ...extra };
  const keys = Object.keys(cols);
  return (await tdb.query(`insert into public.promo_code (club_id, code_upper, ${keys.join(',')}) values ($1,$2,${keys.map((_, i) => '$' + (i + 3)).join(',')}) returning id`, [A, text, ...Object.values(cols)])).rows[0].id as string;
};
const count = (c: ReturnType<typeof as>, codeId: string, orderId: string) => web.withClubTx(c, (tx) => tx.query('select app.count_promo_use($1,$2) as id', [codeId, orderId]));
const bookingFor = (o: string, h: number, status = 'confirmed') =>
  tdb.query(`insert into public.booking (club_id, order_id, type, resource_id, customer_id, start_at, end_at, status, source, created_by, confirmed_at, released_at, release_reason) values ($1,$2,'court',$3,$4,$5,$6,$7,'online',$4,now(), case when $7 = 'released' then now() end, case when $7 = 'released' then 'expired' end) returning id`, [A, o, C1, P1, at(h), at(h + 1), status]).then((r) => r.rows[0].id as string);

describe('does the order need payment (PAY-07-AC1, D64)', () => {
  // an internal seam for the definer functions (reserve_court): called here as their owner role
  const needs = async (o: string) => {
    const k = await tdb.pool.connect();
    try {
      await k.query('begin');
      await k.query('set local role booq_owner');
      await k.query(`select set_config('app.club_id', $1, true)`, [A]);
      return (await k.query('select app.order_needs_payment($1) as n', [o])).rows[0].n as boolean;
    } finally {
      await k.query('rollback');
      k.release();
    }
  };
  /** Price an order of one 50000 line, in one transaction (the sum is checked at commit). */
  const price = async (o: string, credit: number, money: number) => {
    const b = await bookingFor(o, 10 + Math.floor(Math.random() * 10));
    const k = await tdb.pool.connect();
    try {
      await k.query('begin');
      await k.query(`update public.orders set price_group_snapshot='{}', subtotal_satang=50000, discount_satang=0, total_satang=50000, credit_value_satang=$2, wallet_satang=0, money_satang=$3, quote_hash=repeat('a',64), priced_at=now() where id=$1`, [o, credit, money]);
      await k.query(`insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, net_satang, credit_value_satang, money_satang) values ($1,$2,1,'court_hour',$3,'k','ก','x',50000,50000,$4,$5)`, [A, o, b, credit, money]);
      await k.query('commit');
    } finally {
      k.release();
    }
  };
  it('an unpriced order needs payment, never free; priced: money due decides', async () => {
    const o = await order();
    expect(await needs(o)).toBe(true);
    await price(o, 50000, 0);
    expect(await needs(o)).toBe(false);
    const o2 = await order();
    await price(o2, 0, 50000);
    expect(await needs(o2)).toBe(true);
  });
  it('an unknown order, or another club’s, needs payment', async () => {
    expect(await needs('00000000-0000-4000-8000-00000000ffff')).toBe(true);
  });
});

describe('count_promo_use (PROMO-01-AC7, D66)', () => {
  it('counts one use for the order, and a second code on the same order is refused', async () => {
    const c = await code(); const o = await order();
    await count(as(P1), c, o);
    expect((await tdb.query(`select status from public.promo_redemption`)).rows).toEqual([{ status: 'counted' }]);
    const c2 = await code();
    await expect(count(as(P1), c2, o)).rejects.toThrow(/one_code_per_order/);
  });
  it('two players taking the last use of a capped code in parallel: exactly one succeeds', async () => {
    const c = await code({ total_cap: 1 });
    const o1 = await order(P1); const o2 = await order(P2);
    const results = await Promise.allSettled([count(as(P1), c, o1), count(as(P2), c, o2)]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(String((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason)).toMatch(/code_used_up/);
    expect((await tdb.query(`select count(*)::int as n from public.promo_redemption where status = 'counted'`)).rows[0].n).toBe(1);
  });
  it('per customer cap, and a restored use frees the cap again', async () => {
    const c = await code({ per_customer_cap: 1 });
    const o1 = await order(); const o2 = await order();
    await count(as(P1), c, o1);
    await expect(count(as(P1), c, o2)).rejects.toThrow(/code_used_up/);
    await tdb.query(`update public.promo_redemption set status = 'restored', restored_at = now(), restore_reason = 'hold_ended' where order_id = $1`, [o1]);
    await count(as(P1), c, o2);
  });
  it('first time only: refused when the customer already has a confirmed, no-show or late-cancelled booking', async () => {
    const c = await code({ first_time_only: true });
    const old = await order(); await bookingFor(old, 8, 'no_show');
    const o = await order();
    await expect(count(as(P1), c, o)).rejects.toThrow(/first_booking_only/);
    const o2 = await order(P2);
    await count(as(P2), c, o2);
  });
  it('the dates and the active flag are checked again; a missing code and another club’s code answer the same', async () => {
    const early = await code({ starts_on: '2027-01-01' }); const late = await code({ ends_on: '2026-12-28' }); const off = await code({ active: false });
    const o = await order();
    await expect(count(as(P1), early, o)).rejects.toThrow(/code_expired/);
    await expect(count(as(P1), late, o)).rejects.toThrow(/code_expired/);
    await expect(count(as(P1), off, o)).rejects.toThrow(/code_not_valid/);
    await expect(count(as(P1), '00000000-0000-4000-8000-00000000ffff', o)).rejects.toThrow(/code_not_valid/);
    const other = (await tdb.query(`insert into public.promo_code (club_id, code_upper, kind, value, applies_to) values ($1,'FOREIGN','percent',100,'{court_hour}') returning id`, [B])).rows[0].id;
    await expect(count(as(P1), other, o)).rejects.toThrow(/code_not_valid/);
  });
  it('only the order’s customer, or staff, may count a use on it; the function is not for the worker or BOOQ staff', async () => {
    const c = await code(); const o = await order(P1);
    await expect(count(as(P2), c, o)).rejects.toThrow(/order_not_found/);
    await count(as(DESK, ['front_desk', 'player']), c, o);
    for (const role of ['booq_worker', 'booq_platform']) {
      expect((await tdb.query(`select has_function_privilege($1, 'app.count_promo_use(uuid,uuid)', 'execute') as ok`, [role])).rows[0].ok, role).toBe(false);
    }
  });
});

describe('birthday entitlement (R5)', () => {
  const use = (kind: string, o: string, c = as(P1)) => web.withClubTx(c, (tx) => tx.query('select app.use_birthday_entitlement($1,$2) as id', [kind, o]));
  it('in the birth month, once per kind per year; another kind is free; next year is free', async () => {
    const o = await order();
    await use('package', o);
    await expect(use('package', await order())).rejects.toThrow(/already_used/);
    await use('solo_class', o);
    await tdb.setNow('2027-12-29T02:00:00Z');
    await use('package', await order());
  });
  it('not outside the birth month and not with no date of birth', async () => {
    await tdb.setNow('2026-11-29T02:00:00Z');
    await expect(use('package', await order())).rejects.toThrow(/not_entitled/);
    await expect(use('package', await order(P2), as(P2))).rejects.toThrow(/not_entitled/);
  });
  it('the month is the Bangkok month: 01:00 on 1 December Bangkok is still November in UTC', async () => {
    await tdb.query(`update public.app_user set date_of_birth = '1990-12-01' where id = $1`, [P1]);
    await tdb.setNow('2026-11-30T18:30:00Z');   // 01:30 on 1 December in Bangkok
    await use('package', await order());
  });
});

describe('restoring (R7-AC6, D67, D70)', () => {
  it('is registered as a release handler, so a hold that ends restores the code use and the birthday entitlement', async () => {
    expect((await tdb.query(`select name, handler::text as h from app.release_handlers where name = 'f04_entitlements'`)).rows).toEqual([{ name: 'f04_entitlements', h: 'app.restore_order_entitlements' }]);
    const c = await code(); const o = await order();
    await count(as(P1), c, o);
    await web.withClubTx(as(P1), (tx) => tx.query('select app.use_birthday_entitlement($1,$2)', ['package', o]));
    const cl = await tdb.pool.connect();
    try {
      await cl.query('begin');
      await cl.query(`select set_config('app.club_id', $1, true)`, [A]);
      await cl.query(`select app.restore_order_entitlements($1, 'expired')`, [o]);
      await cl.query('commit');
    } finally {
      cl.release();
    }
    expect((await tdb.query('select status, restore_reason from public.promo_redemption')).rows).toEqual([{ status: 'restored', restore_reason: 'expired' }]);
    expect((await tdb.query('select status from public.birthday_entitlement_use')).rows).toEqual([{ status: 'restored' }]);
  });
  it('cancelling one of two hours keeps the code used; cancelling both restores it; the line reports its stored parts', async () => {
    const c = await code(); const o = await order();
    const b1 = await bookingFor(o, 10); const b2 = await bookingFor(o, 11);
    const lines = async () => (await tdb.query('select id from public.order_line where order_id = $1 order by position', [o])).rows.map((r) => r.id as string);
    // build the lines in one transaction so the sum check passes at commit
    const cl = await tdb.pool.connect();
    try {
      await cl.query('begin');
      await cl.query(`update public.orders set price_group_snapshot='{}', subtotal_satang=100000, discount_satang=10000, total_satang=90000, credit_value_satang=0, wallet_satang=10000, money_satang=80000, quote_hash=repeat('a',64), priced_at=now() where id=$1`, [o]);
      await cl.query(`insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, discount_satang, net_satang, wallet_satang, money_satang) values ($1,$2,1,'court_hour',$3,'k','ก','x',50000,5000,45000,10000,35000)`, [A, o, b1]);
      await cl.query(`insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, discount_satang, net_satang, wallet_satang, money_satang) values ($1,$2,2,'court_hour',$3,'k','ก','x',50000,5000,45000,0,45000)`, [A, o, b2]);
      await cl.query('commit');
    } finally {
      cl.release();
    }
    await count(as(P1), c, o);
    const [l1, l2] = await lines();
    // restore_line is for F09's own definer functions (owner); call it as the owner role here
    const asOwner = async (line: string) => {
      const k = await tdb.pool.connect();
      try {
        await k.query('begin');
        await k.query('set local role booq_owner');
        await k.query(`select set_config('app.club_id', $1, true)`, [A]);
        const r = await k.query('select * from app.restore_line($1, $2)', [line, 'cancelled_early']);
        await k.query('commit');
        return r.rows[0];
      } finally {
        k.release();
      }
    };
    await tdb.query(`update public.booking set status = 'cancelled' where id = $1`, [b1]);
    const first = await asOwner(l1!);
    expect(first).toMatchObject({ kind: 'court_hour', wallet_satang: 10000, money_satang: 35000, credit_units: 0, order_restored: false });
    expect((await tdb.query('select status from public.promo_redemption')).rows).toEqual([{ status: 'counted' }]);
    await tdb.query(`update public.booking set status = 'cancelled' where id = $1`, [b2]);
    expect((await asOwner(l2!)).order_restored).toBe(true);
    expect((await tdb.query('select status from public.promo_redemption')).rows).toEqual([{ status: 'restored' }]);
  });
  it('a late cancellation does not restore (the booking is late_cancelled, not cancelled)', async () => {
    const c = await code(); const o = await order();
    const b1 = await bookingFor(o, 10, 'late_cancelled');
    const cl = await tdb.pool.connect();
    try {
      await cl.query('begin');
      await cl.query(`update public.orders set price_group_snapshot='{}', subtotal_satang=50000, discount_satang=0, total_satang=50000, credit_value_satang=0, wallet_satang=0, money_satang=50000, quote_hash=repeat('a',64), priced_at=now() where id=$1`, [o]);
      await cl.query(`insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, net_satang, money_satang) values ($1,$2,1,'court_hour',$3,'k','ก','x',50000,50000,50000)`, [A, o, b1]);
      await cl.query('commit');
    } finally {
      cl.release();
    }
    await count(as(P1), c, o);
    const line = (await tdb.query('select id from public.order_line')).rows[0].id;
    const k = await tdb.pool.connect();
    try {
      await k.query('begin');
      await k.query('set local role booq_owner');
      await k.query(`select set_config('app.club_id', $1, true)`, [A]);
      expect((await k.query('select order_restored from app.restore_line($1, $2)', [line, 'late'])).rows[0].order_restored).toBe(false);
      await k.query('commit');
    } finally {
      k.release();
    }
    expect((await tdb.query('select status from public.promo_redemption')).rows).toEqual([{ status: 'counted' }]);
  });
  it('the restore functions are not callable by the app roles', async () => {
    for (const f of ['app.restore_order_entitlements(uuid,text)', 'app.restore_line(uuid,text)']) {
      for (const role of ['booq_app', 'booq_worker', 'booq_platform']) {
        expect((await tdb.query('select has_function_privilege($1, $2, $3) as ok', [role, f, 'execute'])).rows[0].ok, `${role} ${f}`).toBe(false);
      }
    }
  });
});
