import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F13-T10 / migration 0709: coach payouts (R3, D115; F13 design 3.4, 4.8). Figures come from F07's coach_pay and the delivered sessions.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const P1 = '11111111-1111-4111-8111-111111111111';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const ACC = '55555555-5555-4555-8555-555555555555';
const C1 = '66666666-6666-4666-8666-666666666661';
const C2 = '66666666-6666-4666-8666-666666666662';
const OWNER_B = '77777777-7777-4777-8777-777777777777';
const RES = '88888888-8888-4888-8888-888888888888';
const MONTH = '2026-12-01';

let tdb: TestDatabase;
let web: Db;
const ctx = (user: string, roles: string[], club = A) => ({ clubId: club, userId: user, roles, source: 'admin' as const });
const owner = ctx(OWNER, ['owner', 'player']);
const acc = ctx(ACC, ['accountant', 'player']);
const as = async <T = Record<string, any>>(c: ReturnType<typeof ctx>, sql: string, args: unknown[] = []) => (await web.withClubTx(c, (tx) => tx.query(sql, args))).rows as T[];
const compute = (coach: string, c = owner) => as<{ id: string }>(c, 'select app.compute_payout($1, $2::date) as id', [coach, MONTH]).then((r) => r[0]!.id);
const month = (c = owner, m = MONTH) => as(c, 'select * from app.payout_month($1::date)', [m]);
const rowOf = async (coach: string) => (await month()).find((r) => r.coach_id === coach)!;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status, receipt_prefix) values ($1,'a','ก','A','live','HTC'), ($2,'b','ข','B','live','BBB')`, [A, B]);
  for (const [club, u, roles, name] of [[A, P1, ['player'], 'Player'], [A, DESK, ['front_desk', 'player'], 'Desk'], [A, OWNER, ['owner', 'player'], 'Owner'], [A, ACC, ['accountant', 'player'], 'Acc'],
    [A, C1, ['coach', 'player'], 'Coach One'], [A, C2, ['coach', 'player'], 'Coach Two'], [B, OWNER_B, ['owner', 'player'], 'Owner B']] as const) {
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
  await tdb.setNow('2027-01-05T03:00:00Z');
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});

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

/** A solo class of one hour at `start`, with a coach line of `coachNet` satang (null: no coach line). */
async function solo(coach: string, start: string, over: { status?: string; coachNet?: number | null; test?: boolean } = {}) {
  return raw(async (c) => {
    const o = (await c.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id as string;
    const b = (await c.query(
      `insert into public.booking (club_id, order_id, type, resource_id, customer_id, coach_id, start_at, end_at, status, source, created_by, confirmed_at, is_test, release_reason, released_at)
       values ($1,$2,'solo_class',$3,$4,$5,$6::timestamptz,$6::timestamptz + interval '1 hour',$7,'online',$4, now(), $8, case when $7 = 'released' then 'expired' end, case when $7 = 'released' then now() end) returning id`,
      [A, o, RES, P1, coach, start, over.status ?? 'confirmed', over.test ?? false])).rows[0].id as string;
    if (over.coachNet !== null) {
      await c.query(
        `insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, discount_satang, net_satang, credit_value_satang, wallet_satang, money_satang)
         values ($1,$2,1,'coach',$3,'coach','โค้ช','Coach',$4,0,$4,0,0,$4)`, [A, o, b, over.coachNet ?? 80000]);
    }
    return b;
  });
}
/** A group session at `start` with seats of the given statuses. */
async function group(coach: string, start: string, seats: string[], status = 'scheduled', price: number | null = null) {
  return raw(async (c) => {
    const s = (await c.query(
      `insert into public.class_session (club_id, template_id, start_at, end_at, name_th, name_en, audience, coach_id, resource_id, min_players, max_players, status, cancel_reason, cancelled_at, drop_in_price_satang)
       values ($1, gen_random_uuid(), $2::timestamptz, $2::timestamptz + interval '1 hour', 'กลุ่ม', 'Group', 'adult', $3, $4, 2, 6, $5, case when $5 = 'cancelled' then 'owner' end, case when $5 = 'cancelled' then now() end, $6) returning id`, [A, start, coach, RES, status, price])).rows[0].id as string;
    for (const st of seats) {
      const o = (await c.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id as string;
      await c.query(
        `insert into public.booking (club_id, order_id, type, resource_id, class_session_id, customer_id, start_at, end_at, status, source, created_by, confirmed_at, release_reason, released_at, hold_expires_at)
         values ($1,$2,'class_seat',$3,$4,gen_random_uuid(),$5::timestamptz,$5::timestamptz + interval '1 hour',$6,'online',$7, now(), case when $6 = 'released' then 'expired' end, case when $6 = 'released' then now() end, case when $6 = 'awaiting_payment' then now() + interval '1 hour' end)`, [A, o, RES, s, start, st, P1]);
    }
    return s;
  });
}

describe('who may call', () => {
  it('the owner and the accountant compute and list; front desk, a coach and a player are refused', async () => {
    await compute(C1);
    await compute(C1, acc);
    expect((await month(acc)).length).toBeGreaterThan(0);
    for (const c of [ctx(DESK, ['front_desk', 'player']), ctx(C1, ['coach', 'player']), ctx(P1, ['player'])]) {
      await expect(compute(C1, c), c.roles.join()).rejects.toThrow(/payout:forbidden/);
      await expect(month(c), c.roles.join()).rejects.toThrow(/payout:forbidden/);
    }
    await expect(as(owner, 'select app.compute_payout($1, $2::date)', [C1, '2026-12-15'])).rejects.toThrow(/payout:invalid_month/);
    await expect(as(owner, 'select app.compute_payout($1, $2::date)', [P1, MONTH])).rejects.toThrow(/payout:coach_not_found/);
  });
  it('only the owner adjusts and marks paid; the accountant and the others are refused', async () => {
    await pay(C1, { base: 100000 });
    const id = await compute(C1);
    for (const c of [acc, ctx(DESK, ['front_desk', 'player']), ctx(C1, ['coach', 'player'])]) {
      await expect(as(c, 'select app.add_payout_adjustment($1, 100, $2)', [id, 'x']), c.roles.join()).rejects.toThrow(/payout:forbidden/);
      await expect(as(c, 'select app.mark_payout_paid($1)', [id]), c.roles.join()).rejects.toThrow(/payout:forbidden/);
    }
  });
  it('no role writes a payout directly', async () => {
    const id = await compute(C1);
    await expect(as(owner, `update public.coach_payout set status = 'paid' where id = $1`, [id])).rejects.toThrow(/permission denied/);
    await expect(as(owner, `insert into public.coach_payout (club_id, coach_id, month) values ($1,$2,'2026-11-01')`, [A, C1])).rejects.toThrow(/permission denied/);
    await expect(as(owner, `delete from public.coach_payout_adjustment`)).rejects.toThrow(/permission denied/);
  });
});

describe('which sessions count (R3; D147)', () => {
  it('counts a played solo class and a no show; not a cancelled, late cancelled, released or unplayed one, nor another month, coach or test row', async () => {
    await pay(C1, { solo: ['fixed', 30000] });
    await solo(C1, '2026-12-10T03:00:00Z');                                  // played
    await solo(C1, '2026-12-11T03:00:00Z', { status: 'no_show' });          // no show counts
    await solo(C1, '2026-12-12T03:00:00Z', { status: 'cancelled' });
    await solo(C1, '2026-12-13T03:00:00Z', { status: 'late_cancelled' });
    await solo(C1, '2026-12-14T03:00:00Z', { status: 'released' });
    await solo(C1, '2027-01-20T03:00:00Z');                                  // next month, and not yet played
    await solo(C1, '2026-11-30T16:00:00Z');                                  // 30 Nov 23:00 Bangkok
    await solo(C1, '2026-12-31T17:00:00Z');                                  // 1 Jan 00:00 Bangkok
    await solo(C2, '2026-12-15T03:00:00Z');                                  // another coach
    await solo(C1, '2026-12-16T03:00:00Z', { test: true });
    const r = await rowOf(C1);
    expect([r.solo_sessions, r.group_sessions, r.amount_satang]).toEqual([2, 0, 60000]);
  });
  it('the boundary hours: 1 Dec 00:00 Bangkok counts for December, 31 Dec 23:00 Bangkok counts; a booking whose hour has not ended does not', async () => {
    await pay(C1, { solo: ['fixed', 1000] });
    await solo(C1, '2026-11-30T17:00:00Z');
    await solo(C1, '2026-12-31T16:00:00Z');
    expect((await rowOf(C1)).solo_sessions).toBe(2);
    await tdb.setNow('2026-12-20T03:30:00Z');
    await solo(C1, '2026-12-20T03:00:00Z');
    expect((await rowOf(C1)).solo_sessions).toBe(1);       // 31 Dec 23:00 is in the future now; the played hour of the 20th is still running
  });
  it('a group session counts once when it was held and a seat was played or a no show; not a cancelled session, nor one with no live seat', async () => {
    await pay(C1, { group: ['fixed', 20000] });
    await group(C1, '2026-12-05T03:00:00Z', ['confirmed', 'confirmed', 'no_show']);
    await group(C1, '2026-12-06T03:00:00Z', ['cancelled', 'released']);
    await group(C1, '2026-12-07T03:00:00Z', ['confirmed'], 'cancelled');
    await group(C2, '2026-12-08T03:00:00Z', ['confirmed']);
    const r = await rowOf(C1);
    expect([r.group_sessions, r.group_pay_satang, r.amount_satang]).toEqual([1, 20000, 20000]);
  });
  it('a substitute session pays the substitute, not the coach it was booked with (F07)', async () => {
    await pay(C1, { solo: ['fixed', 30000] });
    await pay(C2, { solo: ['fixed', 25000] });
    const b = await solo(C1, '2026-12-10T03:00:00Z');
    await raw((c) => c.query(`update public.booking set coach_id = $2 where id = $1`, [b, C2]));
    expect([(await rowOf(C1)).solo_sessions, (await rowOf(C2)).solo_sessions, (await rowOf(C2)).amount_satang]).toEqual([0, 1, 25000]);
  });
});

describe('group percent pay (D170)', () => {
  it('is the percentage of the full listed seat price of each seat booked, summed over the month and rounded once', async () => {
    await pay(C1, { base: 100000, group: ['percent', 2000] });
    await group(C1, '2026-12-05T03:00:00Z', ['confirmed', 'confirmed', 'no_show'], 'scheduled', 50000);   // 3 seats x 500 baht
    await group(C1, '2026-12-06T03:00:00Z', ['confirmed'], 'scheduled', 33333);                        // 1 seat
    await group(C1, '2026-12-07T03:00:00Z', ['confirmed', 'cancelled', 'released', 'awaiting_payment'], 'scheduled', 10000);   // 1 live seat
    // (150000 + 33333 + 10000) x 20% = 38666.6 -> 38667
    expect(await rowOf(C1)).toMatchObject({ group_sessions: 3, group_pay_satang: 38667, amount_satang: 138667, flags: [] });
  });
  it('the flag group_percent_no_base is never raised any more', async () => {
    await pay(C1, { group: ['percent', 5000] });
    await group(C1, '2026-12-05T03:00:00Z', ['confirmed'], 'scheduled', 20000);
    const r = await rowOf(C1);
    expect(r.flags).toEqual([]);
    expect(r.amount_satang).toBe(10000);
  });
});

describe('what is owed', () => {
  it('base + fixed solo pay per session + fixed group pay per session', async () => {
    await pay(C1, { base: 1000000, solo: ['fixed', 30000], group: ['fixed', 20000] });
    await solo(C1, '2026-12-10T03:00:00Z');
    await solo(C1, '2026-12-11T03:00:00Z');
    await group(C1, '2026-12-05T03:00:00Z', ['confirmed']);
    expect(await rowOf(C1)).toMatchObject({ base_satang: 1000000, solo_pay_satang: 60000, group_pay_satang: 20000, amount_satang: 1080000, total_satang: '1080000', flags: [] });
  });
  it('a percentage applies to the coaching portion only, summed over the month and rounded once', async () => {
    await pay(C1, { solo: ['percent', 3333] });
    await solo(C1, '2026-12-10T03:00:00Z', { coachNet: 80000 });
    await solo(C1, '2026-12-11T03:00:00Z', { coachNet: 70001 });           // 150001 x 33.33% = 49995.33 -> 49995
    expect((await rowOf(C1)).amount_satang).toBe(49995);
  });
  it('a freelancer (no base) with no sessions is owed nothing and is not flagged', async () => {
    expect(await rowOf(C1)).toMatchObject({ amount_satang: 0, flags: [], solo_sessions: 0, group_sessions: 0 });
  });
});

describe('an unset pay setting gives null and a flag, never a guess', () => {
  it('sessions with no solo pay or no group pay set: amount null, flagged', async () => {
    await pay(C1, { base: 500000 });
    await solo(C1, '2026-12-10T03:00:00Z');
    await group(C1, '2026-12-05T03:00:00Z', ['confirmed']);
    expect(await rowOf(C1)).toMatchObject({ amount_satang: null, total_satang: null, flags: ['solo_pay_unset', 'group_pay_unset'], solo_sessions: 1, group_sessions: 1 });
  });
  it('no coach_pay row at all is the same', async () => {
    await solo(C1, '2026-12-10T03:00:00Z');
    expect(await rowOf(C1)).toMatchObject({ amount_satang: null, flags: ['solo_pay_unset'] });
  });
  it('a percent solo pay with no coach line has no portion: flagged', async () => {
    await pay(C1, { solo: ['percent', 5000] });
    await solo(C1, '2026-12-10T03:00:00Z', { coachNet: null });
    expect(await rowOf(C1)).toMatchObject({ amount_satang: null, flags: ['solo_portion_missing'] });
  });
  it('a group session with seats and no listed seat price cannot be priced as a percentage: flagged, never guessed (D170)', async () => {
    await pay(C1, { group: ['percent', 2000] });
    await group(C1, '2026-12-05T03:00:00Z', ['confirmed']);
    expect(await rowOf(C1)).toMatchObject({ amount_satang: null, flags: ['group_price_unset'] });
  });
  it('setting the pay later and listing again clears the flag (the row is recomputed while open)', async () => {
    await solo(C1, '2026-12-10T03:00:00Z');
    expect((await rowOf(C1)).amount_satang).toBeNull();
    await pay(C1, { solo: ['fixed', 30000] });
    expect(await rowOf(C1)).toMatchObject({ amount_satang: 30000, flags: [] });
  });
});

describe('adjustments (D115)', () => {
  it('need a reason and a non zero amount, add to the total, and are never edited or deleted', async () => {
    await pay(C1, { base: 100000 });
    const id = await compute(C1);
    await expect(as(owner, 'select app.add_payout_adjustment($1, 500, $2)', [id, '  '])).rejects.toThrow(/payout:reason_required/);
    await expect(as(owner, 'select app.add_payout_adjustment($1, 0, $2)', [id, 'why'])).rejects.toThrow(/payout:invalid_delta/);
    await expect(as(owner, 'select app.add_payout_adjustment($1, 500, $2)', ['aaaaaaaa-0000-4000-8000-0000000000ff', 'why'])).rejects.toThrow(/payout:not_found/);
    await as(owner, 'select app.add_payout_adjustment($1, 5000, $2)', [id, 'Bonus for the tournament']);
    await as(owner, 'select app.add_payout_adjustment($1, -1500, $2)', [id, 'Late to a class']);
    expect(await rowOf(C1)).toMatchObject({ amount_satang: 100000, adjustments_satang: '3500', total_satang: '103500' });
    expect((await tdb.query(`select reason from public.coach_payout_adjustment`)).rows.map((r) => r.reason).sort()).toEqual(['Bonus for the tournament', 'Late to a class']);
    await expect(tdb.query(`update public.coach_payout_adjustment set reason = 'x'`)).rejects.toThrow();
    await expect(tdb.query(`delete from public.coach_payout_adjustment`)).rejects.toThrow();
  });
  it('are written to the club audit log without an amount', async () => {
    const id = await compute(C1);
    await as(owner, 'select app.add_payout_adjustment($1, 5000, $2)', [id, 'Bonus']);
    const rows = (await tdb.query(`select action, actor_label, new_value from public.audit_entry where record_type = 'coach_payout'`)).rows;
    expect(rows.map((r) => r.action)).toEqual(['payout.adjusted']);
    expect(JSON.stringify(rows[0].new_value)).not.toMatch(/5000/);
  });
});

describe('mark paid (D115)', () => {
  it('freezes the month: later sessions, a changed pay and new adjustments change nothing, and a second mark is refused', async () => {
    await pay(C1, { base: 100000, solo: ['fixed', 30000] });
    await solo(C1, '2026-12-10T03:00:00Z');
    const id = await compute(C1);
    await as(owner, 'select app.add_payout_adjustment($1, 2000, $2)', [id, 'Bonus']);
    await as(owner, 'select app.mark_payout_paid($1)', [id]);
    expect(await rowOf(C1)).toMatchObject({ status: 'paid', amount_satang: 130000, total_satang: '132000' });
    expect((await tdb.query(`select paid_by from public.coach_payout where id = $1`, [id])).rows[0].paid_by).toBe(OWNER);
    await solo(C1, '2026-12-11T03:00:00Z');
    await pay(C1, { base: 999, solo: ['fixed', 1] });
    expect(await rowOf(C1)).toMatchObject({ status: 'paid', amount_satang: 130000, solo_sessions: 1 });
    expect(await compute(C1)).toBe(id);
    await expect(as(owner, 'select app.add_payout_adjustment($1, 100, $2)', [id, 'late'])).rejects.toThrow(/payout:already_paid/);
    await expect(as(owner, 'select app.mark_payout_paid($1)', [id])).rejects.toThrow(/payout:already_paid/);
    expect((await as(owner, `select action from public.audit_entry where record_type = 'coach_payout' order by seq`)).map((r) => r.action)).toEqual(['payout.adjusted', 'payout.paid']);
  });
  it('is recomputed at the moment of paying, so the frozen figures are current', async () => {
    await pay(C1, { solo: ['fixed', 30000] });
    await solo(C1, '2026-12-10T03:00:00Z');
    const id = await compute(C1);
    await solo(C1, '2026-12-11T03:00:00Z');
    await as(owner, 'select app.mark_payout_paid($1)', [id]);
    expect(await rowOf(C1)).toMatchObject({ solo_sessions: 2, amount_satang: 60000 });
  });
  it('is refused while the amount is unset, and when adjustments would make the total negative', async () => {
    await solo(C1, '2026-12-10T03:00:00Z');
    const id = await compute(C1);
    await expect(as(owner, 'select app.mark_payout_paid($1)', [id])).rejects.toThrow(/payout:amount_unset/);
    await pay(C1, { solo: ['fixed', 30000] });
    await as(owner, 'select app.add_payout_adjustment($1, -40000, $2)', [id, 'Advance paid']);
    await expect(as(owner, 'select app.mark_payout_paid($1)', [id])).rejects.toThrow(/payout:negative_total/);
    expect((await rowOf(C1)).status).toBe('open');
  });
});

describe('a coach reads their own month (K6)', () => {
  it('sees only their own figures; a person who is not a coach is refused; a paid month shows as stored', async () => {
    await pay(C1, { solo: ['fixed', 30000] });
    await pay(C2, { solo: ['fixed', 99000] });
    await solo(C1, '2026-12-10T03:00:00Z');
    await solo(C2, '2026-12-10T05:00:00Z');
    const mine = await as(ctx(C1, ['coach', 'player']), 'select * from app.my_payouts($1::date)', [MONTH]);
    expect(mine).toEqual([expect.objectContaining({ status: 'open', solo_sessions: 1, amount_satang: 30000, total_satang: '30000' })]);
    for (const c of [ctx(P1, ['player']), ctx(DESK, ['front_desk', 'player']), ctx(OWNER, ['owner', 'player'])]) {
      await expect(as(c, 'select * from app.my_payouts($1::date)', [MONTH]), c.roles.join()).rejects.toThrow(/payout:forbidden/);
    }
    await as(owner, 'select app.mark_payout_paid($1)', [await compute(C1)]);
    expect((await as(ctx(C1, ['coach', 'player']), 'select * from app.my_payouts($1::date)', [MONTH]))[0]).toMatchObject({ status: 'paid', amount_satang: 30000 });
    expect(await as(ctx(C1, ['coach', 'player']), 'select * from public.coach_payout')).toEqual([]);      // no direct read
  });
  it('a flagged month shows no amount to the coach', async () => {
    await solo(C1, '2026-12-10T03:00:00Z');
    expect((await as(ctx(C1, ['coach', 'player']), 'select * from app.my_payouts($1::date)', [MONTH]))[0]).toMatchObject({ amount_satang: null, total_satang: null, flags: ['solo_pay_unset'] });
  });
});

describe('clubs and test rows', () => {
  it("another club's owner sees none of this club's payouts, and the accountant reads them only through the functions", async () => {
    await pay(C1, { base: 100000 });
    await compute(C1);
    expect(await month(ctx(OWNER_B, ['owner', 'player'], B))).toEqual([]);
    expect(await as(ctx(OWNER_B, ['owner', 'player'], B), 'select * from public.coach_payout')).toEqual([]);
    expect((await as(acc, 'select * from public.coach_payout')).length).toBe(1);
    expect(await as(ctx(DESK, ['front_desk', 'player']), 'select * from public.coach_payout')).toEqual([]);
  });
  it('a test coach has test payouts, which the Go live purge may delete', async () => {
    const T = '66666666-6666-4666-8666-666666666663';
    await raw(async (c) => {
      await c.query(`insert into public.app_user (club_id, id, line_user_id, full_name, is_test) values ($1,$2,'LT','Test Coach', true)`, [A, T]);
      await c.query(`insert into public.coach (club_id, id) values ($1,$2)`, [A, T]);
    });
    await compute(T);
    expect((await tdb.query(`select is_test from public.coach_payout where coach_id = $1`, [T])).rows).toEqual([{ is_test: true }]);
  });
});
