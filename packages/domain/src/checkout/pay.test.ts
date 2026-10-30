import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db, type Tx } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { CheckoutError } from './errors';
import { findLiveHold, parsePayRequest, placeOrder, preparePay } from './pay';
import { quoteFor } from './quote';
import { fixtureSources, IDS, seedHunter } from './test-fixture';

// F04-T12a: the Pay gate and the reprice (R4-AC9, R8-AC1, R7-AC1, D63; design 4.5 steps 1 and 2). Nothing
// is created by this step: a changed price returns the new quote and the player confirms again.
const { A, COURT, COACH, ME } = IDS;
const HOUR = '2026-12-02T18:00:00+07:00';
const me = { clubId: A, userId: ME, roles: ['player'], requestId: 'r', source: 'player_app' as const };

let tdb: TestDatabase;
let db: Db;
const inTx = <T>(fn: (tx: Tx) => Promise<T>) => db.withClubTx(me, fn);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await seedHunter(tdb);
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

const choice = { courtId: COURT, hours: [HOUR] };
const hashNow = async (body: Record<string, unknown> = choice) =>
  (await inTx((tx) => quoteFor(tx, ME, parsePayRequest({ ...body, quoteHash: '0'.repeat(64) }).choice, fixtureSources()))).quoteHash;
const count = async (table: string) => Number((await tdb.query(`select count(*) from public.${table}`)).rows[0].count);

describe('parsePayRequest', () => {
  it('needs the quote hash the player saw, as 64 hex', () => {
    expect(() => parsePayRequest(choice)).toThrow(CheckoutError);
    expect(() => parsePayRequest({ ...choice, quoteHash: 'abc' })).toThrow(CheckoutError);
    expect(parsePayRequest({ ...choice, quoteHash: 'A'.repeat(64) }).quoteHash).toBe('a'.repeat(64));
  });
  it('reads choices only; amounts are ignored (CC-2)', () => {
    const r = parsePayRequest({ ...choice, quoteHash: 'a'.repeat(64), moneySatang: 1 });
    expect(r.choice).toEqual({ courtId: COURT, hours: [HOUR], coachId: null, coachSource: 'checkout', addOnIds: [], code: null });
  });
});

describe('preparePay: gate and reprice', () => {
  it('the same price as shown is ready to pay, with the quote to freeze', async () => {
    const hash = await hashNow();
    const r = await inTx((tx) => preparePay(tx, ME, parsePayRequest({ ...choice, quoteHash: hash }), fixtureSources()));
    expect(r).toMatchObject({ kind: 'ready', quote: { quoteHash: hash, moneySatang: 50000 } });
  });

  it('a price changed since checkout opened creates nothing and returns the new quote (R4-AC9, D63)', async () => {
    const hash = await hashNow();
    await tdb.query(`update public.court_price_rule set price_satang = 55000 where club_id = $1`, [A]);
    const before = [await count('orders'), await count('booking')];
    const r = await inTx((tx) => preparePay(tx, ME, parsePayRequest({ ...choice, quoteHash: hash }), fixtureSources()));
    expect(r).toMatchObject({ kind: 'price_changed', quote: { totalSatang: 55000 } });
    expect(r.quote.quoteHash).not.toBe(hash);
    expect([await count('orders'), await count('booking')]).toEqual(before);
    // confirming again with the new hash is ready
    const again = await inTx((tx) => preparePay(tx, ME, parsePayRequest({ ...choice, quoteHash: r.quote.quoteHash }), fixtureSources()));
    expect(again.kind).toBe('ready');
  });

  it('a Paused club is refused with club_paused (D60, R4-AC10)', async () => {
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    await expect(inTx((tx) => preparePay(tx, ME, parsePayRequest({ ...choice, quoteHash: 'a'.repeat(64) }), fixtureSources()))).rejects.toMatchObject({ code: 'club_paused' });
  });

  it('a coach added at checkout needs the club feature switch coach_add_at_checkout', async () => {
    const body = { ...choice, coachId: COACH };
    await expect(inTx((tx) => preparePay(tx, ME, parsePayRequest({ ...body, quoteHash: 'a'.repeat(64) }), fixtureSources()))).rejects.toMatchObject({ code: 'coach_at_checkout_disabled' });
    await tdb.query(`insert into public.club_feature (club_id, feature_key, enabled) values ($1,'coach_add_at_checkout',true)`, [A]);
    const hash = await hashNow(body);
    const r = await inTx((tx) => preparePay(tx, ME, parsePayRequest({ ...body, quoteHash: hash }), fixtureSources()));
    expect(r).toMatchObject({ kind: 'ready', quote: { totalSatang: 130000 } });
  });

  it('a coach booked through Classes does not need the checkout switch', async () => {
    const body = { ...choice, coachId: COACH, coachSource: 'classes' };
    const hash = await hashNow(body);
    expect((await inTx((tx) => preparePay(tx, ME, parsePayRequest({ ...body, quoteHash: hash }), fixtureSources()))).kind).toBe('ready');
  });
});

// F04-T12b: the order with its frozen amounts, then reserve_court, then the lines (R7-AC1, R3-AC6, BOOK-06,
// D40, D47, D111; design 4.5 step 3). Uses app.create_priced_order and app.add_order_lines (Architect).
describe('placeOrder', () => {
  const ready = async (body: Record<string, unknown>) => {
    const hash = await hashNow(body);
    const r = await inTx((tx) => preparePay(tx, ME, parsePayRequest({ ...body, quoteHash: hash }), fixtureSources()));
    if (r.kind !== 'ready') throw new Error('expected ready');
    return { choice: parsePayRequest({ ...body, quoteHash: hash }).choice, quote: r.quote };
  };
  const place = async (body: Record<string, unknown>) => {
    const { choice: c, quote } = await ready(body);
    return inTx((tx) => placeOrder(tx, ME, c, quote, fixtureSources()));
  };
  const HOUR2 = '2026-12-02T19:00:00+07:00';

  it('writes the frozen amounts, holds each hour as its own booking and links each line to its hour (BOOK-06, R7-AC1)', async () => {
    const r = await place({ courtId: COURT, hours: [HOUR2, HOUR], addOnIds: [IDS.WATER] });
    expect(r).toMatchObject({ reused: false });
    expect(r.holdExpiresAt).not.toBeNull();
    const o = (await tdb.query(`select status, subtotal_satang, total_satang, money_satang, quote_hash, priced_at from public.orders where id = $1`, [r.orderId])).rows[0];
    expect(o).toMatchObject({ status: 'open', subtotal_satang: 102000, total_satang: 102000, money_satang: 102000 });
    expect(o.priced_at).not.toBeNull();
    const lines = (await tdb.query(
      `select l.position, l.kind, l.unit_price_satang, b.start_at, l.description_key from public.order_line l join public.booking b on b.id = l.booking_id
        where l.order_id = $1 order by l.position`, [r.orderId])).rows;
    expect(lines.map((l) => [l.position, l.kind, l.unit_price_satang, new Date(l.start_at).toISOString()])).toEqual([
      [1, 'court_hour', 50000, '2026-12-02T11:00:00.000Z'],
      [2, 'court_hour', 50000, '2026-12-02T12:00:00.000Z'],
      [3, 'add_on', 2000, '2026-12-02T11:00:00.000Z'], // the add-on belongs to the first hour (D111, R3-AC6)
    ]);
    expect(lines.map((l) => l.description_key)).toEqual(['P-0076', 'P-0076', 'P-0071']);
    expect(Number((await tdb.query(`select count(*) from public.booking where order_id = $1`, [r.orderId])).rows[0].count)).toBe(2);
  });

  it('the stored lines keep their prices and names when the club changes them later (R7-AC2)', async () => {
    const r = await place({ courtId: COURT, hours: [HOUR], addOnIds: [IDS.WATER] });
    await tdb.query(`update public.add_on set price_satang = 9999, name_en = 'Still water' where club_id = $1`, [A]);
    await tdb.query(`update public.court_price_rule set price_satang = 1 where club_id = $1`, [A]);
    const lines = (await tdb.query(`select kind, unit_price_satang, name_en from public.order_line where order_id = $1 order by position`, [r.orderId])).rows;
    expect(lines).toEqual([{ kind: 'court_hour', unit_price_satang: 50000, name_en: '1' }, { kind: 'add_on', unit_price_satang: 2000, name_en: 'Water' }]);
  });

  it('a taken slot refuses and nothing is created (BOOK-04, R8-AC1)', async () => {
    const other = '55555555-5555-4555-8555-555555555555';
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into public.app_user (club_id, id, line_user_id, full_name) values ($1,$2,'L9','Other')`, [A, other]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, other]);
      await c.query('commit');
    } finally {
      c.release();
    }
    const theirs = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, other])).rows[0].id as string;
    await db.withClubTx({ ...me, userId: other }, (tx) => tx.query(`select app.reserve_court($1, $2, $3::timestamptz[])`, [theirs, COURT, [new Date(HOUR).toISOString()]]));
    const before = [await count('orders'), await count('order_line'), await count('booking')];
    await expect(place({ courtId: COURT, hours: [HOUR] })).rejects.toMatchObject({ code: 'BK001', message: 'slot_unavailable' });
    expect([await count('orders'), await count('order_line'), await count('booking')]).toEqual(before);
  });

  it('past the platform limit on Pay taps the claim refuses with too_many_attempts and the seconds to wait; nothing is made (D61, F03 4.8)', async () => {
    // The limit is Security's platform setting; these values are test data.
    await tdb.query(`insert into platform.config (key, value) values ('pay_tap_limit_count', '2'), ('pay_tap_limit_window_seconds', '600')
                     on conflict (key) do update set value = excluded.value`);
    await place({ courtId: COURT, hours: ['2026-12-02T08:00:00+07:00'] });
    await place({ courtId: COURT, hours: ['2026-12-02T09:00:00+07:00'] });
    const before = [await count('orders'), await count('booking')];
    const e = await place({ courtId: COURT, hours: ['2026-12-02T10:00:00+07:00'] }).then(() => null, (x: { code?: string; message?: string; detail?: string }) => x);
    expect(e).toMatchObject({ code: 'BK001', message: 'too_many_attempts' });
    expect(Number(e!.detail)).toBeGreaterThan(0);
    expect([await count('orders'), await count('booking')]).toEqual(before);
  });

  it('a second tap returns the same order and hold and leaves no second order (D47, BOOK-03-AC15)', async () => {
    const first = await place({ courtId: COURT, hours: [HOUR] });
    const orders = await count('orders');
    const second = await place({ courtId: COURT, hours: [HOUR] });
    expect(second).toMatchObject({ orderId: first.orderId, reused: true });
    expect(new Date(second.holdExpiresAt!).getTime()).toBe(new Date(first.holdExpiresAt!).getTime());
    expect(await count('orders')).toBe(orders);
  });
});

// F04-T12c: the code use, the birthday entitlement and the credit and wallet reservation inside Pay
// (R4-AC1 to AC3, AC8, PROMO-01-AC7, R5-AC3, D22, D66). The F06 reservation goes through its port
// (reserve_credit_and_wallet, F06-T09) after the lines exist, since it is keyed by line.
describe('placeOrder: entitlements and the ledger', () => {
  const HOUR_A = '2026-12-02T08:00:00+07:00';
  const placeWith = async (body: Record<string, unknown>, over: Parameters<typeof fixtureSources>[0] = {}) => {
    const src = fixtureSources(over);
    const hash = (await inTx((tx) => quoteFor(tx, ME, parsePayRequest({ ...body, quoteHash: '0'.repeat(64) }).choice, src))).quoteHash;
    const req = parsePayRequest({ ...body, quoteHash: hash });
    return inTx(async (tx) => {
      const r = await preparePay(tx, ME, req, src);
      if (r.kind !== 'ready') throw new Error('expected ready');
      return placeOrder(tx, ME, req.choice, r.quote, src);
    });
  };
  const addCode = async (code: string, totalCap: number | null = null) =>
    (await tdb.query(`insert into public.promo_code (club_id, code_upper, kind, value, applies_to, total_cap) values ($1,$2,'percent',1000,array['court_hour'],$3) returning id`, [A, code, totalCap])).rows[0].id as string;

  it('counts the code use once for the order, at Pay (D66)', async () => {
    const id = await addCode('TEN');
    const r = await placeWith({ courtId: COURT, hours: [HOUR_A], code: 'ten' });
    const rows = (await tdb.query(`select order_id, status from public.promo_redemption where code_id = $1`, [id])).rows;
    expect(rows).toEqual([{ order_id: r.orderId, status: 'counted' }]);
    expect((await tdb.query(`select promo_code_id, money_satang from public.orders where id = $1`, [r.orderId])).rows[0]).toEqual({ promo_code_id: id, money_satang: 45000 });
  });

  it('the last use of a capped code taken after the reprice is refused by the count under the lock; nothing is made (PROMO-01-AC7)', async () => {
    const id = await addCode('ONCE', 1);
    const src = fixtureSources();
    const body = { courtId: COURT, hours: [HOUR_A], code: 'ONCE' };
    const hash = (await inTx((tx) => quoteFor(tx, ME, parsePayRequest({ ...body, quoteHash: '0'.repeat(64) }).choice, src))).quoteHash;
    const req = parsePayRequest({ ...body, quoteHash: hash });
    const stale = await inTx((tx) => preparePay(tx, ME, req, src));
    // Another player takes the last use between this reprice and the count.
    const other = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, ME])).rows[0].id as string;
    await tdb.query(`insert into public.promo_redemption (club_id, code_id, order_id, customer_id) values ($1,$2,$3,$4)`, [A, id, other, ME]);
    const before = [await count('orders'), await count('booking'), await count('promo_redemption')];
    await expect(inTx((tx) => placeOrder(tx, ME, req.choice, stale.quote, src))).rejects.toMatchObject({ code: 'code_used_up' });
    expect([await count('orders'), await count('booking'), await count('promo_redemption')]).toEqual(before);
  });

  it('a hold that ends without payment restores the code use and the birthday entitlement (R7-AC6, D66, R5-AC5)', async () => {
    await tdb.seedCoach(A, COACH);
    await tdb.query(`insert into public.club_feature (club_id, feature_key, enabled) values ($1,'coach_add_at_checkout',true)`, [A]);
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'birthday_discount','{"kind":"percent","value":1000}')`, [A]);
    await tdb.query(`update public.app_user set date_of_birth = '1990-12-20' where id = $1`, [ME]);
    const id = await addCode('STACK');
    await tdb.query(`update public.promo_code set stackable_with_birthday = true where id = $1`, [id]);
    const r = await placeWith({ courtId: COURT, hours: [HOUR_A], coachId: COACH, code: 'STACK' });
    expect((await tdb.query(`select status from public.birthday_entitlement_use where order_id = $1`, [r.orderId])).rows).toEqual([{ status: 'used' }]);
    expect((await tdb.query(`select status from public.promo_redemption where order_id = $1`, [r.orderId])).rows).toEqual([{ status: 'counted' }]);
    await inTx((tx) => tx.query(`select app.release_hold($1, 'player')`, [r.orderId]));
    expect((await tdb.query(`select status from public.birthday_entitlement_use where order_id = $1`, [r.orderId])).rows).toEqual([{ status: 'restored' }]);
    expect((await tdb.query(`select status from public.promo_redemption where order_id = $1`, [r.orderId])).rows).toEqual([{ status: 'restored' }]);
  });

  it('calls the F06 reservation once, after the lines exist, with the order (D22, R4-AC8)', async () => {
    const seen: Array<{ order: string; lines: number }> = [];
    await placeWith({ courtId: COURT, hours: [HOUR_A] }, {
      walletBalance: async () => 20000,
      reserveCreditAndWallet: async (tx, order) => {
        seen.push({ order, lines: Number((await tx.query<{ n: string }>(`select count(*) as n from public.order_line where order_id = $1`, [order])).rows[0]!.n) });
        return true;
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.lines).toBe(1);
    expect((await tdb.query(`select wallet_satang, money_satang from public.orders where id = $1`, [seen[0]!.order])).rows[0]).toEqual({ wallet_satang: 20000, money_satang: 30000 });
  });

  it('a failed reservation rolls the whole Pay back: no order, no hold, no code use (PAY-07-AC5)', async () => {
    await addCode('TEN');
    const before = [await count('orders'), await count('booking'), await count('promo_redemption')];
    await expect(placeWith({ courtId: COURT, hours: [HOUR_A], code: 'TEN' }, { walletBalance: async () => 20000, reserveCreditAndWallet: async () => false }))
      .rejects.toMatchObject({ code: 'credit_unavailable' });
    expect([await count('orders'), await count('booking'), await count('promo_redemption')]).toEqual(before);
  });

  it('a second tap with a code capped at one use per customer returns the same hold (D47)', async () => {
    const id = await addCode('MINE');
    await tdb.query(`update public.promo_code set per_customer_cap = 1 where id = $1`, [id]);
    const first = await placeWith({ courtId: COURT, hours: [HOUR_A], code: 'MINE' });
    // A repeat of the same intent is not repriced (design 4.5 step 6): the live hold is found first.
    const src = fixtureSources();
    const choice = parsePayRequest({ courtId: COURT, hours: [HOUR_A], code: 'MINE', quoteHash: '0'.repeat(64) }).choice;
    expect(await inTx((tx) => findLiveHold(tx, choice))).toMatchObject({ orderId: first.orderId, reused: true });
    const again = await inTx(async (tx) => placeOrder(tx, ME, choice, await quoteFor(tx, ME, { ...choice, code: null }, src), src));
    expect(again).toMatchObject({ orderId: first.orderId, reused: true });
    expect((await tdb.query(`select count(*)::int as n from public.promo_redemption where code_id = $1`, [id])).rows[0].n).toBe(1);
  });

  it('the default reservation writes nothing and asks F06 nothing when no credit or wallet is used', async () => {
    const r = await placeWith({ courtId: COURT, hours: [HOUR_A] });
    expect(r.reused).toBe(false);
  });
});
