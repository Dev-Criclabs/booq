import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F08-T05c / migration 0907: cancel_session, edit_session, apply_template_edit (CLASS-01-AC10, AC11, AC13; CLASS-02-AC11; D121).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const COACH2 = 'e1e1e1e1-0000-4000-8000-000000000008';
const OWNER = '44444444-4444-4444-8444-444444444444';
const DESK = '33333333-3333-4333-8333-333333333333';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '55555555-5555-4555-8555-555555555555';
let tdb: TestDatabase;
let db: Db;
let tpl: string;
let session: string;

const ctx = (user: string | null, roles: string[]) => ({ clubId: A, userId: user, roles: roles as never, source: 'admin' as const });
const owner = () => ctx(OWNER, ['owner', 'player']);
const desk = () => ctx(DESK, ['front_desk', 'player']);
const player = () => ctx(P1, ['player']);
type Out = { ok: true; res: unknown } | { ok: false; code: string };
async function call(c: ReturnType<typeof ctx>, sql: string, params: unknown[]): Promise<Out> {
  try {
    return { ok: true, res: await db.withClubTx(c, async (tx) => (await tx.query(sql, params)).rows[0]) };
  } catch (e) {
    const err = e as { code?: string; message: string };
    if (err.code === 'BK001') return { ok: false, code: err.message };
    throw e;
  }
}
const cancel = (id: string, reason = 'owner', c = owner()) => call(c, `select app.cancel_session($1, $2) as r`, [id, reason]);
const edit = (id: string, changes: Record<string, unknown>, c = owner()) => call(c, `select app.edit_session($1, $2::jsonb)`, [id, JSON.stringify(changes)]);
const hooks = async () => (await tdb.query(`select kind, usr, params, dedupe from public.__hook order by n`)).rows;
const sess = async (id = session) => (await tdb.query(`select status, cancel_reason, edited, coach_id, resource_id, name_en, max_players, to_char(start_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') as at from public.class_session where id = $1`, [id])).rows[0];
const sessionOcc = async (id = session) => (await tdb.query(`select resource_id, coach_id from public.occupancy where class_session_id = $1`, [id])).rows;

async function person(id: string, roles: string[]) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)`, [A, id, 'L' + id]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [A, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
/** A seat of the customer in the session: confirmed (paid) or held. */
async function seat(customer: string, status: 'confirmed' | 'awaiting_payment' = 'confirmed', sess_ = session) {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id;
  const s = (await tdb.query(`select start_at, end_at, resource_id from public.class_session where id = $1`, [sess_])).rows[0];
  return (await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, class_session_id, start_at, end_at, customer_id, status, source, created_by, hold_expires_at, confirmed_at)
     values ($1,$2,'class_seat',$3,$4,$5,$6,$7,$8,'online',$7, $9, $10) returning id`,
    [A, order, s.resource_id, sess_, s.start_at, s.end_at, customer, status, status === 'awaiting_payment' ? new Date(Date.now() + 600000).toISOString() : null, status === 'confirmed' ? new Date().toISOString() : null])).rows[0].id as string;
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow(new Date().toISOString());
  const now = new Date((await tdb.query(`select app.now() as n`)).rows[0].n);
  void now;
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($1,$4,$3,'2','tennis')`, [A, C1, LOC, C2]);
  await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) select $1, d, '06:00', '24:00' from generate_series(1, 7) d`, [A]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [A]);
  for (const [id, roles] of [[OWNER, ['owner', 'player']], [DESK, ['front_desk', 'player']], [P1, ['player']], [P2, ['player']], [P3, ['player']]] as const) await person(id, [...roles]);
  await tdb.seedCoach(A, COACH);
  await tdb.seedCoach(A, COACH2);
  tpl = (await tdb.query(`insert into public.class_template (club_id, name_th, name_en, audience, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by) values ($1,'ก','Group','adult',$2,$3,3,'18:00',2,4,$4) returning id`, [A, COACH, C1, OWNER])).rows[0].id;
  db = createDb({ connectionString: tdb.url, max: 6 });
  await db.withClubTx(owner(), async (tx) => tx.query(`select app.generate_sessions(app.now()::date, app.now()::date + 30)`));
  session = (await tdb.query(`select id from public.class_session where template_id = $1 order by start_at limit 1`, [tpl])).rows[0].id;
  // The hook F10 replaces, and the value return F09-T05 will provide: both recorded.
  await tdb.query(`create table public.__hook (n serial, kind text, usr uuid, params jsonb, dedupe text)`);
  await tdb.query(`grant all on public.__hook, public.__hook_n_seq to public`);
  await tdb.query(`create or replace function app.coach_message_hook(p_kind text, p_user uuid, p_params jsonb, p_dedupe_key text) returns void language plpgsql security definer as $$ begin insert into public.__hook (kind, usr, params, dedupe) values (p_kind, p_user, p_params, p_dedupe_key); end $$`);
  await tdb.query(`create table public.__returns (n serial, booking uuid, kind text)`);
  await tdb.query(`grant all on public.__returns, public.__returns_n_seq to public`);
  // F09's real function (1005) returns jsonb, so the stand-in replaces it by drop and create.
  await tdb.query(`drop function if exists app.return_booking_value(uuid, text)`);
  await tdb.query(`create function app.return_booking_value(p_booking uuid, p_kind text) returns jsonb language plpgsql security definer as $$ begin insert into public.__returns (booking, kind) values (p_booking, p_kind); return '{}'::jsonb; end $$`);
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('app.cancel_session (CLASS-01-AC11, AC13)', () => {
  it('cancels the session, frees the court and the coach, and ends nothing it should not', async () => {
    expect(await cancel(session, 'owner')).toMatchObject({ ok: true });
    expect(await sess()).toMatchObject({ status: 'cancelled', cancel_reason: 'owner' });
    expect(await sessionOcc()).toEqual([]);
    expect((await sess(((await tdb.query(`select id from public.class_session where template_id = $1 order by start_at offset 1 limit 1`, [tpl])).rows[0].id as string))).status).toBe('scheduled');
  });

  it('returns the value of every paid seat through F09 and releases the held ones; both are told', async () => {
    const paid = await seat(P1);
    const held = await seat(P2, 'awaiting_payment');
    expect(await cancel(session, 'below_minimum')).toMatchObject({ ok: true, res: { r: { seats: 2, entries: 0 } } });
    expect((await tdb.query(`select id, status from public.booking where class_session_id = $1 order by status`, [session])).rows.map((r) => r.status).sort()).toEqual(['cancelled', 'released']);
    expect((await tdb.query(`select booking, kind from public.__returns`)).rows).toEqual([{ booking: paid, kind: 'club_cancel' }]);
    const h = await hooks();
    expect(h.filter((x) => x.kind === 'cancellation_result').map((x) => x.usr).sort()).toEqual([P1, P2].sort());
    expect(h.filter((x) => x.kind === 'session_change')).toEqual([{ kind: 'session_change', usr: COACH, params: { session_id: session }, dedupe: `session_change:${session}:cancelled` }]);
    expect(h.find((x) => x.kind === 'cancellation_result' && x.usr === P1)).toMatchObject({ params: { booking_id: paid }, dedupe: `cancellation_result:${paid}` });
  });

  it('ends the session’s waiting entries (session_cancelled) and tells each one', async () => {
    const e = (await tdb.query(`insert into public.waitlist_entry (club_id, customer_id, subject_kind, class_session_id, seq) values ($1,$2,'class_session',$3,1) returning id`, [A, P3, session])).rows[0].id;
    expect(await cancel(session)).toMatchObject({ ok: true, res: { r: { entries: 1 } } });
    expect((await tdb.query(`select status, ended_reason from public.waitlist_entry where id = $1`, [e])).rows[0]).toEqual({ status: 'ended', ended_reason: 'session_cancelled' });
    expect((await hooks()).filter((x) => x.kind === 'waitlist_ended')).toEqual([{ kind: 'waitlist_ended', usr: P3, params: { entry_id: e, session_id: session }, dedupe: `waitlist_ended:${e}` }]);
  });

  it('writes one cancel record per paid seat with the kind and the session reason; a held seat has none (1013)', async () => {
    const p1 = await seat(P1);
    const p2 = await seat(P2);
    await seat(P3, 'awaiting_payment');
    expect(await cancel(session, 'below_minimum')).toMatchObject({ ok: true, res: { r: { seats: 3 } } });
    const rows = (await tdb.query(`select booking_id, kind, outcome, version, reason, by_user, credit_lost from public.booking_cancel order by booking_id`)).rows;
    expect(rows.map((r) => r.booking_id).sort()).toEqual([p1, p2].sort());
    for (const r of rows) expect(r).toMatchObject({ kind: 'club_cancel', outcome: 'returned', version: 1, reason: 'below_minimum', by_user: OWNER, credit_lost: false });
  });

  it('the closure reason records kind closure with no person (1013)', async () => {
    const paid = await seat(P1);
    const worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
    try {
      await worker.withClubTx({ clubId: A, userId: null, roles: ['guest'] as never, source: 'job' as const }, (tx) => tx.query(`select app.cancel_session($1, 'closure')`, [session]));
    } finally {
      await worker.end();
    }
    expect((await tdb.query(`select booking_id, kind, reason, by_user from public.booking_cancel`)).rows).toEqual([{ booking_id: paid, kind: 'closure', reason: 'closure', by_user: null }]);
  });

  it('the reason closure: the worker role cancels with no person and seats go back as closure; other reasons are refused to the worker (0919)', async () => {
    const paid = await seat(P1);
    const worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
    try {
      const wctx = { clubId: A, userId: null, roles: ['guest'] as never, source: 'job' as const };
      await expect(worker.withClubTx(wctx, (tx) => tx.query(`select app.cancel_session($1, 'owner')`, [session]))).rejects.toThrow(/not allowed/);
      await worker.withClubTx(wctx, (tx) => tx.query(`select app.cancel_session($1, 'closure')`, [session]));
    } finally {
      await worker.end();
    }
    expect(await sess()).toMatchObject({ status: 'cancelled', cancel_reason: 'closure' });
    expect((await tdb.query(`select cancelled_by from public.class_session where id = $1`, [session])).rows[0].cancelled_by).toBeNull();
    expect((await tdb.query(`select booking, kind from public.__returns`)).rows).toEqual([{ booking: paid, kind: 'closure' }]);
    expect(await sessionOcc()).toEqual([]);
  });

  it('staff may also cancel with the reason closure; a player may not (0919)', async () => {
    expect(await cancel(session, 'closure', desk())).toMatchObject({ ok: true });
    const next = (await tdb.query(`select id from public.class_session where template_id = $1 and status = 'scheduled' order by start_at limit 1`, [tpl])).rows[0].id;
    await expect(cancel(next, 'closure', ctx(P1, ['player']))).rejects.toThrow(/not allowed/);
  });

  it('a repeated cancel is a no-op; a started session is never changed; the reasons are checked', async () => {
    await cancel(session);
    expect(await cancel(session)).toMatchObject({ ok: true, res: { r: { repeated: true } } });
    const next = (await tdb.query(`select id, start_at from public.class_session where template_id = $1 and status = 'scheduled' order by start_at limit 1`, [tpl])).rows[0];
    await expect(call(owner(), `select app.cancel_session($1, 'because')`, [next.id])).rejects.toThrow(/invalid reason/);
    await tdb.setNow(new Date(new Date(next.start_at).getTime() + 60000));
    expect(await cancel(next.id)).toEqual({ ok: false, code: 'hour_started' });
    expect((await sess(next.id)).status).toBe('scheduled');
  });

  it('only the owner and the front desk; a player and a guest are refused', async () => {
    for (const c of [player(), ctx(null, ['guest']), ctx(COACH, ['coach', 'player'])]) {
      await expect(call(c, `select app.cancel_session($1, 'owner')`, [session])).rejects.toThrow(/not allowed/);
    }
    expect(await cancel(session, 'owner', desk())).toMatchObject({ ok: true });
  });

  it('fails closed, with nothing changed, while the value return is not installed and a paid seat exists', async () => {
    await seat(P1);
    await tdb.query(`drop function app.return_booking_value(uuid, text)`);
    await expect(cancel(session)).rejects.toThrow(/value return is not installed/);
    expect((await sess()).status).toBe('scheduled');
    expect(await sessionOcc()).toHaveLength(1);
  });

  it('a template cancel keeps past sessions: the route cancels the future ones one by one', async () => {
    const all = (await tdb.query(`select id from public.class_session where template_id = $1 and status = 'scheduled' order by start_at`, [tpl])).rows.map((r) => r.id as string);
    for (const id of all) await cancel(id, 'template');
    expect((await tdb.query(`select count(*)::int as n from public.class_session where status = 'cancelled' and cancel_reason = 'template'`)).rows[0].n).toBe(all.length);
    expect((await tdb.query(`select count(*)::int as n from public.occupancy where kind = 'group_class'`)).rows[0].n).toBe(0);
  });
});

describe('app.edit_session (CLASS-01-AC10, AC11)', () => {
  it('a session with a seat is marked edited; the seats follow the new hour and court; the holders are told', async () => {
    const b = await seat(P1);
    const at = (await sess()).at.slice(0, 10);
    expect(await edit(session, { start_at: `${at}T19:00:00+07:00`, resource_id: C2, name_en: 'Moved' })).toMatchObject({ ok: true });
    expect(await sess()).toMatchObject({ edited: true, name_en: 'Moved', resource_id: C2, at: `${at} 19:00` });
    expect(await sessionOcc()).toEqual([{ resource_id: C2, coach_id: COACH }]);
    expect((await tdb.query(`select resource_id, to_char(start_at at time zone 'Asia/Bangkok', 'HH24:MI') as at from public.booking where id = $1`, [b])).rows[0]).toEqual({ resource_id: C2, at: '19:00' });
    expect((await hooks()).filter((x) => x.kind === 'class_session_changed')).toMatchObject([{ usr: P1, params: { booking_id: b, session_id: session } }]);
  });

  it('a change of coach moves the occupancy row and tells both coaches', async () => {
    expect(await edit(session, { coach_id: COACH2 })).toMatchObject({ ok: true });
    expect(await sessionOcc()).toEqual([{ resource_id: C1, coach_id: COACH2 }]);
    expect((await hooks()).filter((x) => x.kind === 'session_change').map((x) => x.usr).sort()).toEqual([COACH, COACH2].sort());
  });

  it('refuses a clash with its code and changes nothing: a busy court, an hour outside opening hours', async () => {
    const at = (await sess()).at.slice(0, 10);
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P3])).rows[0].id;
    const bk = (await tdb.query(`insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at) values ($1,$2,'court',$3,$4::timestamptz,$4::timestamptz + interval '1 hour',$5,'confirmed','online',$5, app.now()) returning id`, [A, order, C2, `${at}T18:00:00+07:00`, P3])).rows[0].id;
    await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, booking_id) values ($1,'court_booking',$2,$3::timestamptz,$3::timestamptz + interval '1 hour','confirmed',$4)`, [A, C2, `${at}T18:00:00+07:00`, bk]);
    expect(await edit(session, { resource_id: C2 })).toEqual({ ok: false, code: 'court_clash' });
    expect(await edit(session, { start_at: `${at}T05:00:00+07:00` })).toEqual({ ok: false, code: 'outside_hours' });
    expect(await sess()).toMatchObject({ edited: false, resource_id: C1, at: `${at} 18:00` });
    expect(await sessionOcc()).toEqual([{ resource_id: C1, coach_id: COACH }]);
  });

  it('max_players cannot go below the seats taken; a bad key or value is refused; only the owner edits', async () => {
    await seat(P1); await seat(P2); await seat(P3, 'awaiting_payment');
    expect(await edit(session, { max_players: 2 })).toEqual({ ok: false, code: 'below_taken' });
    expect(await edit(session, { max_players: 3 })).toMatchObject({ ok: true });
    await expect(edit(session, { audience: 'student' })).rejects.toThrow(/invalid changes/);
    await expect(edit(session, { max_players: 'many' })).rejects.toThrow(/invalid changes/);
    await expect(edit(session, { min_players: 9 })).rejects.toThrow(/invalid changes/);
    await expect(edit(session, {})).rejects.toThrow(/invalid changes/);
    await expect(edit(session, { name_en: 'x' }, desk())).rejects.toThrow(/not allowed/);
  });

  it('a cancelled or unknown session cannot be edited', async () => {
    await cancel(session);
    expect(await edit(session, { name_en: 'x' })).toEqual({ ok: false, code: 'session_not_available' });
    expect(await edit('99999999-9999-4999-8999-999999999999', { name_en: 'x' })).toEqual({ ok: false, code: 'session_not_available' });
  });
});

describe('app.apply_template_edit (CLASS-01-AC10, D121)', () => {
  const second = async () => (await tdb.query(`select id from public.class_session where template_id = $1 order by start_at offset 1 limit 1`, [tpl])).rows[0].id as string;

  it('rewrites the future sessions that have no live seat and are not edited; a session with players keeps its details', async () => {
    const withSeat = session;
    await seat(P1);
    const edited = await second();
    await edit(edited, { name_en: 'By hand' });
    await tdb.query(`update public.class_template set name_en = 'Renamed', max_players = 5 where id = $1`, [tpl]);
    const r = await call(owner(), `select app.apply_template_edit($1) as r`, [tpl]);
    expect(r).toMatchObject({ ok: true });
    expect((await sess(withSeat)).name_en).toBe('Group');
    expect((await sess(edited)).name_en).toBe('By hand');
    const rows = (await tdb.query(`select name_en, max_players from public.class_session where template_id = $1 and id not in ($2, $3)`, [tpl, withSeat, edited])).rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((x) => x.name_en === 'Renamed' && x.max_players === 5)).toBe(true);
  });

  it('a new coach is moved onto the sessions without players; a new weekday cancels them and generates the new dates', async () => {
    await tdb.query(`update public.class_template set coach_id = $2 where id = $1`, [tpl, COACH2]);
    await call(owner(), `select app.apply_template_edit($1)`, [tpl]);
    expect((await tdb.query(`select distinct coach_id from public.occupancy where kind = 'group_class'`)).rows).toEqual([{ coach_id: COACH2 }]);
    await tdb.query(`update public.class_template set weekday = 4 where id = $1`, [tpl]);
    const r = await call(owner(), `select app.apply_template_edit($1) as r`, [tpl]);
    expect(r).toMatchObject({ ok: true });
    const live = (await tdb.query(`select extract(dow from start_at at time zone 'Asia/Bangkok')::int as d, status from public.class_session where template_id = $1`, [tpl])).rows;
    expect(live.filter((x) => x.status === 'scheduled').every((x) => x.d === 4)).toBe(true);
    expect(live.filter((x) => x.status === 'cancelled').every((x) => x.d === 3)).toBe(true);
    expect(live.filter((x) => x.status === 'scheduled').length).toBeGreaterThanOrEqual(4);
  });

  it('only the owner', async () => {
    await expect(call(desk(), `select app.apply_template_edit($1)`, [tpl])).rejects.toThrow(/not allowed/);
  });
});

describe('app.resolve_session (CLASS-01-AC9, migration 0917)', () => {
  const resolve = (id: string, c = owner()) => call(c, `select app.resolve_session($1) as r`, [id]);
  /** A session made needs_attention by an approved leave, as generation does. */
  async function flagged() {
    const s = (await tdb.query(`select id, start_at from public.class_session where template_id = $1 order by start_at offset 1 limit 1`, [tpl])).rows[0];
    const day = new Date(s.start_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const leave = (await tdb.query(`insert into public.coach_leave (club_id, coach_id, start_date, end_date, status, decided_by, decided_at) values ($1,$2,$3,$3,'approved',$4,app.now()) returning id`, [A, COACH, day, OWNER])).rows[0].id;
    await tdb.query(`delete from public.occupancy where class_session_id = $1`, [s.id]);
    await tdb.query(`update public.class_session set status = 'needs_attention', attention_reason = 'coach_leave' where id = $1`, [s.id]);
    return { id: s.id as string, leave: leave as string };
  }

  it('stays needs_attention with its reason while the cause remains, and becomes scheduled with its occupancy once it is fixed', async () => {
    const f = await flagged();
    expect(await resolve(f.id)).toMatchObject({ ok: true, res: { r: { resolved: false, reason: 'coach_leave' } } });
    expect((await sess(f.id)).status).toBe('needs_attention');
    expect(await sessionOcc(f.id)).toEqual([]);
    await tdb.query(`update public.coach_leave set status = 'declined' where id = $1`, [f.leave]);
    expect(await resolve(f.id)).toMatchObject({ ok: true, res: { r: { resolved: true, reason: null } } });
    expect(await sess(f.id)).toMatchObject({ status: 'scheduled' });
    expect(await sessionOcc(f.id)).toEqual([{ resource_id: C1, coach_id: COACH }]);
    expect(await resolve(f.id)).toMatchObject({ ok: true, res: { r: { resolved: true } } });   // a repeat is harmless
  });

  it('a court taken meanwhile gives court_clash; a cancelled or started session is refused; only the owner resolves', async () => {
    const f = await flagged();
    await tdb.query(`update public.coach_leave set status = 'declined' where id = $1`, [f.leave]);
    const s = (await tdb.query(`select resource_id, start_at, end_at from public.class_session where id = $1`, [f.id])).rows[0];
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id;
    const bk = (await tdb.query(`insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at) values ($1,$2,'court',$3,$4,$5,$6,'confirmed','online',$6, app.now()) returning id`, [A, order, s.resource_id, s.start_at, s.end_at, P1])).rows[0].id;
    await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, booking_id) values ($1,'court_booking',$2,$3,$4,'confirmed',$5)`, [A, s.resource_id, s.start_at, s.end_at, bk]);
    expect(await resolve(f.id)).toMatchObject({ ok: true, res: { r: { resolved: false, reason: 'court_clash' } } });
    await expect(resolve(f.id, desk())).rejects.toThrow(/not allowed/);
    await cancel(f.id);
    expect(await resolve(f.id)).toEqual({ ok: false, code: 'session_not_available' });
    expect(await resolve('99999999-9999-4999-8999-999999999999')).toEqual({ ok: false, code: 'session_not_available' });
  });
});
