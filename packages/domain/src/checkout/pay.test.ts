import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db, type Tx } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { CheckoutError } from './errors';
import { parsePayRequest, preparePay } from './pay';
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
