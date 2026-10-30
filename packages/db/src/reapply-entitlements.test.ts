import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F04-T19 / migration 0313: app.reapply_order_entitlements (PAY-03-AC7, PROMO-01-AC7; D107, D109).
// A late payment that reclaims an order takes back the code use and the birthday entitlement the release gave up,
// under the same caps and locks, or reports why it cannot (then F05 sends the money to the wallet). All or nothing.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
let tdb: TestDatabase;

async function asOwner<T>(club: string, sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role booq_owner');
    await c.query(`select set_config('app.club_id', $1, true)`, [club]);
    const r = await c.query(sql, params);
    await c.query('commit');
    return r.rows as T[];
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const reapply = async (order: string, club = A) => (await asOwner<{ r: Record<string, unknown> }>(club, `select app.reapply_order_entitlements($1) as r`, [order]))[0]!.r;

async function user(club: string, id: string) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [club, id, 'L' + id.slice(0, 4) + club.slice(0, 2)]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [club, id]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
const order = async (customer = PLAYER, club = A) => (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [club, customer])).rows[0].id as string;
const code = async (extra: Record<string, unknown> = {}, text = 'SAVE10') => {
  const cols = { kind: 'percent', value: 1000, applies_to: '{court_hour}', ...extra };
  const keys = Object.keys(cols);
  return (await tdb.query(`insert into public.promo_code (club_id, code_upper, ${keys.join(',')}) values ($1,$2,${keys.map((_, i) => '$' + (i + 3)).join(',')}) returning id`, [A, text, ...Object.values(cols)])).rows[0].id as string;
};
const redemption = (c: string, o: string, status = 'restored', customer = PLAYER) =>
  tdb.query(`insert into public.promo_redemption (club_id, code_id, order_id, customer_id, status, restored_at, restore_reason) values ($1,$2,$3,$4,$5, case when $5 = 'restored' then now() end, case when $5 = 'restored' then 'expired' end)`, [A, c, o, customer, status]);
const birthday = (o: string, status = 'restored', kind = 'package', customer = PLAYER) =>
  tdb.query(`insert into public.birthday_entitlement_use (club_id, customer_id, year, kind, order_id, status, restored_at) values ($1,$2,2026,$3,$4,$5, case when $5 = 'restored' then now() end)`, [A, customer, kind, o, status]);
const states = async (o: string) => ({
  promo: (await tdb.query(`select status from public.promo_redemption where order_id = $1`, [o])).rows.map((r) => r.status),
  birthday: (await tdb.query(`select status from public.birthday_entitlement_use where order_id = $1`, [o])).rows.map((r) => r.status),
});

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await user(A, PLAYER);
  await user(A, OTHER);
});
afterEach(async () => {
  await tdb.close();
});

describe('app.reapply_order_entitlements', () => {
  it('an order that used neither a code nor a birthday entitlement is fine and changes nothing', async () => {
    expect(await reapply(await order())).toEqual({ ok: true, promo: false, birthday: false });
  });

  it('takes the code use back when the caps allow, and a repeat is a no-op', async () => {
    const o = await order();
    await redemption(await code(), o);
    expect(await reapply(o)).toEqual({ ok: true, promo: true, birthday: false });
    expect((await states(o)).promo).toEqual(['counted']);
    expect(await reapply(o)).toEqual({ ok: true, promo: false, birthday: false });
  });

  it('cannot when the code has been used up meanwhile (total cap), and changes nothing', async () => {
    const o = await order();
    const c = await code({ total_cap: 1 });
    await redemption(c, o);
    await redemption(c, await order(OTHER), 'counted', OTHER);
    expect(await reapply(o)).toEqual({ ok: false, reason: 'code_used_up' });
    expect((await states(o)).promo).toEqual(['restored']);
  });

  it('cannot when the per customer cap is reached, the code is off, ended, or was for a first booking', async () => {
    const o = await order();
    const capped = await code({ per_customer_cap: 1 }, 'CAPPED');
    await redemption(capped, o);
    await redemption(capped, await order(), 'counted');
    expect(await reapply(o)).toEqual({ ok: false, reason: 'code_used_up' });

    const o2 = await order();
    const off = await code({ active: false }, 'OFF');
    await redemption(off, o2);
    expect(await reapply(o2)).toEqual({ ok: false, reason: 'code_not_valid' });

    const o3 = await order();
    const ended = await code({ ends_on: '2020-01-01' }, 'ENDED');
    await redemption(ended, o3);
    expect(await reapply(o3)).toEqual({ ok: false, reason: 'code_expired' });

    const o4 = await order();
    const first = await code({ first_time_only: true }, 'FIRST');
    await redemption(first, o4);
    const other = await order();
    await tdb.query(`insert into public.location (club_id, id, name) values ($1,'00000000-0000-4000-8000-0000000000a1','M')`, [A]);
    await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,'00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000a1','1','tennis')`, [A]);
    await tdb.query(`insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
                     values ($1,$2,'court','00000000-0000-4000-8000-0000000000c1', date_trunc('hour', now()) + interval '40 hours', date_trunc('hour', now()) + interval '41 hours', $3,'confirmed','online',$3, now())`, [A, other, PLAYER]);
    expect(await reapply(o4)).toEqual({ ok: false, reason: 'code_first_booking_only' });
    expect((await states(o4)).promo).toEqual(['restored']);
  });

  it('takes the birthday entitlement back when the customer has not used that kind this year', async () => {
    const o = await order();
    await birthday(o);
    expect(await reapply(o)).toEqual({ ok: true, promo: false, birthday: true });
    expect((await states(o)).birthday).toEqual(['used']);
  });

  it('cannot when the customer used that kind on another order meanwhile, and the code use is not taken either', async () => {
    const o = await order();
    await redemption(await code(), o);
    await birthday(o);
    await birthday(await order(), 'used');
    expect(await reapply(o)).toEqual({ ok: false, reason: 'birthday_already_used' });
    expect(await states(o)).toEqual({ promo: ['restored'], birthday: ['restored'] });
  });

  it('is callable by the owner role only and never reaches another club’s order', async () => {
    for (const role of ['booq_app', 'booq_worker', 'booq_platform']) {
      expect((await tdb.query(`select has_function_privilege($1, 'app.reapply_order_entitlements(uuid)', 'execute') as ok`, [role])).rows[0].ok, role).toBe(false);
    }
    const o = await order();
    await redemption(await code(), o);
    expect(await reapply(o, B)).toEqual({ ok: true, promo: false, birthday: false });
    expect((await states(o)).promo).toEqual(['restored']);
  });
});
