import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createDb, type Db } from '../../packages/db/src/tx';
import { createTestDatabase, type TestDatabase } from '../../packages/db/src/testing/harness';

// QA, 31 Oct: the cancel record that migration 1013 writes per paid seat. Setup follows the lane's packages/db/src/class-cancel-value.test.ts.
// (lane note) F08-T14: cancelling a session returns the value of every seat through F09's return_booking_value (the real function, 1005) and
// ends the waitlist (CLASS-01-AC13, CLASS-02-AC11). Credit goes back to its package, wallet use back to the wallet, money into the
// wallet as a refund; nothing goes back as cash and no payment row changes (CANCEL-02).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const OWNER = '44444444-4444-4444-8444-444444444444';
const DESK = '33333333-3333-4333-8333-333333333333';
const P1 = '11111111-1111-4111-8111-111111111111';   // seat paid by a group credit
const P2 = '22222222-2222-4222-8222-222222222222';   // seat paid by wallet and money
const P3 = '55555555-5555-4555-8555-555555555555';   // waiting
let tdb: TestDatabase;
let db: Db;
let session: string;

async function asDefiner(sql: string, args: unknown[] = []): Promise<unknown> {
  const c: pg.PoolClient = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role booq_owner');
    await c.query(`select set_config('app.club_id', $1, true), set_config('app.user_id', $2, true), set_config('app.roles', 'owner', true), set_config('app.source', 'admin', true), set_config('app.request_id', 'r', true)`, [A, OWNER]);
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
const cancel = (c = { clubId: A, userId: DESK, roles: ['front_desk', 'player'] as never, source: 'admin' as const }) =>
  db.withClubTx(c, async (tx) => (await tx.query(`select app.cancel_session($1, 'owner') as r`, [session])).rows[0]!.r as { seats: number; entries: number; repeated?: boolean });
const wallet = async (customer: string) => Number((await tdb.query(`select coalesce(sum(change_satang), 0) n from public.wallet_ledger where customer_id = $1`, [customer])).rows[0].n);
const ledger = async (reason: string) => (await tdb.query(`select customer_id, change_satang from public.wallet_ledger where reason = $1 order by customer_id, change_satang`, [reason])).rows;

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
/** A confirmed seat with one class_seat line paid as given; the credit is reserved and the wallet spent through F06's functions. */
async function paidSeat(customer: string, parts: { credit?: string; wallet?: number; money?: number }) {
  const net = (parts.credit ? 40000 : 0) + (parts.wallet ?? 0) + (parts.money ?? 0);
  const c = await tdb.pool.connect();
  let o: string, b: string, line: string;
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    o = (await c.query(`insert into public.orders (club_id, customer_id, source, status) values ($1,$2,'online','paid') returning id`, [A, customer])).rows[0].id;
    const s = (await c.query(`select start_at, end_at, resource_id from public.class_session where id = $1`, [session])).rows[0];
    b = (await c.query(`insert into public.booking (club_id, order_id, type, resource_id, class_session_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
                        values ($1,$2,'class_seat',$3,$4,$5,$6,$7,'confirmed','online',$7,now()) returning id`, [A, o, s.resource_id, session, s.start_at, s.end_at, customer])).rows[0].id;
    line = (await c.query(
      `insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, net_satang, credit_package_id, credit_units, credit_value_satang, wallet_satang, money_satang)
       values ($1,$2,1,'class_seat',$3,'k','ก','x',$4,$4,$5,$6,$7,$8,$9) returning id`,
      [A, o, b, net, parts.credit ?? null, parts.credit ? 1 : 0, parts.credit ? 40000 : 0, parts.wallet ?? 0, parts.money ?? 0])).rows[0].id;
    await c.query('commit');
  } finally {
    c.release();
  }
  if (parts.credit) await asDefiner('select app.credit_reserve($1, $2, $3)', [parts.credit, b, line]);
  if (parts.wallet) await asDefiner('select app.wallet_spend($1, $2, $3, $4)', [customer, parts.wallet, o, line]);
  return { order: o, booking: b, line };
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-11-30T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, C1, LOC]);
  await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) select $1, d, '06:00', '24:00' from generate_series(1, 7) d`, [A]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','14'), ($1,'hold_minutes','15')`, [A]);
  await person(OWNER, ['owner', 'player']);
  await person(DESK, ['front_desk', 'player']);
  for (const p of [P1, P2, P3]) await person(p, ['player']);
  await tdb.seedCoach(A, COACH);
  const tpl = (await tdb.query(`insert into public.class_template (club_id, name_th, name_en, audience, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by) values ($1,'ก','G','adult',$2,$3,3,'18:00',2,3,$4) returning id`, [A, COACH, C1, OWNER])).rows[0].id;
  db = createDb({ connectionString: tdb.url, max: 4 });
  await db.withClubTx({ clubId: A, userId: OWNER, roles: ['owner'] as never, source: 'admin' }, (tx) => tx.query(`select app.generate_sessions('2026-11-30'::date, '2026-12-31'::date)`));
  session = (await tdb.query(`select id from public.class_session where template_id = $1 order by start_at limit 1`, [tpl])).rows[0].id;
  await asDefiner(`select app.wallet_credit($1, 100000, 'refund', 'seed')`, [P2]);
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

async function pack() {
  const product = (await tdb.query(`insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_group_id, price_satang) values ($1,'แพ็ก','8 pack','group_session',8,6,(select id from public.price_group limit 1),100000) returning id`, [A]).catch(async () => {
    const g = (await tdb.query(`insert into public.price_group (club_id, name_th, name_en, rule) values ($1,'ผู้ใหญ่','Adult','{"min_age": 18}') returning id`, [A])).rows[0].id;
    return tdb.query(`insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_group_id, price_satang) values ($1,'แพ็ก','8 pack','group_session',8,6,$2,100000) returning id`, [A, g]);
  })).rows[0].id;
  return (await tdb.query(`insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, expires_at) values ($1,$2,$3,'{"credit_type":"group_session"}',8,'2026-11-01T00:00:00Z','2027-05-01T00:00:00Z') returning id`, [A, P1, product])).rows[0].id as string;
}
const creditLeft = async (pkg: string) =>
  Number((await tdb.query(`select p.credits_total + coalesce((select sum(l.change) from public.credit_ledger l where l.package_id = p.id), 0) as n from public.customer_package p where p.id = $1`, [pkg])).rows[0].n);

describe('1013 cancel_session writes one cancel record per paid seat', () => {
  it('F09/CANCEL-01-AC22 the record names the kind, the reason and what came back, so the cancel sheet can show it', async () => {
    const pkg = await pack();
    await paidSeat(P1, { credit: pkg });
    await paidSeat(P2, { wallet: 20000, money: 30000 });
    await cancel();
    const rows = (await tdb.query(`select b.customer_id, c.kind, c.outcome, c.version, c.reason, c.returned from public.booking_cancel c join public.booking b on b.id = c.booking_id where b.class_session_id = $1 order by b.customer_id`, [session])).rows;
    expect(rows.map((r) => [r.customer_id, r.kind, r.outcome, r.version])).toEqual([[P1, 'club_cancel', 'returned', 1], [P2, 'club_cancel', 'returned', 1]]);
    expect(rows.every((r) => typeof r.reason === 'string' && r.reason.length > 0)).toBe(true);
    expect(rows[1]!.returned).toMatchObject({ moneyToWalletSatang: 30000 });   // what the owner's cancel sheet shows for the paid seat
    expect(JSON.stringify(rows[0]!.returned)).not.toBe('null');
  });
});
