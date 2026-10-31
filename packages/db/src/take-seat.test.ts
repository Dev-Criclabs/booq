import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F08-T05b / migration 0906: app.take_seat (CLASS-01-AC4, AC14, AC17; CC-4; D47).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const OWNER = '44444444-4444-4444-8444-444444444444';
const DESK = '33333333-3333-4333-8333-333333333333';
const KID = '11111111-1111-4111-8111-111111111111';
const players = Array.from({ length: 8 }, (_, i) => `00000000-0000-4000-8000-0000000002${String(i).padStart(2, '0')}`);
let tdb: TestDatabase;
let db: Db;
let session: string;
let studentSession: string;

const ctx = (user: string | null, roles: string[]) => ({ clubId: A, userId: user, roles: roles as never, source: 'player_app' as const });
type Out = { ok: true; res: { booking_ids: string[]; hold_expires_at: string | null; reused?: boolean } } | { ok: false; code: string };
async function take(user: string, order: string, sess = session, roles = ['player']): Promise<Out> {
  try {
    const res = await db.withClubTx(ctx(user, roles), async (tx) => (await tx.query(`select app.take_seat($1, $2) as r`, [order, sess])).rows[0]!.r);
    return { ok: true, res };
  } catch (e) {
    const err = e as { code?: string; message: string };
    if (err.code === 'BK001') return { ok: false, code: err.message };
    throw e;
  }
}
/** A priced order of the customer: money due, or nothing due. */
async function order(customer: string, money = 30000, source = 'online') {
  const id = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,$3) returning id`, [A, customer, source])).rows[0].id as string;
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    await c.query(`update public.orders set price_group_snapshot='{}', subtotal_satang=30000, discount_satang=0, total_satang=30000, credit_value_satang=$2, wallet_satang=0, money_satang=$3, quote_hash=repeat('a',64), priced_at=now() where id=$1`, [id, 30000 - money, money]);
    await c.query('commit');
  } finally {
    c.release();
  }
  return id;
}
const seats = async () => (await tdb.query(`select customer_id, status, type, coach_id, resource_id from public.booking where class_session_id = $1 order by created_at`, [session])).rows;

async function person(id: string, roles: string[], dob: string | null) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, date_of_birth) values ($1,$2,$3,$4)`, [A, id, 'L' + id, dob]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [A, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, C1, LOC]);
  await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) select $1, d, '06:00', '24:00' from generate_series(1, 7) d`, [A]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [A]);
  await person(OWNER, ['owner', 'player'], null);
  await person(DESK, ['front_desk', 'player'], null);
  await person(KID, ['player'], '2012-05-17');
  for (const p of players) await person(p, ['player'], '1990-01-01');
  await tdb.seedCoach(A, COACH);
  const t = (await tdb.query(`insert into public.class_template (club_id, name_th, name_en, audience, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by) values ($1,'ก','G','adult',$2,$3,3,'18:00',2,3,$4) returning id`, [A, COACH, C1, OWNER])).rows[0].id;
  const st = (await tdb.query(`insert into public.class_template (club_id, name_th, name_en, audience, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by) values ($1,'ก','J','student',$2,$3,4,'16:00',2,3,$4) returning id`, [A, COACH, C1, OWNER])).rows[0].id;
  await db_generate();
  session = (await tdb.query(`select id from public.class_session where template_id = $1 order by start_at limit 1`, [t])).rows[0].id;
  studentSession = (await tdb.query(`select id from public.class_session where template_id = $1 order by start_at limit 1`, [st])).rows[0].id;
});
async function db_generate() {
  db = createDb({ connectionString: tdb.url, max: 12 });
  await db.withClubTx(ctx(OWNER, ['owner', 'player']), async (tx) => tx.query(`select app.generate_sessions('2026-12-01'::date, '2026-12-31'::date)`));
}
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('taking a seat (CLASS-01-AC4)', () => {
  it('holds a seat for the payment window: a class_seat booking on the session’s court, no coach, no occupancy row of its own', async () => {
    const occBefore = (await tdb.query(`select count(*)::int as n from public.occupancy`)).rows[0].n;
    const r = await take(players[0]!, await order(players[0]!));
    expect(r).toMatchObject({ ok: true });
    expect(await seats()).toEqual([{ customer_id: players[0], status: 'awaiting_payment', type: 'class_seat', coach_id: null, resource_id: C1 }]);
    expect(new Date((r as { res: { hold_expires_at: string } }).res.hold_expires_at).toISOString()).toBe('2026-12-01T03:15:00.000Z');
    expect((await tdb.query(`select count(*)::int as n from public.occupancy`)).rows[0].n).toBe(occBefore);   // the session already holds court and coach
  });

  it('an order with nothing to pay gets a confirmed seat at once', async () => {
    expect(await take(players[0]!, await order(players[0]!, 0))).toMatchObject({ ok: true, res: { hold_expires_at: null } });
    expect((await seats())[0]).toMatchObject({ status: 'confirmed' });
  });

  it('the last seat: two takers in parallel give one success and one session_full (CC-4)', async () => {
    await take(players[0]!, await order(players[0]!));
    await take(players[1]!, await order(players[1]!));
    const o2 = await order(players[2]!);
    const o3 = await order(players[3]!);
    const [a, b] = await Promise.all([take(players[2]!, o2), take(players[3]!, o3)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((x) => !x.ok)).toEqual({ ok: false, code: 'session_full' });
    expect(await seats()).toHaveLength(3);
  });

  it('eight parallel takers of three seats: exactly three succeed', async () => {
    const orders = await Promise.all(players.map((p) => order(p)));
    const out = await Promise.all(players.map((p, i) => take(p, orders[i]!)));
    expect(out.filter((x) => x.ok)).toHaveLength(3);
    expect(out.filter((x) => !x.ok).every((x) => !x.ok && x.code === 'session_full')).toBe(true);
    expect(await seats()).toHaveLength(3);
  });

  it('a held seat counts toward capacity and an expired hold does not', async () => {
    for (const p of players.slice(0, 3)) await take(p, await order(p));
    expect(await take(players[3]!, await order(players[3]!))).toEqual({ ok: false, code: 'session_full' });
    await tdb.advance('16 minutes');                                         // the three holds ended
    expect(await take(players[3]!, await order(players[3]!))).toMatchObject({ ok: true });
  });

  it('one live seat per player and session: a second tap returns the held seat and its first hold; a second order is already_seated', async () => {
    const o = await order(players[0]!);
    const first = await take(players[0]!, o);
    await tdb.advance('3 minutes');
    const again = await take(players[0]!, o);
    expect(again).toMatchObject({ ok: true, res: { reused: true } });
    expect((again as { res: { booking_ids: string[]; hold_expires_at: string } }).res.booking_ids).toEqual((first as { res: { booking_ids: string[] } }).res.booking_ids);
    expect((again as { res: { hold_expires_at: string } }).res.hold_expires_at).toEqual((first as { res: { hold_expires_at: string } }).res.hold_expires_at);
    // A confirmed seat cannot be taken again.
    await tdb.query(`update public.booking set status = 'confirmed', confirmed_at = app.now(), hold_expires_at = null where class_session_id = $1`, [session]);
    expect(await take(players[0]!, await order(players[0]!))).toEqual({ ok: false, code: 'already_seated' });
  });

  it('a player whose own hold ended may take the seat again: the expired hold is released first', async () => {
    await take(players[0]!, await order(players[0]!));
    await tdb.advance('16 minutes');
    expect(await take(players[0]!, await order(players[0]!))).toMatchObject({ ok: true });
    expect((await tdb.query(`select status from public.booking where class_session_id = $1 order by created_at`, [session])).rows.map((r) => r.status)).toEqual(['released', 'awaiting_payment']);
  });
});

describe('who may take a seat, and which class (CLASS-01-AC5, CC-2)', () => {
  it('a class outside the player’s audience is refused, not only hidden', async () => {
    expect(await take(players[0]!, await order(players[0]!), studentSession)).toEqual({ ok: false, code: 'class_not_for_you' });
    expect(await take(KID, await order(KID), session)).toEqual({ ok: false, code: 'class_not_for_you' });
    expect(await take(KID, await order(KID), studentSession)).toMatchObject({ ok: true });
  });

  it('staff take a seat for a customer’s order; another player’s order and a guest are refused', async () => {
    const o = await order(players[0]!, 30000, 'staff');
    expect(await take(DESK, o, session, ['front_desk', 'player'])).toMatchObject({ ok: true });
    expect((await seats())[0]).toMatchObject({ customer_id: players[0] });
    expect(await take(players[1]!, await order(players[2]!))).toEqual({ ok: false, code: 'order_not_found' });
    expect(await take(players[1]!, await order(players[1]!), session, ['guest'])).toEqual({ ok: false, code: 'sign_in_required' });
  });

  it('refuses a class that has started, a cancelled or needs-attention session, another club’s or an unknown session, and a Paused club', async () => {
    const o = await order(players[0]!);
    await tdb.query(`update public.class_session set status = 'needs_attention', attention_reason = 'court_clash' where id = $1`, [session]);
    expect(await take(players[0]!, o)).toEqual({ ok: false, code: 'session_not_available' });
    await tdb.query(`update public.class_session set status = 'scheduled', attention_reason = null where id = $1`, [session]);
    expect(await take(players[0]!, o, '99999999-9999-4999-8999-999999999999')).toEqual({ ok: false, code: 'session_not_available' });
    await tdb.setNow('2026-12-02T11:00:01Z');                                // 18:00 Bangkok on the day, 1 second after the start
    expect(await take(players[0]!, o)).toEqual({ ok: false, code: 'hour_started' });
    await tdb.setNow('2026-12-01T03:00:00Z');
    await tdb.query(`update public.club set status = 'paused'`);
    expect(await take(players[0]!, o)).toEqual({ ok: false, code: 'club_paused' });
  });

  it('with no hold time setting, a seat that needs payment is refused; one that does not is not', async () => {
    await tdb.query(`delete from public.club_setting where key = 'hold_minutes'`);
    expect(await take(players[0]!, await order(players[0]!))).toEqual({ ok: false, code: 'hold_setting_unset' });
    expect(await take(players[0]!, await order(players[0]!, 0))).toMatchObject({ ok: true });
  });

  it('a seat is not counted in the future court hours (D59)', async () => {
    await take(players[0]!, await order(players[0]!));
    const n = await db.withClubTx(ctx(players[0]!, ['player']), async (tx) => (await tx.query(`select app.future_hours($1) as n`, [players[0]])).rows[0]!.n);
    expect(n).toBe(0);
  });
});

describe('the Pay tap limit (D61, migration 0913)', () => {
  const nextSession = async (n = 1) => (await tdb.query(`select id from public.class_session where template_id = (select template_id from public.class_session where id = $1) order by start_at offset $2 limit 1`, [session, n])).rows[0].id as string;

  it('counts one tap per seat attempt in the counter shared with reserve_court; the third tap in the window is refused with the wait', async () => {
    await tdb.query(`insert into platform.config (key, value) values ('pay_tap_limit_count', '2'), ('pay_tap_limit_window_seconds', '60') on conflict (key) do update set value = excluded.value`);
    const second = await nextSession();
    const third = await nextSession(2);
    expect(await take(players[0]!, await order(players[0]!))).toMatchObject({ ok: true });
    expect(await take(players[0]!, await order(players[0]!), second)).toMatchObject({ ok: true });
    const r = await db.withClubTx(ctx(players[0]!, ['player']), async (tx) => tx.query(`select app.take_seat($1, $2)`, [await order(players[0]!), third]).then(() => 'ok', (e: { code?: string; message: string; detail?: string }) => [e.code, e.message, e.detail]));
    expect(r[0]).toBe('BK001');
    expect(r[1]).toBe('too_many_attempts');
    expect(Number(r[2])).toBeGreaterThanOrEqual(1);
  });

  it('a second tap that only returns the held seat is not counted, and a refused tap leaves no count behind', async () => {
    await tdb.query(`insert into platform.config (key, value) values ('pay_tap_limit_count', '2'), ('pay_tap_limit_window_seconds', '60') on conflict (key) do update set value = excluded.value`);
    const o = await order(players[0]!);
    await take(players[0]!, o);
    for (let i = 0; i < 4; i += 1) expect(await take(players[0]!, o)).toMatchObject({ ok: true, res: { reused: true } });
    expect((await tdb.query(`select count(*)::int as n from public.pay_tap where user_id = $1`, [players[0]])).rows[0].n).toBe(1);
    expect(await take(players[0]!, await order(players[0]!), studentSession)).toEqual({ ok: false, code: 'class_not_for_you' });
    expect((await tdb.query(`select count(*)::int as n from public.pay_tap where user_id = $1`, [players[0]])).rows[0].n).toBe(1);
  });

  it('with the limit unset nothing is refused', async () => {
    for (let i = 0; i < 3; i += 1) {
      const p = players[i]!;
      expect(await take(p, await order(p))).toMatchObject({ ok: true });
    }
  });
});
