// F04-T22c / 0417 app.price_offer_order called directly (the route tests reach it only through checkout, which refuses first). QA, 31 Oct.
// Setup follows the lane's waitlist-functions test.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createDb, type Db } from '../../packages/db/src/tx';
import { createTestDatabase, type TestDatabase } from '../../packages/db/src/testing/harness';

const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const OWNER = '44444444-4444-4444-8444-444444444444';
const P = Array.from({ length: 4 }, (_, i) => `00000000-0000-4000-8000-0000000003${String(i).padStart(2, '0')}`);
let tdb: TestDatabase;
let db: Db;
let session: string;

async function person(id: string, roles: string[]) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, date_of_birth) values ($1,$2,$3,'1990-01-01')`, [A, id, 'L' + id]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [A, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
async function seat(customer: string) {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id;
  const s = (await tdb.query(`select start_at, end_at, resource_id from public.class_session where id = $1`, [session])).rows[0];
  return (await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, class_session_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
     values ($1,$2,'class_seat',$3,$4,$5,$6,$7,'confirmed','online',$7, app.now()) returning id`,
    [A, order, s.resource_id, session, s.start_at, s.end_at, customer])).rows[0].id as string;
}
async function internal(sql: string, params: unknown[] = []) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.club_id', $1, true)`, [A]);
    await c.query('set local role booq_owner');
    const r = await c.query(sql, params);
    await c.query('commit');
    return r.rows[0];
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const ctx = (user: string, roles: string[] = ['player']) => ({ clubId: A, userId: user, roles: roles as never, source: 'player_app' as const });
const _unused = async (user: string) => (await tdb.query(`select e.offer_expires_at, b.hold_expires_at from public.waitlist_entry e left join public.booking b on b.id = e.offer_booking_id where e.customer_id = $1 and e.class_session_id = $2`, [user, session])).rows[0];
const iso = (v: Date) => new Date(v).toISOString();

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-11-30T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, C1, LOC]);
  await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) select $1, d, '06:00', '24:00' from generate_series(1, 7) d`, [A]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15'), ($1,'waitlist_claim_minutes','30'), ($1,'waitlist_no_offer_hours','2')`, [A]);
  await person(OWNER, ['owner', 'player']);
  for (const p of P) await person(p, ['player']);
  await tdb.seedCoach(A, COACH);
  const tpl = (await tdb.query(`insert into public.class_template (club_id, name_th, name_en, audience, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by) values ($1,'ก','Group','adult',$2,$3,3,'18:00',1,2,$4) returning id`, [A, COACH, C1, OWNER])).rows[0].id;
  db = createDb({ connectionString: tdb.url, max: 4 });
  await db.withClubTx(ctx(OWNER, ['owner', 'player']), async (tx) => tx.query(`select app.generate_sessions('2026-11-30'::date, '2026-12-31'::date)`));
  session = (await tdb.query(`select id from public.class_session where template_id = $1 order by start_at limit 1`, [tpl])).rows[0].id;
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

const PRICED = {
  price_group_snapshot: { group: 'adult' }, subtotal_satang: 40000, discount_satang: 0, total_satang: 40000,
  credit_value_satang: 0, wallet_satang: 0, money_satang: 40000, promo_code_id: '', birthday_entitlement: false, quote_hash: 'a'.repeat(64),
};
/** P2 holds an offer for the freed seat; returns the order of the held booking. */
async function offerFor(): Promise<{ order: string; booking: string }> {
  const b0 = await seat(P[0]!);
  await seat(P[1]!);
  await db.withClubTx(ctx(P[2]!), async (tx) => tx.query(`select app.join_waitlist($1, null, null)`, [session]));
  await tdb.query(`update public.booking set status = 'cancelled' where id = $1`, [b0]);
  await internal(`select app.waitlist_advance($1, null, null)`, [session]);
  const r = (await tdb.query(`select b.id, b.order_id from public.waitlist_entry w join public.booking b on b.id = w.offer_booking_id where w.customer_id = $1`, [P[2]])).rows[0];
  return { order: r.order_id as string, booking: r.id as string };
}
const price = (user: string, order: string) =>
  db.withClubTx(ctx(user), async (tx) => (await tx.query(`select app.price_offer_order($1, $2::jsonb) as r`, [order, JSON.stringify(PRICED)])).rows[0]!.r as boolean);
const priced = async (order: string) => (await tdb.query(`select total_satang, priced_at is not null as p from public.orders where id = $1`, [order])).rows[0];

it('F04/R4-AC9 F08/CLASS-02-AC3 the player of the offer prices the shell once; a second call returns false and changes nothing', async () => {
  const o = await offerFor();
  // The sum check on the order is deferred to commit and Pay writes the lines in the same transaction, so this one is read inside and rolled back.
  const seen: unknown[] = [];
  await expect(
    db.withClubTx(ctx(P[2]!), async (tx) => {
      const call = async () => (await tx.query(`select app.price_offer_order($1, $2::jsonb) as r`, [o.order, JSON.stringify(PRICED)])).rows[0]!.r;
      seen.push(await call());
      const first = (await tx.query(`select total_satang, priced_at from public.orders where id = $1`, [o.order])).rows[0]!;
      seen.push(first.total_satang);
      seen.push(await call());
      seen.push((await tx.query(`select priced_at from public.orders where id = $1`, [o.order])).rows[0]!.priced_at.getTime() === first.priced_at.getTime());
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  expect(seen).toEqual([true, 40000, false, true]);
});

it('F08/CLASS-02-AC6 an offer whose hold has ended is not priced, whatever the caller asks', async () => {
  const o = await offerFor();
  await tdb.setNow('2026-11-30T03:31:00Z');   // the offer ended at 03:30
  await expect(price(P[2]!, o.order)).rejects.toThrow(/offer:gone/);
  expect(await priced(o.order)).toEqual({ total_satang: null, p: false });
});

it('F08/CLASS-02-AC14 another player cannot price the offer of the first in line', async () => {
  const o = await offerFor();
  await expect(price(P[3]!, o.order)).rejects.toThrow(/offer:gone/);
  expect(await priced(o.order)).toEqual({ total_satang: null, p: false });
});
