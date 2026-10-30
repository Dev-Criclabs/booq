import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { A, order, payment, setup, tdb, teardown } from './testing/payment-fixtures';

// F05-T08a-db / migration 0414: club_by_beam_webhook, record_payment_event, fail_payment (PAY-02-AC4 to AC15; D24, D71, D72).
const TEST_HASH = 'a'.repeat(64);
const LIVE_HASH = 'b'.repeat(64);
const BODY = 'c'.repeat(64);
let web: Db;
let worker: Db;
const ctx = { clubId: A, userId: null, roles: [] as never, source: 'webhook' as const };
const one = async <T>(db: Db, sql: string, params: unknown[] = []) => db.withClubTx(ctx, async (tx) => (await tx.query(sql, params)).rows[0] as T);
const event = (over: Partial<{ charge: string; type: string; sig: boolean; outcome: string; payment: string | null; looked: unknown }> = {}) =>
  one<{ id: string | null }>(worker, `select app.record_payment_event($1, $2, $3, $4, $5, $6, $7::jsonb) as id`,
    [over.charge ?? 'chr_1', over.type ?? 'charge.successful', BODY, over.sig ?? true, over.outcome ?? 'ignored', over.payment ?? null, over.looked === undefined ? null : JSON.stringify(over.looked)]).then((r) => r.id);

beforeEach(async () => {
  await setup();
  await tdb.query(`insert into public.payment_connection (club_id, merchant_id_test, merchant_id_live, webhook_token_hash_test, webhook_token_hash_live) values ($1,'mt','ml',$2,$3)`, [A, TEST_HASH, LIVE_HASH]);
  web = createDb({ connectionString: tdb.url, max: 2 });
  worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await web.end();
  await worker.end();
  await teardown();
});

describe('app.club_by_beam_webhook', () => {
  const by = (hash: string | null, db = () => web) => one<{ j: unknown }>(db(), `select app.club_by_beam_webhook($1) as j`, [hash]).then((r) => r.j);

  it('finds the club, the key set and its merchant from either token', async () => {
    expect(await by(TEST_HASH)).toEqual({ club_id: A, key_set: 'test', merchant_id: 'mt' });
    expect(await by(LIVE_HASH)).toEqual({ club_id: A, key_set: 'live', merchant_id: 'ml' });
    expect(await by(LIVE_HASH, () => worker)).toEqual({ club_id: A, key_set: 'live', merchant_id: 'ml' });
  });

  it('answers null for an unknown, empty or missing token, and nothing else', async () => {
    expect(await by('d'.repeat(64))).toBeNull();
    expect(await by('')).toBeNull();
    expect(await by(null)).toBeNull();
  });

  it('is granted to booq_app and booq_worker only', async () => {
    const f = (r: string) => tdb.query(`select has_function_privilege($1, 'app.club_by_beam_webhook(text)', 'execute') as ok`, [r]).then((x) => x.rows[0].ok);
    expect([await f('booq_app'), await f('booq_worker'), await f('booq_platform')]).toEqual([true, true, false]);
  });
});

describe('app.record_payment_event', () => {
  it('inserts the row and returns its id; the looked up values fill the columns', async () => {
    const p = await payment(await order('held'));
    const id = await event({ payment: p, outcome: 'applied', looked: { status: 'succeeded', amount_satang: 50000, reference: 'ref1' } });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await tdb.query(`select gateway, gateway_charge_id, event_type, signature_ok, looked_up_status, looked_up_amount_satang, looked_up_reference, outcome, payment_id, body_hash, is_test from public.payment_event`)).rows)
      .toEqual([{ gateway: 'beam', gateway_charge_id: 'chr_1', event_type: 'charge.successful', signature_ok: true, looked_up_status: 'succeeded', looked_up_amount_satang: 50000, looked_up_reference: 'ref1', outcome: 'applied', payment_id: p, body_hash: BODY, is_test: false }]);
  });

  it('a duplicate (same charge and event type) returns null and writes nothing; another type is a new row (D24)', async () => {
    expect(await event()).not.toBeNull();
    expect(await event()).toBeNull();
    expect(await event({ type: 'charge.failed' })).not.toBeNull();
    expect((await tdb.query(`select count(*)::int as n from public.payment_event`)).rows[0].n).toBe(2);
  });

  it('a bad signature writes no row, so the real event is not blocked by its key (D147)', async () => {
    expect(await event({ sig: false, outcome: 'bad_signature' })).toBeNull();
    expect((await tdb.query(`select count(*)::int as n from public.payment_event`)).rows[0].n).toBe(0);
    expect(await event()).not.toBeNull();
  });

  it('is a test row in a Testing club; the failed outcome is allowed; bad values are refused', async () => {
    await tdb.query(`update public.club set status = 'testing'`);
    await event({ outcome: 'failed', looked: { status: 'failed', amount_satang: 100, reference: null } });
    expect((await tdb.query(`select is_test, outcome from public.payment_event`)).rows).toEqual([{ is_test: true, outcome: 'failed' }]);
    await expect(event({ charge: 'chr_2', outcome: 'whatever' })).rejects.toThrow(/invalid event/);
    await expect(event({ charge: '' })).rejects.toThrow(/invalid event/);
    await expect(event({ charge: 'chr_3', payment: '99999999-9999-4999-8999-999999999999' })).rejects.toThrow(/invalid event/);
    await expect(event({ charge: 'chr_4', looked: 'nope' })).rejects.toThrow();
  });

  it('is for the worker only', async () => {
    await expect(one(web, `select app.record_payment_event('c', 't', $1, true, 'ignored')`, [BODY])).rejects.toThrow(/permission denied|forbidden/);
  });
});

describe('app.fail_payment', () => {
  const fail = (p: string, code = 'card_declined') => one(worker, `select app.fail_payment($1, $2)`, [p, code]);
  const row = async (p: string) => (await tdb.query(`select status, failure_code, qr_image from public.payment where id = $1`, [p])).rows[0];

  it('fails a pending charge, clears the QR, and leaves the hold running so the player may tap again (D72)', async () => {
    const o = await order('held');
    const p = await payment(o);
    await tdb.query(`update public.payment set qr_image = 'abc' where id = $1`, [p]);
    await fail(p);
    expect(await row(p)).toEqual({ status: 'failed', failure_code: 'card_declined', qr_image: null });
    expect((await tdb.query(`select status from public.booking where order_id = $1`, [o])).rows[0].status).toBe('awaiting_payment');
    expect((await tdb.query(`select count(*)::int as n from public.payment where order_id = $1 and status = 'pending'`, [o])).rows[0].n).toBe(0);   // a new charge may be made
  });

  it('leaves a final payment untouched', async () => {
    const p = await payment(await order('held'));
    await tdb.query(`update public.payment set status = 'succeeded', confirmed_at = now(), outcome = 'applied' where id = $1`, [p]);
    await fail(p);
    expect(await row(p)).toMatchObject({ status: 'succeeded', failure_code: null });
    await fail('99999999-9999-4999-8999-999999999999');   // an unknown payment is a no-op
  });

  it('needs a code, and is for the worker only', async () => {
    const p = await payment(await order('held'));
    await expect(fail(p, ' ')).rejects.toThrow(/failure code is required/);
    await expect(one(web, `select app.fail_payment($1, 'x')`, [p])).rejects.toThrow(/permission denied|forbidden/);
  });
});
