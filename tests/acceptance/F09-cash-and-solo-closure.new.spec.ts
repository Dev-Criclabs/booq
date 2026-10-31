import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db, type ClubContext } from '../../packages/db/src/tx';
import { createTestDatabase, type TestDatabase } from '../../packages/db/src/testing/harness';

// CANCEL-02-AC5 and CANCEL-03-AC7 at the database (QA, F09 re-sweep). Setup follows the lane's packages/db/src/cancel-booking.test.ts.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURT1 = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT2 = 'c2c2c2c2-0000-4000-8000-000000000002';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const NOW = '2026-12-01T03:00:00Z';   // 1 Dec 10:00 Bangkok
const H = (h: number) => new Date(Date.parse('2026-12-03T00:00:00+07:00') + h * 3_600_000).toISOString();   // 3 Dec, two days ahead

let tdb: TestDatabase;
let db: Db;
let db2: Db;
const player = (u = P1): ClubContext => ({ clubId: A, userId: u, roles: ['player'], requestId: 'r', source: 'player_app' });
const desk = (reason?: string): ClubContext => ({ clubId: A, userId: DESK, roles: ['front_desk', 'player'], requestId: 'r', source: 'admin', ...(reason ? { reason } : {}) });

/** A confirmed booking through the real claim and confirm, with one line paid by money. */
async function book(starts: number[], o: { coach?: string; customer?: string; court?: string } = {}) {
  const customer = o.customer ?? P1;
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id as string;
  const r = await db.withClubTx(player(customer), async (tx) =>
    (await tx.query(`select app.reserve_court($1, $2, $3::timestamptz[], $4) as r`, [order, o.court ?? COURT1, starts.map(H), o.coach ?? null])).rows[0]!.r);
  await db.withClubTx(desk(), (tx) => tx.query(`select app.confirm_booking($1)`, [order]));
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    for (const [i, b] of (r.booking_ids as string[]).entries()) {
      await c.query(
        `insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, net_satang, money_satang)
         values ($1,$2,$3,'court_hour',$4,'k','ก','x',40000,40000,40000)`, [A, order, i + 1, b]);
    }
    await c.query(`update public.orders set status = 'paid' where id = $1`, [order]);
    await c.query('commit');
  } finally {
    c.release();
  }
  return { order, ids: r.booking_ids as string[] };
}
const cancel = (c: ClubContext, booking: string, o: { byStaff?: boolean; club?: boolean; reason?: string | null; via?: Db } = {}) =>
  (o.via ?? db).withClubTx(c, async (tx) =>
    (await tx.query(`select app.cancel_booking($1, $2, $3, $4) as r`, [booking, o.byStaff ?? false, o.club ?? false, o.reason ?? null])).rows[0]!.r as Record<string, any>);
const row = async (id: string) => (await tdb.query(`select status from public.booking where id = $1`, [id])).rows[0].status as string;
const occupancy = async (id: string) => (await tdb.query(`select resource_id, coach_id from public.occupancy where booking_id = $1`, [id])).rows;
const cancels = async (id: string) => (await tdb.query(`select kind, outcome, version, reason, by_user, credit_lost, returned from public.booking_cancel where booking_id = $1 order by version`, [id])).rows;
const refunds = async () => (await tdb.query(`select change_satang, dedupe_key from public.wallet_ledger where reason = 'refund' order by dedupe_key`)).rows;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow(NOW);
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live')`, [A]);
  for (const [u, roles] of [[P1, ['player']], [P2, ['player']], [DESK, ['front_desk', 'player']]] as const) {
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
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($1,$4,$3,'2','tennis')`, [A, COURT1, LOC, COURT2]);
  for (let d = 1; d <= 7; d += 1) await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [A, d]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15'), ($1,'cancel_window_hours','12')`, [A]);
  db = createDb({ connectionString: tdb.url, max: 4 });
  db2 = createDb({ connectionString: tdb.url, max: 4 });
});
afterEach(async () => {
  await db.end();
  await db2.end();
  await tdb.close();
});

const DESKU = DESK;
const refundRows = async () => (await tdb.query(`select change_satang::int as n, reason from public.wallet_ledger where reason in ('refund') order by created_at`)).rows;

it('F09/CANCEL-02-AC5 F05/PAY-06-AC7 a booking paid in cash at the desk, cancelled in time, goes back to the wallet as a refund; no payment row is changed and nothing is returned as cash', async () => {
  const b = await book([18]);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    await c.query(`update public.orders set price_group_snapshot = '{}', subtotal_satang = 40000, discount_satang = 0, total_satang = 40000, credit_value_satang = 0, wallet_satang = 0, money_satang = 40000, quote_hash = repeat('b',64), priced_at = now() where id = $1`, [b.order]);
    await c.query('commit');
  } finally {
    c.release();
  }
  await tdb.query(`insert into public.payment (club_id, order_id, method, status, amount_satang, cash_reason_code, confirmed_at, taken_by) values ($1,$2,'cash','succeeded',40000,'no_banking_app', app.now(), $3)`, [A, b.order, DESKU]);
  const before = (await tdb.query(`select id, method, status, amount_satang from public.payment order by id`)).rows;
  const r = await cancel(player(), b.ids[0]!);
  expect(r).toMatchObject({ outcome: 'in_time' });
  expect(await refundRows()).toEqual([{ n: 40000, reason: 'refund' }]);
  expect((await tdb.query(`select id, method, status, amount_satang from public.payment order by id`)).rows).toEqual(before);   // the cash payment row is as it was: no refund row, no cash out
  expect((await tdb.query(`select count(*)::int as n from public.payment`)).rows[0].n).toBe(1);
});

it('F09/CANCEL-03-AC7 a solo class in a closed range is cancelled with full value even inside the cancel window; the court and the coach are free together', async () => {
  await tdb.seedCoach(A, COACH);
  const b = await book([18], { coach: COACH });
  await tdb.setNow(new Date(Date.parse(H(18)) - 2 * 3_600_000).toISOString());   // two hours before: a player cancel would be late
  const r = (await db.withClubTx(desk(), async (tx) => (await tx.query(`select app.create_closure($1::uuid[], $2, $3, null, 'rain', null) as r`, [[COURT1], H(17), H(21)])).rows[0]!.r)) as Record<string, any>;
  expect(r).toMatchObject({ cancelled: 1 });
  expect(await row(b.ids[0]!)).toBe('cancelled');
  expect(await refundRows()).toEqual([{ n: 40000, reason: 'refund' }]);
  const occ = (await tdb.query(`select kind, coach_id from public.occupancy where resource_id = $1 and start_at < $3 and end_at > $2`, [COURT1, H(18), new Date(Date.parse(H(18)) + 3_600_000).toISOString()])).rows;
  expect(occ).toEqual([{ kind: 'closure', coach_id: null }]);   // only the closure holds the hour now: the coach is not held
  expect((await tdb.query(`select count(*)::int as n from public.occupancy where coach_id = $1`, [COACH])).rows[0].n).toBe(0);
});
