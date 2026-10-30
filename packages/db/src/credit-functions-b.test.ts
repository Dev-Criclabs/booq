import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F06-T06b / migration 0507: credit_use, credit_forfeit, credit_reverse_forfeit, credit_adjust, credit_expire
// (R1-AC3 to AC5, PKG-03-AC3, AC4; D28, D83, D85).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
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
let web: Db;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  for (const [u, roles] of [[PLAYER, ['player']], [OTHER, ['player']], [DESK, ['front_desk', 'player']], [OWNER, ['owner', 'player']]] as const) {
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
  web = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});
const ctx = (user: string, roles: string[]) => ({ clubId: A, userId: user, roles, source: 'admin' as const });

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
const reserve = (pkg: string, b: { booking: string; line: string }) => one<string>('select app.credit_reserve($1, $2, $3)', [pkg, b.booking, b.line]);
const giveBack = (booking: string, reason: string) => one<{ returned: number; lost: number }>('select app.credit_return($1, $2)', [booking, reason]);
const use = (booking: string) => one<number>('select app.credit_use($1)', [booking]);
const forfeit = (booking: string) => one<number>('select app.credit_forfeit($1, null, null)', [booking]);
/** Staff actions run as booq_app in the staff member's context, as the F09 and admin routes will. */
async function asStaff<T = unknown>(user: string, roles: string[], sql: string, args: unknown[]): Promise<T> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role booq_owner');
    await c.query(`select set_config('app.club_id', $1, true), set_config('app.user_id', $2, true), set_config('app.roles', $3, true), set_config('app.source', 'admin', true)`, [A, user, roles.join(',')]);
    const r = Object.values((await c.query(sql, args)).rows[0] ?? {})[0] as T;
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const rows = async (booking: string) =>
  (await tdb.query(`select reason, change, staff_id, note from public.credit_ledger where booking_id = $1 order by array_position(array['reserve','use','forfeit','return','expire','adjust'], reason), id`, [booking])).rows;
const setStatus = async (booking: string, status: string) => {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    await c.query(`update public.booking set status = $2 where id = $1`, [booking, status]);
    await c.query('commit');
  } finally {
    c.release();
  }
};
const left = (pkg: string) => one<number>('select app.package_credits_left($1)', [pkg]);


describe('credit_use (R1-AC3)', () => {
  it('writes change 0 once per reserved credit when the session has started', async () => {
    const pkg = await newPackage({ credit_type: 'court_hour' }, 5);
    const b = await bookedLine('court_hour', pkg);          // 10:00 Bangkok on 10 Feb 2027
    await reserve(pkg, b);
    await expect(use(b.booking)).rejects.toThrow(/not_started/);
    await tdb.setNow('2027-02-10T03:00:00Z');
    expect(await use(b.booking)).toBe(1);
    expect(await use(b.booking)).toBe(0);
    expect((await rows(b.booking)).map((r) => [r.reason, r.change])).toEqual([['reserve', -1], ['use', 0]]);
    expect(await left(pkg)).toBe(4);
    expect(await giveBack(b.booking, 'club_cancel')).toEqual({ returned: 0, lost: 0 });   // used: nothing to give back
  });
  it('a booking cancelled or released meanwhile is not used', async () => {
    const pkg = await newPackage({ credit_type: 'court_hour' }, 5);
    const b = await bookedLine('court_hour', pkg);
    await reserve(pkg, b);
    await setStatus(b.booking, 'cancelled');
    await tdb.setNow('2027-02-10T04:00:00Z');
    expect(await use(b.booking)).toBe(0);
  });
});

describe('credit_forfeit and credit_reverse_forfeit (R1-AC4, AC5)', () => {
  it('a late cancel forfeits the credit once; it is not returned', async () => {
    const pkg = await newPackage({ credit_type: 'court_hour' }, 5);
    const b = await bookedLine('court_hour', pkg);
    await reserve(pkg, b);
    expect(await forfeit(b.booking)).toBe(1);
    expect(await forfeit(b.booking)).toBe(0);
    expect(await giveBack(b.booking, 'player_cancel')).toEqual({ returned: 0, lost: 0 });
    expect(await left(pkg)).toBe(4);
  });
  it('a no show marked by staff after the slot (already used) is forfeited with the staff note', async () => {
    const pkg = await newPackage({ credit_type: 'court_hour' }, 5);
    const b = await bookedLine('court_hour', pkg);
    await reserve(pkg, b);
    await tdb.setNow('2027-02-10T04:00:00Z');
    await use(b.booking);
    await expect(asStaff(DESK, ['front_desk'], 'select app.credit_forfeit($1, $2, $3)', [b.booking, DESK, ' '])).rejects.toThrow(/note_required/);
    await expect(asStaff(DESK, ['front_desk'], 'select app.credit_forfeit($1, $2, $3)', [b.booking, OWNER, 'no show'])).rejects.toThrow(/forbidden/);
    expect(await asStaff(DESK, ['front_desk'], 'select app.credit_forfeit($1, $2, $3)', [b.booking, DESK, 'no show'])).toBe(1);
    expect((await rows(b.booking)).map((r) => [r.reason, r.change, r.staff_id, r.note])).toEqual([
      ['reserve', -1, null, null], ['use', 0, null, null], ['forfeit', 0, DESK, 'no show'],
    ]);
  });
  it('a staff reversal writes a return row with the note, never an edit, once (R1-AC5)', async () => {
    const pkg = await newPackage({ credit_type: 'court_hour' }, 5);
    const b = await bookedLine('court_hour', pkg);
    await reserve(pkg, b);
    await forfeit(b.booking);
    const before = (await tdb.query(`select id, reason, change, note from public.credit_ledger where booking_id = $1 order by id`, [b.booking])).rows;
    await expect(asStaff(PLAYER, ['player'], 'select app.credit_reverse_forfeit($1, $2, $3)', [b.booking, PLAYER, 'me'])).rejects.toThrow(/forbidden/);
    await expect(asStaff(OWNER, ['owner'], 'select app.credit_reverse_forfeit($1, $2, $3)', [b.booking, OWNER, ''])).rejects.toThrow(/note_required/);
    expect(await asStaff(OWNER, ['owner'], 'select app.credit_reverse_forfeit($1, $2, $3)', [b.booking, OWNER, 'came, desk missed it'])).toBe(1);
    expect(await asStaff(OWNER, ['owner'], 'select app.credit_reverse_forfeit($1, $2, $3)', [b.booking, OWNER, 'again'])).toBe(0);
    const after = (await tdb.query(`select id, reason, change, note from public.credit_ledger where booking_id = $1 order by id`, [b.booking])).rows;
    for (const r of before) expect(after).toContainEqual(r);
    expect(after.filter((r) => r.reason === 'return')).toEqual([expect.objectContaining({ change: 1, note: 'came, desk missed it' })]);
    expect(await left(pkg)).toBe(5);
    expect(await giveBack(b.booking, 'closure')).toEqual({ returned: 0, lost: 0 });   // already back: never twice
  });
});

describe('credit_adjust (PKG-01-AC4, D83)', () => {
  const adjust = (user: string, roles: string[], pkg: string, delta: number, note: string | null) =>
    web.withClubTx(ctx(user, roles), (tx) => tx.query('select app.credit_adjust($1, $2, $3) as id', [pkg, delta, note]));
  it('front desk and owner adjust with a written note; never below zero; a player cannot', async () => {
    const pkg = await newPackage({ credit_type: 'court_hour' }, 2);
    await adjust(DESK, ['front_desk', 'player'], pkg, 1, 'rain-out goodwill');
    expect(await left(pkg)).toBe(3);
    await expect(adjust(OWNER, ['owner', 'player'], pkg, -4, 'too many')).rejects.toThrow(/below_zero/);
    await adjust(OWNER, ['owner', 'player'], pkg, -3, 'sold by mistake');
    expect(await left(pkg)).toBe(0);
    await expect(adjust(DESK, ['front_desk', 'player'], pkg, 1, '  ')).rejects.toThrow(/note_required/);
    await expect(adjust(PLAYER, ['player'], pkg, 1, 'me')).rejects.toThrow(/forbidden/);
    expect(Number((await tdb.query(`select count(*) from public.audit_entry where record_type = 'credit_ledger'`)).rows[0].count)).toBeGreaterThanOrEqual(2);
  });
  it('taking credit from an unclaimed record is refused; giving is allowed', async () => {
    const pkg = await newPackage({ credit_type: 'court_hour' }, 2, EXPIRES, IMPORTED);
    await expect(adjust(OWNER, ['owner', 'player'], pkg, -1, 'x')).rejects.toThrow(/customer_not_claimed/);
    await adjust(OWNER, ['owner', 'player'], pkg, 1, 'import fix');
  });
});

describe('credit_expire (PKG-03-AC3, AC4; D85)', () => {
  it('writes one row for the unreserved remainder and none for reserved credit; a second run writes nothing', async () => {
    const pkg = await newPackage({ credit_type: 'court_hour' }, 5);
    const b = await bookedLine('court_hour', pkg);
    await reserve(pkg, b);
    expect(await one('select app.credit_expire($1)', [pkg])).toBe(0);      // not expired yet
    await tdb.setNow(EXPIRES);
    expect(await one('select app.credit_expire($1)', [pkg])).toBe(4);
    expect(await one('select app.credit_expire($1)', [pkg])).toBe(0);
    expect((await tdb.query(`select change from public.credit_ledger where package_id = $1 and reason = 'expire'`, [pkg])).rows).toEqual([{ change: -4 }]);
    expect(await left(pkg)).toBe(0);
    await tdb.setNow('2027-02-10T03:00:00Z');                                 // the reserved credit stays valid for its session
    expect(await use(b.booking)).toBe(1);
  });
  it('a used up package writes no expire row', async () => {
    const pkg = await newPackage({ credit_type: 'court_hour' }, 1);
    await reserve(pkg, await bookedLine('court_hour', pkg));
    await tdb.setNow(EXPIRES);
    expect(await one('select app.credit_expire($1)', [pkg])).toBe(0);
    expect((await tdb.query(`select count(*)::int as n from public.credit_ledger where reason = 'expire'`)).rows[0].n).toBe(0);
  });
  it('only credit_adjust is callable by an app role', async () => {
    for (const f of ['app.credit_use(uuid)', 'app.credit_forfeit(uuid, uuid, text)', 'app.credit_reverse_forfeit(uuid, uuid, text)', 'app.credit_expire(uuid)']) {
      expect((await tdb.query('select has_function_privilege($1, $2, $3) as ok', ['booq_app', f, 'execute'])).rows[0].ok, f).toBe(false);
    }
    expect((await tdb.query('select has_function_privilege($1, $2, $3) as ok', ['booq_app', 'app.credit_adjust(uuid, integer, text)', 'execute'])).rows[0].ok).toBe(true);
  });
});
