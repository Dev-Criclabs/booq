import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { setupDataRoutes } from './routes';

// F04-T14 / F11 A9, A9b, A10 (ADMIN-10, 11, 12; R3-AC1, R3-AC8, PROMO-01-AC12): the owner's setup routes.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER = '44444444-4444-4444-8444-444444444444';
const DESK = '33333333-3333-4333-8333-333333333333';
const ACC = '55555555-5555-4555-8555-555555555555';
const PLAYER = '22222222-2222-4222-8222-222222222222';
const deps = { hasFeature: async () => true };
let tdb: TestDatabase;
let db: Db;
let routes: ReturnType<typeof setupDataRoutes>;

type Roles = ('owner' | 'front_desk' | 'accountant' | 'player')[];
const as = (userId: string, roles: Roles) => ({ clubId: A, userId, roles });
const owner = () => as(OWNER, ['owner', 'player']);
const desk = () => as(DESK, ['front_desk', 'player']);
const call = (method: string, path: string, session: ReturnType<typeof as> | null, input: Record<string, unknown> = {}, body?: unknown) =>
  routes.find((r) => r.def.method === method && r.def.path === path)!.handle({ session, input: { slug: 'club-a', ...input }, body }, deps) as Promise<{ ok: boolean; status: number; code?: string; params?: any; body?: any }>;

async function person(id: string, roles: string[]) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)`, [A, id, 'L' + id]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [A, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
const audits = async (type: string) => Number((await tdb.query(`select count(*) as n from public.audit_entry where record_type = $1`, [type])).rows[0].n);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  await person(OWNER, ['owner', 'player']);
  await person(DESK, ['front_desk', 'player']);
  await person(ACC, ['accountant', 'player']);
  await person(PLAYER, ['player']);
  db = createDb({ connectionString: tdb.url, max: 4 });
  routes = setupDataRoutes({ db, clubBySlug: async (slug) => (slug === 'club-a' ? { clubId: A } : slug === 'club-b' ? { clubId: B } : null) });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('who may read and write', () => {
  it('every resource: owner, front desk and accountant read; only the owner writes; a player and a guest do neither', async () => {
    for (const p of ['price-groups', 'court-prices', 'coach-tiers', 'package-products', 'add-ons', 'partners', 'promo-codes', 'coach-tier-prices']) {
      const path = `/staff/setup/${p}`;
      expect((await call('GET', path, owner())).ok, p).toBe(true);
      expect((await call('GET', path, desk())).ok, p).toBe(true);
      expect((await call('GET', path, as(ACC, ['accountant', 'player']))).ok, p).toBe(true);
      expect(await call('GET', path, as(PLAYER, ['player'])), p).toMatchObject({ ok: false, status: 403 });
      expect(await call('GET', path, null), p).toMatchObject({ ok: false, status: 401 });
      const put = p === 'coach-tier-prices' ? 'PUT' : 'POST';
      expect(await call(put, path, desk(), {}, {}), p).toMatchObject({ ok: false, status: 403 });
      expect(await call(put, path, as(ACC, ['accountant', 'player']), {}, {}), p).toMatchObject({ ok: false, status: 403 });
    }
    expect(await call('GET', '/staff/setup/price-groups', owner(), { slug: 'club-b' })).toMatchObject({ ok: false, status: 404 });
  });
});

describe('price groups and court prices (A9b)', () => {
  it('creates, lists, updates and audits a group; the rule is checked', async () => {
    const g = (await call('POST', '/staff/setup/price-groups', owner(), {}, { nameTh: 'ผู้ใหญ่', nameEn: 'Adult', rule: { min_age: 18 } })).body;
    expect(g).toMatchObject({ nameEn: 'Adult', rule: { min_age: 18 }, position: 0 });
    const s = (await call('POST', '/staff/setup/price-groups', owner(), {}, { nameTh: 'นักเรียน', nameEn: 'Student', rule: { min_age: 0, max_age: 17 }, position: 1 })).body;
    expect((await call('GET', '/staff/setup/price-groups', desk())).body.map((x: { nameEn: string }) => x.nameEn)).toEqual(['Adult', 'Student']);
    expect((await call('PUT', '/staff/setup/price-groups/:id', owner(), { id: s.id }, { nameEn: 'Junior' })).body.nameEn).toBe('Junior');
    expect(await audits('price_group')).toBe(3);
    for (const rule of [{}, { min_age: -1 }, { max_age: 'x' }, { min_age: 20, max_age: 10 }, { foo: 1 }, []]) {
      expect(await call('POST', '/staff/setup/price-groups', owner(), {}, { nameTh: 'x', nameEn: 'x', rule }), JSON.stringify(rule)).toMatchObject({ ok: false, status: 400 });
    }
  });
  it('a court price needs a group and a price; peak and off peak are refused (A-4); one rule per group and day type', async () => {
    const g = (await call('POST', '/staff/setup/price-groups', owner(), {}, { nameTh: 'ก', nameEn: 'Adult', rule: { min_age: 18 } })).body.id;
    const r = await call('POST', '/staff/setup/court-prices', owner(), {}, { priceGroupId: g, priceSatang: 50000 });
    expect(r.body).toMatchObject({ priceGroupId: g, dayType: 'any', peak: 'any', priceSatang: 50000 });
    expect(await call('POST', '/staff/setup/court-prices', owner(), {}, { priceGroupId: g, priceSatang: 60000 })).toMatchObject({ ok: false, status: 409, code: 'duplicate' });
    expect(await call('POST', '/staff/setup/court-prices', owner(), {}, { priceGroupId: g, dayType: 'weekend', peak: 'peak', priceSatang: 1 })).toMatchObject({ ok: false, status: 400, code: 'peak_not_defined', params: { field: 'peak' } });
    expect(await call('POST', '/staff/setup/court-prices', owner(), {}, { priceGroupId: g, dayType: 'weekend', peak: 'off_peak', priceSatang: 1 })).toMatchObject({ ok: false, code: 'peak_not_defined' });
    expect(await call('POST', '/staff/setup/court-prices', owner(), {}, { priceGroupId: g, dayType: 'weekend', peak: 'sometimes', priceSatang: 1 })).toMatchObject({ ok: false, code: 'bad_input' });
    expect(await call('POST', '/staff/setup/court-prices', owner(), {}, { priceGroupId: g })).toMatchObject({ ok: false, status: 400, params: { field: 'priceSatang' } });
    expect(await call('POST', '/staff/setup/court-prices', owner(), {}, { priceGroupId: g, dayType: 'weekend', priceSatang: 12.5 })).toMatchObject({ ok: false, status: 400 });
    expect(await call('POST', '/staff/setup/court-prices', owner(), {}, { priceGroupId: '99999999-9999-4999-8999-999999999999', priceSatang: 1 })).toMatchObject({ ok: false, status: 409, code: 'in_use' });
    expect((await call('PUT', '/staff/setup/court-prices/:id', owner(), { id: r.body.id }, { priceSatang: 55000 })).body.priceSatang).toBe(55000);
  });
  it('a group a price still points at cannot be deleted (in_use); an unused one can', async () => {
    const g = (await call('POST', '/staff/setup/price-groups', owner(), {}, { nameTh: 'ก', nameEn: 'Adult', rule: { min_age: 18 } })).body.id;
    await call('POST', '/staff/setup/court-prices', owner(), {}, { priceGroupId: g, priceSatang: 50000 });
    expect(await call('DELETE', '/staff/setup/price-groups/:id', owner(), { id: g })).toMatchObject({ ok: false, status: 409, code: 'in_use' });
    const u = (await call('POST', '/staff/setup/price-groups', owner(), {}, { nameTh: 'ข', nameEn: 'Unused', rule: { max_age: 5 } })).body.id;
    expect(await call('DELETE', '/staff/setup/price-groups/:id', owner(), { id: u })).toMatchObject({ ok: true });
    expect(await call('DELETE', '/staff/setup/price-groups/:id', owner(), { id: u })).toMatchObject({ ok: false, status: 404 });
  });
});

describe('add-ons, coach tiers and their prices (A9)', () => {
  it('an add-on with no price is saved with null, not a default (ADMIN-10)', async () => {
    const a = (await call('POST', '/staff/setup/add-ons', owner(), {}, { nameTh: 'ลูกบอล', nameEn: 'Balls' })).body;
    expect(a).toMatchObject({ priceSatang: null, active: true, position: 0 });
    expect((await call('PUT', '/staff/setup/add-ons/:id', owner(), { id: a.id }, { priceSatang: 10000 })).body.priceSatang).toBe(10000);
    expect((await call('PUT', '/staff/setup/add-ons/:id', owner(), { id: a.id }, { priceSatang: null, active: false })).body).toMatchObject({ priceSatang: null, active: false });
    expect(await call('PUT', '/staff/setup/add-ons/:id', owner(), { id: a.id }, { priceSatang: -1 })).toMatchObject({ ok: false, status: 400 });
    expect(await call('PUT', '/staff/setup/add-ons/:id', owner(), { id: a.id }, {})).toMatchObject({ ok: false, status: 400 });
    expect(await call('PUT', '/staff/setup/add-ons/:id', owner(), { id: a.id }, { id: 'x' })).toMatchObject({ ok: false, status: 400 });
    expect(await call('PUT', '/staff/setup/add-ons/:id', owner(), { id: 'nope' }, { active: true })).toMatchObject({ ok: false, status: 404 });
  });
  it('a tier price is set, cleared with null and listed; unknown tier or group is in_use', async () => {
    const g = (await call('POST', '/staff/setup/price-groups', owner(), {}, { nameTh: 'ก', nameEn: 'Adult', rule: { min_age: 18 } })).body.id;
    const t = (await call('POST', '/staff/setup/coach-tiers', owner(), {}, { nameTh: 'โค้ช', nameEn: 'Head Coach' })).body.id;
    expect((await call('PUT', '/staff/setup/coach-tier-prices', owner(), {}, { tierId: t, priceGroupId: g, priceSatang: 80000 })).body).toEqual({ tierId: t, priceGroupId: g, priceSatang: 80000 });
    await call('PUT', '/staff/setup/coach-tier-prices', owner(), {}, { tierId: t, priceGroupId: g, priceSatang: null });
    expect((await call('GET', '/staff/setup/coach-tier-prices', desk())).body).toEqual([{ tierId: t, priceGroupId: g, priceSatang: null }]);
    expect(await call('PUT', '/staff/setup/coach-tier-prices', owner(), {}, { tierId: t, priceGroupId: g })).toMatchObject({ ok: false, status: 400 });
    expect(await call('PUT', '/staff/setup/coach-tier-prices', owner(), {}, { tierId: '99999999-9999-4999-8999-999999999999', priceGroupId: g, priceSatang: 1 })).toMatchObject({ ok: false, status: 409 });
    expect(await call('DELETE', '/staff/setup/coach-tiers/:id', owner(), { id: t })).toMatchObject({ ok: false, status: 409, code: 'in_use' });
    expect(await audits('coach_tier_price')).toBeGreaterThanOrEqual(2);
  });
});

describe('package products (A9, F06 PKG-02)', () => {
  it('a court pack needs no tier or group; a solo pack needs a tier and a group; a price left out is null', async () => {
    const g = (await call('POST', '/staff/setup/price-groups', owner(), {}, { nameTh: 'ก', nameEn: 'Adult', rule: { min_age: 18 } })).body.id;
    const t = (await call('POST', '/staff/setup/coach-tiers', owner(), {}, { nameTh: 'โค้ช', nameEn: 'Head Coach' })).body.id;
    const court = (await call('POST', '/staff/setup/package-products', owner(), {}, { nameTh: 'ชุด', nameEn: 'Ten hours', creditType: 'court_hour', credits: 10, validityMonths: 3 })).body;
    expect(court).toMatchObject({ creditType: 'court_hour', credits: 10, validityMonths: 3, priceSatang: null, priceGroupId: null, coachTierId: null, active: true });
    expect(await call('POST', '/staff/setup/package-products', owner(), {}, { nameTh: 'ก', nameEn: 'Solo', creditType: 'solo_class', credits: 5, validityMonths: 3, priceGroupId: g })).toMatchObject({ ok: false, status: 400 });
    expect(await call('POST', '/staff/setup/package-products', owner(), {}, { nameTh: 'ก', nameEn: 'Group', creditType: 'group_session', credits: 5, validityMonths: 3 })).toMatchObject({ ok: false, status: 400 });
    const solo = (await call('POST', '/staff/setup/package-products', owner(), {}, { nameTh: 'ก', nameEn: 'Solo', creditType: 'solo_class', credits: 5, validityMonths: 3, priceGroupId: g, coachTierId: t, priceSatang: 400000 })).body;
    expect(solo).toMatchObject({ coachTierId: t, priceSatang: 400000 });
    expect((await call('PUT', '/staff/setup/package-products/:id', owner(), { id: court.id }, { priceSatang: 90000 })).body.priceSatang).toBe(90000);
    expect((await call('GET', '/staff/setup/package-products', desk())).body).toHaveLength(2);
    for (const bad of [{ credits: 0 }, { validityMonths: 0 }, { creditType: 'x' }, { priceSatang: -1 }]) {
      expect(await call('POST', '/staff/setup/package-products', owner(), {}, { nameTh: 'ก', nameEn: 'X', creditType: 'court_hour', credits: 1, validityMonths: 1, ...bad }), JSON.stringify(bad)).toMatchObject({ ok: false, status: 400 });
    }
  });
  it('a product is switched off, never deleted: there is no delete route, and a sold product stays', async () => {
    const p = (await call('POST', '/staff/setup/package-products', owner(), {}, { nameTh: 'ชุด', nameEn: 'Ten', creditType: 'court_hour', credits: 10, validityMonths: 3, priceSatang: 90000 })).body.id;
    expect(routes.some((r) => r.def.method === 'DELETE' && r.def.path === '/staff/setup/package-products/:id')).toBe(false);
    expect((await call('PUT', '/staff/setup/package-products/:id', owner(), { id: p }, { active: false })).body.active).toBe(false);
  });
});

describe('partners and promo codes (A10)', () => {
  it('a partner is saved; its contact is kept out of the plain audit values', async () => {
    const p = (await call('POST', '/staff/setup/partners', owner(), {}, { name: 'Acme', type: 'company', contact: 'a@example.com' })).body;
    expect(p).toMatchObject({ name: 'Acme', contact: 'a@example.com' });
    expect((await tdb.query(`select new_value from public.audit_entry where record_type = 'partner' limit 1`)).rows[0].new_value).not.toHaveProperty('contact');
    expect((await call('GET', '/staff/setup/partners', as(ACC, ['accountant', 'player']))).body).toHaveLength(1);
  });
  it('a code: upper cased, defaults only where the table has them, the stacking choice is audited (PROMO-01-AC12)', async () => {
    const c = (await call('POST', '/staff/setup/promo-codes', owner(), {}, { code: ' spring10 ', kind: 'percent', value: 1000, appliesTo: ['court_hour'] })).body;
    expect(c).toMatchObject({ code: 'SPRING10', kind: 'percent', value: 1000, appliesTo: ['court_hour'], includesAddOns: false, audience: 'any', stackableWithBirthday: false, active: true, totalCap: null, startsOn: null });
    const u = (await call('PUT', '/staff/setup/promo-codes/:id', owner(), { id: c.id }, { stackableWithBirthday: true, startsOn: '2026-12-01', endsOn: '2026-12-31', totalCap: 50 })).body;
    expect(u).toMatchObject({ stackableWithBirthday: true, startsOn: '2026-12-01', endsOn: '2026-12-31', totalCap: 50 });
    expect((await tdb.query(`select new_value from public.audit_entry where record_type = 'promo_code' order by seq desc limit 1`)).rows[0].new_value).toMatchObject({ stackable_with_birthday: true });
  });
  it('a duplicate code, a bad value, scope, dates and an unknown partner are refused', async () => {
    const base = { code: 'A1', kind: 'percent', value: 500, appliesTo: ['coach'] };
    await call('POST', '/staff/setup/promo-codes', owner(), {}, base);
    expect(await call('POST', '/staff/setup/promo-codes', owner(), {}, { ...base, code: 'a1' })).toMatchObject({ ok: false, status: 409, code: 'duplicate' });
    for (const bad of [{ value: 10001 }, { kind: 'cash' }, { appliesTo: [] }, { appliesTo: ['nothing'] }, { code: 'bad code!' }, { startsOn: '2026-12-31', endsOn: '2026-12-01' }, { startsOn: 'x' }, { totalCap: 0 }, { audience: 'kids' }]) {
      expect(await call('POST', '/staff/setup/promo-codes', owner(), {}, { ...base, code: 'B' + Math.random().toString(36).slice(2, 6).toUpperCase(), ...bad }), JSON.stringify(bad)).toMatchObject({ ok: false, status: 400 });
    }
    expect(await call('POST', '/staff/setup/promo-codes', owner(), {}, { ...base, code: 'P1', partnerId: '99999999-9999-4999-8999-999999999999' })).toMatchObject({ ok: false, status: 409 });
  });
  it('a code a customer has used cannot be deleted (in_use) but can be switched off', async () => {
    const c = (await call('POST', '/staff/setup/promo-codes', owner(), {}, { code: 'USED', kind: 'fixed', value: 5000, appliesTo: ['court_hour'] })).body.id;
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, PLAYER])).rows[0].id;
    await tdb.query(`insert into public.promo_redemption (club_id, code_id, order_id, customer_id) values ($1,$2,$3,$4)`, [A, c, order, PLAYER]);
    expect(await call('DELETE', '/staff/setup/promo-codes/:id', owner(), { id: c })).toMatchObject({ ok: false, status: 409, code: 'in_use' });
    expect((await call('PUT', '/staff/setup/promo-codes/:id', owner(), { id: c }, { active: false })).body.active).toBe(false);
  });
});
