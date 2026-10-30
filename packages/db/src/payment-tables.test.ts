import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectRegistry } from './registry';
import { checkTableClasses } from './registry/check';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F05-T01 / migrations 0401, 0402: payment, payment_event, owner_flag (PAY-02, PAY-06-AC1, AC2,
// PAY-05; D71, D72, D75, D76) and F05-T02 reads.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const ACC = '55555555-5555-4555-8555-555555555555';
const HASH = 'a'.repeat(64);

let tdb: TestDatabase;
let web: Db;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  for (const [club, u, roles] of [[A, PLAYER, ['player']], [A, OTHER, ['player']], [A, DESK, ['front_desk', 'player']], [A, OWNER, ['owner', 'player']], [A, ACC, ['accountant', 'player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [club, u, 'L' + u.slice(0, 2)]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  web = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});
const ctx = (user: string, roles: string[], club = A) => ({ clubId: club, userId: user, roles, source: 'admin' as const });

/** A priced order for the fixtures (written with triggers off, so no lines are needed). */
async function pricedOrder(customer: string | null = PLAYER, money = 50000, club = A) {
  const o = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [club, customer])).rows[0].id as string;
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local session_replication_role = replica`);   // fixture: a priced order without lines
    await c.query(`update public.orders set price_group_snapshot='{}', subtotal_satang=$2, discount_satang=0, total_satang=$2, credit_value_satang=0, wallet_satang=0, money_satang=$2, quote_hash=repeat('a',64), priced_at=now() where id=$1`, [o, money]);
    await c.query('commit');
  } finally {
    c.release();
  }
  return o;
}
const beam = (o: string, extra: { amount?: number; charge?: string | null; status?: string; env?: string } = {}) =>
  tdb.query(
    `insert into public.payment (club_id, order_id, method, status, environment, gateway, gateway_charge_id, amount_satang, confirmed_at)
     values ($1,$2,'beam',$3,$4,'beam',$5, $6, case when $3 = 'succeeded' then now() end) returning id`,
    [A, o, extra.status ?? 'pending', extra.env ?? 'live', extra.charge === undefined ? 'chg_' + Math.random().toString(36).slice(2) : extra.charge, extra.amount ?? 50000],
  );
const cash = (o: string, reason: string | null, note: string | null = null, by: string | null = DESK) =>
  tdb.query(
    `insert into public.payment (club_id, order_id, method, status, amount_satang, cash_reason_code, cash_reason_note, taken_by, confirmed_at) values ($1,$2,'cash','succeeded',50000,$3,$4,$5, now()) returning id`,
    [A, o, reason, note, by],
  );

describe('payment (PAY-02, D72)', () => {
  it('a Beam charge is for the order’s frozen money due and nothing else', async () => {
    const o = await pricedOrder();
    await expect(beam(o, { amount: 40000 })).rejects.toThrow(/money due/);
    await beam(o);
    const unpriced = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, PLAYER])).rows[0].id;
    await expect(beam(unpriced)).rejects.toThrow(/not priced/);
  });
  it('one pending charge per order; a new one only after the first failed', async () => {
    const o = await pricedOrder();
    await beam(o);
    await expect(beam(o)).rejects.toThrow(/payment_one_pending_beam/);
    await tdb.query(`update public.payment set status = 'failed', failure_code = 'DECLINED'`);
    await beam(o);
  });
  it('a charge id is unique per club and gateway', async () => {
    const o = await pricedOrder(); const o2 = await pricedOrder(OTHER);
    await beam(o, { charge: 'chg_same' });
    await expect(beam(o2, { charge: 'chg_same' })).rejects.toThrow(/payment_charge_unique/);
  });
  it('Beam needs its key set; status, outcome and method are constrained; nothing refunds', async () => {
    const o = await pricedOrder();
    await expect(tdb.query(`insert into public.payment (club_id, order_id, method, amount_satang) values ($1,$2,'beam',50000)`, [A, o])).rejects.toThrow(/beam_shape/);
    await expect(beam(o, { env: 'sandbox' })).rejects.toThrow(/environment_values/);
    await expect(tdb.query(`insert into public.payment (club_id, order_id, method, amount_satang, status) values ($1,$2,'slip',50000,'pending')`, [A, o])).rejects.toThrow(/method_values/);
    await expect(beam(o, { status: 'refunded' })).rejects.toThrow(/status_values/);
    const id = (await beam(o)).rows[0].id;
    await expect(tdb.query(`update public.payment set outcome = 'refunded' where id = $1`, [id])).rejects.toThrow(/outcome_values/);
    const methods = (await tdb.query(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'payment_method_values'`)).rows[0].d as string;
    expect(methods).not.toMatch(/refund/i);
  });
  it('cash needs a reason code, and "other" a note; only staff are recorded as taking it (PAY-06)', async () => {
    const o = await pricedOrder();
    await expect(cash(o, null)).rejects.toThrow(/cash_shape/);
    await expect(cash(o, 'felt_like_it')).rejects.toThrow(/cash_reason_values/);
    await expect(cash(o, 'other')).rejects.toThrow(/cash_shape/);
    await expect(cash(o, 'other', '   ')).rejects.toThrow(/cash_shape/);
    await expect(cash(o, 'no_banking_app', null, null)).rejects.toThrow(/cash_shape/);
    await cash(o, 'other', 'phone battery died');
  });
  it('an order paid in cash no longer needs payment (order_needs_payment)', async () => {
    const o = await pricedOrder();
    const needs = async () => {
      const k = await tdb.pool.connect();
      try {
        await k.query('begin');
        await k.query('set local role booq_owner');
        await k.query(`select set_config('app.club_id', $1, true)`, [A]);
        return (await k.query('select app.order_needs_payment($1) as n', [o])).rows[0].n as boolean;
      } finally {
        await k.query('rollback');
        k.release();
      }
    };
    expect(await needs()).toBe(true);
    await cash(o, 'no_banking_app');
    expect(await needs()).toBe(false);
  });
  it('identity never changes and a final payment stays final; a payment cannot be deleted', async () => {
    const o = await pricedOrder();
    const id = (await beam(o)).rows[0].id;
    await expect(tdb.query(`update public.payment set amount_satang = 1 where id = $1`, [id])).rejects.toThrow(/do not change/);
    await expect(tdb.query(`update public.payment set environment = 'test' where id = $1`, [id])).rejects.toThrow(/do not change/);
    await tdb.query(`update public.payment set status = 'expired', qr_image = null where id = $1`, [id]);
    await tdb.query(`update public.payment set status = 'succeeded', outcome = 'applied_late', confirmed_at = now() where id = $1`, [id]);   // a late success after expiry is allowed
    await expect(tdb.query(`update public.payment set status = 'failed', confirmed_at = null where id = $1`, [id])).rejects.toThrow(/final/);
    await expect(tdb.query('delete from public.payment')).rejects.toThrow(/append-only/);
  });
  it('the QR image never reaches the audit log', async () => {
    const o = await pricedOrder();
    const id = (await beam(o)).rows[0].id;
    await tdb.query(`update public.payment set qr_image = 'MARKER-base64-image' where id = $1`, [id]);
    expect(JSON.stringify((await tdb.query(`select * from public.audit_entry where record_type = 'payment'`)).rows)).not.toContain('MARKER-base64-image');
  });
});

describe('payment_event (D71, D76)', () => {
  const ev = (charge: string, type = 'charge.succeeded', outcome = 'applied', hash = HASH) =>
    tdb.query(`insert into public.payment_event (club_id, gateway_charge_id, event_type, body_hash, signature_ok, outcome) values ($1,$2,$3,$4,true,$5)`, [A, charge, type, hash, outcome]);
  it('de-duplicated by charge and event; the body is a hash, not stored; append-only', async () => {
    await ev('chg_1');
    await expect(ev('chg_1')).rejects.toThrow(/payment_event_dedupe/);
    await ev('chg_1', 'charge.failed');
    await expect(ev('chg_2', 'charge.succeeded', 'applied', '{"raw":"body"}')).rejects.toThrow(/body_hash/);
    await expect(ev('chg_3', 'charge.succeeded', 'confirmed')).rejects.toThrow(/outcome_values/);
    await expect(tdb.query(`update public.payment_event set outcome = 'ignored'`)).rejects.toThrow(/append-only/);
    await expect(tdb.query('delete from public.payment_event')).rejects.toThrow(/append-only/);
    const cols = (await tdb.query(`select column_name from information_schema.columns where table_name = 'payment_event'`)).rows.map((r) => r.column_name);
    expect(cols.some((c) => /body$|^raw|payload|customer|player|name|phone/.test(c) && c !== 'body_hash')).toBe(false);
  });
  it('an event of an unknown charge can be recorded with no payment', async () => {
    await ev('chg_unknown', 'charge.succeeded', 'unknown_charge');
  });
});

describe('owner_flag (D75)', () => {
  it('a wrong amount flag needs its payment; one open flag per payment and kind; resolving needs who and when', async () => {
    const o = await pricedOrder();
    const p = (await beam(o)).rows[0].id;
    await expect(tdb.query(`insert into public.owner_flag (club_id, kind) values ($1,'wrong_amount')`, [A])).rejects.toThrow(/wrong_amount_has_payment/);
    await tdb.query(`insert into public.owner_flag (club_id, kind, payment_id) values ($1,'wrong_amount',$2)`, [A, p]);
    await expect(tdb.query(`insert into public.owner_flag (club_id, kind, payment_id) values ($1,'wrong_amount',$2)`, [A, p])).rejects.toThrow(/owner_flag_open/);
    await expect(tdb.query(`update public.owner_flag set status = 'resolved'`)).rejects.toThrow(/resolved_together/);
    await tdb.query(`update public.owner_flag set status = 'resolved', resolved_by = $1, resolved_at = now(), note = 'credited'`, [OWNER]);
    await tdb.query(`insert into public.owner_flag (club_id, kind, payment_id) values ($1,'wrong_amount',$2)`, [A, p]);   // a new one after resolving
    await tdb.query(`insert into public.owner_flag (club_id, kind) values ($1,'key_check_failed')`, [A]);
    await expect(tdb.query(`insert into public.owner_flag (club_id, kind) values ($1,'key_check_failed')`, [A])).rejects.toThrow(/owner_flag_open/);
    await expect(tdb.query('delete from public.owner_flag')).rejects.toThrow(/append-only/);
  });
});

describe('who reads (F05-T02; D35, PDPA-01-AC1)', () => {
  beforeEach(async () => {
    const o1 = await pricedOrder(PLAYER); const o2 = await pricedOrder(OTHER);
    await beam(o1); await beam(o2);
    await tdb.query(`insert into public.payment_event (club_id, gateway_charge_id, event_type, body_hash, signature_ok, outcome) values ($1,'c','charge.succeeded',$2,true,'applied')`, [A, HASH]);
    await tdb.query(`insert into public.owner_flag (club_id, kind) values ($1,'key_check_failed')`, [A]);
    const ob = await pricedOrder(null, 1000, B);
    await tdb.query(`insert into public.payment (club_id, order_id, method, environment, gateway, gateway_charge_id, amount_satang) values ($1,$2,'beam','live','beam','chg_b',1000)`, [B, ob]);
  });
  const n = (c: ReturnType<typeof ctx>, t: string) => web.withClubTx(c, (tx) => tx.query(`select 1 from public.${t}`)).then((r) => r.rowCount);
  it('a player sees only the payment of their own order; staff and the accountant see the club’s; club B’s are never visible', async () => {
    expect(await n(ctx(PLAYER, ['player']), 'payment')).toBe(1);
    expect(await n(ctx(DESK, ['front_desk', 'player']), 'payment')).toBe(2);
    expect(await n(ctx(OWNER, ['owner', 'player']), 'payment')).toBe(2);
    expect(await n(ctx(ACC, ['accountant', 'player']), 'payment')).toBe(2);
    expect(await n(ctx(OWNER, ['owner', 'player'], B), 'payment')).toBe(1);
  });
  it('the event log is for owner, front desk and accountant; flags are the owner’s alone', async () => {
    expect(await n(ctx(PLAYER, ['player']), 'payment_event')).toBe(0);
    expect(await n(ctx(DESK, ['front_desk', 'player']), 'payment_event')).toBe(1);
    expect(await n(ctx(DESK, ['front_desk', 'player']), 'owner_flag')).toBe(0);
    expect(await n(ctx(OWNER, ['owner', 'player']), 'owner_flag')).toBe(1);
  });
  it('no app role writes a payment table directly; BOOQ staff have no privilege on any of them', async () => {
    for (const t of ['payment', 'payment_event', 'owner_flag']) {
      for (const priv of ['insert', 'update', 'delete']) {
        for (const role of ['booq_app', 'booq_worker']) {
          expect((await tdb.query('select has_table_privilege($1, $2, $3) as ok', [role, `public.${t}`, priv])).rows[0].ok, `${role} ${t} ${priv}`).toBe(false);
        }
      }
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        expect((await tdb.query('select has_table_privilege($1, $2, $3) as ok', ['booq_platform', `public.${t}`, priv])).rows[0].ok, `platform ${t} ${priv}`).toBe(false);
      }
    }
  });
  it('test payments are test rows and registered to go before their orders at Go live', async () => {
    const r = (await tdb.query(`select table_name, delete_order from app.test_tables where table_name in ('payment','payment_event','owner_flag','orders') order by delete_order`)).rows;
    expect(r.map((x) => x.table_name)).toEqual(['payment_event', 'owner_flag', 'payment', 'orders']);
    expect((await checkTableClasses(tdb.pool, await collectRegistry())).problems.filter((p) => p.table !== 'app.test_clock')).toEqual([]);
  });
});
