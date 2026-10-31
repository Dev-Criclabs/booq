import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/harness';
import { createDb, type Db } from './tx';

// F10-T13 / migration 0613: what line_usage_sync and line_health write (F10 design 5.7 to 5.9; FA 5.6). LINE-06,
// LINE-07-AC1 to AC6, AC9, AC10; D97, D99, D114.
//   app.line_sync_clubs()                    the clubs the two jobs visit (Testing, Live, Paused)
//   app.record_line_usage(quota, consumption) this month's row, the health checks, the 80 percent void and the
//                                             owner's once a month message at 100 percent on a paid plan
//   app.record_line_token_check(error)       the daily token check
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const D = '4a3c9f1f-8d2e-4b66-8e1b-2d3f4a5b6c7d';
const OWNER = '11111111-1111-4111-8111-111111111111';
const PLAYER = '22222222-2222-4222-8222-222222222222';
const OWNER_LINE = 'Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const MONTH = `date_trunc('month', now() at time zone 'Asia/Bangkok')::date`;

let tdb: TestDatabase;
let w: Db;

async function person(club: string, id: string, line: string, role: string) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)`, [club, id, line]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [club, id]);
    if (role !== 'player') await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [club, id, role]);
    await c.query('commit');
  } finally {
    c.release();
  }
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status, owner_line) values ($1,'a','ก','A','live',$2)`, [A, OWNER_LINE]);
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'d','ด','D','draft')`, [D]);
  await person(A, OWNER, OWNER_LINE, 'owner');
  await person(A, PLAYER, 'UPLAYER', 'player');
  await tdb.query(`insert into public.line_connection (club_id, line_plan_kind, plan_message_limit) values ($1, 'paid', 1000)
                   on conflict (club_id) do update set line_plan_kind = excluded.line_plan_kind, plan_message_limit = excluded.plan_message_limit`, [A]);
  w = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await w?.end();
  await tdb?.close();
});

const job = { clubId: A, userId: null, roles: [] as never, source: 'job' as const, actorLabel: 'line_usage_sync' };
type Quota = { type?: 'none' | 'limited'; value?: number; error?: string };
type Consumption = { total?: number; error?: string };
const sync = (q: Quota, c: Consumption) =>
  w.withClubTx(job, async (tx) =>
    (await tx.query(`select app.record_line_usage($1, $2, $3, $4, $5) as r`, [q.type ?? null, q.value ?? null, q.error ?? null, c.total ?? null, c.error ?? null])).rows[0]!.r as {
      state: string; used: number; limit: number | null; source: string; voided: number; owner_message: boolean;
    });
const tokenCheck = (error: string | null) =>
  w.withClubTx(job, async (tx) => (await tx.query(`select app.record_line_token_check($1) as r`, [error])).rows[0]!.r as string);
const row = async () => (await tdb.query(`select used, line_consumption, message_limit, plan_kind, source, synced_at is not null as synced from platform.club_line_usage where club_id = $1 and month = ${MONTH}`, [A])).rows[0];
const health = async (check: string) => (await tdb.query(`select status, reason from platform.club_health where club_id = $1 and check_key = $2`, [A, check])).rows[0];
const enqueue = (kind: string, key: string, user = PLAYER) =>
  w.withClubTx(job, async (tx) => (await tx.query(`select app.enqueue_message($1, $2, '{}'::jsonb, $3, now() + interval '1 day') as id`, [kind, user, key])).rows[0]!.id as string | null);
const outbox = async (kind: string) => (await tdb.query(`select status, void_reason, dedupe_key from public.message_outbox where club_id = $1 and kind = $2 order by created_at`, [A, kind])).rows;
const capState = () => w.withClubTx(job, async (tx) => (await tx.query(`select app.cap_state() as s`)).rows[0]!.s as string);

describe('app.line_sync_clubs', () => {
  it('lists Testing, Live and Paused clubs, not Draft; worker only', async () => {
    const t = '5b4d0a2a-9e3f-4c77-9f2c-3e4f5a6b7c8e';
    await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'t','ท','T','testing')`, [t]);
    const ids = await w.withClubTx({ ...job, clubId: '00000000-0000-0000-0000-000000000000' }, async (tx) =>
      (await tx.query<{ id: string }>(`select id from app.line_sync_clubs() as t(id)`)).rows.map((r) => r.id));
    expect(ids.sort()).toEqual([A, t].sort());
    expect((await tdb.query(`select has_function_privilege('booq_app', 'app.line_sync_clubs()', 'execute') as x`)).rows[0].x).toBe(false);
  });
});

describe('record_line_usage: the numbers (FA 5.6)', () => {
  it('LINE’s consumption is used and a limited quota is the limit; P1 sees counts only', async () => {
    const r = await sync({ type: 'limited', value: 500 }, { total: 120 });
    expect(r).toMatchObject({ state: 'normal', used: 120, limit: 500, source: 'line' });
    expect(await row()).toEqual({ used: 120, line_consumption: 120, message_limit: 500, plan_kind: 'paid', source: 'line', synced: true });
    expect(await health('line_usage')).toEqual({ status: 'ok', reason: null });
  });

  it('a quota of none, or a failed quota read, falls back to the plan limit from P2 step 4', async () => {
    expect((await sync({ type: 'none' }, { total: 10 })).limit).toBe(1000);
    expect((await sync({ error: 'http_500' }, { total: 10 })).limit).toBe(1000);
  });

  it('(a) at 69 percent nothing changes; (b) at 70 percent the state is alert, which P1 and the banner read', async () => {
    expect((await sync({}, { total: 690 })).state).toBe('normal');
    expect(await capState()).toBe('normal');
    expect((await sync({}, { total: 700 })).state).toBe('alert');
    expect(await capState()).toBe('alert');
    expect(await outbox('owner_cap_paid_over')).toEqual([]);
  });

  it('(c, d) rising to 80 percent voids the queued reminders with cap; they are not revived when usage drops (LINE-07-AC2)', async () => {
    await sync({}, { total: 790 });
    const r = await enqueue('reminder_24h', 'reminder:x:24');
    const confirmed = await enqueue('booking_confirmed', 'confirmed:x');
    const s = await sync({}, { total: 800 });
    expect(s).toMatchObject({ state: 'reminders_stopped', voided: 1 });
    expect(await outbox('reminder_24h')).toEqual([{ status: 'void', void_reason: 'cap', dedupe_key: 'reminder:x:24' }]);
    expect(await outbox('booking_confirmed')).toEqual([{ status: 'pending', void_reason: null, dedupe_key: 'confirmed:x' }]);
    await sync({}, { total: 3 });   // LINE’s own rollover: the estimate resets at once (FA 5.6)
    expect(await row()).toMatchObject({ used: 3, source: 'line' });
    expect(await outbox('reminder_24h')).toEqual([{ status: 'void', void_reason: 'cap', dedupe_key: 'reminder:x:24' }]);
    expect(r && confirmed).toBeTruthy();
  });

  it('(f) at 100 percent on a paid plan the owner is told once for the month', async () => {
    const a = await sync({}, { total: 1000 });
    const b = await sync({}, { total: 1100 });
    expect(a).toMatchObject({ state: 'over_limit', owner_message: true });
    expect(b.owner_message).toBe(false);
    const month = (await tdb.query(`select to_char(${MONTH}, 'YYYY-MM') as m`)).rows[0].m;
    expect(await outbox('owner_cap_paid_over')).toEqual([{ status: 'pending', void_reason: null, dedupe_key: `cap_paid_over:${month}` }]);
    expect((await tdb.query(`select user_id from public.message_outbox where kind = 'owner_cap_paid_over'`)).rows[0].user_id).toBe(OWNER);
  });

  it('(g) at 100 percent on the free plan the owner gets no message (LINE would block it)', async () => {
    await tdb.query(`update public.line_connection set line_plan_kind = 'free' where club_id = $1`, [A]);
    expect(await sync({}, { total: 1000 })).toMatchObject({ state: 'over_limit', owner_message: false });
    expect(await outbox('owner_cap_paid_over')).toEqual([]);
  });

  it('no owner who has signed in: no message and no error', async () => {
    await tdb.query(`update public.club set owner_line = 'Ubbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' where id = $1`, [A]);
    expect(await sync({}, { total: 1000 })).toMatchObject({ state: 'over_limit', owner_message: false });
  });

  it('an upgrade mid month follows the new limit; LINE’s count decides (LINE-07-AC10, D99)', async () => {
    expect((await sync({}, { total: 850 })).state).toBe('reminders_stopped');
    await tdb.query(`update public.line_connection set plan_message_limit = 5000 where club_id = $1`, [A]);
    expect(await sync({}, { total: 860 })).toMatchObject({ state: 'normal', limit: 5000, used: 860 });
    expect(await sync({ type: 'limited', value: 1200 }, { total: 860 })).toMatchObject({ state: 'alert', limit: 1200 });
  });

  it('no limit known anywhere: the state stays normal and a health alert says the cap cannot be computed', async () => {
    await tdb.query(`update public.line_connection set plan_message_limit = null where club_id = $1`, [A]);
    expect(await sync({ type: 'none' }, { total: 99999 })).toMatchObject({ state: 'normal', limit: null });
    expect(await health('line_usage')).toEqual({ status: 'failed', reason: 'no_limit' });
  });
});

describe('record_line_usage: when LINE cannot be read (LINE-07-AC9, D97)', () => {
  it('the last known value is kept (with what our outbox sent since), a health alert is raised, reminders are not stopped', async () => {
    await sync({}, { total: 300 });
    await tdb.query(`update platform.club_line_usage set used = used + 5 where club_id = $1`, [A]);   // five sends since (record_send_result)
    const r = await enqueue('reminder_2h', 'reminder:y:2');
    const s = await sync({ error: 'unreachable' }, { error: 'unreachable' });
    expect(s).toMatchObject({ state: 'normal', used: 305, source: 'line', voided: 0 });
    expect(await row()).toMatchObject({ used: 305, line_consumption: 300 });
    expect(await health('line_usage')).toEqual({ status: 'failed', reason: 'unreachable' });
    expect(await outbox('reminder_2h')).toEqual([{ status: 'pending', void_reason: null, dedupe_key: 'reminder:y:2' }]);
    expect(r).not.toBeNull();
    await sync({}, { total: 310 });
    expect(await health('line_usage')).toEqual({ status: 'ok', reason: null });
  });

  it('(i) no row yet this month: our own count of sent messages this Bangkok month, Testing clubs too (D32)', async () => {
    await tdb.query(`update public.club set status = 'testing' where id = $1`, [A]);
    await tdb.query(
      `insert into public.message_outbox (club_id, user_id, kind, params, dedupe_key, send_at, status, sent_at, is_test)
       values ($1,$2,'booking_confirmed','{}','s1', now(), 'sent', now(), true), ($1,$2,'booking_confirmed','{}','s2', now(), 'sent', now(), true),
              ($1,$2,'booking_confirmed','{}','s3', now() - interval '45 days', 'sent', now() - interval '45 days', true),
              ($1,$2,'booking_confirmed','{}','s4', now(), 'undeliverable', null, true)`, [A, PLAYER]);
    const s = await sync({ error: 'http_500' }, { error: 'http_500' });
    expect(s).toMatchObject({ used: 2, source: 'own_count' });
    expect(await health('line_usage')).toEqual({ status: 'failed', reason: 'http_500' });
  });

  it('a refused token on either call raises the token alert (P1 and the owner banner, D114); a working call clears it', async () => {
    await sync({ error: 'token_rejected' }, { error: 'token_rejected' });
    expect(await health('line_token')).toEqual({ status: 'failed', reason: 'token_rejected' });
    await sync({ type: 'none' }, { total: 1 });
    expect(await health('line_token')).toEqual({ status: 'ok', reason: null });
  });

  it('refuses an unknown quota type and a negative count', async () => {
    await expect(sync({ type: 'lots' as never }, { total: 1 })).rejects.toThrow(/quota type/);
    await expect(sync({}, { total: -1 })).rejects.toThrow(/consumption/);
  });
});

describe('record_line_token_check (line_health, daily; design 5.7)', () => {
  it('a refused token or no token fails the check; a good answer clears it; an unreachable LINE changes nothing', async () => {
    expect(await tokenCheck('token_rejected')).toBe('failed');
    expect(await health('line_token')).toEqual({ status: 'failed', reason: 'token_rejected' });
    expect(await tokenCheck('unreachable')).toBe('unchanged');
    expect(await health('line_token')).toEqual({ status: 'failed', reason: 'token_rejected' });
    expect(await tokenCheck(null)).toBe('ok');
    expect(await health('line_token')).toEqual({ status: 'ok', reason: null });
    expect(await tokenCheck('no_token')).toBe('failed');
    expect(await health('line_token')).toEqual({ status: 'failed', reason: 'no_token' });
  });

  it('only the worker runs the two record functions; no club role and no platform role', async () => {
    for (const fn of ['app.record_line_usage(text,integer,text,integer,text)', 'app.record_line_token_check(text)']) {
      for (const role of ['booq_app', 'booq_platform', 'public']) {
        expect((await tdb.query(`select has_function_privilege($1, $2, 'execute') as x`, [role, fn])).rows[0].x).toBe(false);
      }
      expect((await tdb.query(`select has_function_privilege('booq_worker', $1, 'execute') as x`, [fn])).rows[0].x).toBe(true);
    }
  });
});
