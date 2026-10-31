import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db, type ClubContext } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F09-T08a / migration 1009: app.closure_preview, app.create_closure (F09 design 4.6, 4.7; CANCEL-03-AC1 to AC8,
// AC13 to AC17; CC-4; CONC-13). The preview writes nothing; the closure cancels the confirmed bookings in its range with
// full value, releases holds (closed), cancels group sessions, and then closes the slots, all in one transaction. A
// booking that races it is either cancelled by it or refused, never both.
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

describe('closure_preview (CANCEL-03-AC1, AC8)', () => {
  it('lists the confirmed bookings, holds and sessions in the range with names, counts what it leaves, and writes nothing', async () => {
    await book(9); // played by the time of the preview
    const b = await book(18, P1);
    const h = await hold(19, P2);
    await book(18, P2, COURT2);
    const s = await session(20);
    await tdb.setNow(at(H(9), 1.5));
    const before = await counts();
    const p = await preview(desk(), [COURT], H(8), H(22));
    expect(await counts()).toEqual(before);
    expect(p.occurrences).toHaveLength(1);
    expect(p.bookings.map((x: any) => [x.bookingId, x.status, x.customerName])).toEqual([[b.booking, 'confirmed', 'Ann'], [h.booking, 'awaiting_payment', 'Ben']]);
    expect(p.sessions.map((x: any) => x.sessionId)).toEqual([s]);
    expect(p).toMatchObject({ playedCount: 1, startedCount: 0, cancelCount: 2, expiredPackages: [] });
  });

  it('a player is refused; the preview is staff only (CC-3, AC17)', async () => {
    await expect(preview(player(), [COURT], H(8), H(22))).rejects.toThrow(/closure:forbidden/);
  });
});

describe('create_closure (CANCEL-03-AC2 to AC8, AC12 to AC15)', () => {
  it('cancels a confirmed booking with full value even inside the cancel window, releases a hold as closed, and closes the slots', async () => {
    const b = await book(18);
    const h = await hold(19, P2);
    const outside = await book(22);
    await tdb.setNow(at(H(18), -2)); // two hours before: a player's cancel would be late
    const r = await create(desk(), [COURT], H(17), H(21));
    expect(r).toMatchObject({ cancelled: 1, released: 1, sessions: 0, slots: 1 });
    expect((await status(b.booking)).status).toBe('cancelled');
    expect(await ledger(b.pkg)).toEqual([['reserve', -1], ['return', 1]]);
    const rec = (await tdb.query(`select kind, outcome, reason, closure_id from public.booking_cancel where booking_id = $1`, [b.booking])).rows;
    expect(rec).toEqual([{ kind: 'closure', outcome: 'returned', reason: 'rain', closure_id: r.closure }]);
    expect(await status(h.booking)).toEqual({ status: 'released', release_reason: 'closed' });
    expect((await status(outside.booking)).status).toBe('confirmed');
    expect(await closedSlots()).toEqual([[H(17), H(21)]]);
    const def = (await tdb.query(`select reason, created_by, status, range_start from public.closure where id = $1`, [r.closure])).rows[0];
    expect(def).toMatchObject({ reason: 'rain', created_by: DESK, status: 'active' });
    expect((await tdb.query(`select resource_id from public.closure_resource where closure_id = $1`, [r.closure])).rows).toEqual([{ resource_id: COURT }]);
    expect(Number((await tdb.query(`select count(*) from public.audit_entry where record_type = 'closure' and record_id = $1`, [r.closure])).rows[0].count)).toBeGreaterThan(0);
  });

  it('a payment that arrives after the hold was closed cannot reclaim the slot, so apply_payment sends it to the wallet (AC5, PAY-03)', async () => {
    const h = await hold(19, P2);
    await create(desk(), [COURT], H(17), H(21));
    const worker = createDb({ connectionString: tdb.url, max: 1, role: 'booq_worker' });
    try {
      const hook = { clubId: A, userId: null, roles: [] as never, requestId: 'r', source: 'webhook' as const };
      await expect(worker.withClubTx(hook, (tx) => tx.query(`select app.reclaim_order($1)`, [h.order]))).rejects.toThrow(/slot_unavailable/);
    } finally {
      await worker.end();
    }
    expect((await status(h.booking)).status).toBe('released');
  });

  it('a booking in the closed range afterwards is refused (AC3, AC4)', async () => {
    await create(desk(), [COURT], H(17), H(21));
    await expect(hold(18)).rejects.toThrow(/slot_unavailable/);
    expect((await hold(18, P1, COURT2)).booking).toBeTruthy();
  });

  it('a group class session in the range is cancelled and its court freed (AC6)', async () => {
    const s = await session(19);
    const r = await create(desk(), [COURT], H(17), H(21));
    expect(r.sessions).toBe(1);
    expect((await tdb.query(`select status, cancel_reason from public.class_session where id = $1`, [s])).rows[0]).toEqual({ status: 'cancelled', cancel_reason: 'owner' });
    expect(await closedSlots()).toEqual([[H(17), H(21)]]);
  });

  it('a played booking is untouched and a started one keeps its hour; the closed slot is cut around it (AC8)', async () => {
    const played = await book(9);
    const started = await book(11);
    const later = await book(13);
    await tdb.setNow(at(H(11), 0.5));
    const r = await create(desk(), [COURT], H(8), H(15));
    expect(r.cancelled).toBe(1);
    expect((await status(played.booking)).status).toBe('confirmed');
    expect((await status(started.booking)).status).toBe('confirmed');
    expect((await status(later.booking)).status).toBe('cancelled');
    expect(await closedSlots()).toEqual([[H(12), H(15)]]);
  });

  it('an expired package whose credit was reserved gets it back and is listed (AC12, D85)', async () => {
    const b = await book(18);
    await tdb.query(`update public.customer_package set expires_at = $2 where id = $1`, [b.pkg, at(NOW, -1)]).catch(async () => {
      const c = await tdb.pool.connect();
      try {
        await c.query('begin');
        await c.query('set local session_replication_role = replica');
        await c.query(`update public.customer_package set expires_at = $2 where id = $1`, [b.pkg, at(NOW, -1)]);
        await c.query('commit');
      } finally {
        c.release();
      }
    });
    expect((await preview(desk(), [COURT], H(17), H(21))).expiredPackages.map((x: any) => x.packageId)).toEqual([b.pkg]);
    const r = await create(desk(), [COURT], H(17), H(21));
    expect(r.expiredPackages.map((x: any) => x.packageId)).toEqual([b.pkg]);
    expect(await ledger(b.pkg)).toEqual([['reserve', -1], ['return', 1]]);
  });

  it('a weekly repeat closes every matching day the booking window reaches and cancels the bookings there (AC9)', async () => {
    const next = await book(18, P1, COURT, 7);
    const other = await book(18, P1, COURT, 1);
    const rule = { kind: 'weekly', weekdays: [4] }; // Thursdays
    const p = await preview(desk(), [COURT], H(17), H(21), rule);
    // Thursday 3 December to Thursday 31 December: today (1 December) plus 30 days.
    expect(p.occurrences.map((o: any) => new Date(o.start).toISOString())).toEqual([0, 7, 14, 21, 28].map((d) => H(17, d)));
    expect(p.bookings.map((x: any) => x.bookingId)).toEqual([next.booking]);
    await create(desk(), [COURT], H(17), H(21), rule);
    expect((await closedSlots()).length).toBe(5);
    expect((await status(next.booking)).status).toBe('cancelled');
    expect((await status(other.booking)).status).toBe('confirmed');
    const until = await preview(desk(), [COURT], H(17), H(21), { kind: 'daily', until: '2026-12-05' });
    expect(until.occurrences).toHaveLength(3);
  });

  it('works in a Paused club (AC13, D60)', async () => {
    const b = await book(18);
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    await create(desk(), [COURT], H(17), H(21));
    expect((await status(b.booking)).status).toBe('cancelled');
  });

  it('refuses a player, a missing reason, an unknown court, a bad range or repeat, an unset window, and above the limit, writing nothing (AC15, AC17, A-7)', async () => {
    await book(18);
    const before = await counts();
    await expect(create(player(), [COURT], H(17), H(21))).rejects.toThrow(/closure:forbidden/);
    await expect(create(desk(), [COURT], H(17), H(21), null, '  ')).rejects.toThrow(/closure:reason_required/);
    await expect(create(desk(), [LOC], H(17), H(21))).rejects.toThrow(/closure:invalid_court/);
    await expect(create(desk(), [COURT], H(21), H(17))).rejects.toThrow(/closure:invalid_range/);
    await expect(create(desk(), [COURT], at(NOW, -5), at(NOW, -1))).rejects.toThrow(/closure:ended/);
    await expect(create(desk(), [COURT], H(17), H(17, 2), { kind: 'daily' })).rejects.toThrow(/closure:invalid_repeat/);
    await expect(create(desk(), [COURT], H(17), H(21), { kind: 'weekly', weekdays: [8] })).rejects.toThrow(/closure:invalid_repeat/);
    await expect(create(desk(), [COURT], H(17), H(21), null, 'rain', 0)).rejects.toThrow(/closure:too_many/);
    await tdb.query(`delete from public.club_setting where club_id = $1 and key = 'booking_window_days'`, [A]);
    await expect(create(desk(), [COURT], H(17), H(21), { kind: 'daily' })).rejects.toThrow(/closure:window_unset/);
    expect(await counts()).toEqual(before);
    expect((await create(desk(), [COURT], H(17), H(21), null, 'rain', 1)).cancelled).toBe(1);
  });

  it('a second closure over part of the first closes only the gap', async () => {
    await create(desk(), [COURT], H(17), H(19));
    await create(desk(), [COURT], H(18), H(21));
    expect(await closedSlots()).toEqual([[H(17), H(19)], [H(19), H(21)]]);
  });
});

describe('a closure racing a new booking (CANCEL-03-AC16, CONC-13)', () => {
  it('exactly one outcome stands: the booking is cancelled by the closure or refused, never both and never double', async () => {
    for (let i = 0; i < 6; i += 1) {
      const hour = 8 + i * 2;
      const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id as string;
      const [res, clo] = await Promise.allSettled([
        db.withClubTx(player(), async (tx) => (await tx.query(`select app.reserve_court($1, $2, $3::timestamptz[]) as r`, [order, COURT, [H(hour)]])).rows[0]!.r),
        create(desk(), [COURT], H(hour), H(hour + 1)),
      ]);
      expect(clo.status).toBe('fulfilled');
      const live = (await tdb.query(`select count(*)::int n from public.occupancy where resource_id = $1 and kind <> 'closure' and start_at = $2`, [COURT, H(hour)])).rows[0].n;
      expect(live).toBe(0);
      if (res.status === 'fulfilled') {
        const id = (res.value as any).booking_ids[0];
        expect((await status(id)).status).toBe('released');
      } else {
        expect(String(res.reason)).toMatch(/slot_unavailable/);
      }
      expect(await closedSlots()).toContainEqual([H(hour), H(hour + 1)]);
    }
  });
});
