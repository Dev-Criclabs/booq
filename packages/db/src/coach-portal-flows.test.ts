import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F12-T07: CPORT-03 (availability and the rest cap) and CPORT-04 (leave, the coach's message, the flagged sessions), through the F07 functions.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const P1 = '11111111-1111-4111-8111-111111111111';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const C1 = '66666666-6666-4666-8666-666666666661';
const R1 = '88888888-8888-4888-8888-888888888881';
const LOC = '99999999-9999-4999-8999-999999999999';

let tdb: TestDatabase;
let web: Db;
const ctx = (user: string, roles: string[]) => ({ clubId: A, userId: user, roles, source: 'coach_portal' as const });
const coach = ctx(C1, ['coach', 'player']);
const owner = ctx(OWNER, ['owner', 'player']);
const rows = async (c: ReturnType<typeof ctx>, sql: string, args: unknown[] = []) => (await web.withClubTx(c, (tx) => tx.query(sql, args))).rows as Array<Record<string, any>>;
/** A Wednesday: 2026-12-16. Hour h in Bangkok. */
const H = (h: number) => new Date(`2026-12-16T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();
/** coach_check is internal (no app grant): it runs as the table owner in the club's context, the way the booking functions call it. */
const check = async (starts: string[]) => {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.club_id', $1, true)`, [A]);
    await c.query('set local role booq_owner');
    const r = (await c.query('select app.coach_check($1, $2, $3::timestamptz[]) as r', [A, C1, starts])).rows[0].r as string | null;
    await c.query('commit');
    return r;
  } finally {
    c.release();
  }
};

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  for (const [u, roles, name] of [[P1, ['player'], 'P'], [DESK, ['front_desk', 'player'], 'Desk'], [OWNER, ['owner', 'player'], 'Owner'], [C1, ['coach', 'player'], 'Coach']] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id, full_name) values ($1,$2,$3,$4)', [A, u, 'L' + u.slice(-2), name]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [A, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'Court 1','tennis')`, [A, R1, LOC]);
  await tdb.query(`insert into public.coach (club_id, id) values ($1,$2)`, [A, C1]);
  web = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});

async function booked(h: number) {
  const o = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id as string;
  const b = (await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, customer_id, coach_id, start_at, end_at, status, source, created_by, confirmed_at)
     values ($1,$2,'solo_class',$3,$4,$5,$6,$7,'confirmed','online',$4, now()) returning id`, [A, o, R1, P1, C1, H(h), H(h + 1)])).rows[0].id as string;
  await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, booking_id) values ($1,'solo_class',$2,$3,$4,$5,'confirmed',$6)`, [A, R1, C1, H(h), H(h + 1), b]);
  return b;
}

describe('K3 Availability (CPORT-03, D19)', () => {
  it('only the coach reads the rest cap, and it is the club setting or 6', async () => {
    expect((await rows(coach, 'select app.coach_rest_cap() as n'))[0]!.n).toBe(6);
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'rest_cap_hours','4')`, [A]);
    expect((await rows(coach, 'select app.coach_rest_cap() as n'))[0]!.n).toBe(4);
    for (const c of [ctx(DESK, ['front_desk', 'player']), ctx(P1, ['player']), owner]) await expect(rows(c, 'select app.coach_rest_cap()'), c.roles.join()).rejects.toThrow(/portal:forbidden/);
    await expect(rows(coach, 'select * from public.club_setting')).resolves.toEqual([]);          // the coach reads no setting directly
  });
  it('saving hours that would allow a 7th hour in a row keeps them as typed and the 7th hour is not offered', async () => {
    await rows(coach, `select app.set_availability($1, $2::jsonb)`, [C1, JSON.stringify([{ kind: 'weekly', weekday: 3, on_date: null, start_time: '07:00', end_time: '24:00' }])]);
    for (const h of [8, 9, 10, 11, 12, 13]) await booked(h);
    expect(await check([H(14)])).toBe('rest_rule');                      // the 7th hour in a row
    expect(await check([H(7)])).toBe('rest_rule');                       // or in front of the six
    expect(await check([H(15)])).toBeNull();                             // a free hour breaks the run
    const saved = await rows(coach, `select kind, weekday, to_char(start_time, 'HH24:MI') as s, to_char(end_time, 'HH24:MI') as e from public.coach_availability_rule`);
    expect(saved).toEqual([{ kind: 'weekly', weekday: 3, s: '07:00', e: '24:00' }]);
  });
});

describe('K4 Leave (CPORT-04)', () => {
  it('a request is pending; the owner approves; the coach gets one leave_decision message; the affected sessions are flagged; nothing is deleted', async () => {
    await rows(coach, `select app.set_availability($1, $2::jsonb)`, [C1, JSON.stringify([{ kind: 'weekly', weekday: 3, on_date: null, start_time: '07:00', end_time: '24:00' }])]);
    const b = await booked(10);
    const id = (await rows(coach, `select app.request_leave($1, '2026-12-16', '2026-12-16', null, null, 'Trip', 'family') as id`, [C1]))[0]!.id as string;
    expect((await rows(coach, 'select status from public.coach_leave'))[0]).toEqual({ status: 'pending' });
    expect(await rows(owner, 'select * from public.coach_flagged_session')).toEqual([]);              // a pending request does not flag
    await rows(owner, 'select app.decide_leave($1, true)', [id]);
    const m = (await tdb.query(`select user_id, kind, params, dedupe_key from public.message_outbox where kind = 'leave_decision'`)).rows;
    expect(m).toEqual([{ user_id: C1, kind: 'leave_decision', params: { leave_id: id, status: 'approved' }, dedupe_key: `leave:${id}:approved` }]);
    expect((await rows(owner, 'select booking_id, reason from public.coach_flagged_session'))).toEqual([{ booking_id: b, reason: 'leave' }]);
    expect((await tdb.query(`select status from public.booking where id = $1`, [b])).rows[0].status).toBe('confirmed');
    await expect(rows(owner, 'select app.decide_leave($1, false)', [id])).rejects.toThrow();     // decided once
    expect((await tdb.query(`select count(*)::int as n from public.message_outbox where kind = 'leave_decision'`)).rows[0].n).toBe(1);
  });
});
