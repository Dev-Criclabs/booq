import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { SETUP_TEXT_KEYS } from '@booq/domain';
import { IDS, seedHunter } from '../../../../../packages/domain/src/checkout/test-fixture';
import f04 from '../../../../../locales/pending/f04.json';
import { pricingRoutes } from './routes';

// F04-T14: the owner setup routes (design 5.3; R3-AC8, PROMO-01-AC12). Owner only for writes; every write audited with
// old and new values; changes apply to new orders only; a price a held or paid order used is never deleted.
const { A, ADULT, STUDENT, TIER, WATER, ME } = IDS;
const OWNER = '77777777-7777-4777-8777-777777777777';
const DESK = '88888888-8888-4888-8888-888888888888';
const ACC = '99999999-9999-4999-8999-999999999999';
const deps = { hasFeature: async () => true };
type Roles = string[];
const as = (userId: string, roles: Roles) => ({ clubId: A, userId, roles });
const owner = as(OWNER, ['owner', 'player']);
const desk = as(DESK, ['front_desk', 'player']);

let tdb: TestDatabase;
let db: Db;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await seedHunter(tdb);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    for (const [u, role, line] of [[OWNER, 'owner', 'LO'], [DESK, 'front_desk', 'LD'], [ACC, 'accountant', 'LA']] as const) {
      await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)`, [A, u, line]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3), ($1,$2,'player')`, [A, u, role]);
    }
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

const routes = () => pricingRoutes({ db });
const call = (method: string, path: string, session: ReturnType<typeof as> | null, body?: unknown, input: Record<string, unknown> = {}) =>
  routes().find((r) => r.def.method === method && r.def.path === path)!.handle({ session: session as never, input: { ...input }, body }, deps);
const ok = <T = Record<string, unknown>>(r: { ok: boolean; body?: unknown; code?: string }) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
  return r.body as T;
};
const audits = async (recordId: string) =>
  (await tdb.query(`select action, old_value, new_value, actor_user_id, source from public.audit_entry where record_id = $1 order by seq`, [recordId])).rows;

describe('the setup routes', () => {
  it('reads need price.read, writes price.write; no delete route exists; every answer is no-store', () => {
    const r = routes();
    const paths = ['price-groups', 'court-prices', 'coach-tier-prices', 'add-ons', 'partners', 'promo-codes'];
    for (const p of paths) {
      expect(r.find((x) => x.def.method === 'GET' && x.def.path === `/setup/${p}`)!.def.permission).toBe('price.read');
      expect(r.find((x) => x.def.method === 'POST' && x.def.path === `/setup/${p}`)!.def.permission).toBe('price.write');
    }
    expect(r.filter((x) => x.def.method === 'PUT').every((x) => x.def.permission === 'price.write')).toBe(true);
    expect(r.some((x) => x.def.method === 'DELETE')).toBe(false);
    expect(r.every((x) => x.headers?.['Cache-Control'] === 'no-store')).toBe(true);
  });

  it('front desk and the accountant read; only the owner writes (R3-AC8)', async () => {
    expect(ok<unknown[]>(await call('GET', '/setup/add-ons', desk))).toHaveLength(1);
    expect(await call('GET', '/setup/promo-codes', as(ACC, ['accountant', 'player']))).toMatchObject({ ok: true });
    for (const s of [desk, as(ACC, ['accountant', 'player']), as(ME, ['player'])]) {
      expect(await call('POST', '/setup/add-ons', s, { nameTh: 'ผ้าเย็น', nameEn: 'Towel', priceSatang: 3000 })).toMatchObject({ ok: false, status: 403 });
    }
    expect(await call('GET', '/setup/add-ons', as(ME, ['player']))).toMatchObject({ ok: false, status: 403 });
  });

  it('an add-on: created, changed, retired; each write audited with the old and new values by the owner', async () => {
    const a = ok<{ id: string }>(await call('POST', '/setup/add-ons', owner, { nameTh: 'ผ้าเย็น', nameEn: 'Towel', priceSatang: 3000, priceSatangExtra: 1 }));
    expect(a).toMatchObject({ nameEn: 'Towel', priceSatang: 3000, active: true });
    expect(ok(await call('PUT', '/setup/add-ons/:id', owner, { priceSatang: 3500 }, { id: a.id }))).toMatchObject({ priceSatang: 3500, nameEn: 'Towel' });
    expect(ok(await call('PUT', '/setup/add-ons/:id', owner, { active: false }, { id: a.id }))).toMatchObject({ active: false });
    const log = await audits(a.id);
    expect(log).toHaveLength(3);
    expect(log.every((e) => e.actor_user_id === OWNER && e.source === 'admin')).toBe(true);
    expect(log[1]).toMatchObject({ old_value: { price_satang: 3000 }, new_value: { price_satang: 3500 } });
    expect(log[2]).toMatchObject({ old_value: { active: true }, new_value: { active: false } });
  });

  it('a null add-on price means not for sale; a negative, a fraction or a missing price is bad input', async () => {
    expect(ok(await call('POST', '/setup/add-ons', owner, { nameTh: 'ก', nameEn: 'A', priceSatang: null }))).toMatchObject({ priceSatang: null });
    for (const priceSatang of [-1, 10.5, '100']) {
      expect(await call('POST', '/setup/add-ons', owner, { nameTh: 'ก', nameEn: 'A', priceSatang })).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
    }
    expect(await call('POST', '/setup/add-ons', owner, { nameTh: 'ก', nameEn: 'A' })).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
  });

  it('a change applies to new orders only: a held order keeps its copied price and name (R7-AC2)', async () => {
    const o = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, ME])).rows[0].id;
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local session_replication_role = replica');
      const b = (await c.query(`insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, hold_expires_at)
                     values ($1,$2,'court',$3, date_trunc('hour', now()) + interval '30 hours', date_trunc('hour', now()) + interval '31 hours', $4, 'awaiting_payment', 'online', $4, now() + interval '10 minutes') returning id`,
                     [A, o, IDS.COURT, ME])).rows[0].id;
      await c.query(`insert into public.order_line (club_id, order_id, position, kind, booking_id, add_on_id, description_key, name_th, name_en, unit_price_satang, net_satang, money_satang)
                     values ($1,$2,1,'add_on',$4,$3,'P-0071','น้ำ','Water',2000,2000,2000)`, [A, o, WATER, b]);
      await c.query('commit');
    } finally {
      c.release();
    }
    ok(await call('PUT', '/setup/add-ons/:id', owner, { priceSatang: 9900, nameEn: 'Sparkling water' }, { id: WATER }));
    expect((await tdb.query(`select unit_price_satang, name_en from public.order_line where order_id = $1`, [o])).rows[0]).toEqual({ unit_price_satang: 2000, name_en: 'Water' });
    // And the row an order used cannot be removed, by the route (none exists) or below it.
    await expect(tdb.query(`delete from public.add_on where id = $1`, [WATER])).rejects.toThrow(/foreign key/);
  });

  it('price groups: a rule needs an age bound, min not above max; a change is audited', async () => {
    const g = ok<{ id: string }>(await call('POST', '/setup/price-groups', owner, { nameTh: 'อาวุโส', nameEn: 'Senior', minAge: 60, position: 3 }));
    expect(g).toMatchObject({ nameEn: 'Senior', minAge: 60, maxAge: null, position: 3 });
    expect(g).not.toHaveProperty('rule');
    expect(await call('POST', '/setup/price-groups', owner, { nameTh: 'x', nameEn: 'X' })).toMatchObject({ status: 400, code: 'bad_input' });
    expect(await call('POST', '/setup/price-groups', owner, { nameTh: 'x', nameEn: 'X', minAge: 20, maxAge: 10 })).toMatchObject({ status: 400, code: 'bad_input' });
    expect(ok(await call('PUT', '/setup/price-groups/:id', owner, { maxAge: 99 }, { id: g.id }))).toMatchObject({ minAge: 60, maxAge: 99 });
    expect(await audits(g.id)).toHaveLength(2);
  });

  it('court prices: one rule per group and key; peak is refused until it is defined (A-4)', async () => {
    const r = ok<{ id: string }>(await call('POST', '/setup/court-prices', owner, { priceGroupId: ADULT, dayType: 'weekend', priceSatang: 60000 }));
    expect(r).toMatchObject({ priceGroupId: ADULT, dayType: 'weekend', peak: 'any', priceSatang: 60000 });
    expect(await call('POST', '/setup/court-prices', owner, { priceGroupId: ADULT, dayType: 'weekend', priceSatang: 1 })).toMatchObject({ status: 409, code: 'duplicate' });
    expect(await call('POST', '/setup/court-prices', owner, { priceGroupId: ADULT, peak: 'peak', priceSatang: 1 })).toMatchObject({ status: 400, code: 'peak_not_defined' });
    expect(await call('POST', '/setup/court-prices', owner, { priceGroupId: '00000000-0000-4000-8000-00000000dead', priceSatang: 1 })).toMatchObject({ status: 400, code: 'bad_input' });
    expect(ok(await call('PUT', '/setup/court-prices/:id', owner, { priceSatang: 65000 }, { id: r.id }))).toMatchObject({ priceSatang: 65000 });
  });

  it('coach tier prices: set by tier and group, null is not set (R2-AC3)', async () => {
    expect(ok(await call('PUT', '/setup/coach-tier-prices', owner, { tierId: TIER, priceGroupId: ADULT, priceSatang: null }))).toEqual({ tierId: TIER, priceGroupId: ADULT, priceSatang: null });
    expect(ok(await call('POST', '/setup/coach-tier-prices', owner, { tierId: TIER, priceGroupId: STUDENT, priceSatang: 75000 }))).toMatchObject({ priceSatang: 75000 });
    expect(ok<unknown[]>(await call('GET', '/setup/coach-tier-prices', desk))).toEqual(expect.arrayContaining([{ tierId: TIER, priceGroupId: ADULT, priceSatang: null }]));
    expect(await call('PUT', '/setup/coach-tier-prices', owner, { tierId: TIER, priceGroupId: ADULT })).toMatchObject({ status: 400 });
  });

  it('partners and promo codes: the code is matched in capitals, unique per club; bad values refused (PROMO-01-AC12)', async () => {
    const p = ok<{ id: string }>(await call('POST', '/setup/partners', owner, { name: 'Racket shop', type: 'shop', contact: null }));
    const code = ok<{ id: string }>(await call('POST', '/setup/promo-codes', owner, { code: 'shop10', kind: 'percent', value: 1000, appliesTo: ['court_hour'], partnerId: p.id }));
    expect(code).toMatchObject({ code: 'SHOP10', kind: 'percent', value: 1000, appliesTo: ['court_hour'], audience: 'any', active: true, partnerId: p.id });
    expect(await call('POST', '/setup/promo-codes', owner, { code: 'SHOP10', kind: 'fixed', value: 100, appliesTo: ['add_on'] })).toMatchObject({ status: 409, code: 'duplicate' });
    expect(await call('POST', '/setup/promo-codes', owner, { code: 'BIG', kind: 'percent', value: 10001, appliesTo: ['court_hour'] })).toMatchObject({ status: 400 });
    expect(await call('POST', '/setup/promo-codes', owner, { code: 'BAD', kind: 'fixed', value: 100, appliesTo: ['nothing'] })).toMatchObject({ status: 400 });
    expect(await call('POST', '/setup/promo-codes', owner, { code: 'D', kind: 'fixed', value: 100, appliesTo: ['add_on'], startsOn: '2026-12-10', endsOn: '2026-12-01' })).toMatchObject({ status: 400 });
    expect(ok(await call('PUT', '/setup/promo-codes/:id', owner, { active: false, endsOn: '2026-12-31' }, { id: code.id }))).toMatchObject({ active: false, endsOn: '2026-12-31' });
    const log = await audits(code.id);
    expect(log[1]).toMatchObject({ old_value: { active: true, ends_on: null }, new_value: { active: false, ends_on: '2026-12-31' } });
  });

  it('an unknown id or one of no row is not found; an empty change is bad input', async () => {
    expect(await call('PUT', '/setup/add-ons/:id', owner, { active: false }, { id: '00000000-0000-4000-8000-00000000dead' })).toMatchObject({ status: 404, code: 'not_found' });
    expect(await call('PUT', '/setup/add-ons/:id', owner, { active: false }, { id: 'nope' })).toMatchObject({ status: 404, code: 'not_found' });
    expect(await call('PUT', '/setup/add-ons/:id', owner, {}, { id: WATER })).toMatchObject({ status: 400, code: 'bad_input' });
  });

  it('every refusal maps to a pending text in both languages', () => {
    const files = f04 as { en: Record<string, string>; th: Record<string, string> };
    for (const key of Object.values(SETUP_TEXT_KEYS)) {
      expect(files.en[key]).toBeTypeOf('string');
      expect(files.th[key]).toBeTypeOf('string');
    }
  });
});
