import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { closureRoutes, staffCancelRoutes } from './staff-cancel';

// F09-T13 staff routes (CANCEL-01-AC20, CANCEL-03, CANCEL-04, CC-2; F09 design 5, 7): the A2 cancel and marks, and the A12
// closures. Front desk and owner only; every change needs a written reason; a closure works in a Paused club; each route
// refuses fields it does not name. The services' rules are tested in packages/db (cancel-booking, staff-marks, closure-*).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURT = 'c1c1c1c1-0000-4000-8000-000000000001';
const P1 = '00000000-0000-4000-8000-000000000001';
const DESK = '00000000-0000-4000-8000-000000000002';
const OWNER = '00000000-0000-4000-8000-000000000003';
const deps = { hasFeature: async () => true };
const H = (h: number, day = 0) => new Date(Date.parse('2026-12-03T00:00:00+07:00') + (day * 24 + h) * 3_600_000).toISOString();

let tdb: TestDatabase;
let db: Db;
let staff: ReturnType<typeof staffCancelRoutes>;
let closures: ReturnType<typeof closureRoutes>;
const desk = { clubId: A, userId: DESK, roles: ['front_desk' as const, 'player' as const] };
const player = { clubId: A, userId: P1, roles: ['player' as const] };
const call = (list: typeof staff, method: string, path: string, session: object | null, input: Record<string, unknown>) =>
  list.find((r) => r.def.method === method && r.def.path === path)!.handle({ session: session as never, input }, deps);
const status = async (id: string) => (await tdb.query(`select status from public.booking where id = $1`, [id])).rows[0].status as string;

async function booking(hour = 18, day = 0) {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id as string;
  const r = await db.withClubTx({ clubId: A, userId: P1, roles: ['player'], requestId: 'r', source: 'player_app' }, (tx) =>
    tx.query<{ r: { booking_ids: string[] } }>(`select app.reserve_court($1, $2, $3::timestamptz[]) as r`, [order, COURT, [H(hour, day)]]));
  await db.withClubTx({ clubId: A, userId: OWNER, roles: ['owner', 'player'], requestId: 'r', source: 'admin' }, (tx) => tx.query(`select app.confirm_booking($1)`, [order]));
  return r.rows[0]!.r.booking_ids[0]!;
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live')`, [A]);
  for (const [id, roles] of [[P1, ['player']], [DESK, ['front_desk', 'player']], [OWNER, ['owner', 'player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id, display_name) values ($1,$2,$3,$4)', [A, id, 'L' + id, 'N' + id.slice(-1)]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [A, id, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, COURT, LOC]);
  for (let d = 1; d <= 7; d += 1) await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [A, d]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15'), ($1,'cancel_window_hours','12')`, [A]);
  db = createDb({ connectionString: tdb.url, max: 2 });
  const d = { db, clubBySlug: async (slug: string) => (slug === 'club-a' ? { clubId: A } : null) };
  staff = staffCancelRoutes(d);
  closures = closureRoutes(d);
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('A2 staff cancel and marks (F09-T13)', () => {
  it('declares the routes with booking.cancel.staff and booking.mark; a player is refused', async () => {
    expect(staff.map((r) => `${r.def.method} ${r.def.path} ${r.def.permission}`)).toEqual([
      'GET /staff/bookings/:id/cancel-preview booking.cancel.staff', 'POST /staff/bookings/:id/cancel booking.cancel.staff',
      'POST /staff/bookings/:id/mark booking.mark', 'POST /staff/bookings/:id/mark/reverse booking.mark',
    ]);
    const id = await booking();
    expect(await call(staff, 'POST', '/staff/bookings/:id/cancel', player, { id, reason: 'x' })).toMatchObject({ ok: false, status: 403 });
    expect(await status(id)).toBe('confirmed');
  });

  it('the preview offers the staff cancel and the full value club cancel; a club cancel needs a reason (AC20)', async () => {
    const id = await booking(18);
    await tdb.setNow(new Date(Date.parse(H(18)) - 2 * 3_600_000).toISOString());
    expect(await call(staff, 'GET', '/staff/bookings/:id/cancel-preview', desk, { id })).toMatchObject({
      ok: true, body: { bookingId: id, staffCancel: { outcome: 'late' }, clubCancel: { outcome: 'full' } },
    });
    expect(await call(staff, 'POST', '/staff/bookings/:id/cancel', desk, { id, clubCancel: true })).toEqual({ ok: false, status: 400, code: 'reason_required' });
    expect(await call(staff, 'POST', '/staff/bookings/:id/cancel', desk, { id, clubCancel: true, reason: '  ' })).toEqual({ ok: false, status: 400, code: 'reason_required' });
    expect(await call(staff, 'POST', '/staff/bookings/:id/cancel', desk, { id, clubCancel: 'yes', reason: 'rain' })).toEqual({ ok: false, status: 400, code: 'bad_input' });
    expect(await call(staff, 'POST', '/staff/bookings/:id/cancel', desk, { id, clubCancel: true, reason: 'rain', outcome: 'full' })).toEqual({ ok: false, status: 400, code: 'bad_input' });
    const r = await call(staff, 'POST', '/staff/bookings/:id/cancel', desk, { id, clubCancel: true, reason: 'rain', idempotencyKey: 's-1' });
    expect(r).toMatchObject({ ok: true, body: { bookingId: id, kind: 'club_cancel', outcome: 'full', repeated: false } });
    expect(await call(staff, 'POST', '/staff/bookings/:id/cancel', desk, { id, clubCancel: true, reason: 'rain', idempotencyKey: 's-1' })).toEqual(r);
    expect(await status(id)).toBe('cancelled');
  });

  it('a no show is marked after the slot with a reason and reversed with a reason (CANCEL-04-AC3, AC5, AC6)', async () => {
    const id = await booking(18);
    expect(await call(staff, 'POST', '/staff/bookings/:id/mark', desk, { id, kind: 'no_show', reason: 'absent' })).toEqual({ ok: false, status: 409, code: 'not_ended' });
    await tdb.setNow(new Date(Date.parse(H(19)) + 60_000).toISOString());
    expect(await call(staff, 'POST', '/staff/bookings/:id/mark', desk, { id, kind: 'no_show' })).toEqual({ ok: false, status: 400, code: 'reason_required' });
    expect(await call(staff, 'POST', '/staff/bookings/:id/mark', desk, { id, kind: 'refund', reason: 'x' })).toEqual({ ok: false, status: 400, code: 'bad_input' });
    expect(await call(staff, 'POST', '/staff/bookings/:id/mark', desk, { id, kind: 'no_show', reason: 'absent' })).toMatchObject({ ok: true, body: { bookingId: id, kind: 'no_show_mark' } });
    expect(await status(id)).toBe('no_show');
    expect(await call(staff, 'POST', '/staff/bookings/:id/mark/reverse', desk, { id })).toEqual({ ok: false, status: 400, code: 'reason_required' });
    expect(await call(staff, 'POST', '/staff/bookings/:id/mark/reverse', desk, { id, reason: 'came late' })).toMatchObject({ ok: true, body: { bookingId: id, kind: 'reversal' } });
    expect(await status(id)).toBe('confirmed');
    expect(await call(staff, 'POST', '/staff/bookings/:id/mark/reverse', desk, { id, reason: 'again' })).toEqual({ ok: false, status: 409, code: 'not_marked' });
  });
});

describe('A12 closures (F09-T13)', () => {
  const range = { courtIds: [COURT], start: H(17), end: H(21) };

  it('declares the routes with closure.write; a player is refused', async () => {
    expect(closures.map((r) => `${r.def.method} ${r.def.path} ${r.def.permission}`)).toEqual([
      'POST /staff/closures/preview closure.write', 'POST /staff/closures closure.write', 'GET /staff/closures closure.write',
      'POST /staff/closures/:id/end closure.write', 'GET /staff/closures/:id/expired-packages closure.write', 'GET /staff/closures/:id/unmessaged closure.write',
    ]);
    expect(await call(closures, 'POST', '/staff/closures', player, { ...range, reason: 'x' })).toMatchObject({ ok: false, status: 403 });
  });

  it('preview, then create in a Paused club with a reason, list, read the follow ups, and end (CANCEL-03-AC1, AC11, AC13)', async () => {
    const id = await booking(18);
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    expect(await call(closures, 'POST', '/staff/closures/preview', desk, range)).toMatchObject({ ok: true, body: { cancelCount: 1, bookings: [{ bookingId: id, customerName: 'N1' }] } });
    expect(await call(closures, 'POST', '/staff/closures', desk, range)).toEqual({ ok: false, status: 400, code: 'reason_required' });
    const made = await call(closures, 'POST', '/staff/closures', desk, { ...range, reason: 'resurfacing' });
    expect(made).toMatchObject({ ok: true, body: { cancelled: 1, slots: 1 } });
    const closure = (made as { body: { closure: string } }).body.closure;
    expect(await status(id)).toBe('cancelled');
    expect(await call(closures, 'GET', '/staff/closures', desk, {})).toMatchObject({
      ok: true, body: { closures: [{ id: closure, reason: 'resurfacing', status: 'active', courtIds: [COURT], start: '2026-12-03T17:00:00+07:00' }] },
    });
    expect(await call(closures, 'GET', '/staff/closures/:id/expired-packages', desk, { id: closure })).toEqual({ ok: true, status: 200, body: { packages: [] } });
    expect(await call(closures, 'GET', '/staff/closures/:id/unmessaged', desk, { id: closure })).toEqual({ ok: true, status: 200, body: { players: [] } });
    expect(await call(closures, 'POST', '/staff/closures/:id/end', desk, { id: closure })).toEqual({ ok: false, status: 400, code: 'reason_required' });
    expect(await call(closures, 'POST', '/staff/closures/:id/end', desk, { id: closure, reason: 'done early' })).toMatchObject({ ok: true, body: { status: 'ended' } });
    expect(await call(closures, 'POST', '/staff/closures/:id/end', desk, { id: closure, reason: 'again' })).toEqual({ ok: false, status: 409, code: 'not_active' });
  });

  it('bad input, a bad range or repeat, and the platform limit answer typed codes (A-7)', async () => {
    await booking(18);
    await booking(19);
    expect(await call(closures, 'POST', '/staff/closures/preview', desk, { ...range, courtIds: 'all' })).toEqual({ ok: false, status: 400, code: 'bad_input' });
    expect(await call(closures, 'POST', '/staff/closures/preview', desk, { ...range, start: '3 Dec' })).toEqual({ ok: false, status: 400, code: 'bad_input' });
    expect(await call(closures, 'POST', '/staff/closures/preview', desk, { ...range, start: H(21), end: H(17) })).toEqual({ ok: false, status: 400, code: 'invalid_range' });
    expect(await call(closures, 'POST', '/staff/closures/preview', desk, { ...range, repeat: { kind: 'monthly' } })).toEqual({ ok: false, status: 400, code: 'invalid_repeat' });
    expect(await call(closures, 'POST', '/staff/closures/preview', desk, { ...range, colour: 'red' })).toEqual({ ok: false, status: 400, code: 'bad_input' });
    await tdb.query(`insert into platform.config (key, value) values ('closure_cancel_limit', '1') on conflict (key) do update set value = excluded.value`);
    expect(await call(closures, 'POST', '/staff/closures', desk, { ...range, reason: 'x' })).toEqual({ ok: false, status: 409, code: 'too_many', params: { count: 2 } });
    expect((await tdb.query(`select count(*)::int n from public.closure`)).rows[0].n).toBe(0);
    await tdb.query(`delete from platform.config where key = 'closure_cancel_limit'`);
    expect(await call(closures, 'POST', '/staff/closures', desk, { ...range, reason: 'x' })).toMatchObject({ ok: true, body: { cancelled: 2 } });
  });
});
