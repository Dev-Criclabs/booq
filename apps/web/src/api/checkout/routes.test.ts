import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { pendingFeatureSources, type CodeInput, type QuoteSources } from '@booq/domain';
import { checkoutRoutes } from './routes';

// F04-T11 POST /checkout/quote (R1 to R4, R8-AC4, PROMO-01-AC9, CC-1, CC-2; design 4.2, 5.1). Real club data in
// the test database; the reads other features own go through fake ports. Hunter's prices are test data.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURT = 'c1c1c1c1-0000-4000-8000-000000000001';
const OFF_COURT = 'c3c3c3c3-0000-4000-8000-000000000003';
const ADULT = 'a0a0a0a0-0000-4000-8000-000000000001';
const STUDENT = 'a0a0a0a0-0000-4000-8000-000000000002';
const TIER = 'b0b0b0b0-0000-4000-8000-000000000001';
const HEAD = 'b0b0b0b0-0000-4000-8000-000000000002';
const COACH = 'cccccccc-0000-4000-8000-000000000001';
const HEAD_COACH = 'cccccccc-0000-4000-8000-000000000002';
const WATER = 'dddddddd-0000-4000-8000-000000000001';
const BALLS = 'dddddddd-0000-4000-8000-000000000002';
const B_ADDON = 'dddddddd-0000-4000-8000-000000000009';
const ME = '33333333-3333-4333-8333-333333333333';
const KID = '44444444-4444-4444-8444-444444444444';
const deps = { hasFeature: async () => true };
const SLUGS: Record<string, string> = { 'club-a': A, 'club-b': B };
const HOUR = '2026-12-02T18:00:00+07:00';

const codes: Record<string, CodeInput> = {};
let terms: Awaited<ReturnType<QuoteSources['clubTerms']>> = { birthdayDiscount: null, cancelWindowHours: 12 };
let wallet = 0;
const sources: QuoteSources = {
  ...pendingFeatureSources,
  promoCode: async (_tx, code) => codes[code] ?? null,
  clubTerms: async () => terms,
  coach: async (_tx, id) => (id === COACH ? { tierId: TIER, priceSatang: null } : id === HEAD_COACH ? { tierId: HEAD, priceSatang: null } : null),
  walletBalance: async () => wallet,
};

let tdb: TestDatabase;
let db: Db;
const quote = () => checkoutRoutes({ db, clubBySlug: async (s) => (SLUGS[s] ? { clubId: SLUGS[s]! } : null), sources }).find((r) => r.def.path === '/checkout/quote')!;
const me = { clubId: A, userId: ME, roles: ['player' as const] };
const ask = (body: unknown, session: typeof me | null = me, input: Record<string, unknown> = { slug: 'club-a' }) =>
  quote().handle({ session, input: { ...input, ...(body as object) }, body }, deps);

beforeEach(async () => {
  for (const k of Object.keys(codes)) delete codes[k];
  terms = { birthdayDiscount: null, cancelWindowHours: 12 };
  wallet = 0;
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
    await c.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main')`, [A, LOC]);
    await c.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, COURT, LOC]);
    await c.query(`insert into public.resource (club_id, id, location_id, name, sport, active) values ($1,$2,$3,'3','tennis',false)`, [A, OFF_COURT, LOC]);
    await c.query(`insert into public.app_user (club_id, id, line_user_id, full_name, date_of_birth) values ($1,$2,'L1','Somchai','1990-12-20'), ($1,$3,'L2','Nong','2012-01-01')`, [A, ME, KID]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player'), ($1,$3,'player')`, [A, ME, KID]);
    await c.query(`insert into public.price_group (club_id, id, name_th, name_en, rule) values ($1,$2,'ผู้ใหญ่','Adult','{"min_age":18}'), ($1,$3,'นักเรียน','Student','{"max_age":17}')`, [A, ADULT, STUDENT]);
    await c.query(`insert into public.court_price_rule (club_id, price_group_id, price_satang) values ($1,$2,50000), ($1,$3,50000)`, [A, ADULT, STUDENT]);
    await c.query(`insert into public.coach_tier (club_id, id, name_th, name_en) values ($1,$2,'โค้ช','Coach'), ($1,$3,'หัวหน้าโค้ช','Head Coach')`, [A, TIER, HEAD]);
    await c.query(`insert into public.coach_tier_price (club_id, tier_id, price_group_id, price_satang) values ($1,$2,$4,80000), ($1,$2,$5,70000), ($1,$3,$4,null)`, [A, TIER, HEAD, ADULT, STUDENT]);
    await c.query(`insert into public.add_on (club_id, id, name_th, name_en, price_satang) values ($1,$2,'น้ำ','Water',2000), ($1,$3,'ลูกเทนนิส (ชุด 3 ลูก)','Balls (Set of 3 balls)',null)`, [A, WATER, BALLS]);
    await c.query(`insert into public.price_group (club_id, id, name_th, name_en, rule) values ($1,$2,'ผู้ใหญ่','Adult','{"min_age":18}')`, [B, 'a0a0a0a0-0000-4000-8000-0000000000b1']);
    await c.query(`insert into public.add_on (club_id, id, name_th, name_en, price_satang) values ($1,$2,'น้ำ','Water',1)`, [B, B_ADDON]);
    await c.query('commit');
  } finally {
    c.release();
  }
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

const body = (over: Record<string, unknown> = {}) => ({ courtId: COURT, hours: [HOUR], ...over });
const okBody = async (b: unknown, session: typeof me | null = me) => {
  const r = await ask(b, session);
  if (!r.ok) throw new Error(`expected a quote, got ${r.code}`);
  return r.body as { totalSatang: number; moneySatang: number; walletSatang: number; lines: Array<{ kind: string; unitPriceSatang: number }>; quoteHash: string; cancelWindowHours: number | null; priceGroupId: string; birthdayEntitlement: string | null };
};

describe('POST /checkout/quote', () => {
  it('is a person route answered with no-store; a guest signs in first (R8-AC4)', async () => {
    expect(quote().def).toMatchObject({ method: 'POST', path: '/checkout/quote', needsPerson: true });
    expect(quote().headers).toEqual({ 'Cache-Control': 'no-store' });
    expect(await ask(body(), null)).toEqual({ ok: false, status: 401, code: 'sign_in_required' });
  });

  it("prices Hunter's court hour at 50000 for an Adult and a Student, with the cancel window (R1-AC4, R4-AC5)", async () => {
    const adult = await okBody(body());
    expect(adult).toMatchObject({ totalSatang: 50000, moneySatang: 50000, priceGroupId: ADULT, cancelWindowHours: 12 });
    expect(adult.quoteHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await okBody(body(), { ...me, userId: KID })).priceGroupId).toBe(STUDENT);
  });

  it('the client sends choices only: amounts in the body are ignored (CC-2)', async () => {
    const q = await okBody(body({ totalSatang: 1, moneySatang: 1, lines: [{ unitPriceSatang: 1 }], priceSatang: 1 }));
    expect(q.totalSatang).toBe(50000);
  });

  it('a solo class: Adult 130000, Student 120000 (R2-AC1, AC2)', async () => {
    expect((await okBody(body({ coachId: COACH }))).totalSatang).toBe(130000);
    expect((await okBody(body({ coachId: COACH }), { ...me, userId: KID })).totalSatang).toBe(120000);
  });

  it('an unset coach price cannot be picked, nor an unknown coach (R2-AC3)', async () => {
    expect(await ask(body({ coachId: HEAD_COACH }))).toEqual({ ok: false, status: 409, code: 'coach_price_not_set' });
    expect(await ask(body({ coachId: 'cccccccc-0000-4000-8000-0000000000ff' }))).toEqual({ ok: false, status: 409, code: 'coach_price_not_set' });
  });

  it('an add-on with no price, or another club add-on, is not for sale (R3-AC1, CC-1)', async () => {
    expect((await okBody(body({ addOnIds: [WATER] }))).totalSatang).toBe(52000);
    expect(await ask(body({ addOnIds: [BALLS] }))).toMatchObject({ ok: false, code: 'add_on_not_for_sale' });
    expect(await ask(body({ addOnIds: [B_ADDON] }))).toMatchObject({ ok: false, code: 'add_on_not_for_sale' });
  });

  it('no price rule for the hour refuses it (R1-AC5)', async () => {
    await tdb.query(`delete from public.court_price_rule where club_id = $1 and price_group_id = $2`, [A, ADULT]);
    expect(await ask(body())).toEqual({ ok: false, status: 409, code: 'price_not_set' });
  });

  it('an unknown code, a malformed code and a code of another club all answer code_not_valid (PROMO-01-AC9)', async () => {
    expect(await ask(body({ code: 'NOPE' }))).toEqual({ ok: false, status: 422, code: 'code_not_valid' });
    expect(await ask(body({ code: 'bad code!' }))).toEqual({ ok: false, status: 422, code: 'code_not_valid' });
  });

  it('a code is matched in upper case after trimming; its typed refusal carries the amount variable', async () => {
    codes['TEN'] = { source: 'promo', id: 'c', kind: 'percent', value: 1000, appliesTo: ['court_hour'], includesAddOns: false, audience: 'any', startsOn: null, endsOn: null, firstTimeOnly: false, totalCap: null, perCustomerCap: null, minSpendSatang: null, stackableWithBirthday: false, partnerId: null, active: true, usesCounted: 0, customerUsesCounted: 0, customerHasPaidBooking: false };
    expect((await okBody(body({ code: '  ten ' }))).totalSatang).toBe(45000);
    codes['TEN']!.minSpendSatang = 60000;
    expect(await ask(body({ code: 'TEN' }))).toEqual({ ok: false, status: 422, code: 'code_below_minimum', params: { amount: 60000 } });
  });

  it('the wallet port pays before money (R4-AC1)', async () => {
    wallet = 20000;
    expect(await okBody(body())).toMatchObject({ walletSatang: 20000, moneySatang: 30000 });
  });

  it('the birthday discount uses the setting and the used entitlements of this year (R5-AC1, AC3)', async () => {
    terms = { birthdayDiscount: { kind: 'percent', value: 1000 }, cancelWindowHours: 12 };
    expect(await okBody(body({ coachId: COACH }))).toMatchObject({ birthdayEntitlement: 'solo_class', totalSatang: 117000 });
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, ME])).rows[0].id as string;
    await tdb.query(`insert into public.birthday_entitlement_use (club_id, customer_id, year, kind, order_id) values ($1,$2,2026,'solo_class',$3)`, [A, ME, order]);
    expect(await okBody(body({ coachId: COACH }))).toMatchObject({ birthdayEntitlement: null, totalSatang: 130000 });
  });

  it('a Paused club refuses (R4-AC10); a Draft club is not available', async () => {
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    expect(await ask(body())).toEqual({ ok: false, status: 409, code: 'club_paused' });
    await tdb.query(`update public.club set status = 'draft' where id = $1`, [A]);
    expect(await ask(body())).toEqual({ ok: false, status: 409, code: 'club_not_available' });
  });

  it('bad input, an inactive court and a slug of another club are typed codes', async () => {
    expect(await ask({ courtId: COURT, hours: [] })).toEqual({ ok: false, status: 400, code: 'bad_input' });
    expect(await ask({ courtId: 'x', hours: [HOUR] })).toEqual({ ok: false, status: 400, code: 'bad_input' });
    expect(await ask(body({ hours: ['2026-12-02T18:30:00+07:00'] }))).toEqual({ ok: false, status: 400, code: 'selection_invalid' });
    expect(await ask(body({ courtId: OFF_COURT }))).toEqual({ ok: false, status: 409, code: 'resource_inactive' });
    expect(await quote().handle({ session: me, input: { slug: 'club-b' }, body: body() }, deps)).toEqual({ ok: false, status: 404, code: 'not_found' });
  });
});
