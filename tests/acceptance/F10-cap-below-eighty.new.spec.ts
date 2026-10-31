import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../packages/db/src/testing/harness';
import { createDb, type Db } from '../../packages/db/src/tx';

// LINE-07-AC2 at the database: below 80 percent no queued reminder is voided. QA, 31 Oct. Setup follows the lane's packages/db/src/line-usage-sync.test.ts.

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

it('F10/LINE-07-AC2 at 70 and 79 percent the state is alert and every queued reminder stays pending; the first void is at 80', async () => {
  await sync({}, { total: 690 });
  await enqueue('reminder_24h', 'reminder:y:24');
  expect((await sync({}, { total: 700 })).state).toBe('alert');
  expect(await outbox('reminder_24h')).toEqual([{ status: 'pending', void_reason: null, dedupe_key: 'reminder:y:24' }]);
  expect((await sync({}, { total: 799 })).state).toBe('alert');
  expect(await outbox('reminder_24h')).toEqual([{ status: 'pending', void_reason: null, dedupe_key: 'reminder:y:24' }]);
  expect((await sync({}, { total: 800 })).state).toBe('reminders_stopped');
  expect(await outbox('reminder_24h')).toEqual([{ status: 'void', void_reason: 'cap', dedupe_key: 'reminder:y:24' }]);
});
