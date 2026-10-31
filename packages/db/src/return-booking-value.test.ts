import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F09-T05 / migration 1005: app.return_booking_value(booking, kind) (F09 design 4.2 step 3, 4.4; CANCEL-01-AC1 to AC10,
// CANCEL-02-AC1 to AC6; D21, D158). Per line of the booking, through F06's functions only, each with its dedupe key:
// credit back to its package, wallet use back to the wallet (wallet_return_line), money into the wallet as refund
// (refund:{line}:{version}); for the forfeiting kinds, credit_forfeit and nothing else. Never cash, never Beam.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const COURT = '00000000-0000-4000-8000-0000000000e1';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const NOW = '2027-02-01T03:00:00Z';

let tdb: TestDatabase;
let db: Db;

/** Runs SQL as F09's cancel (a definer) does: as booq_owner in the club's context, with the caller's user and reason. */
async function asDefiner(sql: string, args: unknown[] = [], who: { user?: string; roles?: string; reason?: string } = {}): Promise<any> {
  const c: pg.PoolClient = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role booq_owner');
    const roles = who.roles ?? 'player';
    await c.query(`select set_config('app.club_id', $1, true), set_config('app.user_id', $2, true), set_config('app.roles', $3, true), set_config('app.reason', $4, true),
                          set_config('app.source', $5, true), set_config('app.request_id', 'r', true)`,
      [A, who.user ?? PLAYER, roles, who.reason ?? '', roles.includes('front_desk') || roles.includes('owner') ? 'admin' : 'player_app']);
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

async function pkg(expires = '2027-06-01T00:00:00Z') {
  const product = (await tdb.query(
    `insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_satang) values ($1,'แพ็ก','Pack','court_hour',10,3,100000) returning id`, [A])).rows[0].id;
  return (await tdb.query(
    `insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, expires_at)
     values ($1,$2,$3,'{"credit_type":"court_hour"}',10,'2027-01-04T17:30:00Z',$4) returning id`, [A, PLAYER, product, expires])).rows[0].id as string;
}

type Part = { kind?: string; credit?: string; wallet?: number; money?: number };
/** A confirmed booking with its lines, paid as the parts say: the credit reserved, the wallet spent (fixture: order sums off). */
async function booking(hour: number, parts: Part[], order?: string) {
  const c = await tdb.pool.connect();
  let o = order;
  let b: string;
  const lines: string[] = [];
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    o ??= (await c.query(`insert into public.orders (club_id, customer_id, source, status) values ($1,$2,'online','paid') returning id`, [A, PLAYER])).rows[0].id as string;
    const start = new Date(Date.parse('2027-02-10T00:00:00Z') + hour * 3_600_000).toISOString();
    b = (await c.query(
      `insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
       values ($1,$2,'court',$3,$4::timestamptz,$4::timestamptz + interval '1 hour',$5,'confirmed','online',$5,now()) returning id`, [A, o, COURT, start, PLAYER])).rows[0].id as string;
    let pos = (await c.query(`select coalesce(max(position), 0) p from public.order_line where order_id = $1`, [o])).rows[0].p as number;
    for (const p of parts) {
      pos += 1;
      const creditValue = p.credit ? 30000 : 0;
      const net = creditValue + (p.wallet ?? 0) + (p.money ?? 0);
      lines.push((await c.query(
        `insert into public.order_line (club_id, order_id, position, kind, booking_id, add_on_id, description_key, name_th, name_en, unit_price_satang, net_satang,
                                        credit_package_id, credit_units, credit_value_satang, wallet_satang, money_satang)
         values ($1,$2,$3,$4,$5, case when $4 = 'add_on' then gen_random_uuid() end,'k','ก','x',$6,$6,$7,$8,$9,$10,$11) returning id`,
        [A, o, pos, p.kind ?? 'court_hour', b, net, p.credit ?? null, p.credit ? 1 : 0, creditValue, p.wallet ?? 0, p.money ?? 0])).rows[0].id as string);
    }
    await c.query('commit');
  } finally {
    c.release();
  }
  for (const [i, p] of parts.entries()) {
    if (p.credit) await asDefiner('select app.credit_reserve($1, $2, $3)', [p.credit, b, lines[i]]);
    if (p.wallet) await asDefiner('select app.wallet_spend($1, $2, $3, $4)', [PLAYER, p.wallet, o, lines[i]]);
  }
  return { order: o!, booking: b, lines };
}
const giveBack = (b: string, kind: string, who?: { user?: string; roles?: string; reason?: string }) =>
  asDefiner('select app.return_booking_value($1, $2)', [b, kind], who) as Promise<Record<string, any>>;
const credits = async (reason: string) => (await tdb.query(`select package_id, change, staff_id, note from public.credit_ledger where reason = $1 order by created_at`, [reason])).rows;
const wallet = async (reason: string) => (await tdb.query(`select order_line_id, change_satang, dedupe_key from public.wallet_ledger where reason = $1 order by order_line_id`, [reason])).rows;
/** Refund rows (wallet_credit carries no line; the key names it): key and amount, sorted by key. */
const refunds = async () => (await tdb.query(`select dedupe_key, change_satang from public.wallet_ledger where reason = 'refund' and dedupe_key <> 'seed' order by dedupe_key`)).rows;
const balance = async () => Number((await tdb.query(`select coalesce(sum(change_satang), 0) n from public.wallet_ledger where customer_id = $1`, [PLAYER])).rows[0].n);

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
  const loc = (await tdb.query(`insert into public.location (club_id, name) values ($1,'Main') returning id`, [A])).rows[0].id;
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'Court 1','tennis')`, [A, COURT, loc]);
  await tdb.setNow(NOW);
  await asDefiner(`select app.wallet_credit($1, 100000, 'refund', 'seed')`, [PLAYER]);   // the wallet the bookings spend from
  db = createDb({ connectionString: tdb.url, max: 4 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('in time or full: every part goes back to its own source (D21, CANCEL-01-AC3 to AC7)', () => {
  it('a mixed line: credit back to the package, wallet use back, money into the wallet as refund', async () => {
    const p = await pkg();
    const b = await booking(10, [{ credit: p, wallet: 2000, money: 3000 }, { kind: 'add_on', money: 5000 }]);
    const before = await balance();
    const r = await giveBack(b.booking, 'player_cancel');
    expect(r).toEqual({ credits: 1, creditLost: 0, walletSatang: 2000, moneyToWalletSatang: 8000, forfeitedCredits: 0 });
    expect((await credits('return')).map((x) => [x.package_id, x.change])).toEqual([[p, 1]]);
    expect(await wallet('return')).toEqual([{ order_line_id: b.lines[0], change_satang: '2000', dedupe_key: expect.stringMatching(/^return:/) }]);
    expect(await refunds()).toEqual(
      [{ dedupe_key: `refund:${b.lines[0]}:1`, change_satang: '3000' }, { dedupe_key: `refund:${b.lines[1]}:1`, change_satang: '5000' }]
        .sort((x, y) => x.dedupe_key.localeCompare(y.dedupe_key)),
    );
    expect(await balance()).toBe(before + 2000 + 8000);
  });

  it('a repeat returns nothing more (each part once, by its key)', async () => {
    const p = await pkg();
    const b = await booking(11, [{ credit: p, wallet: 2000, money: 3000 }]);
    await giveBack(b.booking, 'player_cancel');
    const after = await balance();
    expect(await giveBack(b.booking, 'player_cancel')).toMatchObject({ credits: 0, walletSatang: 0, moneyToWalletSatang: 0 });
    expect(await balance()).toBe(after);
    expect(await credits('return')).toHaveLength(1);
  });

  it('one hour of a two hour order returns only that hour (BOOK-06, D111)', async () => {
    const first = await booking(12, [{ wallet: 1000, money: 4000 }]);
    const second = await booking(13, [{ wallet: 1000, money: 4000 }], first.order);
    await giveBack(second.booking, 'player_cancel');
    expect((await wallet('return')).map((x) => x.order_line_id)).toEqual([second.lines[0]]);
    expect((await refunds()).map((x) => x.dedupe_key)).toEqual([`refund:${second.lines[0]}:1`]);
  });

  it('a player cancel after the package expired loses the credit (D85); a club cancel or a closure returns it', async () => {
    const p = await pkg('2027-01-31T00:00:00Z');
    await tdb.setNow('2027-01-20T03:00:00Z');   // the credits are reserved while the package is valid (D85)
    const lost = await booking(14, [{ credit: p, money: 1000 }]);
    const club = await booking(15, [{ credit: p }]);
    const closed = await booking(16, [{ credit: p }]);
    await tdb.setNow(NOW);                       // then cancelled after it expired
    expect(await giveBack(lost.booking, 'player_cancel')).toMatchObject({ credits: 0, creditLost: 1, moneyToWalletSatang: 1000 });
    expect(await credits('return')).toEqual([]);
    expect(await giveBack(club.booking, 'club_cancel', { user: DESK, roles: 'front_desk,player', reason: 'rain' })).toMatchObject({ credits: 1, creditLost: 0 });
    expect(await giveBack(closed.booking, 'closure', { user: DESK, roles: 'front_desk,player', reason: 'resurfacing' })).toMatchObject({ credits: 1 });
  });
});

describe('forfeited (CANCEL-01-AC10, D158)', () => {
  it('a late cancel forfeits the credit, keeps the wallet part spent and the money paid: nothing goes to the wallet', async () => {
    const p = await pkg();
    const b = await booking(17, [{ credit: p, wallet: 2000, money: 3000 }]);
    const before = await balance();
    expect(await giveBack(b.booking, 'late_cancel_mark')).toEqual({ credits: 0, creditLost: 0, walletSatang: 0, moneyToWalletSatang: 0, forfeitedCredits: 1 });
    expect((await credits('forfeit')).map((x) => [x.change, x.staff_id, x.note])).toEqual([[0, null, null]]);   // automatic: no staff
    expect(await wallet('return')).toEqual([]);
    expect(await balance()).toBe(before);
  });

  it('a staff mark forfeits with the staff member and the written reason from the request', async () => {
    const p = await pkg();
    const b = await booking(18, [{ credit: p }]);
    await giveBack(b.booking, 'no_show_mark', { user: DESK, roles: 'front_desk,player', reason: 'did not come' });
    expect((await credits('forfeit')).map((x) => [x.staff_id, x.note])).toEqual([[DESK, 'did not come']]);
  });
});

describe('refusals', () => {
  it('an unknown kind, a reversal (F09-T07 owns it) and an unknown booking are refused', async () => {
    const b = await booking(19, [{ money: 1000 }]);
    await expect(giveBack(b.booking, 'refund')).rejects.toThrow(/cancel:kind/);
    await expect(giveBack(b.booking, 'reversal')).rejects.toThrow(/cancel:kind/);
    await expect(giveBack('ffffffff-0000-4000-8000-000000000000', 'player_cancel')).rejects.toThrow(/cancel:not_found/);
  });

  it('no app role may call it: the F09 and F08 definer functions do', async () => {
    for (const role of ['booq_app', 'booq_worker', 'booq_platform']) {
      expect((await tdb.query(`select has_function_privilege($1, 'app.return_booking_value(uuid, text)', 'execute') as ok`, [role])).rows[0].ok, role).toBe(false);
    }
  });
});

describe("F08's cancel_session returns a paid seat's value through it (CLASS-01-AC11)", () => {
  it('the seat holder gets the money of the seat in the wallet as refund', async () => {
    await tdb.seedCoach(A, COACH);
    await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) select $1, d, '06:00', '24:00' from generate_series(1, 7) d`, [A]);
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [A]);
    const owner = { clubId: A, userId: OWNER, roles: ['owner', 'player'] as never, source: 'admin' as const };
    await tdb.query(`insert into public.class_template (club_id, name_th, name_en, audience, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by)
                     values ($1,'ก','Group','adult',$2,$3,3,'18:00',2,4,$4)`, [A, COACH, COURT, OWNER]);
    await db.withClubTx(owner, (tx) => tx.query(`select app.generate_sessions(app.now()::date, app.now()::date + 30)`));
    const s = (await tdb.query(`select id, start_at, end_at from public.class_session order by start_at limit 1`)).rows[0];
    const c = await tdb.pool.connect();
    let seat: string;
    let line: string;
    try {
      await c.query('begin');
      await c.query('set local session_replication_role = replica');
      const o = (await c.query(`insert into public.orders (club_id, customer_id, source, status) values ($1,$2,'online','paid') returning id`, [A, PLAYER])).rows[0].id;
      seat = (await c.query(
        `insert into public.booking (club_id, order_id, type, resource_id, class_session_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
         values ($1,$2,'class_seat',$3,$4,$5,$6,$7,'confirmed','online',$7,now()) returning id`, [A, o, COURT, s.id, s.start_at, s.end_at, PLAYER])).rows[0].id;
      line = (await c.query(
        `insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, net_satang, money_satang)
         values ($1,$2,1,'class_seat',$3,'k','ก','x',30000,30000,30000) returning id`, [A, o, seat])).rows[0].id;
      await c.query('commit');
    } finally {
      c.release();
    }
    const before = await balance();
    await db.withClubTx({ ...owner, reason: 'coach ill' }, (tx) => tx.query(`select app.cancel_session($1, 'owner')`, [s.id]));
    expect((await tdb.query(`select status from public.booking where id = $1`, [seat!])).rows[0].status).toBe('cancelled');
    expect(await refunds()).toEqual([{ dedupe_key: `refund:${line!}:1`, change_satang: '30000' }]);
    expect(await balance()).toBe(before + 30000);
  });
});
