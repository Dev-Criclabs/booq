import { createDb, type Db } from './tx';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { A, apply, log, pay, PLAYER, RES, setup, tdb, teardown } from './testing/payment-fixtures';

// F07-T06b / migration 0809: apply_payment for the order that adds a coach to a booking (COACH-03-AC3, D74, D111).
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const OTHER = '22222222-2222-4222-8222-222222222222';
const C2 = '00000000-0000-4000-8000-0000000000c2';
let web: Db;

/** The player's confirmed court booking a day ahead at 10:00 Bangkok, the priced add order, and the add through the real function. */
async function added(): Promise<{ b: string; order: string; payment: string }> {
  const day = new Date(Date.now() + 36 * 3600e3);
  const start = `${day.toISOString().slice(0, 10)}T10:00:00+07:00`;
  const o1 = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, PLAYER])).rows[0].id as string;
  const b = (await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
     values ($1,$2,'court',$3,$4::timestamptz,$4::timestamptz + interval '1 hour',$5,'confirmed','online',$5, app.now()) returning id`, [A, o1, RES, start, PLAYER])).rows[0].id as string;
  await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, booking_id) values ($1,'court_booking',$2,$3::timestamptz,$3::timestamptz + interval '1 hour','confirmed',$4)`, [A, RES, start, b]);
  const order = await addOrder(PLAYER);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    await c.query(`insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, discount_satang, net_satang, credit_value_satang, wallet_satang, money_satang)
                   values ($1,$2,1,'coach',$3,'coach','โค้ช','Coach',80000,0,80000,0,0,80000)`, [A, order, b]);
    await c.query('commit');
  } finally {
    c.release();
  }
  await web.withClubTx({ clubId: A, userId: PLAYER, roles: ['player'], source: 'player_app' }, async (tx) => tx.query(`select app.add_coach_to_booking($1, $2, $3)`, [b, COACH, order]));
  const payment = (await tdb.query(`insert into public.payment (club_id, order_id, method, status, environment, gateway, gateway_charge_id, amount_satang) values ($1,$2,'beam','pending','live','beam','chg_'||gen_random_uuid(), 80000) returning id`, [A, order])).rows[0].id as string;
  return { b, order, payment };
}
async function addOrder(customer: string) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    const r = await c.query(
      `insert into public.orders (club_id, customer_id, source, status, price_group_snapshot, subtotal_satang, discount_satang, total_satang, credit_value_satang, wallet_satang, money_satang, quote_hash, priced_at)
       values ($1,$2,'online','open','{}'::jsonb,80000,0,80000,0,0,80000,repeat('a',64), app.now()) returning id`, [A, customer]);
    await c.query('commit');
    return r.rows[0].id as string;
  } finally {
    c.release();
  }
}
const book = async (b: string) => (await tdb.query(`select type, coach_id from public.booking where id = $1`, [b])).rows[0];
const addStatus = async (o: string) => (await tdb.query(`select status from public.booking_coach_add where order_id = $1`, [o])).rows[0].status;

beforeEach(async () => {
  await setup();
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'hold_minutes','15')`, [A]);
  await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) select $1, d, '06:00', '24:00' from generate_series(1, 7) d`, [A]);
  await tdb.seedCoach(A, COACH);
  web = createDb({ connectionString: tdb.url, max: 3 });
});
afterEach(async () => {
  await web.end();
  await teardown();
});

describe('payment of an add order (F07-T06b)', () => {
  it('while the hold runs: confirms the add, marks the order paid, issues the receipt, and the coach stays', async () => {
    const x = await added();
    expect(await apply(x.payment)).toEqual({ outcome: 'applied', order_status: 'paid' });
    expect(await addStatus(x.order)).toBe('confirmed');
    expect(await book(x.b)).toEqual({ type: 'solo_class', coach_id: COACH });
    expect(await pay(x.payment)).toMatchObject({ status: 'succeeded', outcome: 'applied' });
    expect((await log()).filter((l) => l.port === 'issue_receipt')).toEqual([{ port: 'issue_receipt', args: [x.order, x.payment, 'order'] }]);
    expect(await apply(x.payment)).toMatchObject({ repeated: true });
  });

  it('after the hold ended and the job freed the coach: the coach is taken back when still free (applied_late)', async () => {
    const x = await added();
    await tdb.advance('16 minutes');
    await web.withClubTx({ clubId: A, userId: PLAYER, roles: ['player'], source: 'player_app' }, async (tx) => tx.query(`select app.release_coach_add($1, 'expired')`, [x.order]));
    expect(await book(x.b)).toEqual({ type: 'court', coach_id: null });
    expect(await apply(x.payment)).toEqual({ outcome: 'applied_late', order_status: 'paid' });
    expect(await book(x.b)).toEqual({ type: 'solo_class', coach_id: COACH });
    expect(await addStatus(x.order)).toBe('confirmed');
  });

  it('after the hold ended and the job has not run yet: the payment releases it itself, then takes the coach back', async () => {
    const x = await added();
    await tdb.advance('16 minutes');
    expect(await apply(x.payment)).toMatchObject({ outcome: 'applied_late' });
    expect(await book(x.b)).toEqual({ type: 'solo_class', coach_id: COACH });
  });

  it('when the coach was booked meanwhile: the amount goes to the wallet, the booking stays a court booking, nothing is half done', async () => {
    const x = await added();
    await tdb.advance('16 minutes');
    await web.withClubTx({ clubId: A, userId: PLAYER, roles: ['player'], source: 'player_app' }, async (tx) => tx.query(`select app.release_coach_add($1, 'expired')`, [x.order]));
    // Another player books the same coach for the same hour on another court.
    const pc = await tdb.pool.connect();
    try {
      await pc.query('begin');
      await pc.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,'L2')`, [A, OTHER]);
      await pc.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, OTHER]);
      await pc.query('commit');
    } finally {
      pc.release();
    }
    await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) select $1, $2, location_id, '2', 'tennis' from public.resource where id = $3`, [A, C2, RES]);
    const start = (await tdb.query(`select start_at from public.booking where id = $1`, [x.b])).rows[0].start_at as Date;
    const o2 = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, OTHER])).rows[0].id;
    const b2 = (await tdb.query(`insert into public.booking (club_id, order_id, type, resource_id, coach_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at) values ($1,$2,'solo_class',$3,$4,$5,$5::timestamptz + interval '1 hour',$6,'confirmed','online',$6, app.now()) returning id`, [A, o2, C2, COACH, start, OTHER])).rows[0].id;
    await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, booking_id) values ($1,'solo_class',$2,$3,$4,$4::timestamptz + interval '1 hour','confirmed',$5)`, [A, C2, COACH, start, b2]);
    expect(await apply(x.payment)).toMatchObject({ outcome: 'wallet_late' });
    expect(await book(x.b)).toEqual({ type: 'court', coach_id: null });
    expect(await addStatus(x.order)).toBe('released');
    expect((await log()).map((l) => l.port)).toEqual(['credit_wallet', 'issue_receipt', 'enqueue_message']);
    expect(await pay(x.payment)).toMatchObject({ status: 'succeeded', outcome: 'wallet_late' });
  });
});
