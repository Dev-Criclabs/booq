import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { playerCancelRoutes } from './cancel';

// F09-T12 player cancel routes (CANCEL-01-AC1 to AC12, AC14; F09 design 5): GET /me/bookings/:id/cancel-preview answers
// app.cancel_outcome for the C13b sheet; POST /me/bookings/:id/cancel runs app.cancel_booking as the player. Own bookings
// only (another player's is 404), the client sends no outcome, and a repeat with the Idempotency-Key gets the same answer.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURT = 'c1c1c1c1-0000-4000-8000-000000000001';
const P1 = '00000000-0000-4000-8000-000000000001';
const P2 = '00000000-0000-4000-8000-000000000002';
const OWNER = '00000000-0000-4000-8000-000000000003';
const deps = { hasFeature: async () => true };
const SLUGS: Record<string, string> = { 'club-a': A, 'club-b': B };
const H = (h: number) => new Date(Date.parse('2026-12-03T00:00:00+07:00') + h * 3_600_000).toISOString();

let tdb: TestDatabase;
let db: Db;
let routes: ReturnType<typeof playerCancelRoutes>;
const preview = () => routes.find((r) => r.def.path === '/me/bookings/:id/cancel-preview')!;
const cancel = () => routes.find((r) => r.def.path === '/me/bookings/:id/cancel')!;
const me = (userId = P1) => ({ clubId: A, userId, roles: ['player' as const] });

async function booking(hour = 18, confirm = true) {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id as string;
  const r = await db.withClubTx({ clubId: A, userId: P1, roles: ['player'], requestId: 'r', source: 'player_app' }, (tx) =>
    tx.query<{ r: { booking_ids: string[] } }>(`select app.reserve_court($1, $2, $3::timestamptz[]) as r`, [order, COURT, [H(hour)]]));
  if (confirm) await db.withClubTx({ clubId: A, userId: OWNER, roles: ['owner', 'player'], requestId: 'r', source: 'admin' }, (tx) => tx.query(`select app.confirm_booking($1)`, [order]));
  return r.rows[0]!.r.booking_ids[0]!;
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  for (const [id, roles] of [[P1, ['player']], [P2, ['player']], [OWNER, ['owner', 'player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [A, id, 'L' + id]);
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
  routes = playerCancelRoutes({ db, clubBySlug: async (slug) => (SLUGS[slug] ? { clubId: SLUGS[slug]! } : null) });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('player cancel routes (F09-T12)', () => {
  it('declares the preview (booking.read.own) and the cancel (a signed in person); a guest is refused', async () => {
    expect(routes.map((r) => `${r.def.method} ${r.def.path}`)).toEqual(['GET /me/bookings/:id/cancel-preview', 'POST /me/bookings/:id/cancel']);
    expect(preview().def.permission).toBe('booking.read.own');
    expect(cancel().def.needsPerson).toBe(true);
    const id = await booking();
    expect(await preview().handle({ session: null, input: { id } }, deps)).toEqual({ ok: false, status: 401, code: 'unauthenticated' });
    expect(await cancel().handle({ session: null, input: { id } }, deps)).toEqual({ ok: false, status: 401, code: 'sign_in_required' });
  });

  it('the preview states the outcome with the window, and the cancel gives the same outcome (AC1, AC2)', async () => {
    const id = await booking(18);
    const p = await preview().handle({ session: me(), input: { slug: 'club-a', id } }, deps);
    expect(p).toMatchObject({ ok: true, body: { bookingId: id, outcome: 'in_time', windowHours: 12 } });
    const c = await cancel().handle({ session: me(), input: { slug: 'club-a', id } }, deps);
    expect(c).toMatchObject({ ok: true, status: 200, body: { bookingId: id, outcome: 'in_time', repeated: false } });
    expect((await tdb.query(`select status from public.booking where id = $1`, [id])).rows[0].status).toBe('cancelled');
  });

  it('late inside the window: forfeited (AC10); the answer carries no staff reason (CC-3)', async () => {
    const id = await booking(18);
    await tdb.setNow(new Date(Date.parse(H(18)) - 2 * 3_600_000).toISOString());
    expect(await preview().handle({ session: me(), input: { id } }, deps)).toMatchObject({ ok: true, body: { outcome: 'late' } });
    const c = await cancel().handle({ session: me(), input: { id } }, deps);
    expect(c).toMatchObject({ ok: true, body: { outcome: 'late' } });
    expect(JSON.stringify(c)).not.toMatch(/reason/);
    expect((await tdb.query(`select status from public.booking where id = $1`, [id])).rows[0].status).toBe('late_cancelled');
  });

  it("another player's booking, another club's slug and a malformed id are 404 (ROLE-01-AC4)", async () => {
    const id = await booking();
    for (const r of [preview(), cancel()]) {
      expect(await r.handle({ session: me(P2), input: { id } }, deps)).toEqual({ ok: false, status: 404, code: 'not_found' });
      expect(await r.handle({ session: me(), input: { slug: 'club-b', id } }, deps)).toEqual({ ok: false, status: 404, code: 'not_found' });
      expect(await r.handle({ session: me(), input: { id: 'nope' } }, deps)).toEqual({ ok: false, status: 404, code: 'not_found' });
    }
    expect((await tdb.query(`select status from public.booking where id = $1`, [id])).rows[0].status).toBe('confirmed');
  });

  it('the client cannot send an outcome or any other field: bad_input, nothing cancelled', async () => {
    const id = await booking();
    for (const extra of [{ outcome: 'in_time' }, { clubCancel: true }, { reason: 'x' }]) {
      expect(await cancel().handle({ session: me(), input: { id, ...extra } }, deps)).toEqual({ ok: false, status: 400, code: 'bad_input' });
    }
    expect((await tdb.query(`select status from public.booking where id = $1`, [id])).rows[0].status).toBe('confirmed');
  });

  it('a repeat with the Idempotency-Key returns the same result; a second tap without one is the same cancel (AC14)', async () => {
    const id = await booking();
    const first = await cancel().handle({ session: me(), input: { id, idempotencyKey: 'c-1' } }, deps);
    expect(await cancel().handle({ session: me(), input: { id, idempotencyKey: 'c-1' } }, deps)).toEqual(first);
    expect(await cancel().handle({ session: me(), input: { id } }, deps)).toMatchObject({ ok: true, body: { bookingId: id, repeated: true } });
    expect(Number((await tdb.query(`select count(*) from public.booking_cancel where booking_id = $1`, [id])).rows[0].count)).toBe(1);
    expect(await cancel().handle({ session: me(), input: { id, idempotencyKey: 'bad key' } }, deps)).toEqual({ ok: false, status: 400, code: 'bad_input' });
  });

  it('a hold, a started booking and an unset window answer typed codes (AC15, AC16)', async () => {
    const held = await booking(19, false);
    expect(await cancel().handle({ session: me(), input: { id: held } }, deps)).toEqual({ ok: false, status: 409, code: 'hold' });
    const id = await booking(18);
    await tdb.setNow(new Date(Date.parse(H(18)) + 60_000).toISOString());
    expect(await preview().handle({ session: me(), input: { id } }, deps)).toEqual({ ok: false, status: 409, code: 'started' });
    expect(await cancel().handle({ session: me(), input: { id } }, deps)).toEqual({ ok: false, status: 409, code: 'started' });
    await tdb.setNow('2026-12-01T03:00:00Z');
    await tdb.query(`delete from public.club_setting where club_id = $1 and key = 'cancel_window_hours'`, [A]);
    expect(await preview().handle({ session: me(), input: { id } }, deps)).toEqual({ ok: false, status: 409, code: 'window_unset' });
  });

  it('a Paused club still lets the player cancel (AC21, D118)', async () => {
    const id = await booking();
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    expect(await cancel().handle({ session: me(), input: { id } }, deps)).toMatchObject({ ok: true, body: { outcome: 'in_time' } });
  });
});
