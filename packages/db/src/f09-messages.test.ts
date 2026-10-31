import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db, type ClubContext } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F09-T11 / migration 1013: the cancel and closure messages through F10's app.enqueue_message (F09 design 4.9; CANCEL-01-AC14,
// CANCEL-03-AC2, AC5, AC7, AC15; LINE-05). One message per player by dedupe key; params hold ids only; a message that
// fails or cannot be delivered never undoes the cancel, and the owner gets the list of players a closure could not reach.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURT = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT2 = 'c1c1c1c1-0000-4000-8000-000000000002';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-12-01T03:00:00Z';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
// Hours of Thursday 3 December 2026, Bangkok.
const H = (h: number, day = 0) => new Date(Date.parse('2026-12-03T00:00:00+07:00') + (day * 24 + h) * 3_600_000).toISOString();

let tdb: TestDatabase;
let db: Db;
const desk = (): ClubContext => ({ clubId: A, userId: DESK, roles: ['front_desk', 'player'], requestId: 'r', source: 'admin' });
const player = (u = P1): ClubContext => ({ clubId: A, userId: u, roles: ['player'], requestId: 'r', source: 'player_app' });

async function asOwner(sql: string, params: unknown[]) {
  const o = await tdb.pool.connect();
  try {
    await o.query('begin');
    await o.query('set local role booq_owner');
    await o.query(`select set_config('app.club_id', $1, true)`, [A]);
    await o.query(sql, params);
    await o.query('commit');
  } finally {
    o.release();
  }
}

/** A held hour: reserved by the player and not paid. */
async function hold(hour: number, customer = P1, court = COURT, day = 0) {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id as string;
  const r = await db.withClubTx(player(customer), async (tx) => (await tx.query(`select app.reserve_court($1, $2, $3::timestamptz[]) as r`, [order, court, [H(hour, day)]])).rows[0]!.r);
  return { order, booking: r.booking_ids[0] as string };
}

/** A confirmed hour paid by one credit of a package, through the real claim, confirm and reserve. */
async function book(hour: number, customer = P1, court = COURT, day = 0) {
  const { order, booking } = await hold(hour, customer, court, day);
  await db.withClubTx(desk(), (tx) => tx.query(`select app.confirm_booking($1)`, [order]));
  const product = (await tdb.query(`insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_satang) values ($1,'แพ็ก','Pack','court_hour',10,3,100000) returning id`, [A])).rows[0].id;
  const pkg = (await tdb.query(`insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, expires_at)
                               values ($1,$2,$3,'{"credit_type":"court_hour"}',10,'2026-11-01T00:00:00Z','2027-06-01T00:00:00Z') returning id`, [A, customer, product])).rows[0].id as string;
  const c = await tdb.pool.connect();
  let line: string;
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    line = (await c.query(
      `insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, net_satang, credit_package_id, credit_units, credit_value_satang)
       values ($1,$2,1,'court_hour',$3,'k','ก','x',30000,30000,$4,1,30000) returning id`, [A, order, booking, pkg])).rows[0].id;
    await c.query(`update public.orders set status = 'paid' where id = $1`, [order]);
    await c.query('commit');
  } finally {
    c.release();
  }
  await asOwner('select app.credit_reserve($1, $2, $3)', [pkg, booking, line!]);
  return { order, booking, pkg };
}

const preview = (c: ClubContext, courts: string[], start: string, end: string, rule: unknown = null) =>
  db.withClubTx(c, async (tx) => (await tx.query(`select app.closure_preview($1::uuid[], $2, $3, $4::jsonb) as r`, [courts, start, end, rule === null ? null : JSON.stringify(rule)])).rows[0]!.r as Record<string, any>);
const create = (c: ClubContext, courts: string[], start: string, end: string, rule: unknown = null, reason: string | null = 'rain', limit: number | null = null) =>
  db.withClubTx(c, async (tx) => (await tx.query(`select app.create_closure($1::uuid[], $2, $3, $4::jsonb, $5, $6) as r`,
    [courts, start, end, rule === null ? null : JSON.stringify(rule), reason, limit])).rows[0]!.r as Record<string, any>);
const status = async (id: string) => (await tdb.query(`select status, release_reason from public.booking where id = $1`, [id])).rows[0] as { status: string; release_reason: string | null };
const ledger = async (pkg: string) => (await tdb.query(`select reason, change from public.credit_ledger where package_id = $1 order by created_at, reason`, [pkg])).rows.map((x) => [x.reason, x.change]);
const closedSlots = async (court = COURT) =>
  (await tdb.query(`select start_at, end_at from public.occupancy where resource_id = $1 and kind = 'closure' order by start_at`, [court])).rows.map((x) => [x.start_at.toISOString(), x.end_at.toISOString()]);
const counts = async () => (await tdb.query(`select (select count(*)::int from public.closure) closures, (select count(*)::int from public.occupancy) occupancy,
                                                   (select count(*)::int from public.booking_cancel) cancels, (select count(*)::int from public.booking where status = 'confirmed') confirmed`)).rows[0];
const at = (iso: string, hours: number) => new Date(Date.parse(iso) + hours * 3_600_000).toISOString();

async function session(hour: number, court = COURT) {
  const id = await tdb.seedClassSession(A, court, H(hour));
  await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, class_session_id)
                   select club_id, 'group_class', resource_id, coach_id, start_at, end_at, 'confirmed', id from public.class_session where id = $1`, [id]);
  return id;
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow(NOW);
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live')`, [A]);
  for (const [u, roles, name] of [[P1, ['player'], 'Ann'], [P2, ['player'], 'Ben'], [DESK, ['front_desk', 'player'], 'Desk']] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id, display_name) values ($1,$2,$3,$4)', [A, u, 'L' + u.slice(0, 2), name]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [A, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$4,'1','tennis'), ($1,$3,$4,'2','tennis')`, [A, COURT, COURT2, LOC]);
  for (let d = 1; d <= 7; d += 1) await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [A, d]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15'), ($1,'cancel_window_hours','12')`, [A]);
  db = createDb({ connectionString: tdb.url, max: 6 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

const outbox = async () =>
  (await tdb.query(`select kind, user_id, params, dedupe_key, status from public.message_outbox where kind in ('cancellation_result', 'club_closed_slot', 'session_change', 'booking_released') order by kind, dedupe_key`)).rows;
const cancel = (c: ClubContext, booking: string, staff = false, reason: string | null = null) =>
  db.withClubTx(c, async (tx) => (await tx.query(`select app.cancel_booking($1, $2, $2, $3, null) as r`, [booking, staff, reason])).rows[0]!.r as Record<string, any>);

describe('cancellation_result and session_change (CANCEL-01-AC14, LINE-05)', () => {
  it('a cancel sends the player one cancellation_result by its version; a second tap sends nothing more', async () => {
    const b = await book(18);
    await cancel(player(), b.booking);
    await cancel(player(), b.booking);
    expect(await outbox()).toEqual([
      { kind: 'cancellation_result', user_id: P1, params: { booking_id: b.booking }, dedupe_key: `cancel:${b.booking}:1`, status: 'pending' },
    ]);
  });

  it('a solo class tells the coach too (session_change, CANCEL-03-AC7)', async () => {
    await tdb.seedCoach(A, COACH);
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id as string;
    const r = await db.withClubTx(player(), async (tx) => (await tx.query(`select app.reserve_court($1, $2, $3::timestamptz[], $4) as r`, [order, COURT, [H(18)], COACH])).rows[0]!.r);
    await db.withClubTx(desk(), (tx) => tx.query(`select app.confirm_booking($1)`, [order]));
    const id = r.booking_ids[0] as string;
    await cancel(desk(), id, true, 'rain');
    expect((await outbox()).map((m) => [m.kind, m.user_id, m.dedupe_key])).toEqual([
      ['cancellation_result', P1, `cancel:${id}:1`],
      ['session_change', COACH, `session:${id}:1:${COACH}`],
    ]);
  });
});

describe('club_closed_slot (CANCEL-03-AC2, AC5, AC15)', () => {
  it('each player whose booking or hold the closure ends gets one Club closed message, and no cancel message', async () => {
    const b = await book(18, P1);
    const h = await hold(19, P2);
    const r = await create(desk(), [COURT], H(17), H(21));
    expect((await outbox()).filter((m) => m.kind !== 'booking_released')).toEqual([
      { kind: 'club_closed_slot', user_id: P1, params: { booking_id: b.booking, closure_id: r.closure }, dedupe_key: `closure:${r.closure}:${b.booking}`, status: 'pending' },
      { kind: 'club_closed_slot', user_id: P2, params: { booking_id: h.booking, closure_id: r.closure }, dedupe_key: `closure:${r.closure}:${h.booking}`, status: 'pending' },
    ].sort((x, y) => x.dedupe_key.localeCompare(y.dedupe_key)));
  });

  // F03 design 4.5 and D48: a hold released as closed gets no booking_released (the closure message replaces it). F10's
  // app.f10_released (0605) skips only payment_unavailable and offer_ended; reported to the orchestrator for F10.
  it.todo('no booking_released for a hold the closure released (needs F10 f10_released to skip the reason closed)');

  it('a message that fails or cannot be delivered leaves the cancel standing; the owner lists those players', async () => {
    const b = await book(18, P1);
    const c = await book(20, P2);
    const r = await create(desk(), [COURT], H(17), H(21));
    await tdb.query(`update public.message_outbox set status = 'failed', last_error = 'x' where dedupe_key = $1`, [`closure:${r.closure}:${b.booking}`]);
    await tdb.query(`update public.message_outbox set status = 'undeliverable', last_error = 'cap' where dedupe_key = $1`, [`closure:${r.closure}:${c.booking}`]);
    expect((await status(b.booking)).status).toBe('cancelled');
    const list = await db.withClubTx(desk(), async (tx) => (await tx.query(`select app.closure_unmessaged($1) as r`, [r.closure])).rows[0]!.r);
    expect(list.map((x: any) => [x.customerId, x.customerName, x.status])).toEqual([[P1, 'Ann', 'failed'], [P2, 'Ben', 'undeliverable']]);
    await expect(db.withClubTx(player(), (tx) => tx.query(`select app.closure_unmessaged($1)`, [r.closure]))).rejects.toThrow(/closure:forbidden/);
  });

  it('a session in the range: its seat holders hear from F08, not twice from F09', async () => {
    await session(19);
    const r = await create(desk(), [COURT], H(17), H(21));
    expect((await outbox()).filter((m) => m.kind === 'club_closed_slot')).toEqual([]);
    expect(r.sessions).toBe(1);
  });
});
