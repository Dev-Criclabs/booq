import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db, type ClubContext } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F09-T08b / migration 1010: app.end_closure, app.closures_due_roll, app.roll_closure (F09 design 4.8, 8; CANCEL-03-AC9,
// AC11; A-8). Ending or shortening frees the closed slots from the cut on and restores nothing; a repeat closure gains
// each occurrence once as the booking window reaches it, and a booking found there is cancelled by the same routine.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURT = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT2 = 'c1c1c1c1-0000-4000-8000-000000000002';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-12-01T03:00:00Z';
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

const end = (c: ClubContext, closure: string, newEnd: string | null, reason: string | null = 'reopened') =>
  db.withClubTx(c, async (tx) => (await tx.query(`select app.end_closure($1, $2, $3) as r`, [closure, newEnd, reason])).rows[0]!.r as Record<string, any>);
const job = { clubId: A, userId: null, roles: [] as never, requestId: 'r', source: 'job' as const };
async function asWorker<T>(fn: (w: Db) => Promise<T>) {
  const w = createDb({ connectionString: tdb.url, max: 1, role: 'booq_worker' });
  try {
    return await fn(w);
  } finally {
    await w.end();
  }
}
const due = (w: Db) => w.withClubTx(job, async (tx) => (await tx.query(`select app.closures_due_roll() as r`)).rows[0]!.r as string[]);
const roll = (w: Db, closure: string) => w.withClubTx(job, async (tx) => (await tx.query(`select app.roll_closure($1) as r`, [closure])).rows[0]!.r as Record<string, any>);
const closure = async (id: string) => (await tdb.query(`select status, ended_by, range_end, repeat_rule from public.closure where id = $1`, [id])).rows[0];

describe('end_closure (CANCEL-03-AC11)', () => {
  it('ending now frees the slots from now on; the cancelled booking is not restored', async () => {
    const b = await book(19);
    const c = await create(desk(), [COURT], H(17), H(21));
    await tdb.setNow(at(H(18), 0.5));
    expect(await end(desk(), c.closure, null)).toMatchObject({ status: 'ended', freed: 1 });
    expect(await closure(c.closure)).toMatchObject({ status: 'ended', ended_by: DESK });
    expect(await closedSlots()).toEqual([[H(17), at(H(18), 0.5)]]);
    expect((await status(b.booking)).status).toBe('cancelled');
    expect((await hold(19)).booking).toBeTruthy();
    const audit = (await tdb.query(`select count(*)::int n from public.audit_entry where record_type = 'closure' and record_id = $1`, [c.closure])).rows[0].n;
    expect(audit).toBeGreaterThanOrEqual(2);
  });

  it('a new end shortens a one off closure', async () => {
    const c = await create(desk(), [COURT, COURT2], H(17), H(21));
    expect(await end(desk(), c.closure, H(19))).toMatchObject({ status: 'active' });
    expect((await closure(c.closure)).range_end.toISOString()).toBe(H(19));
    expect(await closedSlots()).toEqual([[H(17), H(19)]]);
    expect(await closedSlots(COURT2)).toEqual([[H(17), H(19)]]);
    expect((await hold(20)).booking).toBeTruthy();
  });

  it('a new end stops a repeat at its last occurrence before it, and the roll adds none after', async () => {
    const c = await create(desk(), [COURT], H(17), H(21), { kind: 'weekly', weekdays: [4] });
    await end(desk(), c.closure, H(18, 14));
    expect((await closure(c.closure)).repeat_rule).toEqual({ kind: 'weekly', weekdays: [4], until: '2026-12-17' });
    expect(await closedSlots()).toEqual([[H(17), H(21)], [H(17, 7), H(21, 7)], [H(17, 14), H(18, 14)]]);
    await tdb.setNow(at(NOW, 24 * 14));
    await asWorker(async (w) => expect(await due(w)).toEqual([]));
  });

  it('refuses a player, no reason, a closure already ended or unknown, and a new end in the past or not shorter', async () => {
    const c = await create(desk(), [COURT], H(17), H(21));
    await expect(end(player(), c.closure, null)).rejects.toThrow(/closure:forbidden/);
    await expect(end(desk(), c.closure, null, ' ')).rejects.toThrow(/closure:reason_required/);
    await expect(end(desk(), c.closure, at(NOW, -1))).rejects.toThrow(/closure:invalid_range/);
    await expect(end(desk(), c.closure, H(22))).rejects.toThrow(/closure:invalid_range/);
    await expect(end(desk(), LOC, null)).rejects.toThrow(/closure:not_found/);
    await end(desk(), c.closure, null);
    await expect(end(desk(), c.closure, null)).rejects.toThrow(/closure:not_active/);
  });
});

describe('roll_closure (CANCEL-03-AC9, A-8)', () => {
  it('a repeat closure gains its next occurrence once, and a booking found there is cancelled with full value', async () => {
    const c = await create(desk(), [COURT], H(17), H(21), { kind: 'weekly', weekdays: [4] });
    expect((await closedSlots()).length).toBe(5);
    // The window grows to 40 days: Thursday 7 January 2027 is now reached, and a booking was made there first.
    await tdb.query(`update public.club_setting set value = '40' where club_id = $1 and key = 'booking_window_days'`, [A]);
    const b = await book(18, P1, COURT, 35);
    await asWorker(async (w) => {
      expect(await due(w)).toEqual([c.closure]);
      expect(await roll(w, c.closure)).toMatchObject({ added: 1, cancelled: 1, slots: 1 });
      expect(await roll(w, c.closure)).toMatchObject({ added: 0 });
      expect(await due(w)).toEqual([]);
    });
    expect((await status(b.booking)).status).toBe('cancelled');
    expect(await ledger(b.pkg)).toEqual([['reserve', -1], ['return', 1]]);
    expect((await tdb.query(`select kind, reason, by_user, closure_id from public.booking_cancel where booking_id = $1`, [b.booking])).rows)
      .toEqual([{ kind: 'closure', reason: 'rain', by_user: null, closure_id: c.closure }]);
    expect(await closedSlots()).toContainEqual([H(17, 35), H(21, 35)]);
  });

  it('the job cancels a group session in a new occurrence with the closure reason', async () => {
    const c = await create(desk(), [COURT], H(17), H(21), { kind: 'daily' });
    await tdb.query(`update public.club_setting set value = '31' where club_id = $1 and key = 'booking_window_days'`, [A]);
    const s = await tdb.seedClassSession(A, COURT, H(19, 29));
    await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, class_session_id)
                     select club_id, 'group_class', resource_id, coach_id, start_at, end_at, 'confirmed', id from public.class_session where id = $1`, [s]);
    await asWorker(async (w) => expect(await roll(w, c.closure)).toMatchObject({ added: 1, sessions: 1 }));
    expect((await tdb.query(`select status, cancel_reason from public.class_session where id = $1`, [s])).rows[0]).toEqual({ status: 'cancelled', cancel_reason: 'closure' });
  });

  it('an ended closure or a one off never rolls; a player cannot roll', async () => {
    const c = await create(desk(), [COURT], H(17), H(21));
    await asWorker(async (w) => expect(await roll(w, c.closure)).toMatchObject({ added: 0 }));
    await expect(db.withClubTx(player(), (tx) => tx.query(`select app.roll_closure($1)`, [c.closure]))).rejects.toThrow(/closure:forbidden/);
  });
});
