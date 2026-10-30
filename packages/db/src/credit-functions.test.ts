import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F06-T06a / migration 0506: eligible_credits, credit_reserve, credit_return (PKG-01-AC8, PKG-02-AC5,
// AC10, PKG-03-AC8, AC9, R1-AC1, AC2, AC9; D84, D85).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const IMPORTED = '66666666-6666-4666-8666-666666666666';
const ADULT = '00000000-0000-4000-8000-0000000000a1';
const STUDENT = '00000000-0000-4000-8000-0000000000a2';
const TIER1 = '00000000-0000-4000-8000-0000000000c1';
const TIER2 = '00000000-0000-4000-8000-0000000000c2';
const COURT1 = '00000000-0000-4000-8000-0000000000e1';
const COURT2 = '00000000-0000-4000-8000-0000000000e2';
const NOW = '2027-02-01T03:00:00Z';
const EXPIRES = '2027-04-05T16:59:59.999Z';            // 5 Apr 2027 23:59:59.999 Bangkok

let tdb: TestDatabase;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  for (const u of [PLAYER, OTHER]) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [A, u, 'L' + u.slice(0, 2)]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, u]);
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
  await tdb.query(`insert into public.price_group (club_id, id, name_th, name_en, rule) values ($1,$2,'ผู้ใหญ่','Adult','{"min_age":18}'), ($1,$3,'นักเรียน','Student','{"max_age":17}')`, [A, ADULT, STUDENT]);
  await tdb.query(`insert into public.coach_tier (club_id, id, name_th, name_en) values ($1,$2,'1','Tier 1'), ($1,$3,'2','Tier 2')`, [A, TIER1, TIER2]);
  const loc = (await tdb.query(`insert into public.location (club_id, name) values ($1,'Main') returning id`, [A])).rows[0].id;
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$4,'Court 1','tennis'), ($1,$3,$4,'Court 2','tennis')`, [A, COURT1, COURT2, loc]);
  await tdb.setNow(NOW);
});
afterEach(async () => {
  await tdb.close();
});

type Snapshot = { credit_type: string; coach_tier_id?: string; price_group_id?: string };
/** A package with a snapshot of what it fits; the product row is only the FK target. */
async function newPackage(snapshot: Snapshot, credits = 10, expires = EXPIRES, customer = PLAYER) {
  const product = (await tdb.query(
    `insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_group_id, coach_tier_id, price_satang)
     values ($1,'แพ็ก','Pack',$2,$3,3,$4,$5,100000) returning id`,
    [A, snapshot.credit_type, credits, snapshot.price_group_id ?? (snapshot.credit_type === 'court_hour' ? null : ADULT), snapshot.coach_tier_id ?? null],
  )).rows[0].id;
  return (await tdb.query(
    `insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, expires_at)
     values ($1,$2,$3,$4,$5,'2027-01-04T17:30:00Z',$6) returning id`,
    [A, customer, product, JSON.stringify(snapshot), credits, expires],
  )).rows[0].id as string;
}
/** A confirmed booking with its order and one line of `kind` allocated to `pkg` (fixture: sums and FKs of the order off). */
async function bookedLine(kind: 'court_hour' | 'coach' | 'class_seat' = 'court_hour', pkg: string | null = null, customer = PLAYER, hour = 10) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    const o = (await c.query(`insert into public.orders (club_id, customer_id, source, status) values ($1,$2,'online','paid') returning id`, [A, customer])).rows[0].id as string;
    const type = kind === 'court_hour' ? 'court' : kind === 'coach' ? 'solo_class' : 'class_seat';
    const start = `2027-02-10T${String(hour - 7).padStart(2, '0')}:00:00Z`;
    const b = (await c.query(
      `insert into public.booking (club_id, order_id, type, resource_id, coach_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
       values ($1,$2,$3,$4,$5,$6::timestamptz,$6::timestamptz + interval '1 hour',$7,'confirmed','online',$7,now()) returning id`,
      [A, o, type, COURT1, type === 'solo_class' ? gen() : null, start, customer],
    )).rows[0].id as string;
    const l = (await c.query(
      `insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, net_satang, credit_package_id, credit_units, credit_value_satang)
       values ($1,$2,1,$3,$4,'k','ก','x',50000,50000,$5,1,50000) returning id`,
      [A, o, kind, b, pkg],
    )).rows[0].id as string;
    await c.query('commit');
    return { order: o, booking: b, line: l };
  } finally {
    c.release();
  }
}
const gen = () => '00000000-0000-4000-8000-' + Math.floor(Math.random() * 1e12).toString().padStart(12, '0');

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
const eligible = (spec: Record<string, unknown>, customer = PLAYER) =>
  asDefiner<{ package_id: string; credits_left: number }>('select package_id, credits_left from app.eligible_credits($1, $2)', [customer, JSON.stringify(spec)]);
const reserve = (pkg: string, b: { booking: string; line: string }) => one<string>('select app.credit_reserve($1, $2, $3)', [pkg, b.booking, b.line]);
const giveBack = (booking: string, reason: string) => one<{ returned: number; lost: number }>('select app.credit_return($1, $2)', [booking, reason]);
const left = (pkg: string) => one<number>('select app.package_credits_left($1)', [pkg]);

describe('eligible_credits (R1-AC1, PKG-02-AC5, AC10; D84)', () => {
  it('fits by type, nearest expiry first, then id; expired and used up packages do not fit', async () => {
    const later = await newPackage({ credit_type: 'court_hour' }, 10, '2027-05-05T16:59:59.999Z');
    const sooner = await newPackage({ credit_type: 'court_hour' }, 10, EXPIRES);
    await newPackage({ credit_type: 'court_hour' }, 10, '2027-01-31T16:59:59.999Z');   // expired before NOW
    const empty = await newPackage({ credit_type: 'court_hour' }, 1);
    await reserve(empty, await bookedLine('court_hour', empty));
    await newPackage({ credit_type: 'group_session', price_group_id: ADULT });
    expect((await eligible({ credit_type: 'court_hour' })).map((r) => r.package_id)).toEqual([sooner, later]);
  });
  it('bundle hours fit any time on either court; a solo credit fits any coach of its tier only (PKG-02-AC10)', async () => {
    const bundle = await newPackage({ credit_type: 'court_hour' });
    expect((await eligible({ credit_type: 'court_hour', resource_id: COURT2, start_at: '2027-03-01T13:00:00Z' })).map((r) => r.package_id)).toEqual([bundle]);
    const solo = await newPackage({ credit_type: 'solo_class', coach_tier_id: TIER1, price_group_id: ADULT });
    expect((await eligible({ credit_type: 'solo_class', coach_tier_id: TIER1, price_group_id: ADULT, coach_id: gen() })).map((r) => r.package_id)).toEqual([solo]);
    expect(await eligible({ credit_type: 'solo_class', coach_tier_id: TIER2, price_group_id: ADULT })).toEqual([]);
  });
  it('a coach picked at court checkout never uses solo pack credit (R1-AC9, COACH-03)', async () => {
    await newPackage({ credit_type: 'solo_class', coach_tier_id: TIER1, price_group_id: ADULT });
    expect(await eligible({ credit_type: 'solo_class', coach_tier_id: TIER1, price_group_id: ADULT, coach_source: 'checkout' })).toEqual([]);
    expect(await eligible({ credit_type: 'solo_class', coach_tier_id: TIER1, price_group_id: ADULT, coach_source: 'classes' })).toHaveLength(1);
  });
  it('a Student credit held by an 18 year old fits only Student items and stays valid until expiry (PKG-02-AC5, D84)', async () => {
    await tdb.query(`update public.app_user set date_of_birth = '2009-01-15' where id = $1`, [PLAYER]);   // 18 on 15 Jan 2027, before NOW
    const student = await newPackage({ credit_type: 'group_session', price_group_id: STUDENT });
    expect((await eligible({ credit_type: 'group_session', price_group_id: STUDENT })).map((r) => r.package_id)).toEqual([student]);
    expect(await eligible({ credit_type: 'group_session', price_group_id: ADULT })).toEqual([]);
    await tdb.setNow('2027-04-05T16:59:59.998Z');
    expect(await eligible({ credit_type: 'group_session', price_group_id: STUDENT })).toHaveLength(1);
    await tdb.setNow(EXPIRES);
    expect(await eligible({ credit_type: 'group_session', price_group_id: STUDENT })).toEqual([]);
  });
  it('another customer’s packages never fit; an imported record cannot list its value (customer_not_claimed)', async () => {
    await newPackage({ credit_type: 'court_hour' }, 10, EXPIRES, OTHER);
    expect(await eligible({ credit_type: 'court_hour' })).toEqual([]);
    await newPackage({ credit_type: 'court_hour' }, 10, EXPIRES, IMPORTED);
    await expect(eligible({ credit_type: 'court_hour' }, IMPORTED)).rejects.toThrow(/customer_not_claimed/);
    await expect(eligible({ credit_type: 'voucher' })).rejects.toThrow(/line_spec/);
  });
});

describe('credit_reserve (R1-AC1, PKG-01-AC8)', () => {
  it('two parallel reserves of the last credit give exactly one success', async () => {
    const pkg = await newPackage({ credit_type: 'court_hour' }, 1);
    const b1 = await bookedLine('court_hour', pkg, PLAYER, 10);
    const b2 = await bookedLine('court_hour', pkg, PLAYER, 11);
    const c1 = await tdb.pool.connect();
    const c2 = await tdb.pool.connect();
    try {
      const results = await Promise.allSettled([
        asDefiner('select app.credit_reserve($1, $2, $3)', [pkg, b1.booking, b1.line], c1),
        asDefiner('select app.credit_reserve($1, $2, $3)', [pkg, b2.booking, b2.line], c2),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(String((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason)).toMatch(/credit:used_up/);
    } finally {
      c1.release();
      c2.release();
    }
    expect(await left(pkg)).toBe(0);
  });
  it('a repeat writes nothing; a released then reclaimed line reserves again with attempt 2', async () => {
    const pkg = await newPackage({ credit_type: 'court_hour' }, 5);
    const b = await bookedLine('court_hour', pkg);
    const first = await reserve(pkg, b);
    expect(await reserve(pkg, b)).toBe(first);
    expect(await left(pkg)).toBe(4);
    expect(await giveBack(b.booking, 'release')).toEqual({ returned: 1, lost: 0 });
    expect(await giveBack(b.booking, 'release')).toEqual({ returned: 0, lost: 0 });
    expect(await left(pkg)).toBe(5);
    await reserve(pkg, b);
    const keys = (await tdb.query(`select dedupe_key from public.credit_ledger where reason = 'reserve' order by created_at, dedupe_key`)).rows.map((r) => r.dedupe_key);
    expect(keys).toEqual([`reserve:${b.line}:1`, `reserve:${b.line}:2`]);
    expect(await left(pkg)).toBe(4);
  });
  it('a new booking can never reserve a credit of an expired package (PKG-03-AC9)', async () => {
    const pkg = await newPackage({ credit_type: 'court_hour' }, 5);
    await tdb.setNow(EXPIRES);
    await expect(reserve(pkg, await bookedLine('court_hour', pkg))).rejects.toThrow(/credit:expired/);
  });
  it('the line must be this booking’s, the customer’s, of a kind the credit covers, and allocated to this package', async () => {
    const pkg = await newPackage({ credit_type: 'court_hour' }, 5);
    const b = await bookedLine('court_hour', pkg);
    const other = await bookedLine('court_hour', pkg, OTHER);
    await expect(one('select app.credit_reserve($1, $2, $3)', [pkg, other.booking, b.line])).rejects.toThrow(/line_not_found/);
    await expect(reserve(pkg, other)).rejects.toThrow(/line_not_found/);
    await expect(reserve(pkg, await bookedLine('coach', pkg))).rejects.toThrow(/does_not_fit/);
    const pkg2 = await newPackage({ credit_type: 'court_hour' }, 5);
    await expect(reserve(pkg2, b)).rejects.toThrow(/does_not_fit/);
    await reserve(pkg2, await bookedLine('court_hour', null));      // no package named: the marker case, resolved by the caller
    const imported = await newPackage({ credit_type: 'court_hour' }, 5, EXPIRES, IMPORTED);
    await expect(reserve(imported, await bookedLine('court_hour', imported, IMPORTED))).rejects.toThrow(/customer_not_claimed/);
  });
});

describe('credit_return (R1-AC2; D85)', () => {
  it('a cancel in time returns the credit to its own package, once', async () => {
    const pkg = await newPackage({ credit_type: 'court_hour' }, 5);
    const b = await bookedLine('court_hour', pkg);
    await reserve(pkg, b);
    expect(await giveBack(b.booking, 'player_cancel')).toEqual({ returned: 1, lost: 0 });
    expect(await giveBack(b.booking, 'player_cancel')).toEqual({ returned: 0, lost: 0 });
    expect(await left(pkg)).toBe(5);
  });
  it('reserved before expiry, cancelled by the player after it: the credit is lost (PKG-03-AC8, AC9, CANCEL-01-AC11)', async () => {
    const pkg = await newPackage({ credit_type: 'court_hour' }, 5);
    const b = await bookedLine('court_hour', pkg);
    await reserve(pkg, b);
    await tdb.setNow('2027-04-05T17:00:00Z');
    expect(await giveBack(b.booking, 'player_cancel')).toEqual({ returned: 0, lost: 1 });
    expect(await left(pkg)).toBe(4);
  });
  it('after expiry a closure or a club cancel still returns it (CANCEL-03-AC12)', async () => {
    const pkg = await newPackage({ credit_type: 'court_hour' }, 5);
    const b1 = await bookedLine('court_hour', pkg, PLAYER, 10);
    const b2 = await bookedLine('court_hour', pkg, PLAYER, 11);
    await reserve(pkg, b1);
    await reserve(pkg, b2);
    await tdb.setNow('2027-04-06T03:00:00Z');
    expect(await giveBack(b1.booking, 'closure')).toEqual({ returned: 1, lost: 0 });
    expect(await giveBack(b2.booking, 'club_cancel')).toEqual({ returned: 1, lost: 0 });
    expect(await left(pkg)).toBe(5);
  });
  it('a used or forfeited credit is not returned; an unknown reason or booking is refused', async () => {
    const pkg = await newPackage({ credit_type: 'court_hour' }, 5);
    const b = await bookedLine('court_hour', pkg);
    await reserve(pkg, b);
    await tdb.query(`insert into public.credit_ledger (club_id, package_id, change, reason, booking_id, order_line_id) values ($1,$2,0,'use',$3,$4)`, [A, pkg, b.booking, b.line]);
    expect(await giveBack(b.booking, 'club_cancel')).toEqual({ returned: 0, lost: 0 });
    await expect(giveBack(b.booking, 'refund')).rejects.toThrow(/credit:reason/);
    await expect(one('select app.credit_return(gen_random_uuid(), $1)', ['release'])).rejects.toThrow(/booking_not_found/);
    expect(await left(pkg)).toBe(4);
  });
  it('no app role can call the credit functions directly (grants are F06-T11)', async () => {
    for (const f of ['app.eligible_credits(uuid, jsonb, timestamptz)', 'app.credit_reserve(uuid, uuid, uuid)', 'app.credit_return(uuid, text)']) {
      for (const role of ['booq_app', 'booq_worker', 'booq_platform']) {
        expect((await tdb.query('select has_function_privilege($1, $2, $3) as ok', [role, f, 'execute'])).rows[0].ok, `${role} ${f}`).toBe(false);
      }
    }
  });
});
