import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F10-T10 / migration 0611: app.message_facts, the display facts of a message read at send time from the ids in params
// (F10 design 5.4, 5.6; LINE-04-AC1 to AC4, BOOK-06, D64, PLAT-07, CC-3).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const P = '11111111-1111-4111-8111-111111111111';
const COACH = '55555555-5555-4555-8555-555555555555';

let tdb: TestDatabase;
let wk: Db;
const job = { clubId: A, userId: null, roles: [] as never, source: 'job' as const };

async function asReplica(fn: (q: (sql: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>) => Promise<void>) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');   // fixture rows without the business triggers
    await fn((sql, p) => c.query(sql, p));
    await c.query('commit');
  } finally {
    c.release();
  }
}
async function person(id: string, fullName: string | null, display: string | null, role = 'player') {
  await asReplica(async (q) => {
    await q(`insert into public.app_user (club_id, id, line_user_id, full_name, display_name) values ($1,$2,$3,$4,$5)`, [A, id, 'L' + id.slice(0, 3), fullName, display]);
    await q(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [A, id, role]);
  });
}
/** An order of `hours` hours on court "3" from 18:00 Bangkok on 9 Dec 2026, paid as given, with a receipt. */
async function order(hours: number, o: { money?: number; credit?: number; wallet?: number; method?: string | null; receipt?: string | null; coach?: string } = {}) {
  let id = '';
  const bookings: string[] = [];
  await asReplica(async (q) => {
    const loc = (await q(`insert into public.location (club_id, name) values ($1,'M') returning id`, [A])).rows[0]!.id;
    const res = (await q(`insert into public.resource (club_id, location_id, name, sport) values ($1,$2,'3','tennis') returning id`, [A, loc])).rows[0]!.id;
    const money = o.money ?? 50000 * hours;
    const total = money + (o.wallet ?? 0) + (o.credit ?? 0);
    id = (await q(`insert into public.orders (club_id, customer_id, source, price_group_snapshot, subtotal_satang, discount_satang, total_satang,
                                              credit_value_satang, wallet_satang, money_satang, quote_hash, priced_at)
                    values ($1,$2,'online','{}',$3,0,$3,$4,$5,$6,repeat('a',64), now()) returning id`,
      [A, P, total, o.credit ?? 0, o.wallet ?? 0, money])).rows[0]!.id as string;
    for (let h = 0; h < hours; h++) {
      const s = new Date(Date.UTC(2026, 11, 9, 11 + h)).toISOString();
      const e = new Date(Date.UTC(2026, 11, 9, 12 + h)).toISOString();
      bookings.push((await q(`insert into public.booking (club_id, order_id, type, resource_id, coach_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
                              values ($1,$2,$3,$4,$5,$6,$7,$8,'confirmed','online',$8, now()) returning id`,
        [A, id, o.coach ? 'solo_class' : 'court', res, o.coach ?? null, s, e, P])).rows[0]!.id as string);
    }
    let pay: unknown = null;
    if (o.method !== null && money > 0) {
      pay = (await q(`insert into public.payment (club_id, order_id, method, status, environment, gateway, gateway_charge_id, amount_satang, confirmed_at, cash_reason_code, taken_by)
                      values ($1,$2,$3,'succeeded',$4,$5,$6,$7, now(), $8, $9) returning id`,
        [A, id, o.method ?? 'beam', (o.method ?? 'beam') === 'beam' ? 'live' : null, (o.method ?? 'beam') === 'beam' ? 'beam' : null,
         (o.method ?? 'beam') === 'beam' ? 'chg_' + id.slice(0, 8) : null, money, o.method === 'cash' ? 'no_banking_app' : null, o.method === 'cash' ? P : null])).rows[0]!.id;
    }
    if (o.receipt !== null) {
      const number = o.receipt ?? 'HTC-2026-000001';
      const test = number.includes('-T');
      await q(`insert into public.receipt (club_id, order_id, payment_id, kind, series, seq_no, number, vat_flag, lines, total_satang, is_test)
               values ($1,$2,$3,'sale',$4,1,$5,false,'{}',$6,$7)`, [A, id, pay, test ? 'T2026' : '2026', number, money, test]);
    }
  });
  return { id, bookings };
}
const enqueue = (kind: string, params: object, user = P) =>
  tdb.query(`insert into public.message_outbox (club_id, user_id, kind, params, dedupe_key) values ($1,$2,$3,$4::jsonb,$5) returning id`,
    [A, user, kind, JSON.stringify(params), kind + ':' + JSON.stringify(params)]).then((r) => r.rows[0].id as string);
const facts = async (id: string) => wk.withClubTx(job, async (tx) => (await tx.query<{ f: Record<string, unknown> }>(`select app.message_facts($1) as f`, [id])).rows[0]!.f);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ฮันเตอร์','Hunter','live')`, [A]);
  await person(P, 'Nok Somsri', 'nok');
  await person(COACH, 'Bee Chai', 'Coach Bee', 'coach');
  wk = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await wk?.end();
  await tdb?.close();
});

describe('message_facts', () => {
  it('a two hour order: both hours with the court, the club name in both languages, the given name, the amount, PromptPay and one receipt (LINE-04-AC1, BOOK-06)', async () => {
    const o = await order(2);
    const f = await facts(await enqueue('booking_confirmed', { order_id: o.id }));
    expect(f).toMatchObject({
      clubName: { th: 'ฮันเตอร์', en: 'Hunter' },
      firstName: 'Nok',
      moneySatang: 100000, walletSatang: 0, creditValueSatang: 0,
      paidBy: 'beam',
      receiptNumber: 'HTC-2026-000001',
    });
    expect((f['hours'] as Array<Record<string, unknown>>).map((h) => [h['bookingId'], h['court'], new Date(String(h['startAt'])).toISOString()])).toEqual([
      [o.bookings[0], '3', '2026-12-09T11:00:00.000Z'],
      [o.bookings[1], '3', '2026-12-09T12:00:00.000Z'],
    ]);
  });

  it('a zero money order: how it was paid comes from the order, no payment, still its receipt (D64)', async () => {
    const o = await order(1, { money: 0, credit: 50000, method: null, receipt: 'HTC-2026-000002' });
    expect(await facts(await enqueue('booking_confirmed', { order_id: o.id }))).toMatchObject({ moneySatang: 0, creditValueSatang: 50000, paidBy: null, receiptNumber: 'HTC-2026-000002' });
  });

  it('a Testing club’s receipt number is the test series as issued (PLAT-07)', async () => {
    const o = await order(1, { receipt: 'HTC-T2026-000001' });
    expect((await facts(await enqueue('booking_confirmed', { order_id: o.id })))['receiptNumber']).toBe('HTC-T2026-000001');
  });

  it('cash shows as cash; a solo class names its coach; a reminder by booking id finds its order', async () => {
    const o = await order(1, { method: 'cash', coach: COACH });
    expect((await facts(await enqueue('booking_confirmed', { order_id: o.id })))['paidBy']).toBe('cash');
    const r = await facts(await enqueue('reminder_24h', { booking_id: o.bookings[0] }));
    expect(r).toMatchObject({ hoursBefore: 24, moneySatang: 50000 });
    expect((r['hours'] as Array<Record<string, unknown>>)[0]!['coachName']).toBe('Coach Bee');
  });

  it('a coach by id, an amount, a status, the claim minutes setting; no order means no order facts', async () => {
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'waitlist_claim_minutes','30')`, [A]);
    const f = await facts(await enqueue('coach_changed', { coach_id: COACH, amount_satang: 25050, status: 'approved' }));
    expect(f).toMatchObject({ coachName: 'Coach Bee', amountSatang: 25050, status: 'approved', claimMinutes: 30, hours: [], moneySatang: null, receiptNumber: null, package: null, hoursBefore: null });
  });

  it('no name on the record: no given name', async () => {
    const X = '66666666-6666-4666-8666-666666666666';
    await person(X, null, null);
    expect((await facts(await enqueue('booking_confirmed', {}, X)))['firstName']).toBeNull();
  });

  it('only the worker reads it; the facts are never written to the outbox', async () => {
    const o = await order(1);
    const id = await enqueue('booking_confirmed', { order_id: o.id });
    await facts(id);
    expect((await tdb.query(`select params from public.message_outbox where id = $1`, [id])).rows[0].params).toEqual({ order_id: o.id });
    const r = await tdb.query(`select has_function_privilege('booq_app', 'app.message_facts(uuid)', 'execute') as app, has_function_privilege('booq_platform', 'app.message_facts(uuid)', 'execute') as plat`);
    expect(r.rows[0]).toEqual({ app: false, plat: false });
  });
});
