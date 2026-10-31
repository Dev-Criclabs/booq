import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F12-T05 / migration 1205: K6 Earnings (CPORT-06; R3, D115, D170). The coach's number is F13's own.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const P1 = '11111111-1111-4111-8111-111111111111';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const C1 = '66666666-6666-4666-8666-666666666661';
const C2 = '66666666-6666-4666-8666-666666666662';
const OWNER_B = '77777777-7777-4777-8777-777777777777';
const RES = '88888888-8888-4888-8888-888888888888';
const MONTH = '2026-12-01';

let tdb: TestDatabase;
let web: Db;
const ctx = (user: string, roles: string[], club = A) => ({ clubId: club, userId: user, roles, source: 'coach_portal' as const });
const coach1 = ctx(C1, ['coach', 'player']);
const owner = ctx(OWNER, ['owner', 'player']);
const rows = async (c: ReturnType<typeof ctx>, sql: string, args: unknown[] = []) => (await web.withClubTx(c, (tx) => tx.query(sql, args))).rows as Array<Record<string, any>>;
const earnings = async (m = MONTH, c = coach1) => (await rows(c, 'select app.my_earnings($1::date) as e', [m]))[0]!.e as Record<string, any>;
const ownerRow = async (coach: string) => (await rows(owner, 'select * from app.payout_month($1::date)', [MONTH])).find((r) => r.coach_id === coach)!;

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
const pay = (coach: string, f: { base?: number | null; solo?: ['fixed' | 'percent', number]; group?: ['fixed' | 'percent', number] }) =>
  tdb.query(`insert into public.coach_pay (club_id, coach_id, monthly_base_satang, solo_pay_kind, solo_pay_value, group_pay_kind, group_pay_value) values ($1,$2,$3,$4,$5,$6,$7)
             on conflict (club_id, coach_id) do update set monthly_base_satang = excluded.monthly_base_satang, solo_pay_kind = excluded.solo_pay_kind, solo_pay_value = excluded.solo_pay_value, group_pay_kind = excluded.group_pay_kind, group_pay_value = excluded.group_pay_value`,
    [A, coach, f.base ?? null, f.solo?.[0] ?? null, f.solo?.[1] ?? null, f.group?.[0] ?? null, f.group?.[1] ?? null]);
async function solo(coach: string, start: string, coachNet = 80000) {
  return raw(async (c) => {
    const o = (await c.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id as string;
    const b = (await c.query(
      `insert into public.booking (club_id, order_id, type, resource_id, customer_id, coach_id, start_at, end_at, status, source, created_by, confirmed_at)
       values ($1,$2,'solo_class',$3,$4,$5,$6::timestamptz,$6::timestamptz + interval '1 hour','confirmed','online',$4, now()) returning id`, [A, o, RES, P1, coach, start])).rows[0].id as string;
    await c.query(`insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, discount_satang, net_satang, credit_value_satang, wallet_satang, money_satang)
                   values ($1,$2,1,'coach','coach','โค้ช','Coach',$4,0,$4,0,0,$4)`.replace("'coach','coach'", "'coach',$3,'coach'"), [A, o, b, coachNet]);
    return b;
  });
}
async function group(coach: string, start: string, price: number | null, seats: number) {
  return raw(async (c) => {
    const s = (await c.query(
      `insert into public.class_session (club_id, template_id, start_at, end_at, name_th, name_en, audience, coach_id, resource_id, min_players, max_players, drop_in_price_satang)
       values ($1, gen_random_uuid(), $2::timestamptz, $2::timestamptz + interval '1 hour', 'ก', 'G', 'adult', $3, $4, 2, 6, $5) returning id`, [A, start, coach, RES, price])).rows[0].id as string;
    for (let i = 0; i < seats; i++) {
      const o = (await c.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id as string;
      await c.query(`insert into public.booking (club_id, order_id, type, resource_id, class_session_id, customer_id, start_at, end_at, status, source, created_by, confirmed_at)
                     values ($1,$2,'class_seat',$3,$4,gen_random_uuid(),$5::timestamptz,$5::timestamptz + interval '1 hour','confirmed','online',$6, now())`, [A, o, RES, s, start, P1]);
    }
  });
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2027-01-05T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  for (const [club, u, roles, name] of [[A, P1, ['player'], 'P'], [A, DESK, ['front_desk', 'player'], 'Desk'], [A, OWNER, ['owner', 'player'], 'Owner'], [A, C1, ['coach', 'player'], 'Coach One'],
    [A, C2, ['coach', 'player'], 'Coach Two'], [B, OWNER_B, ['owner', 'player'], 'Owner B']] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id, full_name) values ($1,$2,$3,$4)', [club, u, 'L' + u.slice(-2), name]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  await raw((c) => c.query(`insert into public.coach (club_id, id) values ($1,$2), ($1,$3)`, [A, C1, C2]));
  web = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});

describe('who may read (CC-2)', () => {
  it('only a coach, and only their own: front desk, the owner who is no coach, a player and another club are refused; a bad month too', async () => {
    for (const c of [ctx(DESK, ['front_desk', 'player']), ctx(OWNER, ['owner', 'player']), ctx(P1, ['player']), ctx(OWNER_B, ['owner', 'player'], B)]) {
      await expect(earnings(MONTH, c), c.roles.join()).rejects.toThrow(/portal:forbidden/);
      await expect(rows(c, 'select * from app.my_payout_history()'), c.roles.join()).rejects.toThrow(/portal:forbidden/);
      await expect(rows(c, 'select * from app.my_payout_adjustments($1::date)', [MONTH]), c.roles.join()).rejects.toThrow(/portal:forbidden/);
    }
    await expect(earnings('2026-12-15')).rejects.toThrow(/portal:invalid_month/);
    await expect(rows(coach1, 'select * from app.my_payout_adjustments($1::date)', ['2026-12-15'])).rejects.toThrow(/portal:invalid_month/);
  });
  it('the functions take no coach: the coach reads no payout table, and another coach\'s figures are never in the answer', async () => {
    await pay(C2, { base: 999999, solo: ['fixed', 55555] });
    await solo(C2, '2026-12-10T03:00:00Z');
    await ownerRow(C2);
    const e = await earnings();
    expect(JSON.stringify(e)).not.toMatch(/999999|55555/);
    expect(await rows(coach1, 'select * from public.coach_payout')).toEqual([]);
    expect(await rows(coach1, 'select * from public.coach_pay')).toEqual([]);
  });
});

describe('the month (CPORT-06)', () => {
  it('equals the owner\'s payout row for the same month, with the coach\'s own rates', async () => {
    await pay(C1, { base: 1000000, solo: ['fixed', 30000], group: ['percent', 2000] });
    await solo(C1, '2026-12-10T03:00:00Z');
    await solo(C1, '2026-12-11T03:00:00Z');
    await group(C1, '2026-12-05T03:00:00Z', 50000, 3);
    const e = await earnings();
    const o = await ownerRow(C1);
    expect(e).toMatchObject({ month: MONTH, status: 'open', solo_sessions: 2, group_sessions: 1, base_satang: 1000000, solo_pay_satang: 60000, group_pay_satang: 30000,
      amount_satang: 1090000, adjustments_satang: 0, total_satang: 1090000, flags: [], paid_at: null,
      solo_rate: { kind: 'fixed', value: 30000 }, group_rate: { kind: 'percent', value: 2000 } });
    expect([e.solo_sessions, e.group_sessions, e.base_satang, e.solo_pay_satang, e.group_pay_satang, e.amount_satang, Number(e.total_satang)])
      .toEqual([o.solo_sessions, o.group_sessions, o.base_satang, o.solo_pay_satang, o.group_pay_satang, o.amount_satang, Number(o.total_satang)]);
  });
  it('a null amount stays null with its flag and is never zero; no rate is shown for a pay that is not set', async () => {
    await solo(C1, '2026-12-10T03:00:00Z');
    expect(await earnings()).toMatchObject({ amount_satang: null, total_satang: null, flags: ['solo_pay_unset'], solo_rate: null, group_rate: null, solo_sessions: 1 });
    await pay(C1, { solo: ['fixed', 30000] });
    await group(C1, '2026-12-05T03:00:00Z', null, 2);
    expect(await earnings()).toMatchObject({ amount_satang: null, flags: ['group_pay_unset'], solo_rate: { kind: 'fixed', value: 30000 } });
    await pay(C1, { solo: ['fixed', 30000], group: ['percent', 2000] });
    expect(await earnings()).toMatchObject({ amount_satang: null, flags: ['group_price_unset'] });
  });
  it('a month with nothing in it is open with zero sessions and, for a freelancer, nothing owed', async () => {
    expect(await earnings('2026-11-01')).toMatchObject({ status: 'open', solo_sessions: 0, group_sessions: 0, amount_satang: 0, total_satang: 0, flags: [] });
  });
  it('adjustments carry the owner\'s reason and move the total; after the owner marks the month paid the frozen figures stay', async () => {
    await pay(C1, { base: 100000, solo: ['fixed', 30000] });
    await solo(C1, '2026-12-10T03:00:00Z');
    const id = (await rows(owner, 'select app.compute_payout($1, $2::date) as id', [C1, MONTH]))[0]!.id as string;
    await rows(owner, 'select app.add_payout_adjustment($1, 5000, $2)', [id, 'Bonus for the tournament']);
    await rows(owner, 'select app.add_payout_adjustment($1, -1500, $2)', [id, 'Late to a class']);
    expect(await earnings()).toMatchObject({ amount_satang: 130000, adjustments_satang: 3500, total_satang: 133500 });
    expect((await rows(coach1, 'select * from app.my_payout_adjustments($1::date)', [MONTH])).map((r) => [r.delta_satang, r.reason]).sort()).toEqual([[-1500, 'Late to a class'], [5000, 'Bonus for the tournament']]);
    await rows(owner, 'select app.mark_payout_paid($1)', [id]);
    await solo(C1, '2026-12-12T03:00:00Z');
    await pay(C1, { base: 1, solo: ['fixed', 1] });
    expect(await earnings()).toMatchObject({ status: 'paid', solo_sessions: 1, amount_satang: 130000, total_satang: 133500 });
    expect((await earnings()).paid_at).not.toBeNull();
  });
  it('another coach\'s adjustments are not listed', async () => {
    await pay(C2, { base: 100000 });
    const id = (await rows(owner, 'select app.compute_payout($1, $2::date) as id', [C2, MONTH]))[0]!.id as string;
    await rows(owner, 'select app.add_payout_adjustment($1, 5000, $2)', [id, 'For C2 only']);
    expect(await rows(coach1, 'select * from app.my_payout_adjustments($1::date)', [MONTH])).toEqual([]);
  });
});

describe('past payouts', () => {
  it('lists the coach\'s paid months only, newest first, with the total paid including adjustments', async () => {
    await pay(C1, { base: 100000 });
    const ids: string[] = [];
    for (const m of ['2026-10-01', '2026-11-01', '2026-12-01']) ids.push((await rows(owner, 'select app.compute_payout($1, $2::date) as id', [C1, m]))[0]!.id as string);
    await rows(owner, 'select app.add_payout_adjustment($1, 2500, $2)', [ids[1], 'Bonus']);
    await rows(owner, 'select app.mark_payout_paid($1)', [ids[0]]);
    await rows(owner, 'select app.mark_payout_paid($1)', [ids[1]]);                    // December stays open
    await pay(C2, { base: 777 });
    const o2 = (await rows(owner, 'select app.compute_payout($1, $2::date) as id', [C2, '2026-11-01']))[0]!.id as string;
    await rows(owner, 'select app.mark_payout_paid($1)', [o2]);
    const h = await rows(coach1, `select to_char(month, 'YYYY-MM-DD') as month, total_satang, paid_at from app.my_payout_history()`);
    expect(h.map((r) => [r.month, Number(r.total_satang)])).toEqual([['2026-11-01', 102500], ['2026-10-01', 100000]]);
    expect(h.every((r) => r.paid_at !== null)).toBe(true);
    expect(await rows(ctx(C2, ['coach', 'player']), 'select count(*)::int as n from app.my_payout_history()')).toEqual([{ n: 1 }]);
  });
});
