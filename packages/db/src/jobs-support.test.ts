import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F06-T10 / migration 0512: the due lists of the F06 jobs and the session_start hook (PKG-03-AC3, AC10, R1-AC3;
// D85, D89, D90). The jobs themselves are F06-T13; here a sweep is "list, then act per item in its club".
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PA = '11111111-1111-4111-8111-111111111111';
const PB = '22222222-2222-4222-8222-222222222222';
const OA = '44444444-4444-4444-8444-444444444444';
const OB = '55555555-5555-4555-8555-555555555555';
const EXPIRES = '2027-04-05T16:59:59.999Z';
const SYSTEM = { clubId: '00000000-0000-0000-0000-000000000000', userId: null, roles: [] as never } as const;

let tdb: TestDatabase;
let worker: Db;
const products: Record<string, string> = {};
const courts: Record<string, string> = {};
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  for (const [club, u, roles] of [[A, PA, ['player']], [B, PB, ['player']], [A, OA, ['owner', 'player']], [B, OB, ['owner', 'player']]] as const) {
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
  for (const club of [A, B]) {
    products[club] = (await tdb.query(`insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_satang)
                                        values ($1,'10','10','court_hour',10,3,450000) returning id`, [club])).rows[0].id;
    const loc = (await tdb.query(`insert into public.location (club_id, name) values ($1,'M') returning id`, [club])).rows[0].id;
    courts[club] = (await tdb.query(`insert into public.resource (club_id, location_id, name, sport) values ($1,$2,'1','tennis') returning id`, [club, loc])).rows[0].id;
  }
  worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
  await tdb.setNow('2027-02-01T03:00:00Z');
});
afterEach(async () => {
  await worker.end();
  await tdb.close();
});

const pkg = async (club: string, customer: string, credits = 5) =>
  (await tdb.query(`insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, expires_at)
                    values ($1,$2,$3,'{"credit_type":"court_hour"}',$4,'2027-01-04T17:30:00Z',$5) returning id`, [club, customer, products[club], credits, EXPIRES])).rows[0].id as string;
const due = async <T>(fn: string) => worker.withClubTx(SYSTEM, async (tx) => (await tx.query(`select * from app.${fn}(100)`)).rows as T[]);
const inClub = async <T = unknown>(club: string, sql: string, args: unknown[]) =>
  worker.withClubTx({ clubId: club, userId: null, roles: [], source: 'job' }, async (tx) => Object.values((await tx.query(sql, args)).rows[0] ?? {})[0] as T);
/** One sweep: list what is due, act on each in its own club transaction. */
async function sweepPackages() {
  let n = 0;
  for (const r of await due<{ club_id: string; package_id: string }>('due_package_expiry')) n += await inClub<number>(r.club_id, 'select app.credit_expire($1)', [r.package_id]);
  return n;
}
async function sweepWallets() {
  let n = 0;
  for (const r of await due<{ club_id: string; customer_id: string }>('due_wallet_expiry')) n += Number(await inClub<string>(r.club_id, 'select app.wallet_expire($1)', [r.customer_id]));
  return n;
}
/** A fixture reserve, as the definer functions (F04 Pay) make it. */
async function reserveAs(club: string, p: string, b: { booking: string; line: string }) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role booq_owner');
    await c.query(`select set_config('app.club_id', $1, true)`, [club]);
    await c.query('select app.credit_reserve($1, $2, $3)', [p, b.booking, b.line]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
const setPaused = (club: string, paused: boolean) => tdb.query(`update public.club set status = $2 where id = $1`, [club, paused ? 'paused' : 'live']);
const walletIn = (club: string, customer: string, amount: number, key: string) =>
  tdb.query(`insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, dedupe_key) values ($1,$2,$3,'refund',$4)`, [club, customer, amount, key]);

describe('package_expire sweep (PKG-03-AC3)', () => {
  it('lists packages of every club once they reach expiry; the sweep writes one expire row; twice writes once', async () => {
    const a = await pkg(A, PA);
    const b = await pkg(B, PB, 3);
    expect(await due('due_package_expiry')).toEqual([]);
    await tdb.setNow('2027-04-05T16:59:59.998Z');
    expect(await due('due_package_expiry')).toEqual([]);
    await tdb.setNow(EXPIRES);
    expect((await due<{ package_id: string }>('due_package_expiry')).map((r) => r.package_id).sort()).toEqual([a, b].sort());
    expect(await sweepPackages()).toBe(8);
    expect(await sweepPackages()).toBe(0);
    expect(await due('due_package_expiry')).toEqual([]);
    expect((await tdb.query(`select count(*)::int as n from public.credit_ledger where reason = 'expire'`)).rows[0].n).toBe(2);
  });
  it('a paused club is skipped until it is resumed', async () => {
    await pkg(A, PA);
    const b = await pkg(B, PB);
    await setPaused(A, true);
    await tdb.setNow('2027-04-06T03:00:00Z');
    expect((await due<{ package_id: string }>('due_package_expiry')).map((r) => r.package_id)).toEqual([b]);
    await sweepPackages();
    expect((await tdb.query(`select count(*)::int as n from public.credit_ledger where club_id = $1`, [A])).rows[0].n).toBe(0);
    await setPaused(A, false);
    expect(await due('due_package_expiry')).toHaveLength(1);
  });
  it('a used up package is not listed', async () => {
    const a = await pkg(A, PA, 1);
    await tdb.query(`insert into public.credit_ledger (club_id, package_id, change, reason) values ($1,$2,-1,'import')`, [A, a]);
    await tdb.setNow('2027-04-06T03:00:00Z');
    expect(await due('due_package_expiry')).toEqual([]);
  });
});

describe('wallet_expire sweep (PKG-03-AC10, D89)', () => {
  const setMonths = (club: string, n: number | null) =>
    tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'wallet_expiry_months',$2::jsonb) on conflict (club_id, key) do update set value = excluded.value`, [club, JSON.stringify(n)]);
  it('only clubs that set wallet_expiry_months are swept; an unset setting never expires anything', async () => {
    await walletIn(A, PA, 10000, 'a1');
    await walletIn(B, PB, 10000, 'b1');
    await setMonths(B, null);
    await tdb.setNow('2028-01-01T03:00:00Z');
    expect(await due('due_wallet_expiry')).toEqual([]);
    await setMonths(A, 3);
    expect(await due('due_wallet_expiry')).toEqual([{ club_id: A, customer_id: PA }]);
    expect(await sweepWallets()).toBe(10000);
    expect(await sweepWallets()).toBe(0);
    expect(await due('due_wallet_expiry')).toEqual([]);
  });
  it('a paused club is skipped', async () => {
    await walletIn(A, PA, 10000, 'a1');
    await setMonths(A, 1);
    await setPaused(A, true);
    await tdb.setNow('2028-01-01T03:00:00Z');
    expect(await due('due_wallet_expiry')).toEqual([]);
  });
});

describe('session_start credit hook (R1-AC3)', () => {
  async function booked(club: string, customer: string, p: string, startUtc: string, status = 'confirmed') {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local session_replication_role = replica');
      const o = (await c.query(`insert into public.orders (club_id, customer_id, source, status) values ($1,$2,'online','paid') returning id`, [club, customer])).rows[0].id;
      const b = (await c.query(`insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
                                values ($1,$2,'court',$3,$4::timestamptz,$4::timestamptz + interval '1 hour',$5,$6,'online',$5,now()) returning id`, [club, o, courts[club], startUtc, customer, status])).rows[0].id;
      const l = (await c.query(`insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, net_satang, credit_package_id, credit_units, credit_value_satang)
                                values ($1,$2,1,'court_hour',$3,'k','ก','x',50000,50000,$4,1,50000) returning id`, [club, o, b, p])).rows[0].id;
      await c.query('commit');
      return { booking: b as string, line: l as string };
    } finally {
      c.release();
    }
  }
  it('lists started bookings of every club with a credit still reserved; the hook writes use once', async () => {
    const pa = await pkg(A, PA);
    const pb = await pkg(B, PB);
    const ba = await booked(A, PA, pa, '2027-02-10T03:00:00Z');
    const bb = await booked(B, PB, pb, '2027-02-10T05:00:00Z');
    await reserveAs(A, pa, ba);
    await reserveAs(B, pb, bb);
    await tdb.setNow('2027-02-10T03:00:00Z');
    const list = await due<{ club_id: string; booking_id: string }>('due_session_credits');
    expect(list).toEqual([{ club_id: A, booking_id: ba.booking }]);
    expect(await inClub<number>(A, 'select app.f06_session_start($1)', [ba.booking])).toBe(1);
    expect(await inClub<number>(A, 'select app.f06_session_start($1)', [ba.booking])).toBe(0);
    expect(await due('due_session_credits')).toEqual([]);
    await tdb.setNow('2027-02-10T06:00:00Z');
    expect((await due<{ booking_id: string }>('due_session_credits')).map((r) => r.booking_id)).toEqual([bb.booking]);
  });
  it('a cancelled booking is not listed', async () => {
    const pa = await pkg(A, PA);
    const ba = await booked(A, PA, pa, '2027-02-10T03:00:00Z', 'cancelled');
    await reserveAs(A, pa, ba);
    await tdb.setNow('2027-02-10T04:00:00Z');
    expect(await due('due_session_credits')).toEqual([]);
  });
});

describe('only the worker', () => {
  it('lists due work; the app role cannot', async () => {
    for (const f of ['due_package_expiry', 'due_wallet_expiry', 'due_session_credits']) {
      expect((await tdb.query('select has_function_privilege($1, $2, $3) as ok', ['booq_app', `app.${f}(integer)`, 'execute'])).rows[0].ok, f).toBe(false);
      const app = createDb({ connectionString: tdb.url, max: 1 });
      try {
        await expect(app.withClubTx({ clubId: A, userId: PA, roles: ['player'], source: 'player_app' }, (tx) => tx.query(`select * from app.${f}(1)`))).rejects.toThrow(/permission denied|forbidden/);
      } finally {
        await app.end();
      }
    }
  });
});

describe('reads for the quote, brought forward from F06-T11 (F04 4.3)', () => {
  const DESK = '33333333-3333-4333-8333-333333333333';
  const PA2 = '66666666-6666-4666-8666-666666666666';
  async function morePeople() {
    for (const [u, roles] of [[DESK, ['front_desk', 'player']], [PA2, ['player']]] as const) {
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
  }
  const asApp = async <T>(user: string, roles: string[], sql: string, args: unknown[] = [], club = A) => {
    const app = createDb({ connectionString: tdb.url, max: 1 });
    try {
      return (await app.withClubTx({ clubId: club, userId: user, roles, source: 'player_app' }, (tx) => tx.query(sql, args))).rows as T[];
    } finally {
      await app.end();
    }
  };
  it('a player lists their own eligible credits; another player’s are refused; the front desk may', async () => {
    await morePeople();
    const p = await pkg(A, PA);
    const spec = JSON.stringify({ credit_type: 'court_hour' });
    expect(await asApp(PA, ['player'], 'select package_id from app.eligible_credits($1, $2)', [PA, spec])).toEqual([{ package_id: p }]);
    await expect(asApp(PA2, ['player'], 'select package_id from app.eligible_credits($1, $2)', [PA, spec])).rejects.toThrow(/forbidden/);
    expect(await asApp(DESK, ['front_desk', 'player'], 'select package_id from app.eligible_credits($1, $2)', [PA, spec])).toEqual([{ package_id: p }]);
  });
  it('a player reads only their own wallet balance; the front desk and owner read the club’s; never another club’s', async () => {
    await morePeople();
    await walletIn(A, PA, 10000, 'a1');
    await walletIn(A, PA2, 2000, 'a2');
    await walletIn(B, PB, 5000, 'b1');
    expect(await asApp(PA, ['player'], 'select customer_id, balance_satang from public.wallet_balance')).toEqual([{ customer_id: PA, balance_satang: '10000' }]);
    expect(await asApp(PA2, ['player'], 'select customer_id from public.wallet_balance where customer_id = $1', [PA])).toEqual([]);
    expect((await asApp<{ customer_id: string }>(DESK, ['front_desk', 'player'], 'select customer_id from public.wallet_balance order by customer_id')).map((r) => r.customer_id)).toEqual([PA, PA2].sort());
    expect((await asApp<{ customer_id: string }>(OA, ['owner', 'player'], 'select customer_id from public.wallet_balance')).map((r) => r.customer_id).sort()).toEqual([PA, PA2].sort());
    expect(await asApp(OB, ['owner', 'player'], 'select customer_id from public.wallet_balance', [], B)).toEqual([{ customer_id: PB }]);
  });
});
