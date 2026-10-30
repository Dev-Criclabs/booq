import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F13-T02 / migration 0702: app.issue_receipt (RCPT-01-AC1 to AC6, AC14, AC15; RCPT-02-AC11; D4, D33, D64, D106).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const PLAYER_B = '22222222-2222-4222-8222-222222222222';

let tdb: TestDatabase;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status, receipt_prefix) values ($1,'a','ก','A','live','HTC'), ($2,'b','ข','B','live','BBB')`, [A, B]);
  for (const club of [A, B]) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into public.app_user (club_id, id, line_user_id, full_name) values ($1,$2,'L1','Somchai Jaidee')`, [club, club === A ? PLAYER : PLAYER_B]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [club, club === A ? PLAYER : PLAYER_B]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  await tdb.setNow('2026-12-29T03:00:00Z');
});
afterEach(async () => {
  await tdb.close();
});

type Line = { unit: number; credit?: number; wallet?: number; money: number };
/** A paid, priced order with lines. Fixture: triggers are off so no bookings are needed; the numbers are consistent anyway. */
async function order(over: { club?: string; kind?: string; lines?: Line[]; customer?: string | null; status?: string } = {}): Promise<string> {
  const club = over.club ?? A;
  const lines = over.lines ?? [{ unit: 50000, money: 50000 }];
  const sum = (f: (l: Line) => number) => lines.reduce((n, l) => n + f(l), 0);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local session_replication_role = replica`);
    const o = (
      await c.query(`insert into public.orders (club_id, customer_id, source, kind, status, is_test) values ($1,$2,'online',$3,$4,(select status = 'testing' from public.club where id = $1)) returning id`, [
        club, over.customer === undefined ? (club === A ? PLAYER : PLAYER_B) : over.customer, over.kind ?? 'sale', over.status ?? 'paid',
      ])
    ).rows[0].id as string;
    await c.query(
      `update public.orders set price_group_snapshot='{}', subtotal_satang=$2, discount_satang=0, total_satang=$2, credit_value_satang=$3, wallet_satang=$4, money_satang=$5, quote_hash=repeat('a',64), priced_at=now() where id=$1`,
      [o, sum((l) => l.unit), sum((l) => l.credit ?? 0), sum((l) => l.wallet ?? 0), sum((l) => l.money)],
    );
    let pos = 0;
    for (const l of lines) {
      pos += 1;
      const walletCredit = over.kind === 'wallet_credit';
      await c.query(
        `insert into public.order_line (club_id, order_id, position, kind, package_product_id, description_key, name_th, name_en, unit_price_satang, net_satang, credit_value_satang, wallet_satang, money_satang, credit_units)
         values ($1,$2,$3,$4,$5,'k','ก','Court',$6,$6,$7,$8,$9,$10)`,
        [club, o, pos, walletCredit ? 'wallet_credit' : 'package', walletCredit ? null : '99999999-9999-4999-8999-999999999999', l.unit, l.credit ?? 0, l.wallet ?? 0, l.money, l.credit ? 1 : 0],
      );
    }
    await c.query('commit');
    return o;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
async function payment(o: string, amount = 50000, club = A, status = 'succeeded'): Promise<string> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local session_replication_role = replica`);
    const r = await c.query(
      `insert into public.payment (club_id, order_id, method, status, environment, gateway, gateway_charge_id, amount_satang, confirmed_at) values ($1,$2,'beam',$3,'live','beam',$4,$5, case when $3 = 'succeeded' then now() end) returning id`,
      [club, o, status, 'chg_' + Math.random().toString(36).slice(2), amount],
    );
    await c.query('commit');
    return r.rows[0].id as string;
  } finally {
    c.release();
  }
}
/** Calls the function inside the club's context, in its own transaction. */
async function issue(club: string, o: string, p: string | null, kind = 'order', commit = true): Promise<string> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.club_id', $1, true)`, [club]);
    const r = await c.query(`select app.issue_receipt($1, $2, $3) as id`, [o, p, kind]);
    await c.query(commit ? 'commit' : 'rollback');
    return r.rows[0].id as string;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const row = async (id: string) => (await tdb.query(`select * from public.receipt where id = $1`, [id])).rows[0];
const sale = async (club = A, over: Parameters<typeof order>[0] = {}) => {
  const o = await order({ club, ...over });
  return issue(club, o, await payment(o, 50000, club));
};

describe('numbers (RCPT-01-AC1, AC2, AC14; D106)', () => {
  it('the first real receipt is HTC-2026-000001 of its Bangkok year, the next 000002; a second club has its own sequence', async () => {
    const r1 = await row(await sale());
    const r2 = await row(await sale());
    const b1 = await row(await sale(B));
    expect([r1.number, r1.series, r1.seq_no]).toEqual(['HTC-2026-000001', '2026', 1]);
    expect([r2.number, r2.seq_no]).toEqual(['HTC-2026-000002', 2]);
    expect([b1.number, b1.seq_no]).toEqual(['BBB-2026-000001', 1]);
  });

  it('the sequence restarts each Bangkok year, and the year is the Bangkok year of issue', async () => {
    await sale();
    await tdb.setNow('2026-12-31T16:59:00Z');   // 23:59 on 31 December in Bangkok
    expect((await row(await sale())).number).toBe('HTC-2026-000002');
    await tdb.setNow('2026-12-31T17:00:00Z');   // 00:00 on 1 January 2027 in Bangkok
    const first2027 = await row(await sale());
    expect([first2027.number, first2027.series, first2027.seq_no]).toEqual(['HTC-2027-000001', '2027', 1]);
  });

  it('a rollback leaves no gap: the next receipt takes the number the rolled back one would have had', async () => {
    const o = await order();
    const p = await payment(o);
    await issue(A, o, p, 'order', false);
    expect((await tdb.query(`select count(*)::int as n from public.receipt`)).rows[0].n).toBe(0);
    expect((await tdb.query(`select count(*)::int as n from public.receipt_counter`)).rows[0].n).toBe(0);
    expect((await row(await issue(A, o, p))).number).toBe('HTC-2026-000001');
  });

  it('numbers longer than six digits are not cut', async () => {
    await tdb.query(`insert into public.receipt_counter (club_id, series, last_no) values ($1, '2026', 999999)`, [A]);
    expect((await row(await sale())).number).toBe('HTC-2026-1000000');
  });
});

describe('one receipt per order and idempotence (RCPT-01-AC4; D40)', () => {
  it('a repeated call returns the same receipt and writes nothing, even with a different payment', async () => {
    const o = await order();
    const p = await payment(o);
    const id = await issue(A, o, p);
    expect(await issue(A, o, p)).toBe(id);
    expect(await issue(A, o, await payment(o))).toBe(id);
    expect((await tdb.query(`select last_no from public.receipt_counter`)).rows).toEqual([{ last_no: 1 }]);
  });

  it('an order of several hours has one receipt, with every line in the snapshot in order', async () => {
    const o = await order({ lines: [{ unit: 50000, money: 50000 }, { unit: 50000, money: 50000 }] });
    const r = await row(await issue(A, o, await payment(o, 100000)));
    expect(r.total_satang).toBe(100000);
    expect((r.lines.items as Array<{ position: number }>).map((i) => i.position)).toEqual([1, 2]);
    expect((await tdb.query(`select count(*)::int as n from public.receipt where order_id = $1`, [o])).rows[0].n).toBe(1);
  });
});

describe('what the snapshot holds (RCPT-01-AC5, AC12; D64)', () => {
  it('lines with their text and amounts, the methods and amounts received, the customer name and the club VAT switch at issue time', async () => {
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1, 'vat_enabled', 'true')`, [A]);
    const o = await order({ lines: [{ unit: 50000, credit: 20000, money: 30000 }] });
    const r = await row(await issue(A, o, await payment(o, 30000)));
    expect(r).toMatchObject({ kind: 'sale', status: 'issued', vat_flag: true, customer_id: PLAYER, customer_name_snapshot: 'Somchai Jaidee', total_satang: 50000, is_test: false });
    expect(r.lines.order).toMatchObject({ total_satang: 50000, credit_value_satang: 20000, wallet_satang: 0, money_satang: 30000 });
    expect(r.lines.items[0]).toMatchObject({ position: 1, description_key: 'k', name_en: 'Court', unit_price_satang: 50000, net_satang: 50000, credit_value_satang: 20000, money_satang: 30000 });
    expect(r.lines.payments).toHaveLength(1);
    expect(r.lines.payments[0]).toMatchObject({ method: 'beam', amount_satang: 30000 });
  });

  it('later edits never change it: a renamed customer and a switched VAT leave the stored receipt as it was', async () => {
    const o = await order();
    const id = await issue(A, o, await payment(o));
    await tdb.query(`update public.app_user set full_name = 'Someone Else' where id = $1`, [PLAYER]);
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1, 'vat_enabled', 'true')`, [A]);
    expect(await row(id)).toMatchObject({ customer_name_snapshot: 'Somchai Jaidee', vat_flag: false });
  });

  it('an order paid with no money still has a receipt in the same series, with no money line (RCPT-01-AC5)', async () => {
    const o = await order({ lines: [{ unit: 50000, credit: 50000, money: 0 }] });
    const r = await row(await issue(A, o, null));
    expect(r).toMatchObject({ payment_id: null, number: 'HTC-2026-000001', total_satang: 50000 });
    expect(r.lines.payments).toEqual([]);
    expect(r.lines.order.money_satang).toBe(0);
  });
});

describe('wallet credit receipts (RCPT-01-AC6; RCPT-02-AC11; D37, D74, D79)', () => {
  it('states the money received and credited, one per payment, in the same series as sales', async () => {
    const sold = await order();
    const p = await payment(sold, 50000);
    const sid = await issue(A, sold, p);
    const wo = await order({ kind: 'wallet_credit', status: 'open', lines: [{ unit: 50000, money: 50000 }] });
    const wid = await issue(A, wo, p, 'wallet_credit');
    const w = await row(wid);
    expect([(await row(sid)).number, w.number]).toEqual(['HTC-2026-000001', 'HTC-2026-000002']);
    expect(w).toMatchObject({ kind: 'wallet_credit', payment_id: p, total_satang: 50000 });
    expect(w.lines.items[0]).toMatchObject({ kind: 'wallet_credit' });
    expect(await issue(A, wo, p, 'wallet_credit')).toBe(wid);
  });

  it('needs a confirmed payment and an order of kind wallet_credit', async () => {
    const wo = await order({ kind: 'wallet_credit', status: 'open', lines: [{ unit: 50000, money: 50000 }] });
    await expect(issue(A, wo, null, 'wallet_credit')).rejects.toThrow(/receipt:no_payment/);
    const pending = await payment(await order(), 50000, A, 'pending');
    await expect(issue(A, wo, pending, 'wallet_credit')).rejects.toThrow(/receipt:payment_not_confirmed/);
    const sold = await order();
    await expect(issue(A, sold, await payment(sold), 'wallet_credit')).rejects.toThrow(/receipt:wrong_order_kind/);
  });
});

describe('refusals', () => {
  it('an order of another club, an unknown order and no club in the context are refused', async () => {
    const other = await order({ club: B });
    await expect(issue(A, other, null)).rejects.toThrow(/receipt:order_not_found/);
    await expect(issue(A, 'aaaaaaaa-0000-4000-8000-0000000000ff', null)).rejects.toThrow(/receipt:order_not_found/);
    const c = await tdb.pool.connect();
    try {
      await expect(c.query(`select app.issue_receipt($1, null, 'order')`, [other])).rejects.toThrow(/receipt:no_club/);
    } finally {
      c.release();
    }
  });

  it('an order with money due and no confirmed payment gets no receipt; neither does one whose payment belongs to another order', async () => {
    const o = await order();
    await expect(issue(A, o, null)).rejects.toThrow(/receipt:no_payment/);
    await expect(issue(A, o, await payment(o, 50000, A, 'pending'))).rejects.toThrow(/receipt:payment_not_confirmed/);
    await expect(issue(A, o, await payment(await order()))).rejects.toThrow(/receipt:payment_not_confirmed/);
    expect((await tdb.query(`select count(*)::int as n from public.receipt`)).rows[0].n).toBe(0);
  });

  it('an unknown kind and an unpriced or open zero-money order are refused', async () => {
    const o = await order();
    await expect(issue(A, o, null, 'refund')).rejects.toThrow(/receipt:invalid_kind/);
    const open = await order({ status: 'open', lines: [{ unit: 50000, credit: 50000, money: 0 }] });
    await expect(issue(A, open, null)).rejects.toThrow(/receipt:order_not_paid/);
  });

  it('no role can call it directly: only the payment functions that own the transaction', async () => {
    for (const role of ['booq_app', 'booq_worker', 'booq_platform', 'anon', 'authenticated']) {
      const r = await tdb.query(`select has_function_privilege($1, 'app.issue_receipt(uuid, uuid, text)', 'execute') as ok`, [role]);
      expect(r.rows[0].ok, role).toBe(false);
    }
  });
});

describe('prefix and the test series (RCPT-01-AC14, AC15; D4, D33, D106)', () => {
  it('a real receipt without a club prefix raises receipt:prefix_missing and takes no number', async () => {
    await tdb.query(`update public.club set receipt_prefix = null where id = $1`, [A]);
    const o = await order();
    await expect(issue(A, o, await payment(o))).rejects.toThrow(/receipt:prefix_missing/);
    await tdb.query(`update public.club set receipt_prefix = '  ' where id = $1`, [A]);
    await expect(issue(A, o, await payment(o))).rejects.toThrow(/receipt:prefix_missing/);
    expect((await tdb.query(`select count(*)::int as n from public.receipt_counter`)).rows[0].n).toBe(0);
  });

  it('a Testing club with no prefix issues TEST receipts in the T series, flagged, and the real counter is untouched', async () => {
    await tdb.query(`update public.club set status = 'testing', receipt_prefix = null where id = $1`, [A]);
    const t1 = await row(await sale());
    const t2 = await row(await sale());
    expect([t1.number, t1.series, t1.is_test]).toEqual(['TEST-2026-000001', 'T2026', true]);
    expect(t2.number).toBe('TEST-2026-000002');
    expect((await tdb.query(`select series, last_no, is_test from public.receipt_counter`)).rows).toEqual([{ series: 'T2026', last_no: 2, is_test: true }]);
  });

  it('after Go live the first real receipt is 000001 whatever the test series reached (RCPT-01-AC1, AC15)', async () => {
    await tdb.query(`update public.club set status = 'testing' where id = $1`, [A]);
    await sale();
    await sale();
    await tdb.query(`update public.club set status = 'live' where id = $1`, [A]);
    const real = await row(await sale());
    expect([real.number, real.series, real.is_test]).toEqual(['HTC-2026-000001', '2026', false]);
    expect((await tdb.query(`select series, last_no from public.receipt_counter order by series`)).rows).toEqual([{ series: '2026', last_no: 1 }, { series: 'T2026', last_no: 2 }]);
  });
});

describe('parallel confirmations (RCPT-01-AC3)', () => {
  it('twenty at once get consecutive numbers with no gap and no repeat', async () => {
    const jobs: Array<[string, string]> = [];
    for (let i = 0; i < 20; i += 1) {
      const o = await order();
      jobs.push([o, await payment(o)]);
    }
    const ids = await Promise.all(jobs.map(([o, p]) => issue(A, o, p)));
    const seqs = (await tdb.query(`select seq_no from public.receipt where id = any($1) order by seq_no`, [ids])).rows.map((r) => r.seq_no);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
});
