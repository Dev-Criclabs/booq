import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F07-T03 / migration 0803: the coach rules (COACH-01-AC1 to AC12, R3-AC1 to AC7, CC-4; D156).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const COURT1 = '00000000-0000-4000-8000-0000000000c1';
const COURT2 = '00000000-0000-4000-8000-0000000000c2';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const OTHER_COACH = 'e1e1e1e1-0000-4000-8000-000000000008';
const BCOACH = 'e2e2e2e2-0000-4000-8000-000000000007';
const OWNER = '44444444-4444-4444-8444-444444444444';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let tdb: TestDatabase;
let db: Db;

/** 2026-12-02 is a Wednesday (Bangkok day of week 3). */
const H = (h: number, day = 2) => new Date(`2026-12-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();

async function inClub<T>(sql: string, params: unknown[] = [], club = A): Promise<T[]> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.club_id', $1, true)`, [club]);
    await c.query('set local role booq_owner');
    const r = await c.query(sql, params);
    await c.query('commit');
    return r.rows as T[];
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const check = async (starts: string[], coach = COACH, ignoreBooking: string | null = null, club = A) =>
  (await inClub<{ r: string | null }>(`select app.coach_check($1, $2, $3::timestamptz[], $4) as r`, [club, coach, starts, ignoreBooking], club))[0]!.r;
const run = async (starts: string[], coach = COACH, ignoreBooking: string | null = null) =>
  (await inClub<{ r: number }>(`select app.coach_rest_run($1, $2::timestamptz[], $3) as r`, [coach, starts, ignoreBooking]))[0]!.r;

let orderSeq = 0;
/** One occupancy row of the coach at hour h: a confirmed solo class, a held (unpaid) one, or a group class. */
async function busy(h: number, o: { state?: 'confirmed' | 'held'; expired?: boolean; kind?: 'solo' | 'group'; coach?: string; day?: number } = {}) {
  const coach = o.coach ?? COACH;
  const day = o.day ?? 2;
  if (o.kind === 'group') {
    const tpl = (await tdb.query(`insert into public.class_template (club_id, name_th, name_en, audience, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by) values ($1,'ก','G','adult',$2,$3,3,'18:00',4,6,$4) returning id`, [A, coach, COURT2, OWNER])).rows[0].id as string;
    const sess = (await tdb.query(`insert into public.class_session (club_id, template_id, start_at, end_at, name_th, name_en, audience, coach_id, resource_id, min_players, max_players) values ($1,$2,$3,$4,'ก','G','adult',$5,$6,4,6) returning id`, [A, tpl, H(h, day), H(h + 1, day), coach, COURT2])).rows[0].id as string;
    await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, class_session_id) values ($1,'group_class',$2,$3,$4,$5,'confirmed',$6)`,
      [A, COURT2, coach, H(h, day), H(h + 1, day), sess]);
    return null;
  }
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, uid(++orderSeq + 100)])).rows[0].id as string;
  const held = o.state === 'held';
  const hold = held ? (o.expired ? `app.now() - interval '5 minutes'` : `app.now() + interval '10 minutes'`) : 'null';
  const b = (await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, coach_id, start_at, end_at, status, source, created_by, confirmed_at, hold_expires_at)
     values ($1,$2,'solo_class',$3,$4,$5,$6, $7, 'staff', $8, ${held ? 'null' : 'app.now()'}, ${hold}) returning id`,
    [A, order, COURT1, coach, H(h, day), H(h + 1, day), held ? 'awaiting_payment' : 'confirmed', OWNER])).rows[0].id as string;
  await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, hold_expires_at, booking_id)
                   values ($1,'solo_class',$2,$3,$4,$5,$6, ${hold}, $7)`, [A, COURT1, coach, H(h, day), H(h + 1, day), held ? 'held' : 'confirmed', b]);
  return b;
}
const rule = (coach: string, cols: string, vals: unknown[]) =>
  tdb.query(`insert into public.coach_availability_rule (club_id, coach_id, ${cols}) values ($1, $2, ${vals.map((_, i) => '$' + (i + 3)).join(',')})`, [A, coach, ...vals]);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($1,$4,$3,'2','tennis')`, [A, COURT1, LOC, COURT2]);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [A, OWNER, 'Lo']);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'owner'), ($1,$2,'player')`, [A, OWNER]);
    await c.query('commit');
  } finally {
    c.release();
  }
  await tdb.seedCoach(A, COACH);   // works every hour of every day
  await tdb.seedCoach(B, BCOACH);
  db = createDb({ connectionString: tdb.url, max: 12 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('coach_check: exists, active, working, leave, busy (COACH-01-AC1 to AC3, AC10)', () => {
  it('a free, working coach is bookable', async () => {
    expect(await check([H(10)])).toBeNull();
  });

  it('an unknown coach, another club’s coach, and an inactive coach are unavailable (CC-1)', async () => {
    expect(await check([H(10)], '99999999-9999-4999-8999-999999999999')).toBe('coach_unavailable');
    expect(await check([H(10)], BCOACH)).toBe('coach_unavailable');
    await tdb.query(`update public.coach set active = false where id = $1`, [COACH]);
    expect(await check([H(10)])).toBe('coach_unavailable');
    expect(await check([H(10)], COACH, null, B)).toBe('coach_unavailable');   // asked in another club's context
  });

  it('no rule means never offered; a weekly rule covers its weekday and hours only', async () => {
    expect(await check([H(10)], OTHER_COACH)).toBe('coach_unavailable');   // not even a coach row
    await tdb.seedCoach(A, OTHER_COACH);
    await tdb.query(`delete from public.coach_availability_rule where coach_id = $1`, [OTHER_COACH]);
    expect(await check([H(10)], OTHER_COACH)).toBe('coach_unavailable');   // a coach with no rule
    await rule(OTHER_COACH, 'kind, weekday, start_time, end_time', ['weekly', 3, '09:00', '12:00']);   // Wednesday
    expect(await check([H(9)], OTHER_COACH)).toBeNull();
    expect(await check([H(11)], OTHER_COACH)).toBeNull();
    expect(await check([H(12)], OTHER_COACH)).toBe('coach_unavailable');   // the rule ends at 12:00
    expect(await check([H(8)], OTHER_COACH)).toBe('coach_unavailable');
    expect(await check([H(10, 3)], OTHER_COACH)).toBe('coach_unavailable');   // Thursday
  });

  it('the last hour of the day can be covered (a rule ending at 24:00)', async () => {
    expect(await check([H(23)])).toBeNull();
  });

  it('an open rule on a date works without a weekly one; a closed time over an open rule wins', async () => {
    await tdb.seedCoach(A, OTHER_COACH);
    await tdb.query(`delete from public.coach_availability_rule where coach_id = $1`, [OTHER_COACH]);
    await rule(OTHER_COACH, 'kind, on_date, start_time, end_time', ['open', '2026-12-02', '09:00', '18:00']);
    expect(await check([H(10)], OTHER_COACH)).toBeNull();
    await rule(OTHER_COACH, 'kind, on_date, start_time, end_time', ['closed', '2026-12-02', '12:00', '14:00']);
    expect(await check([H(11)], OTHER_COACH)).toBeNull();
    expect(await check([H(12)], OTHER_COACH)).toBe('coach_unavailable');
    expect(await check([H(13)], OTHER_COACH)).toBe('coach_unavailable');
    expect(await check([H(14)], OTHER_COACH)).toBeNull();
  });

  it('a closed time wins over a weekly rule as well', async () => {
    await rule(COACH, 'kind, on_date, start_time, end_time', ['closed', '2026-12-02', '15:00', '16:00']);
    expect(await check([H(15)])).toBe('coach_unavailable');
    expect(await check([H(16)])).toBeNull();
  });

  it('approved leave blocks; pending and declined leave does not; a part day blocks its hours only (D120, D156)', async () => {
    const leave = (cols: string, vals: unknown[]) => tdb.query(`insert into public.coach_leave (club_id, coach_id, ${cols}) values ($1,$2, ${vals.map((_, i) => '$' + (i + 3)).join(',')})`, [A, COACH, ...vals]);
    await leave('start_date, end_date', ['2026-12-02', '2026-12-02']);   // pending
    expect(await check([H(10)])).toBeNull();
    await leave('start_date, end_date, status, decided_by, decided_at', ['2026-12-02', '2026-12-02', 'declined', OWNER, new Date().toISOString()]);
    expect(await check([H(10)])).toBeNull();
    await leave('start_date, end_date, from_hour, to_hour, status, decided_by, decided_at', ['2026-12-03', '2026-12-03', 14, 16, 'approved', OWNER, new Date().toISOString()]);
    expect(await check([H(14, 3)])).toBe('coach_unavailable');
    expect(await check([H(15, 3)])).toBe('coach_unavailable');
    expect(await check([H(16, 3)])).toBeNull();
    expect(await check([H(13, 3)])).toBeNull();
    await leave('start_date, end_date, status, decided_by, decided_at', ['2026-12-05', '2026-12-07', 'approved', OWNER, new Date().toISOString()]);
    for (const d of [5, 6, 7]) expect(await check([H(10, d)])).toBe('coach_unavailable');
    expect(await check([H(10, 8)])).toBeNull();
  });

  it('a confirmed solo class, a held hour and a group class block the same hour; an expired hold does not (AC3)', async () => {
    await busy(10);
    await busy(11, { state: 'held' });
    await busy(12, { kind: 'group' });
    await busy(13, { state: 'held', expired: true });
    expect(await check([H(10)])).toBe('coach_unavailable');
    expect(await check([H(11)])).toBe('coach_unavailable');
    expect(await check([H(12)])).toBe('coach_unavailable');
    expect(await check([H(13)])).toBeNull();
  });

  it('ignore_booking lets a moved booking’s own hour through', async () => {
    const b = await busy(10);
    expect(await check([H(10)])).toBe('coach_unavailable');
    expect(await check([H(10)], COACH, b)).toBeNull();
  });
});

describe('the rest rule (COACH-01-AC4, AC6, AC12; R3-AC1 to AC7)', () => {
  it('six hours in a row are allowed, a seventh is refused', async () => {
    for (const h of [8, 9, 10, 11, 12]) await busy(h);
    expect(await check([H(13)])).toBeNull();       // the 6th
    await busy(13);
    expect(await check([H(14)])).toBe('rest_rule');   // the 7th
    expect(await check([H(7)])).toBe('rest_rule');    // or in front
  });

  it('a free hour breaks the run and starts a new one (R3-AC2)', async () => {
    for (const h of [8, 9, 10, 11, 12, 13]) await busy(h);
    expect(await check([H(15)])).toBeNull();          // 14 is free
    expect(await check([H(14)])).toBe('rest_rule');
  });

  it('candidate hours join runs from both sides', async () => {
    for (const h of [8, 9, 10]) await busy(h);
    for (const h of [12, 13, 14]) await busy(h);
    expect(await check([H(11)])).toBe('rest_rule');    // 8 to 14 is seven
    expect(await run([H(11)])).toBe(7);
  });

  it('a selection of several hours counts as one run: six pass, seven are refused', async () => {
    expect(await check([H(8), H(9), H(10), H(11), H(12), H(13)])).toBeNull();
    expect(await check([H(8), H(9), H(10), H(11), H(12), H(13), H(14)])).toBe('rest_rule');
    expect(await run([H(8), H(9), H(11)])).toBe(2);     // 8-9 and 11 apart
  });

  it('unpaid held hours count, an expired hold does not, and a group class counts (R3-AC3, AC4)', async () => {
    for (const h of [8, 9, 10]) await busy(h, { state: 'held' });
    await busy(11, { kind: 'group' });
    await busy(12, { state: 'held', expired: true });
    expect(await run([H(13)])).toBe(1);               // 12 is not busy: 13 stands alone
    expect(await run([H(12)])).toBe(5);               // 8 to 12 once 12 is a candidate
  });

  it('the cap is the setting rest_cap_hours; empty means 6 (D156)', async () => {
    for (const h of [8, 9, 10]) await busy(h);
    expect(await check([H(11)])).toBeNull();          // no setting: 6
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'rest_cap_hours','3')`, [A]);
    expect(await check([H(11)])).toBe('rest_rule');
    await tdb.query(`update public.club_setting set value = '4' where key = 'rest_cap_hours'`);
    expect(await check([H(11)])).toBeNull();
  });

  it('ignores the booking being moved (R3-AC7)', async () => {
    const ids: (string | null)[] = [];
    for (const h of [8, 9, 10, 11, 12, 13]) ids.push(await busy(h));
    expect(await check([H(14)])).toBe('rest_rule');
    // moving the 8 o'clock booking to 14 leaves 9 to 14: six
    expect(await check([H(14)], COACH, ids[0]!)).toBeNull();
  });

  it('another coach’s hours and another day’s hours do not count', async () => {
    await tdb.seedCoach(A, OTHER_COACH);
    for (const h of [8, 9, 10, 11, 12]) await busy(h, { coach: OTHER_COACH });
    for (const h of [8, 9, 10, 11, 12]) await busy(h, { day: 3 });
    expect(await check([H(13)])).toBeNull();
    expect(await run([H(13)])).toBe(1);
  });
});

describe('the hooks (0213, 0227) and lock_coach', () => {
  it('registers app.coach_rules_check and app.coach_rules_check_move', async () => {
    expect((await tdb.query(`select handler::text as h from app.coach_rules_hook`)).rows[0].h).toBe('app.coach_rules_check');
    expect((await tdb.query(`select handler::text as h from app.coach_rules_move_hook`)).rows[0].h).toBe('app.coach_rules_check_move');
  });

  it('a refusal is a BK001 error with the code, and rest_rule carries the cap as the detail', async () => {
    for (const h of [8, 9, 10, 11, 12, 13]) await busy(h);
    const err = await inClub(`select app.coach_rules_check($1, $2, $3, $4::timestamptz[])`, [A, COACH, COURT1, [H(14)]]).catch((e) => e as { code: string; message: string; detail: string });
    expect(err).toMatchObject({ code: 'BK001', message: 'rest_rule', detail: '6' });
    const other = await inClub(`select app.coach_rules_check($1, $2, $3, $4::timestamptz[])`, [A, OTHER_COACH, COURT1, [H(14)]]).catch((e) => e as { code: string; message: string });
    expect(other).toMatchObject({ code: 'BK001', message: 'coach_unavailable' });
    await inClub(`select app.coach_rules_check($1, $2, $3, $4::timestamptz[])`, [A, COACH, COURT1, [H(20)]]);   // fine: no error
  });

  it('the check takes no override argument: no role can exceed the cap (AC12)', async () => {
    const r = await tdb.query(`select pronargs, proargnames from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and proname in ('coach_check', 'coach_rest_run', 'coach_rules_check', 'coach_rules_check_move') order by proname`);
    for (const row of r.rows) expect((row.proargnames ?? []).join(' ')).not.toMatch(/override/);
  });

  it('lock_coach locks the coach row', async () => {
    const c1 = await tdb.pool.connect();
    const c2 = await tdb.pool.connect();
    try {
      for (const c of [c1, c2]) { await c.query('begin'); await c.query(`select set_config('app.club_id', $1, true)`, [A]); await c.query('set local role booq_owner'); await c.query(`set local lock_timeout = '300ms'`); }
      await c1.query(`select app.lock_coach($1)`, [COACH]);
      await expect(c2.query(`select app.lock_coach($1)`, [COACH])).rejects.toThrow(/lock timeout/);
      await c2.query('rollback');
      await c1.query('commit');
    } finally {
      c1.release();
      c2.release();
    }
  });
});

describe('through reserve_court (CONC-17)', () => {
  beforeEach(async () => {
    for (let d = 1; d <= 7; d += 1) await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [A, d]);
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [A]);
  });
  const reserve = async (customer: string, resource: string, starts: string[]) => {
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id as string;
    try {
      await db.withClubTx({ clubId: A, userId: customer, roles: ['player'], source: 'player_app' }, async (tx) =>
        tx.query(`select app.reserve_court($1, $2, $3::timestamptz[], $4, null)`, [order, resource, starts, COACH]));
      return { ok: true as const };
    } catch (e) {
      const err = e as { code?: string; message: string; detail?: string };
      if (err.code === 'BK001') return { ok: false as const, code: err.message, detail: err.detail };
      throw e;
    }
  };
  const players = async (n: number) => {
    for (let i = 1; i <= n; i += 1) {
      const c = await tdb.pool.connect();
      try {
        await c.query('begin');
        await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3) on conflict do nothing', [A, uid(i), 'P' + i]);
        await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player') on conflict do nothing`, [A, uid(i)]);
        await c.query('commit');
      } finally {
        c.release();
      }
    }
  };

  it('books a free coach on a free court', async () => {
    await players(1);
    expect(await reserve(uid(1), COURT1, [H(18)])).toEqual({ ok: true });
  });

  it('refuses a coach on leave with coach_unavailable and a seventh hour with rest_rule and the cap', async () => {
    await players(2);
    await tdb.query(`insert into public.coach_leave (club_id, coach_id, start_date, end_date, status, decided_by, decided_at) values ($1,$2,'2026-12-03','2026-12-03','approved',$3,now())`, [A, COACH, OWNER]);
    expect(await reserve(uid(1), COURT1, [H(10, 3)])).toEqual({ ok: false, code: 'coach_unavailable', detail: undefined });
    for (const h of [8, 9, 10, 11, 12, 13]) await busy(h, { day: 4 });
    expect(await reserve(uid(2), COURT2, [H(14, 4)])).toEqual({ ok: false, code: 'rest_rule', detail: '6' });
  });

  it('two parallel bookings of the 6th and the 7th hour give exactly one success', async () => {
    await players(2);
    for (const h of [8, 9, 10, 11, 12]) await busy(h);
    const out = await Promise.all([reserve(uid(1), COURT1, [H(13)]), reserve(uid(2), COURT2, [H(14)])]);
    expect(out.filter((o) => o.ok)).toHaveLength(1);
    expect(out.find((o) => !o.ok)).toMatchObject({ code: expect.stringMatching(/rest_rule|coach_unavailable/) });
  });
});
