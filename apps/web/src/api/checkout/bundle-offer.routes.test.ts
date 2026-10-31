import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { fixtureSources, IDS, seedHunter } from '../../../../../packages/domain/src/checkout/test-fixture';
import { checkoutRoutes } from './routes';

// F04-T16: the bundle prompt in the quote (R6-AC1, AC2, AC4; design 4.7; H-C10c-Checkout-bundle-prompt). A full price
// court order of a player with no court hour credit carries the club's court bundle; anything else carries none.
// Hunter's bundle price is test data here, never a default in code.
const { A, COURT, ME, ADULT, STUDENT } = IDS;
const HOUR = '2026-12-02T18:00:00+07:00';
const BUNDLE = 'eeeeeeee-0000-4000-8000-000000000001';
const deps = { hasFeature: async () => true };
const me = { clubId: A, userId: ME, roles: ['player'] as ['player'] };

let tdb: TestDatabase;
let db: Db;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-02T10:00:00Z');
  await seedHunter(tdb);
  await tdb.query(`insert into public.package_product (club_id, id, name_th, name_en, credit_type, credits, validity_months, price_satang)
                   values ($1,$2,'แพ็กเกจ 10 ชั่วโมง','10 hour bundle','court_hour',10,6,450000)`, [A, BUNDLE]);
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

const quote = async (body: Record<string, unknown>) => {
  const r = await checkoutRoutes({
    db,
    clubBySlug: async () => ({ clubId: A }),
    sources: fixtureSources(),
    payments: { privateKey: () => '', gateway: () => { throw new Error('no charge in a quote'); }, alerts: { p1: () => undefined }, now: () => new Date() },
  }).find((x) => x.def.path === '/checkout/quote')!.handle({ session: me, input: { slug: 'club-a', ...body }, body }, deps);
  if (!r.ok) throw new Error(r.code);
  return r.body as { bundleOffer: unknown; quoteHash: string; totalSatang: number };
};
const giveCourtCredit = () =>
  tdb.query(`insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, purchase_date, expires_at)
             values ($1,$2,$3, jsonb_build_object('credit_type','court_hour','price_group_id',null,'coach_tier_id',null,'credits',10,'validity_months',6,'price_satang',450000),
                     10, now(), '2026-12-01', '2027-06-01T16:59:59Z')`, [A, ME, BUNDLE]);

describe('the bundle prompt (R6)', () => {
  it('a full price court order of a player with no court credit carries the bundle, its price and hours (R6-AC1)', async () => {
    const q = await quote({ courtId: COURT, hours: [HOUR] });
    expect(q.bundleOffer).toEqual({ productId: BUNDLE, priceSatang: 450000, hours: 10, hoursUsedNow: 1 });
    expect(q.totalSatang).toBe(50000);
  });

  it('declining changes nothing: the offer is outside the quote hash (R6-AC2)', async () => {
    const a = await quote({ courtId: COURT, hours: [HOUR] });
    await tdb.query(`update public.package_product set price_satang = 470000 where id = $1`, [BUNDLE]);
    const b = await quote({ courtId: COURT, hours: [HOUR] });
    expect(b.quoteHash).toBe(a.quoteHash);
    expect(b.bundleOffer).toMatchObject({ priceSatang: 470000 });
  });

  it('a player who has court hours is not offered it (R6-AC4)', async () => {
    await giveCourtCredit();
    expect((await quote({ courtId: COURT, hours: [HOUR] })).bundleOffer).toBeNull();
  });

  it('no prompt when the bundle has no price, is inactive, or is of another price group (R6-AC1)', async () => {
    await tdb.query(`update public.package_product set price_satang = null where id = $1`, [BUNDLE]);
    expect((await quote({ courtId: COURT, hours: [HOUR] })).bundleOffer).toBeNull();
    await tdb.query(`update public.package_product set price_satang = 450000, active = false where id = $1`, [BUNDLE]);
    expect((await quote({ courtId: COURT, hours: [HOUR] })).bundleOffer).toBeNull();
    await tdb.query(`update public.package_product set active = true, price_group_id = $2 where id = $1`, [BUNDLE, STUDENT]);
    expect((await quote({ courtId: COURT, hours: [HOUR] })).bundleOffer).toBeNull();
    await tdb.query(`update public.package_product set price_group_id = $2 where id = $1`, [BUNDLE, ADULT]);
    expect((await quote({ courtId: COURT, hours: [HOUR] })).bundleOffer).toMatchObject({ productId: BUNDLE });
  });

  it('an order that is not full price is not offered it: a code discount', async () => {
    await tdb.query(`insert into public.promo_code (club_id, code_upper, kind, value, applies_to) values ($1,'TEN','percent',1000,array['court_hour'])`, [A]);
    expect((await quote({ courtId: COURT, hours: [HOUR], code: 'TEN' })).bundleOffer).toBeNull();
  });
});
