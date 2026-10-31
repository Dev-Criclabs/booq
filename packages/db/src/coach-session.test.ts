import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F12-T03 / migration 1203: K5 Session detail (CPORT-05; CC-1, CC-2, CC-3).
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

describe('who may open a session (CC-2)', () => {
  it('only the session\'s own coach: another coach, front desk, a player and another club are refused or told not found', async () => {
    const b = await solo(C1, '2026-12-10T05:00:00Z');
    const g = await group(C1, '2026-12-10T06:00:00Z', [[P1, 'confirmed']]);
    await expect(session('solo', b, ctx(C2, ['coach', 'player']))).rejects.toThrow(/portal:not_found/);
    await expect(session('group', g.session, ctx(C2, ['coach', 'player']))).rejects.toThrow(/portal:not_found/);
    for (const c of [ctx(DESK, ['front_desk', 'player']), ctx(P1, ['player']), ctx(OWNER_B, ['owner', 'player'], B)]) {
      await expect(session('solo', b, c), c.roles.join()).rejects.toThrow(/portal:forbidden/);
    }
    await expect(session('solo', g.session)).rejects.toThrow(/portal:not_found/);       // the wrong kind for the id
    await expect(session('group', b)).rejects.toThrow(/portal:not_found/);
    await expect(session('solo', 'aaaaaaaa-0000-4000-8000-0000000000ff')).rejects.toThrow(/portal:not_found/);
    await expect(session('other', b)).rejects.toThrow(/portal:invalid_kind/);
  });
  it('a cancelled or released class is not found; a substituted class opens for the substitute only', async () => {
    const cancelled = await solo(C1, '2026-12-10T05:00:00Z', { status: 'cancelled' });
    await expect(session('solo', cancelled)).rejects.toThrow(/portal:not_found/);
    const gc = await group(C1, '2026-12-10T06:00:00Z', [[P1, 'confirmed']], 'cancelled');
    await expect(session('group', gc.session)).rejects.toThrow(/portal:not_found/);
    const b = await solo(C1, '2026-12-10T07:00:00Z');
    await raw((c) => c.query(`update public.booking set coach_id = $2 where id = $1`, [b, C2]));
    await expect(session('solo', b)).rejects.toThrow(/portal:not_found/);
    expect((await session('solo', b, ctx(C2, ['coach', 'player']))).id).toBe(b);
  });
});

describe('what the coach sees', () => {
  it('a solo class: the header, the one player by the name they gave and their level, nothing else about them', async () => {
    const b = await solo(C1, '2026-12-10T05:00:00Z');
    const s = await session('solo', b);
    expect(s).toMatchObject({ kind: 'solo', id: b, court: 'Court 1', status: 'confirmed', held: false, players: 1, listed: 1, marked: 0, session_note: null });
    expect(s.roster).toEqual([{ booking_id: b, customer_id: P1, name: 'Ploy Srisuk', level: 'beginner', mark: null, note: null, last_note: null }]);
    expect(JSON.stringify(s)).not.toMatch(/0812345678|66812345|date_of_birth/);
  });
  it('a group session: confirmed players listed by name, a held seat counted but not listed, the capacity and the marks', async () => {
    const g = await group(C1, '2026-12-10T06:00:00Z', [[P2, 'confirmed'], [P1, 'confirmed'], [P3, 'awaiting_payment'], [P3, 'cancelled']]);
    await raw((c) => c.query(`insert into public.coach_attendance (club_id, booking_id, coach_id, mark) values ($1,$2,$3,'present')`, [A, g.seats[1], C1]));
    const s = await session('group', g.session);
    expect(s).toMatchObject({ kind: 'group', class_name_en: 'Adult clinic', class_name_th: 'กลุ่ม', level: 'beginner', court: 'Court 1', players: 3, capacity: 6, listed: 2, marked: 1 });
    expect(s.roster.map((r: Record<string, any>) => [r.name, r.level, r.mark])).toEqual([['Ann', 'new', null], ['Ploy Srisuk', 'beginner', 'present']]);
    expect(Object.keys(s.roster[0]).sort()).toEqual(['booking_id', 'customer_id', 'last_note', 'level', 'mark', 'name', 'note']);
  });
  it('the coach\'s notes: this session\'s note on the player and on the session, and the last earlier note on that player; never another coach\'s', async () => {
    const earlier = await solo(C1, '2026-12-01T05:00:00Z');
    const b = await solo(C1, '2026-12-10T05:00:00Z');
    await note(C1, { booking: earlier, customer: P1, body: 'old note', at: '2026-12-01T06:00:00Z' });
    const oldest = await solo(C1, '2026-11-20T05:00:00Z');
    await note(C1, { booking: oldest, customer: P1, body: 'older still', at: '2026-11-20T06:00:00Z' });
    await note(C2, { booking: earlier, customer: P1, body: 'another coach\'s note', at: '2026-12-05T06:00:00Z' });
    await note(C1, { booking: b, customer: P1, body: 'this session, about the player' });
    await note(C1, { booking: b, customer: null, body: 'this session, general' });
    const s = await session('solo', b);
    expect(s.session_note).toBe('this session, general');
    expect(s.roster[0]).toMatchObject({ note: 'this session, about the player', last_note: { body: 'old note' } });
    expect(JSON.stringify(s)).not.toContain('another coach');
    expect((await session('solo', await solo(C2, '2026-12-10T08:00:00Z', { customer: P1 }), ctx(C2, ['coach', 'player']))).roster[0].last_note.body).toBe("another coach's note");
  });
  it('a held solo class has no player to mark yet', async () => {
    const b = await solo(C1, '2026-12-10T05:00:00Z', { status: 'awaiting_payment' });
    expect(await session('solo', b)).toMatchObject({ held: true, listed: 0, roster: [] });
  });
});

describe('can_mark (CPORT-05, D118)', () => {
  it('not_ended before the hour has ended, ok after, month_paid once the month of that coach is paid', async () => {
    const b = await solo(C1, '2026-12-10T00:00:00Z');                       // 07:00 to 08:00, now is 08:00 exactly
    await tdb.setNow('2026-12-10T00:30:00Z');
    expect((await session('solo', b)).can_mark).toBe('not_ended');
    await tdb.setNow('2026-12-10T01:00:00Z');
    expect((await session('solo', b)).can_mark).toBe('ok');
    await raw((c) => c.query(`insert into public.coach_payout (club_id, coach_id, month, status, amount_satang, paid_by, paid_at) values ($1,$2,'2026-12-01','paid',0,$3,now())`, [A, C1, DESK]));
    expect((await session('solo', b)).can_mark).toBe('month_paid');
    const other = await solo(C1, '2026-11-20T00:00:00Z');
    expect((await session('solo', other)).can_mark).toBe('ok');             // a different month is still open
  });
  it('a payout of another coach does not close this coach\'s month', async () => {
    const b = await solo(C1, '2026-12-10T00:00:00Z');
    await raw((c) => c.query(`insert into public.coach_payout (club_id, coach_id, month, status, amount_satang, paid_by, paid_at) values ($1,$2,'2026-12-01','paid',0,$3,now())`, [A, C2, DESK]));
    expect((await session('solo', b)).can_mark).toBe('ok');
  });
});
