import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import type { LineUsageApi } from '@booq/line/server';
import { closeTestDatabase } from '../testing/teardown';
import { runLineHealth, runLineUsageSync } from './line-usage';

// F10-T13 jobs line_usage_sync (every 10 minutes) and line_health (daily); F10 design 5.7, 5.8, 8; FA 5.6. LINE-06,
// LINE-07-AC1 to AC6, AC9, AC10; D97, D99, D114. LINE is a settable quota and consumption here (design 13); the
// database rules themselves are in packages/db/src/line-usage-sync.test.ts.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '4a3c9f1f-8d2e-4b66-8e1b-2d3f4a5b6c7d';
const OWNER = '11111111-1111-4111-8111-111111111111';
const OWNER_LINE = `U${'a'.repeat(32)}`;
const MONTH = `date_trunc('month', now() at time zone 'Asia/Bangkok')::date`;

let tdb: TestDatabase;
let worker: Db;
type Lineside = { quota: Awaited<ReturnType<LineUsageApi['quota']>>; consumption: Awaited<ReturnType<LineUsageApi['consumption']>> };
let lineOf: Record<string, Lineside>;
let calls: string[];

/** The usage API over a settable LINE per token (token = 'tok-' + club). */
const api: LineUsageApi = {
  async quota(token) {
    calls.push(`quota:${token}`);
    return lineOf[token]!.quota;
  },
  async consumption(token) {
    calls.push(`consumption:${token}`);
    return lineOf[token]!.consumption;
  },
};
const tokens: Record<string, string | null> = {};
const deps = () => ({ api, readToken: async (_tx: unknown, clubId: string) => tokens[clubId] ?? null });

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status, owner_line) values ($1,'a','ก','A','live',$2), ($3,'b','ข','B','testing',null)`, [A, OWNER_LINE, B]);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)`, [A, OWNER, OWNER_LINE]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player'), ($1,$2,'owner')`, [A, OWNER]);
    await c.query('commit');
  } finally {
    c.release();
  }
  await tdb.query(`insert into public.line_connection (club_id, line_plan_kind, plan_message_limit) values ($1,'paid',1000), ($2,'free',200)
                   on conflict (club_id) do update set line_plan_kind = excluded.line_plan_kind, plan_message_limit = excluded.plan_message_limit`, [A, B]);
  tokens[A] = 'tok-a';
  tokens[B] = 'tok-b';
  lineOf = {
    'tok-a': { quota: { ok: true, type: 'limited', value: 1000 }, consumption: { ok: true, totalUsage: 100 } },
    'tok-b': { quota: { ok: true, type: 'none', value: null }, consumption: { ok: true, totalUsage: 10 } },
  };
  calls = [];
  worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await worker?.end();
  if (tdb) await closeTestDatabase(tdb);
});

const usage = async (club: string) => (await tdb.query(`select used, message_limit, source from platform.club_line_usage where club_id = $1 and month = ${MONTH}`, [club])).rows[0];
const health = async (club: string, check: string) => (await tdb.query(`select status, reason from platform.club_health where club_id = $1 and check_key = $2`, [club, check])).rows[0];

describe('line_usage_sync', () => {
  it('reads each Testing, Live and Paused club with its own token and writes its row (LINE-06, D32)', async () => {
    const r = await runLineUsageSync(worker, deps());
    expect(r).toMatchObject({ clubs: 2, fromLine: 2, fallback: 0, errors: 0 });
    expect(await usage(A)).toEqual({ used: 100, message_limit: 1000, source: 'line' });
    expect(await usage(B)).toEqual({ used: 10, message_limit: 200, source: 'line' });
    expect(calls.sort()).toEqual(['consumption:tok-a', 'consumption:tok-b', 'quota:tok-a', 'quota:tok-b']);
  });

  it('(f) at 100 percent on a paid plan the owner message is queued once for the month', async () => {
    lineOf['tok-a']!.consumption = { ok: true, totalUsage: 1000 };
    expect((await runLineUsageSync(worker, deps())).ownerMessages).toBe(1);
    lineOf['tok-a']!.consumption = { ok: true, totalUsage: 1050 };
    expect((await runLineUsageSync(worker, deps())).ownerMessages).toBe(0);
    expect((await tdb.query(`select count(*)::int as n from public.message_outbox where kind = 'owner_cap_paid_over'`)).rows[0].n).toBe(1);
  });

  it('LINE unreadable: the last known value stays, a health alert, and the other club is still synced (LINE-07-AC9, D97)', async () => {
    await runLineUsageSync(worker, deps());
    lineOf['tok-a'] = { quota: { ok: false, code: 'unreachable' }, consumption: { ok: false, code: 'unreachable' } };
    lineOf['tok-b']!.consumption = { ok: true, totalUsage: 20 };
    const r = await runLineUsageSync(worker, deps());
    expect(r).toMatchObject({ clubs: 2, fromLine: 1, fallback: 1, errors: 0 });
    expect(await usage(A)).toEqual({ used: 100, message_limit: 1000, source: 'line' });
    expect(await health(A, 'line_usage')).toEqual({ status: 'failed', reason: 'unreachable' });
    expect(await usage(B)).toMatchObject({ used: 20 });
  });

  it('a club with no token is not called; its usage check says no_token', async () => {
    tokens[B] = null;
    await runLineUsageSync(worker, deps());
    expect(calls.some((c) => c.endsWith('tok-b'))).toBe(false);
    expect(await health(B, 'line_usage')).toEqual({ status: 'failed', reason: 'no_token' });
  });

  it('a club whose call throws is counted as an error and does not stop the others', async () => {
    const throwing: LineUsageApi = { ...api, quota: async (t) => { if (t === 'tok-a') throw new Error('boom'); return api.quota(t); } };
    const r = await runLineUsageSync(worker, { api: throwing, readToken: deps().readToken });
    expect(r).toMatchObject({ clubs: 2, errors: 1, fromLine: 1 });
    expect(await usage(B)).toMatchObject({ used: 10 });
  });

  it('records its run in the heartbeat', async () => {
    await runLineUsageSync(worker, deps());
    expect((await tdb.query(`select count(*)::int as n from platform.worker_heartbeat where task_name = 'line_usage_sync' and last_succeeded_at is not null`)).rows[0].n).toBe(1);
  });
});

describe('line_health (daily token check, design 5.7)', () => {
  it('a refused token fails line_token; a good one clears it; no token is no_token (D114)', async () => {
    lineOf['tok-a']!.quota = { ok: false, code: 'token_rejected' };
    tokens[B] = null;
    expect(await runLineHealth(worker, deps())).toMatchObject({ clubs: 2, failed: 2, ok: 0 });
    expect(await health(A, 'line_token')).toEqual({ status: 'failed', reason: 'token_rejected' });
    expect(await health(B, 'line_token')).toEqual({ status: 'failed', reason: 'no_token' });
    lineOf['tok-a']!.quota = { ok: true, type: 'none', value: null };
    expect(await runLineHealth(worker, deps())).toMatchObject({ ok: 1 });
    expect(await health(A, 'line_token')).toEqual({ status: 'ok', reason: null });
    expect(calls.filter((c) => c.startsWith('consumption'))).toEqual([]);
  });
});
