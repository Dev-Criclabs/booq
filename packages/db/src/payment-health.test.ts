import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F05-T04c / migration 0699: the Beam checks in platform.club_health (PAY-01-AC7, PAY-02-AC5, D75).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const P = '11111111-1111-4111-8111-111111111111';
let tdb: TestDatabase;
let web: Db;
let worker: Db;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,'L1')`, [A, P]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, P]);
    await c.query('commit');
  } finally {
    c.release();
  }
  web = createDb({ connectionString: tdb.url, max: 2 });
  worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await web.end();
  await worker.end();
  await tdb.close();
});

const player = { clubId: A, userId: P, roles: ['player'] as never, source: 'player_app' as const };
const report = (check: string, reason: string | null, ctx: Parameters<Db['withClubTx']>[0] = player, db = web) =>
  db.withClubTx(ctx, (tx) => tx.query('select app.report_payment_health($1, $2)', [check, reason]));
const row = async (check: string) =>
  (await tdb.query(`select status, reason, changed_at, checked_at from platform.club_health where club_id = $1 and check_key = $2`, [A, check])).rows[0];

describe('app.report_payment_health', () => {
  it('records a failed charge with its reason code, and missing keys on their own check', async () => {
    await report('beam_charge', 'unreachable');
    await report('beam_keys', 'keys_missing');
    expect(await row('beam_charge')).toMatchObject({ status: 'failed', reason: 'unreachable' });
    expect(await row('beam_keys')).toMatchObject({ status: 'failed', reason: 'keys_missing' });
  });

  it('ok clears the reason; changed_at moves only when the status changes, checked_at every time', async () => {
    await tdb.setNow('2026-12-02T10:00:00Z');
    await report('beam_charge', 'unreachable');
    await tdb.setNow('2026-12-02T10:05:00Z');
    await report('beam_charge', 'unreachable');
    const again = await row('beam_charge');
    expect(new Date(again.changed_at).toISOString()).toBe('2026-12-02T10:00:00.000Z');
    expect(new Date(again.checked_at).toISOString()).toBe('2026-12-02T10:05:00.000Z');
    await tdb.setNow('2026-12-02T10:10:00Z');
    await report('beam_charge', null);
    const ok = await row('beam_charge');
    expect(ok).toMatchObject({ status: 'ok', reason: null });
    expect(new Date(ok.changed_at).toISOString()).toBe('2026-12-02T10:10:00.000Z');
  });

  it('refuses an unknown check, an unknown reason and a LINE check (those are F10s)', async () => {
    await expect(report('beam_other', 'unreachable')).rejects.toThrow();
    await expect(report('beam_charge', 'something else')).rejects.toThrow();
    await expect(report('line_token', null)).rejects.toThrow();
  });

  it('the worker may report; a context with no person and not the worker may not', async () => {
    await report('beam_charge', 'unreachable', { clubId: A, userId: null, roles: [] as never, source: 'job' }, worker);
    expect(await row('beam_charge')).toMatchObject({ status: 'failed' });
    await expect(report('beam_charge', null, { clubId: A, userId: null, roles: [] as never, source: 'webhook' })).rejects.toThrow(/not allowed/);
  });

  it('the app role cannot write the table directly; the row holds no person, amount or key', async () => {
    await expect(web.withClubTx(player, (tx) => tx.query(`insert into platform.club_health (club_id, check_key, status) values ($1,'beam_keys','ok')`, [A]))).rejects.toThrow();
    await report('beam_keys', 'key_refused');
    const cols = (await tdb.query(`select column_name from information_schema.columns where table_schema = 'platform' and table_name = 'club_health' order by ordinal_position`)).rows.map((r) => r.column_name);
    expect(cols).toEqual(['club_id', 'check_key', 'status', 'reason', 'changed_at', 'checked_at']);
  });
});
