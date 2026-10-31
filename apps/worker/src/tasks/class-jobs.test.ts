import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { DEFAULT_JOB_SPEC } from '../policy';
import { clubTask } from '../task-wrapper';
import { CLASS_GENERATE, classGenerateDispatch, generateClassSessions } from './class-generate';
import { CLASS_BELOW_MINIMUM, OFFER_EXPIRY, runClassBelowMinimum, runOfferExpiry } from './class-jobs';

// F08-T10: class_generate, offer_expiry, class_below_minimum (CLASS-01-AC2, AC16; CLASS-02-AC4, AC15; WAIT-01-AC4).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const OWNER = '44444444-4444-4444-8444-444444444444';
const DESK = '33333333-3333-4333-8333-333333333333';
const DESK2 = '33333333-3333-4333-8333-333333333334';
const P = Array.from({ length: 5 }, (_, i) => `00000000-0000-4000-8000-0000000005${String(i).padStart(2, '0')}`);
let tdb: TestDatabase;
let worker: Db;
let app: Db;
let tpl: string;
let session: string;

const ctx = (user: string | null, roles: string[] = ['player']) => ({ clubId: A, userId: user, roles: roles as never, source: 'player_app' as const });
async function person(id: string, roles: string[], club = A) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, date_of_birth) values ($1,$2,$3,'1990-01-01')`, [club, id, 'L' + id + club.slice(0, 2)]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [club, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
async function seat(customer: string, status: 'confirmed' | 'awaiting_payment' = 'confirmed', sess = session) {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id;
  const s = (await tdb.query(`select start_at, end_at, resource_id from public.class_session where id = $1`, [sess])).rows[0];
  return (await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, class_session_id, start_at, end_at, customer_id, status, source, created_by, hold_expires_at, confirmed_at)
     values ($1,$2,'class_seat',$3,$4,$5,$6,$7,$8,'online',$7,$9,$10) returning id`,
    [A, order, s.resource_id, sess, s.start_at, s.end_at, customer, status, status === 'awaiting_payment' ? '2026-11-30T03:10:00Z' : null, status === 'confirmed' ? '2026-11-30T03:00:00Z' : null])).rows[0].id as string;
}
const sessions = async () => (await tdb.query(`select to_char(start_at at time zone 'Asia/Bangkok', 'MM-DD') as d, status from public.class_session order by start_at`)).rows;
const outbox = async () => (await tdb.query(`select kind, user_id, status, dedupe_key from public.message_outbox order by dedupe_key`)).rows;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-11-30T03:00:00Z');   // Monday 10:00 Bangkok
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, C1, LOC]);
  await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) select $1, d, '06:00', '24:00' from generate_series(1, 7) d`, [A]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','14'), ($1,'hold_minutes','15'), ($1,'waitlist_claim_minutes','30'), ($1,'waitlist_no_offer_hours','2')`, [A]);
  await person(OWNER, ['owner', 'player']);
  await person(DESK, ['front_desk', 'player']);
  await person(DESK2, ['front_desk', 'player']);
  for (const p of P) await person(p, ['player']);
  await tdb.seedCoach(A, COACH);
  tpl = (await tdb.query(`insert into public.class_template (club_id, name_th, name_en, audience, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by) values ($1,'ก','Group','adult',$2,$3,3,'18:00',2,2,$4) returning id`, [A, COACH, C1, OWNER])).rows[0].id;
  worker = createDb({ connectionString: tdb.url, max: 4, role: 'booq_worker' });
  app = createDb({ connectionString: tdb.url, max: 4 });
  await worker.withClubTx({ clubId: A, userId: null, roles: [], source: 'job' }, (tx) => tx.query(`select app.generate_sessions_window()`));
  session = (await tdb.query(`select id from public.class_session where template_id = $1 order by start_at limit 1`, [tpl])).rows[0].id;
});
afterEach(async () => {
  await worker.end();
  await app.end();
  await tdb.close();
});

describe('class_generate (CLASS-01-AC2, AC3, AC9)', () => {
  it('makes the window’s sessions in the club’s own context and a rerun makes nothing twice; the window moves with the day', async () => {
    expect((await sessions()).map((s) => s.d)).toEqual(['12-02', '12-09']);
    const run = clubTask(worker, generateClassSessions, { actorLabel: CLASS_GENERATE });
    await run({ clubId: A }, {});
    expect((await sessions()).length).toBe(2);
    await tdb.setNow('2026-12-02T17:05:00Z');                  // 00:05 on 3 December in Bangkok: the window now reaches 17 December
    await run({ clubId: A }, {});
    expect((await sessions()).map((s) => s.d)).toEqual(['12-02', '12-09', '12-16']);
  });

  it('reports sessions that need attention and another club is not touched', async () => {
    await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) select $1, d, '06:00', '24:00' from generate_series(1, 7) d`, [B]);
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','14')`, [B]);
    await tdb.query(`insert into public.coach_leave (club_id, coach_id, start_date, end_date, status, decided_by, decided_at) values ($1,$2,'2026-12-16','2026-12-16','approved',$3,app.now())`, [A, COACH, OWNER]);
    await tdb.setNow('2026-12-02T17:05:00Z');
    const r = await worker.withClubTx({ clubId: A, userId: null, roles: [], source: 'job' }, async (tx) => (await tx.query(`select app.generate_sessions_window() as r`)).rows[0]!.r);
    expect(r).toEqual({ made: 1, needs_attention: 1, skipped: false });
    expect((await tdb.query(`select count(*)::int as n from public.class_session where club_id = $1`, [B])).rows[0].n).toBe(0);
  });

  it('a club without a booking window makes nothing', async () => {
    await tdb.query(`delete from public.club_setting where key = 'booking_window_days'`);
    await tdb.setNow('2026-12-02T17:05:00Z');
    const r = await worker.withClubTx({ clubId: A, userId: null, roles: [], source: 'job' }, async (tx) => (await tx.query(`select app.generate_sessions_window() as r`)).rows[0]!.r);
    expect(r).toMatchObject({ made: 0, skipped: true });
  });

  it('the dispatch adds one generation per club with the default retry spec and a key per club', async () => {
    const added: { task: string; payload: unknown; spec: unknown }[] = [];
    await classGenerateDispatch({ listClubIds: async () => [A, 'nope', B, A] })({}, { addJob: async (t: string, payload: unknown, spec: unknown) => void added.push({ task: t, payload, spec }) } as never);
    expect(added).toEqual([
      { task: CLASS_GENERATE, payload: { clubId: A }, spec: { ...DEFAULT_JOB_SPEC, jobKey: `${CLASS_GENERATE}:${A}` } },
      { task: CLASS_GENERATE, payload: { clubId: B }, spec: { ...DEFAULT_JOB_SPEC, jobKey: `${CLASS_GENERATE}:${B}` } },
    ]);
  });
});

describe('offer_expiry (CLASS-02-AC4, AC15; WAIT-01-AC4)', () => {
  async function offerOpen() {
    const b1 = await seat(P[0]!); await seat(P[1]!);
    for (const p of [P[2]!, P[3]!]) await app.withClubTx(ctx(p), async (tx) => tx.query(`select app.join_waitlist($1, null, null)`, [session]));
    await tdb.query(`update public.booking set status = 'cancelled' where id = $1`, [b1]);
    await tdb.query(`select set_config('app.club_id', $1, false)`, [A]);
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('app.club_id', $1, true)`, [A]);
      await c.query('set local role booq_owner');
      await c.query(`select app.waitlist_advance($1, null, null)`, [session]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  const entries = async () => (await tdb.query(`select customer_id, status from public.waitlist_entry where class_session_id = $1 order by seq`, [session])).rows;

  it('an offer past its time is expired once and passed on to the next in line; before its time nothing happens', async () => {
    await offerOpen();
    expect(await runOfferExpiry(worker)).toMatchObject({ due: 0, expired: 0, failed: 0 });
    await tdb.advance('31 minutes');
    expect(await runOfferExpiry(worker)).toMatchObject({ due: 1, expired: 1, failed: 0 });
    expect((await entries()).map((e) => e.status)).toEqual(['expired', 'offered']);
    expect(await runOfferExpiry(worker)).toMatchObject({ due: 0, expired: 0 });
    expect((await entries()).map((e) => e.status)).toEqual(['expired', 'offered']);
  });

  it('an open offer stands when the two hour mark passes (the job does not end it)', async () => {
    await offerOpen();
    await tdb.setNow('2026-12-02T09:20:00Z');                  // 16:20 Bangkok on the day: inside the two hour cut off, before the start
    await tdb.query(`update public.waitlist_entry set offer_expires_at = '2026-12-02T10:00:00Z' where status = 'offered'`);
    expect(await runOfferExpiry(worker)).toMatchObject({ expired: 0 });
    expect((await entries()).map((e) => e.status)).toEqual(['offered', 'waiting']);
  });

  it('entries whose class has started are ended (slot_passed) and their offer message voided (WAIT-01-AC4)', async () => {
    await offerOpen();
    await tdb.setNow('2026-12-02T11:00:01Z');
    expect(await runOfferExpiry(worker)).toMatchObject({ ended: 2 });
    expect((await tdb.query(`select status, ended_reason from public.waitlist_entry where class_session_id = $1`, [session])).rows).toEqual([{ status: 'ended', ended_reason: 'slot_passed' }, { status: 'ended', ended_reason: 'slot_passed' }]);
    expect((await outbox()).filter((m) => m.kind === 'waitlist_offer').every((m) => m.status === 'void')).toBe(true);
  });

  it('records its heartbeat', async () => {
    await runOfferExpiry(worker);
    expect((await tdb.query(`select runs from platform.worker_heartbeat where task_name = $1`, [OFFER_EXPIRY])).rows[0].runs).toBe('1');
  });
});

describe('class_below_minimum (CLASS-01-AC16)', () => {
  it('is inert while the club has not set the alert minutes', async () => {
    await tdb.setNow('2026-12-02T10:30:00Z');                  // 30 minutes before the start
    expect(await runClassBelowMinimum(worker)).toMatchObject({ due: 0, alerts: 0 });
    expect(await outbox()).toEqual([]);
  });

  it('fires once at start minus the setting: one message per front desk person, nothing cancelled', async () => {
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'below_min_alert_minutes','120')`, [A]);
    await seat(P[0]!);                                           // 1 of the 2 needed
    await tdb.setNow('2026-12-02T08:59:00Z');                  // 121 minutes before: not yet
    expect(await runClassBelowMinimum(worker)).toMatchObject({ due: 0 });
    await tdb.setNow('2026-12-02T09:00:00Z');                  // 120 minutes before
    expect(await runClassBelowMinimum(worker)).toMatchObject({ due: 1, alerts: 2, failed: 0 });
    expect((await outbox()).map((m) => [m.kind, m.user_id, m.status])).toEqual([['class_below_minimum', DESK, 'pending'], ['class_below_minimum', DESK2, 'pending']]);
    expect((await outbox())[0]!.dedupe_key).toBe(`below_min:${session}:${DESK}`);
    expect(await runClassBelowMinimum(worker)).toMatchObject({ due: 0, alerts: 0 });
    expect((await tdb.query(`select status from public.class_session where id = $1`, [session])).rows[0].status).toBe('scheduled');
    expect((await outbox()).length).toBe(2);
  });

  it('a session at its minimum is not alerted, and a session back at the minimum has its pending alert voided', async () => {
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'below_min_alert_minutes','120')`, [A]);
    await seat(P[0]!); await seat(P[1]!);
    await tdb.setNow('2026-12-02T09:30:00Z');
    expect(await runClassBelowMinimum(worker)).toMatchObject({ due: 0 });
    await tdb.query(`update public.booking set status = 'cancelled' where customer_id = $1`, [P[1]]);
    await runClassBelowMinimum(worker);
    expect((await outbox()).every((m) => m.status === 'pending')).toBe(true);
    await seat(P[2]!);                                           // back at 2
    expect((await outbox()).every((m) => m.status === 'void')).toBe(true);
  });

  it('a cancelled session and a Draft club get no alert', async () => {
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'below_min_alert_minutes','120')`, [A]);
    await tdb.setNow('2026-12-02T10:00:00Z');
    await tdb.query(`update public.class_session set status = 'cancelled', cancel_reason = 'owner', cancelled_at = now() where id = $1`, [session]);
    expect(await runClassBelowMinimum(worker)).toMatchObject({ due: 0 });
    await tdb.query(`update public.class_session set status = 'scheduled', cancel_reason = null, cancelled_at = null where id = $1`, [session]);
    await tdb.query(`update public.club set status = 'draft' where id = $1`, [A]);
    expect(await runClassBelowMinimum(worker)).toMatchObject({ due: 0 });
    expect(CLASS_BELOW_MINIMUM).toBe('class_below_minimum');
  });
});
