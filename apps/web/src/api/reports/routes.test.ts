import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileReply } from '@booq/auth';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { reportRoutes } from './routes';

// F13-T14: daily close and report routes (RCPT-03; R2-AC9, AC11; PLAT-06-AC15; D35; design 5).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const ACC = '55555555-5555-4555-8555-555555555555';
const COACH = '66666666-6666-4666-8666-666666666666';
const OWNER_B = '77777777-7777-4777-8777-777777777777';
const deps = { hasFeature: async () => true };

let tdb: TestDatabase;
let db: Db;
const sess = (userId: string, roles: string[], clubId = A) => ({ clubId, userId, roles: roles as never });
const routes = reportRoutes({ db: undefined as never });
const handler = (m: string, p: string) => reportRoutes({ db }).find((r) => r.def.method === m && r.def.path === p)!;
const run = (m: string, p: string, session: ReturnType<typeof sess> | null, input: Record<string, unknown> = {}, body?: unknown) =>
  handler(m, p).handle({ session, input, ...(body === undefined ? {} : { body }) }, deps);
const owner = sess(OWNER, ['owner', 'player']);
const text = (r: unknown) => Buffer.from((r as { body: FileReply }).body.bytes).toString('utf8');
const audits = async () => (await tdb.query(`select new_value from public.audit_entry where action = 'report.exported' order by seq`)).rows.map((r) => r.new_value);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-31T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status, receipt_prefix) values ($1,'a','ก','A','live','HTC'), ($2,'b','ข','B','live','BBB')`, [A, B]);
  for (const [club, u, roles] of [[A, PLAYER, ['player']], [A, DESK, ['front_desk', 'player']], [A, OWNER, ['owner', 'player']], [A, ACC, ['accountant', 'player']], [A, COACH, ['coach', 'player']], [B, OWNER_B, ['owner', 'player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id, full_name) values ($1,$2,$3,$4)', [club, u, 'L' + u.slice(0, 2), 'Name ' + u.slice(0, 2)]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  const C = '66666666-6666-4666-8666-666666666661';
  {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into public.app_user (club_id, id, line_user_id, full_name) values ($1,$2,'LC1','Coach One')`, [A, C]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player'), ($1,$2,'coach')`, [A, C]);
      await c.query(`insert into public.coach (club_id, id) values ($1,$2)`, [A, C]);
      await c.query(`insert into public.coach_pay (club_id, coach_id, monthly_base_satang, solo_pay_kind, solo_pay_value) values ($1,$2,1000000,'fixed',30000)`, [A, C]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  // Two cash payments in club A and one in club B, all on 20 December 2026.
  for (const [club, cents] of [[A, 50000], [A, 30000], [B, 99000]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local session_replication_role = replica');
      const o = (await c.query(`insert into public.orders (club_id, customer_id, source, status) values ($1,$2,'staff','paid') returning id`, [club, club === A ? PLAYER : OWNER_B])).rows[0].id as string;
      await c.query(`insert into public.payment (club_id, order_id, method, status, amount_satang, cash_reason_code, confirmed_at, is_test, taken_by) values ($1,$2,'cash','succeeded',$3,'no_banking_app','2026-12-20T05:00:00Z',false,$4)`, [club, o, cents, club === A ? DESK : OWNER_B]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('route table', () => {
  it('declares who may call each route', () => {
    expect(routes.map((r) => `${r.def.method} ${r.def.path} ${r.def.permission}`).sort()).toEqual([
      'GET /staff/daily-close daily-close.run',
      'GET /staff/daily-close/csv daily-close.run',
      'GET /staff/coach-pay payout.read',
      'GET /staff/coach-pay/csv payout.read',
      'GET /staff/reports/:name report.read',
      'GET /staff/reports/:name/csv report.read',
      'POST /staff/daily-close daily-close.run',
      'POST /staff/coach-pay/:id/adjustments payout.adjust',
      'POST /staff/coach-pay/:id/paid payout.pay',
    ].sort());
  });
});

describe('reports (R2-AC9, AC11)', () => {
  const input = { name: 'cash-by-type', from: '2026-12-01', to: '2026-12-31' };
  it('refuses everyone but the owner and the accountant, and anonymous callers', async () => {
    for (const s of [sess(DESK, ['front_desk', 'player']), sess(COACH, ['coach', 'player']), sess(PLAYER, ['player'])]) {
      expect(await run('GET', '/staff/reports/:name', s, input)).toMatchObject({ ok: false, status: 403 });
      expect(await run('GET', '/staff/reports/:name/csv', s, input)).toMatchObject({ ok: false, status: 403 });
    }
    expect(await run('GET', '/staff/reports/:name', null, input)).toMatchObject({ ok: false, status: 401 });
    expect(await audits()).toEqual([]);
  });
  it('returns the club rows only, as numbers', async () => {
    for (const s of [owner, sess(ACC, ['accountant', 'player'])]) {
      expect(await run('GET', '/staff/reports/:name', s, input)).toMatchObject({
        ok: true,
        body: [{ method: 'beam', payments: 0, amount_satang: 0 }, { method: 'cash', payments: 2, amount_satang: 80000 }],
      });
    }
    expect(await run('GET', '/staff/reports/:name', sess(OWNER_B, ['owner', 'player'], B), input)).toMatchObject({ body: [{ amount_satang: 0 }, { amount_satang: 99000 }] });
  });
  it('validates the name and the dates', async () => {
    expect(await run('GET', '/staff/reports/:name', owner, { ...input, name: 'nope' })).toMatchObject({ ok: false, status: 404 });
    expect(await run('GET', '/staff/reports/:name', owner, { ...input, name: 'constructor' })).toMatchObject({ ok: false, status: 404 });
    for (const bad of [{ from: '2026-12-01' }, { from: '2026-02-30', to: '2026-03-01' }, { from: 'x', to: 'y' }]) {
      expect(await run('GET', '/staff/reports/:name', owner, { name: input.name, ...bad })).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
    }
    expect(await run('GET', '/staff/reports/:name', owner, { ...input, from: '2026-12-31', to: '2026-12-01' })).toMatchObject({ ok: false, status: 400, code: 'invalid_range' });
    expect(await run('GET', '/staff/reports/:name', owner, { name: 'value-owed', asOf: '2026-12-31' })).toMatchObject({ ok: true });
  });
  it('the CSV is the same rows as the screen and is audited (R2-AC9)', async () => {
    const r = await run('GET', '/staff/reports/:name/csv', owner, input);
    expect(r).toMatchObject({ ok: true });
    const f = (r as { body: FileReply }).body;
    expect(f).toBeInstanceOf(FileReply);
    expect(f.options).toEqual({ contentType: 'text/csv; charset=utf-8', filename: 'cash-by-type-2026-12-01-2026-12-31.csv' });
    expect(text(r).replace(/^﻿/, '').trim().split(/\r?\n/)).toEqual(['method,payments,amount_satang', 'beam,0,0', 'cash,2,80000']);
    expect(await audits()).toEqual([{ name: 'cash-by-type', from: '2026-12-01', to: '2026-12-31', rows: 2 }]);
  });
});

describe('daily close (RCPT-03)', () => {
  it('previews an open day, runs a finished day once, then reads and exports it', async () => {
    const open = await run('GET', '/staff/daily-close', owner, { day: '2026-12-20' });
    expect(open).toMatchObject({ ok: true, body: { closed: false, day: '2026-12-20', totals: { money_total_satang: 80000 } } });
    expect(await run('POST', '/staff/daily-close', owner, {}, { day: '2027-01-05' })).toMatchObject({ ok: false, status: 409, code: 'day_not_over' });
    const done = await run('POST', '/staff/daily-close', owner, {}, { day: '2026-12-20' });
    expect(done).toMatchObject({ ok: true, body: { day: '2026-12-20' } });
    expect(await run('POST', '/staff/daily-close', owner, {}, { day: '2026-12-20' })).toMatchObject({ ok: false, status: 409, code: 'already_closed' });
    expect(await run('GET', '/staff/daily-close', owner, { day: '2026-12-20' })).toMatchObject({ ok: true, body: { closed: true, totals: { money_total_satang: 80000 } } });
    const csv = await run('GET', '/staff/daily-close/csv', owner, { day: '2026-12-20' });
    expect(text(csv)).toContain('money_total,,80000');
    expect(text(csv)).toContain('method,cash,80000');
    expect((await audits()).at(-1)).toMatchObject({ name: 'daily-close', from: '2026-12-20', to: '2026-12-20' });
  });
  it('is refused to front desk, coaches and players, and rejects bad bodies', async () => {
    for (const s of [sess(DESK, ['front_desk', 'player']), sess(COACH, ['coach', 'player']), sess(PLAYER, ['player'])]) {
      expect(await run('POST', '/staff/daily-close', s, {}, { day: '2026-12-20' })).toMatchObject({ ok: false, status: 403 });
      expect(await run('GET', '/staff/daily-close', s, { day: '2026-12-20' })).toMatchObject({ ok: false, status: 403 });
    }
    for (const body of [undefined, {}, { day: 'x' }, { day: '2026-12-20', extra: 1 }, []]) {
      expect(await run('POST', '/staff/daily-close', owner, {}, body), JSON.stringify(body)).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
    }
  });
  it("does not show one club's close to another", async () => {
    await run('POST', '/staff/daily-close', owner, {}, { day: '2026-12-20' });
    expect(await run('GET', '/staff/daily-close', sess(OWNER_B, ['owner', 'player'], B), { day: '2026-12-20' })).toMatchObject({ body: { closed: false, totals: { money_total_satang: 99000 } } });
  });
});

describe('coach payouts (R3, D115)', () => {
  const month = { month: '2026-12' };
  const rowsOf = async (s = owner) => ((await run('GET', '/staff/coach-pay', s, month)) as { body: Array<Record<string, any>> }).body;
  it('the owner and the accountant read the month; front desk, a coach and a player are refused; the month must be YYYY-MM', async () => {
    for (const s of [owner, sess(ACC, ['accountant', 'player'])]) {
      expect(await run('GET', '/staff/coach-pay', s, month)).toMatchObject({ ok: true, body: [{ coach_name: 'Coach One', status: 'open', base_satang: 1000000, amount_satang: 1000000, adjustments_satang: 0, total_satang: 1000000, flags: [] }] });
    }
    for (const s of [sess(DESK, ['front_desk', 'player']), sess(COACH, ['coach', 'player']), sess(PLAYER, ['player'])]) {
      expect(await run('GET', '/staff/coach-pay', s, month)).toMatchObject({ ok: false, status: 403 });
    }
    expect(await run('GET', '/staff/coach-pay', null, month)).toMatchObject({ ok: false, status: 401 });
    for (const bad of [{}, { month: '2026-13' }, { month: 'x' }, { month: '2026-12-15' }]) {
      expect(await run('GET', '/staff/coach-pay', owner, bad), JSON.stringify(bad)).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
    }
    expect((await run('GET', '/staff/coach-pay', sess(OWNER_B, ['owner', 'player'], B), month) as { body: unknown[] }).body).toEqual([]);
  });
  it('the CSV has the same rows and is audited', async () => {
    const r = await run('GET', '/staff/coach-pay/csv', sess(ACC, ['accountant', 'player']), month);
    expect((r as { body: FileReply }).body.options.filename).toBe('coach-payouts-2026-12.csv');
    const lines = text(r).replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    expect(lines[0]).toBe('coach_id,coach_name,status,solo_sessions,group_sessions,base_satang,solo_pay_satang,group_pay_satang,flags,amount_satang,adjustments_satang,total_satang,paid_at');
    expect(lines[1]).toContain('Coach One,open,0,0,1000000,0,0,,1000000,0,1000000');
    expect((await audits()).at(-1)).toEqual({ name: 'coach-payouts', from: '2026-12-01', to: '2026-12-01', rows: 1 });
  });
  it('only the owner adjusts, with a reason, and marks paid; the accountant cannot; a paid month takes no more adjustments', async () => {
    const id = (await rowsOf())[0]!.payout_id as string;
    const acc = sess(ACC, ['accountant', 'player']);
    expect(await run('POST', '/staff/coach-pay/:id/adjustments', acc, { id }, { delta_satang: 100, reason: 'x' })).toMatchObject({ ok: false, status: 403 });
    expect(await run('POST', '/staff/coach-pay/:id/paid', acc, { id })).toMatchObject({ ok: false, status: 403 });
    for (const body of [undefined, {}, { delta_satang: 100 }, { delta_satang: 0, reason: 'x' }, { delta_satang: 1.5, reason: 'x' }, { delta_satang: 100, reason: 'x', extra: 1 }]) {
      expect(await run('POST', '/staff/coach-pay/:id/adjustments', owner, { id }, body), JSON.stringify(body)).toMatchObject({ ok: false, status: 400 });
    }
    expect(await run('POST', '/staff/coach-pay/:id/adjustments', owner, { id }, { delta_satang: 100, reason: '   ' })).toMatchObject({ ok: false, status: 400, code: 'reason_required' });
    expect(await run('POST', '/staff/coach-pay/:id/adjustments', owner, { id: 'nope' }, { delta_satang: 100, reason: 'x' })).toMatchObject({ ok: false, status: 404 });
    expect(await run('POST', '/staff/coach-pay/:id/adjustments', owner, { id }, { delta_satang: 2500, reason: 'Bonus' })).toMatchObject({ ok: true });
    expect((await rowsOf())[0]).toMatchObject({ adjustments_satang: 2500, total_satang: 1002500 });
    expect(await run('POST', '/staff/coach-pay/:id/paid', owner, { id })).toMatchObject({ ok: true, body: { id } });
    expect((await rowsOf())[0]).toMatchObject({ status: 'paid' });
    expect(await run('POST', '/staff/coach-pay/:id/paid', owner, { id })).toMatchObject({ ok: false, status: 409, code: 'already_paid' });
    expect(await run('POST', '/staff/coach-pay/:id/adjustments', owner, { id }, { delta_satang: 1, reason: 'late' })).toMatchObject({ ok: false, status: 409, code: 'already_paid' });
    expect(await run('POST', '/staff/coach-pay/:id/paid', sess(OWNER_B, ['owner', 'player'], B), { id })).toMatchObject({ ok: false, status: 404, code: 'not_found' });
  });
  it('marking paid is refused while the pay is unset (409 amount_unset)', async () => {
    await tdb.query(`update public.coach_pay set solo_pay_kind = null, solo_pay_value = null`);
    await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online')`, [A, PLAYER]);
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local session_replication_role = replica');
      const o = (await c.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, PLAYER])).rows[0].id as string;
      await c.query(`insert into public.booking (club_id, order_id, type, resource_id, customer_id, coach_id, start_at, end_at, status, source, created_by, confirmed_at)
                     values ($1,$2,'solo_class',gen_random_uuid(),$3,'66666666-6666-4666-8666-666666666661','2026-12-10T03:00:00Z','2026-12-10T04:00:00Z','confirmed','online',$3, now())`, [A, o, PLAYER]);
      await c.query('commit');
    } finally {
      c.release();
    }
    const row = (await rowsOf())[0]!;
    expect(row).toMatchObject({ amount_satang: null, flags: ['solo_pay_unset'], total_satang: null });
    expect(await run('POST', '/staff/coach-pay/:id/paid', owner, { id: row.payout_id })).toMatchObject({ ok: false, status: 409, code: 'amount_unset' });
  });
});
