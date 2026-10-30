import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F06-T07 / migration 0508: grant_package and the expiry arithmetic, extend_package, extend_for_pause,
// wallet_expire (PKG-02-AC2, AC3, AC6, PKG-03-AC5, AC7, AC10; D20, D88, D89, D90).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const ADULT = '00000000-0000-4000-8000-0000000000a1';
const STUDENT = '00000000-0000-4000-8000-0000000000a2';
const BUNDLE = '00000000-0000-4000-8000-0000000000d1';
const GROUP_STUDENT = '00000000-0000-4000-8000-0000000000d2';

let tdb: TestDatabase;
let web: Db;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  for (const [u, roles] of [[PLAYER, ['player']], [DESK, ['front_desk', 'player']], [OWNER, ['owner', 'player']]] as const) {
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
  await tdb.query(`insert into public.price_group (club_id, id, name_th, name_en, rule) values ($1,$2,'ผู้ใหญ่','Adult','{"min_age":18}'), ($1,$3,'นักเรียน','Student','{"max_age":17}')`, [A, ADULT, STUDENT]);
  await tdb.query(`insert into public.package_product (club_id, id, name_th, name_en, credit_type, credits, validity_months, price_group_id, price_satang)
                   values ($1,$2,'10 ชั่วโมง','10 hours','court_hour',10,3,null,450000), ($1,$3,'กลุ่ม 8','Group 8','group_session',8,3,$4,320000)`, [A, BUNDLE, GROUP_STUDENT, STUDENT]);
  web = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});
const ctx = (user: string, roles: string[]) => ({ clubId: A, userId: user, roles, source: 'admin' as const });

async function asDefiner<T = Record<string, unknown>>(sql: string, args: unknown[] = [], client?: pg.PoolClient): Promise<T[]> {
  const c = client ?? (await tdb.pool.connect());
  try {
    await c.query('begin');
    await c.query('set local role booq_owner');
    await c.query(`select set_config('app.club_id', $1, true)`, [A]);
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
const one = async <T = unknown>(sql: string, args: unknown[] = []) => Object.values((await asDefiner(sql, args))[0] ?? {})[0] as T;
const bkk = (t: Date | string) => new Date(t).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' });

/** A paid package order with one package line per product (fixture: sums off). */
async function packageOrder(products: string[], customer = PLAYER) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    const o = (await c.query(`insert into public.orders (club_id, customer_id, source, status) values ($1,$2,'online','paid') returning id`, [A, customer])).rows[0].id as string;
    let pos = 1;
    for (const p of products) {
      await c.query(`insert into public.order_line (club_id, order_id, position, kind, package_product_id, description_key, name_th, name_en, unit_price_satang, net_satang, money_satang)
                     values ($1,$2,$3,'package',$4,'k','ก','x',450000,450000,450000)`, [A, o, pos++, p]);
    }
    await c.query('commit');
    return o;
  } finally {
    c.release();
  }
}
const packagesOf = async (order: string) =>
  (await tdb.query(`select id, credits_total, expires_at, purchase_date::text as purchase_date, product_snapshot from public.customer_package where order_id = $1 order by credits_total desc`, [order])).rows;

describe('expiry arithmetic (PKG-02-AC2, AC3; D20; Gaps B5)', () => {
  const cases: [string, number, string][] = [
    ['2026-10-31', 3, '2027-01-31'],
    ['2026-11-30', 3, '2027-02-28'],
    ['2027-11-30', 3, '2028-02-29'],     // leap year
    ['2026-12-29', 3, '2027-03-29'],     // across the year end
    ['2026-08-31', 6, '2027-02-28'],
    ['2028-02-29', 12, '2029-02-28'],
    ['2027-01-05', 3, '2027-04-05'],     // the canvas sample "9 Apr" is wrong
  ];
  it.each(cases)('%s plus %i months ends %s 23:59:59.999 Bangkok', async (day, months, end) => {
    const at = await one<Date>('select app.package_expiry($1::date, $2)', [day, months]);
    expect(bkk(at)).toBe(`${end} 23:59:59`);
    expect(at.getUTCMilliseconds()).toBe(999);
    expect(bkk(new Date(at.getTime() + 1)).slice(11)).toBe('00:00:00');          // the next millisecond is the next Bangkok day
  });
  it('a purchase confirmed at 00:30 Bangkok counts from that Bangkok day, not the UTC one', async () => {
    await tdb.setNow('2027-01-04T17:30:00Z');                  // 5 Jan 2027 00:30 Bangkok, still 4 Jan in UTC
    const o = await packageOrder([BUNDLE]);
    await one('select app.grant_package($1)', [o]);
    const [p] = await packagesOf(o);
    expect(p?.purchase_date).toBe('2027-01-05');
    expect(bkk(p?.expires_at)).toBe('2027-04-05 23:59:59');
  });
});

describe('grant_package (R3, PKG-02-AC6)', () => {
  beforeEach(() => tdb.setNow('2027-01-10T05:00:00Z'));
  it('creates the package with the product snapshot and credits; a second grant of one order grants once', async () => {
    const o = await packageOrder([BUNDLE]);
    await one('select app.grant_package($1)', [o]);
    await one('select app.grant_package($1)', [o]);
    const ps = await packagesOf(o);
    expect(ps).toHaveLength(1);
    expect(ps[0]?.credits_total).toBe(10);
    expect(ps[0]?.product_snapshot).toMatchObject({ credit_type: 'court_hour', coach_tier_id: null, price_group_id: null, credits: 10, validity_months: 3, price_satang: 450000 });
    await tdb.query(`update public.package_product set credits = 12, validity_months = 6, price_satang = 500000 where id = $1`, [BUNDLE]);
    expect((await packagesOf(o))[0]?.credits_total).toBe(10);            // later edits never change a package sold (PKG-02-AC4)
  });
  it('20 parallel grants of one order grant once', async () => {
    const o = await packageOrder([BUNDLE]);
    const clients = Array.from({ length: 20 }, () => new pg.Client({ connectionString: tdb.url }));   // own connections: more than the pool holds
    await Promise.all(clients.map((c) => c.connect()));
    try {
      const r = await Promise.allSettled(clients.map((c) => asDefiner('select app.grant_package($1)', [o], c as unknown as pg.PoolClient)));
      expect(r.filter((x) => x.status === 'rejected')).toEqual([]);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
    expect(await packagesOf(o)).toHaveLength(1);
  });
  it('grants every package line of the order', async () => {
    await tdb.query(`update public.app_user set date_of_birth = '2012-05-01' where id = $1`, [PLAYER]);
    const o = await packageOrder([BUNDLE, GROUP_STUDENT]);
    await one('select app.grant_package($1)', [o]);
    expect((await packagesOf(o)).map((p) => p.credits_total)).toEqual([10, 8]);
  });
  it('a Student product is refused for an adult and for a buyer with no date of birth; allowed under 18', async () => {
    const o = await packageOrder([GROUP_STUDENT]);
    await expect(one('select app.grant_package($1)', [o])).rejects.toThrow(/not_for_this_buyer/);
    await tdb.query(`update public.app_user set date_of_birth = '2009-01-10' where id = $1`, [PLAYER]);   // 18 today
    await expect(one('select app.grant_package($1)', [o])).rejects.toThrow(/not_for_this_buyer/);
    await tdb.query(`update public.app_user set date_of_birth = '2009-01-11' where id = $1`, [PLAYER]);   // 17 today
    await one('select app.grant_package($1)', [o]);
    expect(await packagesOf(o)).toHaveLength(1);
  });
  it('raises on an order with no package line', async () => {
    const o = await packageOrder([]);
    await expect(one('select app.grant_package($1)', [o])).rejects.toThrow(/order_not_package/);
    await expect(one('select app.grant_package(gen_random_uuid())')).rejects.toThrow(/order_not_package/);
  });
});

describe('extend_package (PKG-03-AC5; D88)', () => {
  const extend = (user: string, roles: string[], pkg: string, at: string, reason: string | null) =>
    web.withClubTx(ctx(user, roles), (tx) => tx.query('select app.extend_package($1, $2, $3)', [pkg, at, reason]));
  it('the owner moves one package to a later day at 23:59 Bangkok with a reason; the old and new dates are kept', async () => {
    await tdb.setNow('2027-01-05T03:00:00Z');
    const o = await packageOrder([BUNDLE]);
    await one('select app.grant_package($1)', [o]);
    const [p] = await packagesOf(o);
    await extend(OWNER, ['owner', 'player'], p?.id, '2027-04-20T16:59:59.999Z', 'injury, doctor’s note');
    expect(bkk((await packagesOf(o))[0]?.expires_at)).toBe('2027-04-20 23:59:59');
    const ext = (await tdb.query(`select kind, reason, staff_id, old_expires_at, new_expires_at from public.package_extension where package_id = $1`, [p?.id])).rows;
    expect(ext).toHaveLength(1);
    expect(ext[0]).toMatchObject({ kind: 'owner', reason: 'injury, doctor’s note', staff_id: OWNER });
    expect(bkk(ext[0].old_expires_at)).toBe('2027-04-05 23:59:59');
    expect(Number((await tdb.query(`select count(*) from public.audit_entry where record_type = 'package_extension'`)).rows[0].count)).toBe(1);
  });
  it('front desk cannot extend; a reason is required; the new expiry ends 23:59 Bangkok on a later day', async () => {
    await tdb.setNow('2027-01-05T03:00:00Z');
    const o = await packageOrder([BUNDLE]);
    await one('select app.grant_package($1)', [o]);
    const id = (await packagesOf(o))[0]?.id;
    await expect(extend(DESK, ['front_desk', 'player'], id, '2027-04-20T16:59:59.999Z', 'x')).rejects.toThrow(/forbidden/);
    await expect(extend(OWNER, ['owner'], id, '2027-04-20T16:59:59.999Z', '  ')).rejects.toThrow(/reason_required/);
    await expect(extend(OWNER, ['owner'], id, '2027-04-20T10:00:00Z', 'x')).rejects.toThrow(/expiry_not_later_day/);
    await expect(extend(OWNER, ['owner'], id, '2027-04-05T16:59:59.999Z', 'x')).rejects.toThrow(/expiry_not_later_day/);
    await expect(extend(OWNER, ['owner'], id, '2027-04-01T16:59:59.999Z', 'x')).rejects.toThrow(/expiry_not_later_day/);
  });
});

describe('extend_for_pause (PKG-03-AC7; D90)', () => {
  async function pause(from: string, to: string) {
    await tdb.query(`insert into public.club_pause (club_id, paused_at, pause_reason, paused_by, resumed_at, resume_reason, resumed_by)
                     values ($1,$2,'storm',gen_random_uuid(),$3,'fixed',gen_random_uuid())`, [A, from, to]);
    await tdb.setNow(to);
    await one('select app.extend_for_pause($1, $2, $3)', [A, from, to]);
  }
  it('is registered to run on resume', async () => {
    expect((await tdb.query(`select handler::text from app.pause_handlers where handler_key = 'f06_package_expiry'`)).rows).toEqual([{ handler: 'app.extend_for_pause(uuid,timestamp with time zone,timestamp with time zone)' }]);
  });
  it('moves expiry by the exact length, then to 23:59 on the resulting day; one pause extension per package', async () => {
    await tdb.setNow('2027-01-05T03:00:00Z');
    const o = await packageOrder([BUNDLE]);
    await one('select app.grant_package($1)', [o]);              // expires 5 Apr 23:59:59.999
    await pause('2027-02-01T03:00:00Z', '2027-02-11T05:00:00Z');   // 10 days 2 hours
    const [p] = await packagesOf(o);
    expect(bkk(p?.expires_at)).toBe('2027-04-16 23:59:59');        // 5 Apr 23:59 + 10d 2h = 16 Apr 01:59, to 23:59
    const ext = (await tdb.query(`select kind, reason, pause_id is not null as has_pause from public.package_extension where package_id = $1`, [p?.id])).rows;
    expect(ext).toEqual([{ kind: 'pause', reason: 'pause', has_pause: true }]);
  });
  it('a pause under a day moves expiry to 23:59 of the next day when it crosses midnight, and changes nothing otherwise', async () => {
    await tdb.setNow('2027-01-05T03:00:00Z');
    const o = await packageOrder([BUNDLE]);
    await one('select app.grant_package($1)', [o]);
    await pause('2027-02-01T03:00:00Z', '2027-02-01T06:00:00Z');   // 3 hours: 5 Apr 23:59 + 3h = 6 Apr 02:59
    expect(bkk((await packagesOf(o))[0]?.expires_at)).toBe('2027-04-06 23:59:59');
  });
  it('a package that expired before the pause began is not moved; another club’s pause is refused', async () => {
    await tdb.setNow('2026-10-01T03:00:00Z');
    const o = await packageOrder([BUNDLE]);
    await one('select app.grant_package($1)', [o]);              // expires 1 Jan 2027
    await pause('2027-02-01T03:00:00Z', '2027-02-03T03:00:00Z');
    expect(bkk((await packagesOf(o))[0]?.expires_at)).toBe('2027-01-01 23:59:59');
    await expect(one('select app.extend_for_pause(gen_random_uuid(), now(), now())')).rejects.toThrow(/another club/);
  });
});

describe('wallet_expire (PKG-03-AC10; D89)', () => {
  const credit = (amount: number, key: string, reason = 'refund') => one('select app.wallet_credit($1, $2, $3, $4)', [PLAYER, amount, reason, key]);
  const balance = async () => Number((await tdb.query(`select coalesce(sum(change_satang), 0) as n from public.wallet_ledger where customer_id = $1`, [PLAYER])).rows[0].n);
  const setMonths = (n: number | null) =>
    tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'wallet_expiry_months',$2::jsonb) on conflict (club_id, key) do update set value = excluded.value`, [A, JSON.stringify(n)]);
  it('refuses to run with the setting empty: wallet value never expires', async () => {
    await credit(10000, 'r1');
    await expect(one('select app.wallet_expire($1)', [PLAYER])).rejects.toThrow(/expiry_not_set/);
    await setMonths(null);
    await expect(one('select app.wallet_expire($1)', [PLAYER])).rejects.toThrow(/expiry_not_set/);
    expect(await one('select app.wallet_value_expires_at(now())')).toBeNull();
  });
  it('with the setting, expires the unspent oldest value at 23:59 Bangkok after N months, once', async () => {
    await setMonths(3);
    await tdb.setNow('2027-01-05T03:00:00Z');
    await credit(10000, 'old');
    await tdb.setNow('2027-03-01T03:00:00Z');
    await credit(5000, 'new');
    await tdb.setNow('2027-04-05T16:59:59.998Z');
    expect(await one('select app.wallet_expire($1)', [PLAYER])).toBe('0');
    await tdb.setNow('2027-04-05T16:59:59.999Z');
    expect(await one('select app.wallet_expire($1)', [PLAYER])).toBe('10000');
    expect(await one('select app.wallet_expire($1)', [PLAYER])).toBe('0');
    expect(await balance()).toBe(5000);
  });
  it('spending first uses the oldest value; a return cancels its spend; a pause moves the expiry', async () => {
    await setMonths(3);
    await tdb.setNow('2027-01-05T03:00:00Z');
    await credit(10000, 'old');
    await tdb.query(`insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, staff_id, note) values ($1,$2,-4000,'adjust',$3,'used at desk')`, [A, PLAYER, OWNER]);
    await tdb.query(`insert into public.club_pause (club_id, paused_at, pause_reason, paused_by, resumed_at, resume_reason, resumed_by)
                     values ($1,'2027-02-01T03:00:00Z','storm',gen_random_uuid(),'2027-02-03T03:00:00Z','fixed',gen_random_uuid())`, [A]);
    await tdb.setNow('2027-04-06T03:00:00Z');                      // past 5 Apr, before 7 Apr (moved by the 2 day pause)
    expect(await one('select app.wallet_expire($1)', [PLAYER])).toBe('0');
    await tdb.setNow('2027-04-07T17:00:00Z');
    expect(await one('select app.wallet_expire($1)', [PLAYER])).toBe('6000');
    expect(await balance()).toBe(0);
  });
  it('does nothing while the club is paused', async () => {
    await setMonths(1);
    await tdb.setNow('2027-01-05T03:00:00Z');
    await credit(10000, 'old');
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    await tdb.setNow('2027-03-01T03:00:00Z');
    expect(await one('select app.wallet_expire($1)', [PLAYER])).toBe('0');
  });
});
