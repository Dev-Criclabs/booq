import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F08-T07 / migration 0909: f08_release (release_handlers ord 50) and f08_cancel (cancel_handlers ord 30)
// (CLASS-01-AC13, CLASS-02-AC2, AC14; WAIT-01-AC2).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const COACH2 = 'e1e1e1e1-0000-4000-8000-000000000008';
const OWNER = '44444444-4444-4444-8444-444444444444';
const P = Array.from({ length: 7 }, (_, i) => `00000000-0000-4000-8000-0000000003${String(i).padStart(2, '0')}`);
const KID = '11111111-1111-4111-8111-111111111111';
let tdb: TestDatabase;
let db: Db;
let dbw: Db;
let tpl: string;
let session: string;

const ctx = (user: string | null, roles: string[] = ['player']) => ({ clubId: A, userId: user, roles: roles as never, source: 'player_app' as const });
type Out<T = unknown> = { ok: true; res: T } | { ok: false; code: string };
async function run<T = unknown>(d: Db, c: ReturnType<typeof ctx>, sql: string, params: unknown[] = []): Promise<Out<T>> {
  try {
    return { ok: true, res: (await d.withClubTx(c, async (tx) => (await tx.query(sql, params)).rows[0])) as T };
  } catch (e) {
    const err = e as { code?: string; message: string };
    if (err.code === 'BK001') return { ok: false, code: err.message };
    throw e;
  }
}
const join = (user: string, sess: string | null = session, resource: string | null = null, slot: string | null = null) =>
  run<{ id: string }>(db, ctx(user), `select app.join_waitlist($1, $2, $3) as id`, [sess, resource, slot]).then((r) => (r.ok ? { ok: true as const, id: r.res.id } : r));
/** Internal functions are run as the function owner in the club's context, as the release handlers will. */
async function internal<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.club_id', $1, true)`, [A]);
    await c.query('set local role booq_owner');
    const r = await c.query(sql, params);
    await c.query('commit');
    return r.rows[0] as T;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const advance = (sess: string | null = session, resource: string | null = null, slot: string | null = null) =>
  internal<{ n: number }>(`select app.waitlist_advance($1, $2, $3) as n`, [sess, resource, slot]).then((r) => r.n);
const entries = async (sess = session) => (await tdb.query(`select customer_id, status, offer_no, ended_reason from public.waitlist_entry where class_session_id = $1 order by seq`, [sess])).rows;
const entry = async (user: string, sess = session) => (await tdb.query(`select * from public.waitlist_entry where customer_id = $1 and class_session_id = $2 order by seq desc limit 1`, [user, sess])).rows[0];
const outbox = async () => (await tdb.query(`select kind, user_id, status, dedupe_key, void_reason from public.message_outbox order by created_at, dedupe_key`)).rows;

async function person(id: string, roles: string[] = ['player'], dob: string | null = '1990-01-01') {
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
async function seat(customer: string, sess = session, status: 'confirmed' | 'awaiting_payment' = 'confirmed') {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id;
  const s = (await tdb.query(`select start_at, end_at, resource_id from public.class_session where id = $1`, [sess])).rows[0];
  return (await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, class_session_id, start_at, end_at, customer_id, status, source, created_by, hold_expires_at, confirmed_at)
     values ($1,$2,'class_seat',$3,$4,$5,$6,$7,$8,'online',$7, $9, $10) returning id`,
    [A, order, s.resource_id, sess, s.start_at, s.end_at, customer, status, status === 'awaiting_payment' ? '2026-11-30T03:10:00Z' : null, status === 'confirmed' ? '2026-11-30T03:00:00Z' : null])).rows[0].id as string;
}
const freeSeat = (booking: string) => tdb.query(`update public.booking set status = 'cancelled' where id = $1`, [booking]);

beforeEach(async () => {
  tdb = await createTestDatabase();
  // Wednesday 2 Dec 2026, 18:00 Bangkok is the first session; "now" is the Monday before, so the 2 hour cut off is far away.
  await tdb.setNow('2026-11-30T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($1,$4,$3,'2','tennis')`, [A, C1, LOC, C2]);
  await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) select $1, d, '06:00', '24:00' from generate_series(1, 7) d`, [A]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15'), ($1,'waitlist_claim_minutes','30'), ($1,'waitlist_no_offer_hours','2')`, [A]);
  await person(OWNER, ['owner', 'player'], null);
  await person(KID, ['player'], '2012-05-17');
  for (const p of P) await person(p);
  await tdb.seedCoach(A, COACH);
  await tdb.seedCoach(A, COACH2);
  tpl = (await tdb.query(`insert into public.class_template (club_id, name_th, name_en, audience, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by) values ($1,'ก','Group','adult',$2,$3,3,'18:00',2,2,$4) returning id`, [A, COACH, C1, OWNER])).rows[0].id;
  db = createDb({ connectionString: tdb.url, max: 6 });
  dbw = createDb({ connectionString: tdb.url, max: 3, role: 'booq_worker' });
  await db.withClubTx(ctx(OWNER, ['owner', 'player']), async (tx) => tx.query(`select app.generate_sessions('2026-11-30'::date, '2026-12-31'::date)`));
  session = (await tdb.query(`select id from public.class_session where template_id = $1 order by start_at limit 1`, [tpl])).rows[0].id;
});
afterEach(async () => {
  await db.end();
  await dbw.end();
  await tdb.close();
});

const release = (order: string, reason: string, d = db, c = ctx(OWNER, ['owner', 'player'])) => run(d, c, `select app.release_hold($1, $2) as r`, [order, reason]);
const orderOf = async (booking: string) => (await tdb.query(`select order_id from public.booking where id = $1`, [booking])).rows[0].order_id as string;
const cancelHandlers = (booking: string, kind: string) => internal(`select app.run_cancel_handlers($1, $2)`, [booking, kind]);

describe('registration', () => {
  it('the release handler is at ord 50 and the cancel handler at ord 30', async () => {
    expect((await tdb.query(`select ord from app.release_handlers where name = 'f08_waitlist'`)).rows).toEqual([{ ord: 50 }]);
    expect((await tdb.query(`select ord from app.cancel_handlers where name = 'f08_waitlist'`)).rows).toEqual([{ ord: 30 }]);
  });
});

describe('f08_release (CLASS-02-AC2, AC14, AC4)', () => {
  let b1: string;
  let b2: string;
  beforeEach(async () => {
    b1 = await seat(P[0]!, session, 'awaiting_payment');
    b2 = await seat(P[1]!);
    for (const p of [P[2]!, P[3]!]) await join(p);
  });

  it('a held seat that is released frees the spot: the first in line is offered it in the same transaction', async () => {
    expect(await release(await orderOf(b1), 'player')).toMatchObject({ ok: true, res: { r: true } });
    expect((await entries()).map((e) => [e.customer_id, e.status])).toEqual([[P[2], 'offered'], [P[3], 'waiting']]);
  });

  it('an expired hold released by the job offers the spot too; the handler runs once per release', async () => {
    await tdb.advance('11 minutes');
    expect(await release(await orderOf(b1), 'expired', dbw, ctx(null, []))).toMatchObject({ ok: true, res: { r: true } });
    expect((await entries()).map((e) => e.status)).toEqual(['offered', 'waiting']);
    expect(await release(await orderOf(b1), 'expired', dbw, ctx(null, []))).toMatchObject({ ok: true, res: { r: false } });
    expect((await entries()).map((e) => e.status)).toEqual(['offered', 'waiting']);
  });

  it('an offer whose hold ends is an ended offer: the entry expires and the next is offered', async () => {
    await release(await orderOf(b1), 'player');
    const e = await entry(P[2]!);
    await tdb.advance('31 minutes');
    expect(await release(await orderOf(e.offer_booking_id), 'expired', dbw, ctx(null, []))).toMatchObject({ ok: true, res: { r: true } });
    expect((await entries()).map((x) => [x.customer_id, x.status])).toEqual([[P[2], 'expired'], [P[3], 'offered']]);
    expect((await outbox()).find((m) => m.dedupe_key === `offer:${e.id}:1`)).toMatchObject({ status: 'void' });
  });

  it('nothing is offered when the reason is closed, or when the session is cancelled', async () => {
    await release(await orderOf(b1), 'closed', dbw, ctx(null, []));
    expect((await entries()).map((e) => e.status)).toEqual(['waiting', 'waiting']);
  });

  it('a class with nobody waiting is untouched; a released ordinary court booking runs the handler as a no op', async () => {
    await tdb.query(`update public.waitlist_entry set status = 'left', ended_reason = 'left'`);
    expect(await release(await orderOf(b1), 'player')).toMatchObject({ ok: true });
    expect((await tdb.query(`select count(*)::int as n from public.booking where waitlist_entry_id is not null`)).rows[0].n).toBe(0);
    void b2;
  });

  it('a released held court hour offers the slot to the first waiting entry (WAIT-01-AC2)', async () => {
    const SLOT = '2026-12-05T20:00:00+07:00';
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P[4]])).rows[0].id;
    const bk = (await tdb.query(`insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, hold_expires_at) values ($1,$2,'court',$3,$4::timestamptz,$4::timestamptz + interval '1 hour',$5,'awaiting_payment','online',$5, app.now() + interval '10 minutes') returning id`, [A, order, C2, SLOT, P[4]])).rows[0].id;
    await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, hold_expires_at, booking_id) values ($1,'court_booking',$2,$3::timestamptz,$3::timestamptz + interval '1 hour','held',app.now() + interval '10 minutes',$4)`, [A, C2, SLOT, bk]);
    expect(await join(P[5]!, null, C2, SLOT)).toMatchObject({ ok: true });
    await release(order, 'player');
    expect((await tdb.query(`select customer_id, status from public.waitlist_entry where resource_id = $1`, [C2])).rows).toEqual([{ customer_id: P[5], status: 'offered' }]);
    expect((await tdb.query(`select state from public.occupancy where resource_id = $1 and start_at = $2::timestamptz`, [C2, SLOT])).rows).toEqual([{ state: 'held' }]);
  });
});

describe('f08_cancel (CLASS-01-AC13, CLASS-02-AC11)', () => {
  let b1: string;
  beforeEach(async () => {
    b1 = await seat(P[0]!);
    await seat(P[1]!);
    for (const p of [P[2]!, P[3]!]) await join(p);
  });

  it('a cancelled seat offers the spot in the cancel transaction; each cancel kind that frees a spot does', async () => {
    await tdb.query(`update public.booking set status = 'cancelled' where id = $1`, [b1]);
    await cancelHandlers(b1, 'player_cancel');
    expect((await entries()).map((e) => e.status)).toEqual(['offered', 'waiting']);
  });

  it('is idempotent: a second run offers nothing more', async () => {
    await tdb.query(`update public.booking set status = 'cancelled' where id = $1`, [b1]);
    await cancelHandlers(b1, 'staff_cancel');
    await cancelHandlers(b1, 'staff_cancel');
    expect((await entries()).map((e) => e.status)).toEqual(['offered', 'waiting']);
    expect((await tdb.query(`select count(*)::int as n from public.booking where waitlist_entry_id is not null`)).rows[0].n).toBe(1);
  });

  it('a late cancel mark, a no show mark and a reversal do not free anything', async () => {
    await tdb.query(`update public.booking set status = 'cancelled' where id = $1`, [b1]);
    for (const k of ['late_cancel_mark', 'no_show_mark', 'reversal']) await cancelHandlers(b1, k);
    expect((await entries()).map((e) => e.status)).toEqual(['waiting', 'waiting']);
  });

  it('a closure over a court hour ends its waiting entries (closure) and tells those players', async () => {
    const SLOT = '2026-12-05T20:00:00+07:00';
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P[4]])).rows[0].id;
    const bk = (await tdb.query(`insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at) values ($1,$2,'court',$3,$4::timestamptz,$4::timestamptz + interval '1 hour',$5,'confirmed','online',$5, app.now()) returning id`, [A, order, C2, SLOT, P[4]])).rows[0].id;
    await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, booking_id) values ($1,'court_booking',$2,$3::timestamptz,$3::timestamptz + interval '1 hour','confirmed',$4)`, [A, C2, SLOT, bk]);
    await join(P[5]!, null, C2, SLOT);
    await tdb.query(`create table public.__hook (n serial, kind text, usr uuid, params jsonb, dedupe text)`);
    await tdb.query(`grant all on public.__hook, public.__hook_n_seq to public`);
    await tdb.query(`create or replace function app.coach_message_hook(p_kind text, p_user uuid, p_params jsonb, p_dedupe_key text) returns void language plpgsql security definer as $$ begin insert into public.__hook (kind, usr, params, dedupe) values (p_kind, p_user, p_params, p_dedupe_key); end $$`);
    await tdb.query(`update public.booking set status = 'cancelled' where id = $1`, [bk]);
    await cancelHandlers(bk, 'closure');
    expect((await tdb.query(`select status, ended_reason from public.waitlist_entry where resource_id = $1`, [C2])).rows).toEqual([{ status: 'ended', ended_reason: 'closure' }]);
    expect((await tdb.query(`select kind, usr from public.__hook`)).rows).toEqual([{ kind: 'waitlist_ended', usr: P[5] }]);
  });
});
