import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F04-T11 request from BE-C / migration 0315: app.quote_promo_code and app.birthday_discount (R5, PROMO-01).
// Read only, no lock; the quote engine decides scope, audience, minimum spend and value from what these return.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
let tdb: TestDatabase;
let web: Db;

const ctx = (user: string | null, roles: string[], club = A) => ({ clubId: club, userId: user, roles: roles as never, source: 'player_app' as const });
const quote = (code: string, c = ctx(PLAYER, ['player']), customer: string | null = null) =>
  web.withClubTx(c, async (tx) => (await tx.query(`select app.quote_promo_code($1, $2) as q`, [code, customer])).rows[0]?.q as Record<string, unknown> | null);

async function user(club: string, id: string, roles: string[]) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [club, id, 'L' + id.slice(0, 4) + club.slice(0, 2)]);
    for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
const order = async (customer: string) => (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id as string;
const code = async (text: string, extra: Record<string, unknown> = {}, club = A) => {
  const cols = { kind: 'percent', value: 1000, applies_to: '{court_hour,coach}', ...extra };
  const keys = Object.keys(cols);
  return (await tdb.query(`insert into public.promo_code (club_id, code_upper, ${keys.join(',')}) values ($1,$2,${keys.map((_, i) => '$' + (i + 3)).join(',')}) returning id`, [club, text, ...Object.values(cols)])).rows[0].id as string;
};

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await user(A, PLAYER, ['player']);
  await user(A, OTHER, ['player']);
  await user(A, DESK, ['front_desk', 'player']);
  web = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});

describe('app.quote_promo_code', () => {
  it('returns the code’s terms and the counts, matching the code without case or spaces', async () => {
    const id = await code('SAVE10', { includes_add_ons: true, audience: 'adult', first_time_only: true, total_cap: 50, per_customer_cap: 2, min_spend_satang: 100000, starts_on: '2026-12-01', ends_on: '2026-12-31' });
    const r = await quote('  save10 ');
    expect(r).toEqual({
      id, kind: 'percent', value: 1000, applies_to: ['court_hour', 'coach'], includes_add_ons: true, audience: 'adult', starts_on: '2026-12-01', ends_on: '2026-12-31',
      first_time_only: true, total_cap: 50, per_customer_cap: 2, min_spend_satang: 100000, stackable_with_birthday: false, partner_id: null, active: true,
      uses_counted: 0, customer_uses_counted: 0, customer_has_paid_booking: false,
    });
  });

  it('nothing for an unknown code and for another club’s code: the two look the same', async () => {
    await code('THEIRS', {}, B);
    expect(await quote('NOPE')).toBeNull();
    expect(await quote('THEIRS')).toBeNull();
    expect(await quote('')).toBeNull();
  });

  it('an inactive code is returned with active false', async () => {
    await code('OLD', { active: false });
    expect(await quote('OLD')).toMatchObject({ active: false });
  });

  it('counts only counted uses, in total and for the customer; a restored use does not count', async () => {
    const id = await code('SAVE10');
    for (const [who, status] of [[PLAYER, 'counted'], [PLAYER, 'restored'], [OTHER, 'counted']] as const) {
      await tdb.query(`insert into public.promo_redemption (club_id, code_id, order_id, customer_id, status, restored_at, restore_reason) values ($1,$2,$3,$4,$5, case when $5 = 'restored' then now() end, case when $5 = 'restored' then 'expired' end)`, [A, id, await order(who), who, status]);
    }
    expect(await quote('SAVE10')).toMatchObject({ uses_counted: 2, customer_uses_counted: 1 });
    expect(await quote('SAVE10', ctx(OTHER, ['player']))).toMatchObject({ uses_counted: 2, customer_uses_counted: 1 });
  });

  it('says whether the customer has a paid booking (for a first booking code)', async () => {
    await code('FIRST', { first_time_only: true });
    await tdb.query(`insert into public.location (club_id, id, name) values ($1,'00000000-0000-4000-8000-0000000000a1','M')`, [A]);
    await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,'00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000a1','1','tennis')`, [A]);
    expect(await quote('FIRST')).toMatchObject({ customer_has_paid_booking: false });
    await tdb.query(`insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
                     values ($1,$2,'court','00000000-0000-4000-8000-0000000000c1', date_trunc('hour', now()) + interval '40 hours', date_trunc('hour', now()) + interval '41 hours', $3,'confirmed','online',$3, now())`, [A, await order(PLAYER), PLAYER]);
    expect(await quote('FIRST')).toMatchObject({ customer_has_paid_booking: true });
    expect(await quote('FIRST', ctx(OTHER, ['player']))).toMatchObject({ customer_has_paid_booking: false });
  });

  it('a guest gets the terms with zero customer counts', async () => {
    await code('SAVE10');
    expect(await quote('SAVE10', ctx(null, ['guest']))).toMatchObject({ customer_uses_counted: 0, customer_has_paid_booking: false });
  });

  it('p_customer is for owner and front desk only', async () => {
    const id = await code('SAVE10');
    await tdb.query(`insert into public.promo_redemption (club_id, code_id, order_id, customer_id) values ($1,$2,$3,$4)`, [A, id, await order(OTHER), OTHER]);
    expect(await quote('SAVE10', ctx(DESK, ['front_desk', 'player']), OTHER)).toMatchObject({ customer_uses_counted: 1 });
    await expect(quote('SAVE10', ctx(PLAYER, ['player']), OTHER)).rejects.toThrow(/not allowed/);
    await expect(quote('SAVE10', ctx(null, ['guest']), OTHER)).rejects.toThrow(/not allowed/);
    expect(await quote('SAVE10', ctx(PLAYER, ['player']), PLAYER)).toMatchObject({ customer_uses_counted: 0 });
  });

  it('is callable by booq_app only and needs a club in the context', async () => {
    for (const role of ['booq_worker', 'booq_platform']) {
      expect((await tdb.query(`select has_function_privilege($1, 'app.quote_promo_code(text, uuid)', 'execute') as ok`, [role])).rows[0].ok, role).toBe(false);
    }
  });
});

describe('app.birthday_discount', () => {
  const read = (c = ctx(PLAYER, ['player'])) => web.withClubTx(c, async (tx) => (await tx.query(`select app.birthday_discount() as d`)).rows[0]?.d);

  it('is null until the club sets it', async () => {
    expect(await read()).toBeNull();
  });

  it('returns {kind, value} once set, to a player and a guest, for the club in context only', async () => {
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1, 'birthday_discount', '{"kind": "percent", "value": 1000}')`, [A]);
    expect(await read()).toEqual({ kind: 'percent', value: 1000 });
    expect(await read(ctx(null, ['guest']))).toEqual({ kind: 'percent', value: 1000 });
    expect(await read(ctx(PLAYER, ['player'], B))).toBeNull();
  });

  it('only booq_app may call it', async () => {
    for (const role of ['booq_worker', 'booq_platform']) {
      expect((await tdb.query(`select has_function_privilege($1, 'app.birthday_discount()', 'execute') as ok`, [role])).rows[0].ok, role).toBe(false);
    }
  });
});
