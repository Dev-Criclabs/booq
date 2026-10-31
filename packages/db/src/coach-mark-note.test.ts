import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F12-T04 / migration 1204: attendance marks and session notes (CPORT-05, D118, PLAT-04).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '23232323-2323-4323-8323-232323232323';
const DESK = '33333333-3333-4333-8333-333333333333';
const C1 = '66666666-6666-4666-8666-666666666661';
const C2 = '66666666-6666-4666-8666-666666666662';
const OWNER_B = '77777777-7777-4777-8777-777777777777';
const R1 = '88888888-8888-4888-8888-888888888881';
const LOC = '99999999-9999-4999-8999-999999999999';

let tdb: TestDatabase;
let web: Db;
const ctx = (user: string, roles: string[], club = A) => ({ clubId: club, userId: user, roles, source: 'coach_portal' as const });
const coach1 = ctx(C1, ['coach', 'player']);
const session = async (kind: string, id: string, c = coach1) =>
  (await web.withClubTx(c, (tx) => tx.query('select app.coach_session($1, $2) as s', [kind, id]))).rows[0]!.s as Record<string, any>;
const mark = async (booking: string, m: string, c = coach1) =>
  (await web.withClubTx(c, (tx) => tx.query('select app.mark_attendance($1, $2) as r', [booking, m]))).rows[0]!.r as Record<string, any>;
const save = async (kind: string, id: string, customer: string | null, body: string | null, c = coach1) =>
  (await web.withClubTx(c, (tx) => tx.query('select app.save_session_note($1, $2, $3, $4) as r', [kind, id, customer, body]))).rows[0]!.r as Record<string, any>;
const audit = async (type: string) => (await tdb.query(`select action, old_value, new_value, pii_old, pii_new from public.audit_entry where record_type = $1 order by seq`, [type])).rows;
const status = async (id: string) => (await tdb.query(`select status from public.booking where id = $1`, [id])).rows[0].status as string;

async function raw<T>(fn: (c: { query: (s: string, p?: unknown[]) => Promise<{ rows: any[] }> }) => Promise<T>): Promise<T> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } finally {
    c.release();
  }
}
async function solo(coach: string, start: string, over: { customer?: string; status?: string } = {}) {
  return raw(async (c) => {
    const o = (await c.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, over.customer ?? P1])).rows[0].id as string;
    return (await c.query(
      `insert into public.booking (club_id, order_id, type, resource_id, customer_id, coach_id, start_at, end_at, status, source, created_by, confirmed_at, hold_expires_at)
       values ($1,$2,'solo_class',$3,$4,$5,$6::timestamptz,$6::timestamptz + interval '1 hour',$7,'online',$4, now(), case when $7 = 'awaiting_payment' then now() + interval '1 hour' end) returning id`,
      [A, o, R1, over.customer ?? P1, coach, start, over.status ?? 'confirmed'])).rows[0].id as string;
  });
}
async function group(coach: string, start: string, seats: Array<[string, string]>, status = 'scheduled') {
  return raw(async (c) => {
    const s = (await c.query(
      `insert into public.class_session (club_id, template_id, start_at, end_at, name_th, name_en, audience, level, coach_id, resource_id, min_players, max_players, status, cancel_reason, cancelled_at)
       values ($1, gen_random_uuid(), $2::timestamptz, $2::timestamptz + interval '1 hour', 'กลุ่ม', 'Adult clinic', 'adult', 'beginner', $3, $4, 2, 6, $5, case when $5 = 'cancelled' then 'owner' end, case when $5 = 'cancelled' then now() end) returning id`,
      [A, start, coach, R1, status])).rows[0].id as string;
    const ids: string[] = [];
    for (const [customer, st] of seats) {
      const o = (await c.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id as string;
      ids.push((await c.query(
        `insert into public.booking (club_id, order_id, type, resource_id, class_session_id, customer_id, start_at, end_at, status, source, created_by, confirmed_at, hold_expires_at)
         values ($1,$2,'class_seat',$3,$4,$5,$6::timestamptz,$6::timestamptz + interval '1 hour',$7,'online',$5, now(), case when $7 = 'awaiting_payment' then now() + interval '1 hour' end) returning id`,
        [A, o, R1, s, customer, start, st])).rows[0].id as string);
    }
    return { session: s, seats: ids };
  });
}
const note = (coach: string, over: { booking?: string | null; session?: string | null; customer?: string | null; body: string; at?: string }) =>
  raw((c) => c.query(`insert into public.coach_note (club_id, coach_id, booking_id, class_session_id, customer_id, body, updated_at) values ($1,$2,$3,$4,$5,$6,$7::timestamptz)`,
    [A, coach, over.booking ?? null, over.session ?? null, over.customer ?? null, over.body, over.at ?? '2026-12-01T00:00:00Z']));

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-10T01:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  for (const [club, u, roles, name, level] of [[A, P1, ['player'], 'Ploy Srisuk', 'beginner'], [A, P2, ['player'], 'Ann', 'new'], [A, P3, ['player'], 'Mali', 'advanced'],
    [A, DESK, ['front_desk', 'player'], 'Desk', null], [A, C1, ['coach', 'player'], 'Coach One', null], [A, C2, ['coach', 'player'], 'Coach Two', null], [B, OWNER_B, ['owner', 'player'], 'Owner B', null]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id, full_name, level, phone, phone_normalized) values ($1,$2,$3,$4,$5,$6,$7)', [club, u, 'L' + u.slice(-2), name, level, '0812345678', '66812345' + u.slice(-3)]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  await raw(async (c) => {
    await c.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main')`, [A, LOC]);
    await c.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'Court 1','tennis')`, [A, R1, LOC]);
    await c.query(`insert into public.coach (club_id, id) values ($1,$2), ($1,$3)`, [A, C1, C2]);
  });
  web = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});


// The test clock is 10 Dec 08:00 Bangkok. A class at 00:00 UTC (07:00 to 08:00) has just ended; one at 05:00 UTC is in the afternoon.
describe('who may mark (CC-2)', () => {
  it('only the delivering coach; another coach, front desk, a player, a held or cancelled booking, a court booking and another id are refused', async () => {
    const b = await solo(C1, '2026-12-10T00:00:00Z');
    const g = await group(C1, '2026-12-10T00:00:00Z', [[P1, 'confirmed']]);
    await expect(mark(b, 'present', ctx(C2, ['coach', 'player']))).rejects.toThrow(/portal:not_found/);
    await expect(mark(g.seats[0]!, 'present', ctx(C2, ['coach', 'player']))).rejects.toThrow(/portal:not_found/);
    for (const c of [ctx(DESK, ['front_desk', 'player']), ctx(P1, ['player']), ctx(OWNER_B, ['owner', 'player'], B)]) {
      await expect(mark(b, 'present', c), c.roles.join()).rejects.toThrow(/portal:forbidden/);
      await expect(save('solo', b, null, 'x', c), c.roles.join()).rejects.toThrow(/portal:forbidden/);
    }
    await expect(mark(await solo(C1, '2026-12-09T00:00:00Z', { status: 'cancelled' }), 'present')).rejects.toThrow(/portal:not_found/);
    await expect(mark(await solo(C1, '2026-12-09T02:00:00Z', { status: 'awaiting_payment' }), 'present')).rejects.toThrow(/portal:not_found/);
    await expect(mark('aaaaaaaa-0000-4000-8000-0000000000ff', 'present')).rejects.toThrow(/portal:not_found/);
    const court = await raw(async (c) => {
      const o = (await c.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id as string;
      return (await c.query(`insert into public.booking (club_id, order_id, type, resource_id, customer_id, start_at, end_at, status, source, created_by, confirmed_at)
                             values ($1,$2,'court',$3,$4,'2026-12-09T00:00:00Z','2026-12-09T01:00:00Z','confirmed','online',$4, now()) returning id`, [A, o, R1, P1])).rows[0].id as string;
    });
    await expect(mark(court, 'present')).rejects.toThrow(/portal:not_found/);
    expect(await tdb.query(`select 1 from public.coach_attendance`).then((r) => r.rowCount)).toBe(0);
  });
});

describe('attendance (CPORT-05, D118)', () => {
  it('is refused before the hour has ended, saved and audited after, repeated with the same value changes nothing, and can be changed', async () => {
    const early = await solo(C1, '2026-12-10T05:00:00Z');
    await expect(mark(early, 'present')).rejects.toThrow(/portal:not_ended/);
    const b = await solo(C1, '2026-12-10T00:00:00Z');
    await expect(mark(b, 'late')).rejects.toThrow(/portal:invalid_mark/);
    await expect(mark(b, null as never)).rejects.toThrow(/portal:invalid_mark/);
    expect(await mark(b, 'present')).toEqual({ booking_id: b, mark: 'present', changed: true });
    expect(await mark(b, 'present')).toEqual({ booking_id: b, mark: 'present', changed: false });
    expect((await audit('coach_attendance')).map((r) => r.action)).toEqual(['insert']);
    expect(await mark(b, 'absent')).toMatchObject({ mark: 'absent', changed: true });
    const a = await audit('coach_attendance');
    expect(a.map((r) => r.action)).toEqual(['insert', 'update']);
    expect([a[1].old_value.mark, a[1].new_value.mark]).toEqual(['present', 'absent']);
    expect((await session('solo', b)).roster[0].mark).toBe('absent');
    expect((await session('solo', b)).marked).toBe(1);
  });
  it('a mark is only a hint: the booking status, the forfeit and the coach payout figures are the same with Present and with Absent', async () => {
    await tdb.query(`insert into public.coach_pay (club_id, coach_id, solo_pay_kind, solo_pay_value) values ($1,$2,'fixed',30000)`, [A, C1]);
    await raw((c) => c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'owner') on conflict do nothing`, [A, DESK]));
    const b = await solo(C1, '2026-12-10T00:00:00Z');
    const figures = async () => (await tdb.query(`select app.payout_figures($1, $2, '2026-12-01') as f`, [A, C1])).rows[0].f;
    const before = await figures();
    await mark(b, 'absent');
    expect(await status(b)).toBe('confirmed');
    expect(await figures()).toEqual(before);
    await mark(b, 'present');
    expect(await figures()).toEqual(before);
    expect(before).toMatchObject({ solo_sessions: 1, solo_pay_satang: 30000, amount_satang: 30000 });
    expect((await tdb.query(`select count(*)::int as n from public.booking_cancel`)).rows[0].n).toBe(0);
  });
  it('the mark of a group seat; the roster of the coach shows it', async () => {
    const g = await group(C1, '2026-12-10T00:00:00Z', [[P1, 'confirmed'], [P2, 'confirmed']]);
    await mark(g.seats[0]!, 'present');
    await mark(g.seats[1]!, 'absent');
    expect((await session('group', g.session)).roster.map((r: Record<string, any>) => r.mark).sort()).toEqual(['absent', 'present']);
  });
  it('can be changed while the month is open and not once the coach\'s payout for that month is paid; another month stays open', async () => {
    const b = await solo(C1, '2026-12-10T00:00:00Z');
    const nov = await solo(C1, '2026-11-20T00:00:00Z');
    await mark(b, 'present');
    await raw((c) => c.query(`insert into public.coach_payout (club_id, coach_id, month, status, amount_satang, paid_by, paid_at) values ($1,$2,'2026-12-01','paid',0,$3,now())`, [A, C1, DESK]));
    await expect(mark(b, 'absent')).rejects.toThrow(/portal:month_paid/);
    await expect(mark(b, 'present')).rejects.toThrow(/portal:month_paid/);
    expect((await tdb.query(`select mark from public.coach_attendance where booking_id = $1`, [b])).rows).toEqual([{ mark: 'present' }]);
    expect((await mark(nov, 'absent')).changed).toBe(true);
  });
});

describe('private notes (CPORT-05)', () => {
  it('can be written once the session has started, not before', async () => {
    const future = await solo(C1, '2026-12-10T06:00:00Z');
    await expect(save('solo', future, null, 'too early')).rejects.toThrow(/portal:not_started/);
    const started = await solo(C1, '2026-12-10T01:00:00Z');
    expect(await save('solo', started, null, 'on time')).toEqual({ saved: true });
  });
  it('a session note and a player note are saved, replaced in place with the old text kept in the audit pii columns, and deleted by a blank body', async () => {
    const b = await solo(C1, '2026-12-10T00:00:00Z');
    await save('solo', b, null, '  Rally drills from the baseline  ');
    await save('solo', b, P1, 'work on the split step');
    let s = await session('solo', b);
    expect([s.session_note, s.roster[0].note]).toEqual(['Rally drills from the baseline', 'work on the split step']);
    await save('solo', b, P1, 'better split step now');
    await save('solo', b, P1, 'better split step now');              // the same text again changes nothing
    expect((await tdb.query(`select count(*)::int as n from public.coach_note`)).rows[0].n).toBe(2);
    const a = (await audit('coach_note')).filter((r) => r.action === 'update');
    expect(a).toHaveLength(1);
    expect([a[0].pii_old.body, a[0].pii_new.body]).toEqual(['work on the split step', 'better split step now']);
    expect(JSON.stringify(a.map((r) => [r.old_value, r.new_value]))).not.toContain('split');   // the text is in the pii columns only
    expect(await save('solo', b, null, '   ')).toEqual({ deleted: true });
    expect(await save('solo', b, null, null)).toEqual({ deleted: false });
    s = await session('solo', b);
    expect([s.session_note, s.roster[0].note]).toEqual([null, 'better split step now']);
  });
  it('a group session: a note on a player with a confirmed place, never on one without; the length limit; a bad kind', async () => {
    const g = await group(C1, '2026-12-10T00:00:00Z', [[P1, 'confirmed'], [P2, 'cancelled'], [P3, 'awaiting_payment']]);
    expect(await save('group', g.session, P1, 'good backhand')).toEqual({ saved: true });
    for (const who of [P2, P3, DESK]) await expect(save('group', g.session, who, 'x'), who).rejects.toThrow(/portal:invalid_customer/);
    await expect(save('solo', await solo(C1, '2026-12-10T00:00:00Z', { customer: P1 }), P2, 'x')).rejects.toThrow(/portal:invalid_customer/);
    await expect(save('group', g.session, P1, 'x'.repeat(2001))).rejects.toThrow(/portal:body_too_long/);
    expect(await save('group', g.session, P1, 'x'.repeat(2000))).toEqual({ saved: true });
    await expect(save('other', g.session, null, 'x')).rejects.toThrow(/portal:invalid_kind/);
    expect((await session('group', g.session)).roster[0].note).toBe('x'.repeat(2000));
  });
  it('only the session\'s own coach writes; another coach\'s call changes nothing and another coach\'s own note on the same player is theirs alone', async () => {
    const b = await solo(C1, '2026-12-10T00:00:00Z');
    await expect(save('solo', b, null, 'x', ctx(C2, ['coach', 'player']))).rejects.toThrow(/portal:not_found/);
    await save('solo', b, P1, 'mine');
    expect((await tdb.query(`select coach_id, body from public.coach_note`)).rows).toEqual([{ coach_id: C1, body: 'mine' }]);
    const b2 = await solo(C2, '2026-12-10T00:00:00Z', { customer: P1 });
    await save('solo', b2, P1, 'theirs', ctx(C2, ['coach', 'player']));
    expect((await session('solo', b)).roster[0].note).toBe('mine');
  });
});
