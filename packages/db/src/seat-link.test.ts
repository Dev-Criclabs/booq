import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F08-T03 / migration 0903: booking.class_session_id, waitlist_entry_id, one live seat per player and session
// (CLASS-01-AC4, AC17, CLASS-02-AC12).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const RES = '00000000-0000-4000-8000-0000000000c1';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const OWNER = '44444444-4444-4444-8444-444444444444';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
let tdb: TestDatabase;
let session: string;
let session2: string;

async function seat(customer: string, over: Record<string, unknown> = {}, sess = session) {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id as string;
  const r: Record<string, unknown> = {
    club_id: A, order_id: order, type: 'class_seat', resource_id: RES, class_session_id: sess, start_at: '2026-12-02T18:00:00+07:00', end_at: '2026-12-02T19:00:00+07:00',
    customer_id: customer, status: 'confirmed', source: 'online', created_by: customer, confirmed_at: new Date().toISOString(), ...over,
  };
  const cols = Object.keys(r);
  return tdb.query(`insert into public.booking (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, cols.map((c) => r[c]));
}
async function person(id: string, roles: string[]) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)`, [A, id, 'L' + id.slice(0, 3)]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [A, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
const newSession = async (tpl: string, d: string) =>
  (await tdb.query(`insert into public.class_session (club_id, template_id, start_at, end_at, name_th, name_en, audience, coach_id, resource_id, min_players, max_players) values ($1,$2,$3,$4,'ก','G','adult',$5,$6,4,6) returning id`,
    [A, tpl, `2026-12-${d}T18:00:00+07:00`, `2026-12-${d}T19:00:00+07:00`, COACH, RES])).rows[0].id as string;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, RES, LOC]);
  await person(OWNER, ['owner', 'player']);
  await person(P1, ['player']);
  await person(P2, ['player']);
  await tdb.seedCoach(A, COACH);
  const tpl = (await tdb.query(`insert into public.class_template (club_id, name_th, name_en, audience, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by) values ($1,'ก','G','adult',$2,$3,3,'18:00',4,6,$4) returning id`, [A, COACH, RES, OWNER])).rows[0].id;
  session = await newSession(tpl, '02');
  session2 = await newSession(tpl, '09');
});
afterEach(async () => {
  await tdb.close();
});

describe('a seat names its session (CLASS-01-AC4)', () => {
  it('a seat with no session is refused, and a session on a court booking is refused', async () => {
    await expect(seat(P1, { class_session_id: null })).rejects.toThrow(/booking_seat_has_session/);
    await expect(seat(P1, { type: 'court' })).rejects.toThrow(/booking_seat_has_session/);
    await expect(seat(P1, { class_session_id: '99999999-9999-4999-8999-999999999999' })).rejects.toThrow(/booking_class_session_fk/);
  });

  it('a seat keeps the waitlist entry it came from (the key to the entry comes with the waitlist table)', async () => {
    const w = '88888888-8888-4888-8888-888888888888';
    expect((await seat(P1, { waitlist_entry_id: w })).rows[0].waitlist_entry_id).toBe(w);
  });

  it('existing court and solo bookings are unchanged: both new columns are null', async () => {
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id;
    const b = (await tdb.query(`insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at) values ($1,$2,'court',$3,'2026-12-05T10:00:00+07:00','2026-12-05T11:00:00+07:00',$4,'confirmed','online',$4, app.now()) returning class_session_id, waitlist_entry_id`, [A, order, RES, P1])).rows[0];
    expect(b).toEqual({ class_session_id: null, waitlist_entry_id: null });
  });
});

describe('one live seat per player and session (CLASS-02-AC12, CLASS-01-AC17)', () => {
  it('a player cannot hold two live seats in one session, held or confirmed', async () => {
    await seat(P1);
    await expect(seat(P1)).rejects.toThrow(/booking_one_live_seat/);
    await expect(seat(P1, { status: 'awaiting_payment', confirmed_at: null, hold_expires_at: new Date(Date.now() + 600000).toISOString() })).rejects.toThrow(/booking_one_live_seat/);
  });

  it('a held seat blocks a second one too', async () => {
    await seat(P1, { status: 'awaiting_payment', confirmed_at: null, hold_expires_at: new Date(Date.now() + 600000).toISOString() });
    await expect(seat(P1)).rejects.toThrow(/booking_one_live_seat/);
  });

  it('another player, another session, and a player whose seat ended may take a seat', async () => {
    const first = (await seat(P1)).rows[0].id as string;
    expect((await seat(P2)).rowCount).toBe(1);
    expect((await seat(P1, {}, session2)).rowCount).toBe(1);
    await tdb.query(`update public.booking set status = 'cancelled' where id = $1`, [first]);
    expect((await seat(P1)).rowCount).toBe(1);
  });
});
