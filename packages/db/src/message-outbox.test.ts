import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectRegistry } from './registry';
import { checkTableClasses } from './registry/check';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F10-T02 / migration 0601: message_outbox (FA 5.3, F10 design 4.1). LINE-03-AC6 (the row is the message
// log: type, club, recipient, time, result, no text), CC-1 (club scope), CC-3 (no personal data in params).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const T = 'c0ffee00-1111-4222-8333-444455556666';
const PA = '11111111-1111-4111-8111-111111111111';
const PB = '22222222-2222-4222-8222-222222222222';
const PT = '33333333-3333-4333-8333-333333333333';

let tdb: TestDatabase;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(
    `insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live'), ($3,'t','ท','T','testing')`,
    [A, B, T],
  );
  for (const [club, u] of [[A, PA], [B, PB], [T, PT]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [club, u, 'L' + u.slice(0, 2)]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [club, u]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
});
afterEach(async () => {
  await tdb.close();
});

const put = (o: { club?: string; user?: string; kind?: string; params?: unknown; key?: string; status?: string; voidReason?: string | null } = {}) =>
  tdb.query(
    `insert into public.message_outbox (club_id, user_id, kind, params, dedupe_key, send_at, status, void_reason)
     values ($1,$2,$3,$4::jsonb,$5, now(), $6, $7) returning id, is_test, retry_key, attempts`,
    [o.club ?? A, o.user ?? PA, o.kind ?? 'booking_confirmed', JSON.stringify(o.params ?? { order_id: PB }), o.key ?? 'confirmed:1', o.status ?? 'pending', o.voidReason ?? null],
  );

describe('message_outbox (F10-T02, LINE-03-AC6, CC-1, CC-3)', () => {
  it('a duplicate dedupe key in one club is refused; the same key in another club is its own row', async () => {
    await put();
    await expect(put()).rejects.toThrow(/message_outbox_dedupe/);
    await put({ club: B, user: PB });
  });

  it('refuses params with a name, phone or date of birth key, at any depth and in either spelling (CC-3)', async () => {
    for (const params of [
      { name: 'Somchai' },
      { coach_name: 'x' },
      { coachName: 'x' },
      { phone: '0812345678' },
      { mobile_phone: 'x' },
      { date_of_birth: '1990-01-01' },
      { dateOfBirth: 'x' },
      { dob: 'x' },
      { email: 'x' },
      { line_user_id: 'U1' },
      { lines: [{ hour: 9, player: { full_name: 'x' } }] },
    ]) {
      await expect(put({ params, key: JSON.stringify(params) })).rejects.toThrow(/message_outbox_params_not_personal/);
    }
  });

  it('accepts ids and values, and params must be an object', async () => {
    await put({ params: { order_id: PB, booking_id: PA, amount_satang: 50000, hours: [9, 10], receipt_number: 'HTC-2026-0001' } });
    await put({ key: 'birthday:x', kind: 'birthday_discount', params: { birthday_discount_percent: 10, year: 2026 } });
    await expect(put({ key: 'arr', params: [1, 2] })).rejects.toThrow(/message_outbox_params_object/);
  });

  it('status and void reason take the design values; a void row has a reason and only a void row has one', async () => {
    await expect(put({ status: 'queued' })).rejects.toThrow(/message_outbox_status_values/);
    await expect(put({ status: 'void', voidReason: 'bored' })).rejects.toThrow(/message_outbox_void_reason_values/);
    await expect(put({ status: 'void' })).rejects.toThrow(/message_outbox_void_has_reason/);
    await expect(put({ status: 'pending', voidReason: 'cap' })).rejects.toThrow(/message_outbox_void_has_reason/);
    let i = 0;
    for (const r of ['cancelled', 'moved', 'cap', 'switch_off', 'no_credits', 'superseded']) await put({ key: `v${i++}`, status: 'void', voidReason: r });
    for (const s of ['failed', 'undeliverable']) await put({ key: `s${i++}`, status: s });
    await expect(put({ key: 'sent', status: 'sent' })).rejects.toThrow(/message_outbox_sent_has_time/);
  });

  it('a row carries a stable retry key, starts at zero attempts, and a final row stays final', async () => {
    const row = (await put()).rows[0];
    expect(row.retry_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.attempts).toBe(0);
    await expect(tdb.query(`update public.message_outbox set retry_key = gen_random_uuid() where id = $1`, [row.id])).rejects.toThrow(/do not change/);
    await expect(tdb.query(`update public.message_outbox set dedupe_key = 'other' where id = $1`, [row.id])).rejects.toThrow(/do not change/);
    await tdb.query(`update public.message_outbox set attempts = 1, last_error = 'timeout' where id = $1`, [row.id]);
    await tdb.query(`update public.message_outbox set status = 'sent', sent_at = now() where id = $1`, [row.id]);
    await expect(tdb.query(`update public.message_outbox set status = 'pending', sent_at = null where id = $1`, [row.id])).rejects.toThrow(/final/);
    const v = (await put({ key: 'v', status: 'void', voidReason: 'cap' })).rows[0];
    await expect(tdb.query(`update public.message_outbox set status = 'pending', void_reason = null where id = $1`, [v.id])).rejects.toThrow(/final/);
  });

  it('the recipient must be a person of the same club', async () => {
    await expect(put({ user: PB })).rejects.toThrow(/foreign key/);
  });

  it('is_test comes from the club status and every Testing club row carries it (D4, D32)', async () => {
    expect((await put()).rows[0].is_test).toBe(false);
    expect((await put({ club: T, user: PT })).rows[0].is_test).toBe(true);
  });

  it('pending rows are found by send time through the partial index', async () => {
    const idx = (await tdb.query(`select indexdef from pg_indexes where tablename = 'message_outbox' and indexname = 'message_outbox_due'`)).rows[0];
    expect(idx.indexdef).toMatch(/\(send_at\) WHERE \(status = 'pending'::text\)/);
  });

  it('another club’s rows are not reachable, and no application role reads the outbox yet (CC-1)', async () => {
    await put();
    await put({ club: B, user: PB });
    const c = await tdb.pool.connect();
    try {
      // No application role holds a grant before F10-T07.
      for (const role of ['booq_app', 'booq_worker', 'booq_platform']) {
        await c.query('begin');
        await c.query(`set local role ${role}`);
        await expect(c.query('select 1 from public.message_outbox')).rejects.toThrow(/permission denied/);
        await c.query('rollback');
      }
      // Even with a grant and an open policy, the restrictive tenant policy keeps a club to its own rows.
      await c.query('begin');
      await c.query('grant select on public.message_outbox to booq_worker');
      await c.query('create policy t_open on public.message_outbox for select to booq_worker using (true)');
      await c.query('set local role booq_worker');
      await c.query(`select set_config('app.club_id', $1, true)`, [A]);
      const rows = (await c.query('select club_id from public.message_outbox')).rows;
      expect(rows.map((r) => r.club_id)).toEqual([A]);
      await c.query('rollback');
    } finally {
      c.release();
    }
  });

  it('the row holds no text column (the log is type, club, recipient, time and result; CC-3)', async () => {
    const cols = (await tdb.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'message_outbox' order by ordinal_position`)).rows.map((r) => r.column_name);
    expect(cols).toEqual([
      'club_id', 'id', 'user_id', 'kind', 'params', 'dedupe_key', 'send_at', 'status', 'void_reason',
      'attempts', 'last_error', 'retry_key', 'sent_at', 'is_test', 'created_at',
    ]);
  });

  it('is classified D, purged at Go live and passes the table class check', async () => {
    const reg = await collectRegistry();
    expect(reg['public.message_outbox']).toEqual({ class: 'D' });
    const res = await checkTableClasses(tdb.pool, reg);
    expect(res.problems.filter((p) => p.table === 'public.message_outbox')).toEqual([]);
    const t = (await tdb.query(`select delete_order from app.test_tables where table_name = 'message_outbox'`)).rows[0];
    expect(t.delete_order).toBeLessThan(900);
  });
});
