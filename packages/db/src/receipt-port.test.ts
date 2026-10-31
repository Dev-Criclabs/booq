import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase } from './testing/harness';
import { A, PLAYER, apply, order, payment, setup, tdb, teardown, worker, ctx as workerCtx } from './testing/payment-fixtures';

// F13-T04 / migration 0703: app.apply_payment issues its receipts through the registered issue_receipt port (RCPT-01-AC6; D37,
// D74, D79, D112, D119). The F05 fixtures install fakes for every port; these tests put F06's and F13's real ports back.
const DESK = '33333333-3333-4333-8333-333333333333';
const REAL: [string, string][] = [
  ['grant_package', 'app.port_grant_package(uuid)'],
  ['credit_wallet', 'app.port_credit_wallet(text, uuid, integer, text, text, uuid)'],
  ['issue_receipt', 'app.issue_receipt(uuid, uuid, text)'],
];
let app: Db;

const receipts = async () => (await tdb.query(`select kind, status, number, order_id, payment_id, total_satang from public.receipt order by seq_no`)).rows;
const staffCtx = { clubId: A, userId: DESK, roles: ['front_desk', 'player'] as never, source: 'admin' as const };

beforeEach(async () => {
  await setup();
  await tdb.query(`update public.club set receipt_prefix = 'HTC' where id = $1`, [A]);
  for (const [port, handler] of REAL) {
    await tdb.query(`delete from app.payment_ports where port = $1`, [port]);
    await tdb.query(`select app.register_payment_port($1, $2::regprocedure)`, [port, handler]);
  }
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [A, DESK, 'LD']);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'front_desk'), ($1,$2,'player')`, [A, DESK]);
    await c.query('commit');
  } finally {
    c.release();
  }
  app = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await app.end();
  await teardown();
});

describe('registration', () => {
  it('a database with only the migrations has the port pointing at issue_receipt', async () => {
    const fresh = await createTestDatabase();
    try {
      expect((await fresh.query(`select handler::text as h from app.payment_ports where port = 'issue_receipt'`)).rows).toEqual([{ h: 'app.issue_receipt(uuid,uuid,text)' }]);
    } finally {
      await fresh.close();
    }
  });
  it('an unregistered port rolls the whole payment back', async () => {
    await tdb.query(`delete from app.payment_ports where port = 'issue_receipt'`);
    const p = await payment(await order('held'));
    await expect(apply(p)).rejects.toThrow(/payment:port_missing:issue_receipt/);
    expect((await tdb.query(`select status from public.payment where id = $1`, [p])).rows[0].status).toBe('pending');
    expect(await receipts()).toEqual([]);
  });
});

describe('apply_payment issues the receipt (RCPT-01-AC6, D37)', () => {
  it('a paid order has exactly one sale receipt, and a repeated callback adds none', async () => {
    const o = await order('held');
    const p = await payment(o);
    expect(await apply(p)).toMatchObject({ outcome: 'applied' });
    expect(await apply(p)).toMatchObject({ outcome: 'applied' });
    expect(await receipts()).toEqual([{ kind: 'sale', status: 'issued', number: expect.stringMatching(/^HTC-\d{4}-000001$/), order_id: o, payment_id: p, total_satang: 50000 }]);
  });

  it('a late payment for a cancelled order goes to the wallet with its own wallet credit receipt', async () => {
    const o = await order('held');
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local session_replication_role = replica');
      await c.query(`update public.orders set status = 'cancelled' where id = $1`, [o]);
      await c.query('commit');
    } finally {
      c.release();
    }
    const p = await payment(o);
    expect(await apply(p)).toMatchObject({ outcome: 'wallet_cancelled' });
    const r = await receipts();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'wallet_credit', payment_id: p, total_satang: 50000 });
    expect(await apply(p)).toMatchObject({ outcome: 'wallet_cancelled' });
    expect(await receipts()).toHaveLength(1);
  });

  it('a duplicate payment for an order already paid gets a wallet credit receipt, beside the sale receipt', async () => {
    const o = await order('held');
    await apply(await payment(o));
    const second = await payment(o);
    expect(await apply(second)).toMatchObject({ outcome: 'wallet_duplicate' });
    expect((await receipts()).map((r) => [r.kind, r.number])).toEqual([['sale', expect.stringMatching(/^HTC-\d{4}-000001$/)], ['wallet_credit', expect.stringMatching(/^HTC-\d{4}-000002$/)]]);
  });

  it('a wrong amount credited by staff gets a wallet credit receipt for the full amount received', async () => {
    const p = await payment(await order('held'));
    await worker.withClubTx(workerCtx(), async (tx) => tx.query(`select app.flag_wrong_amount($1, $2)`, [p, 40000]));
    await app.withClubTx(staffCtx, async (tx) => tx.query(`select app.credit_wrong_amount($1, $2)`, [p, 'paid 400 not 500']));
    const r = await receipts();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'wallet_credit', payment_id: p, total_satang: 40000 });
    const snap = (await tdb.query(`select lines -> 'payments' as pay from public.receipt`)).rows[0].pay;
    expect(snap).toEqual([{ method: 'beam', amount_satang: 40000, confirmed_at: expect.any(String) }]);   // the amount received, not the 50000 asked
  });

});

describe('a refund to the wallet issues no receipt (D119)', () => {
  it('crediting the wallet for a refund writes the wallet and the wallet credit order, and no receipt', async () => {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role booq_owner');
      await c.query(`select set_config('app.club_id', $1, true)`, [A]);
      await c.query(`select app.wallet_credit($1, $2, 'refund', 'refund-1')`, [PLAYER, 20000]);
      await c.query('commit');
    } finally {
      c.release();
    }
    expect((await tdb.query(`select count(*)::int as n from public.wallet_ledger where reason = 'refund'`)).rows[0].n).toBe(1);
    expect(await receipts()).toEqual([]);
  });
});
