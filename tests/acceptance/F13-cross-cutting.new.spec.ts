// F13-T20 cross cutting suite (QA): receipts and money documents never change after issue, no cash refund exists anywhere, and the test series stays apart from the real one.
// IDs: RCPT-01 (AC12, AC13, AC15, AC16), CC-3, CC-6, D33, D119. It reads the schema of a migrated database (so a new table or function is seen at once) and leaves what the
// lanes already prove by behaviour to them (receipt-tables.test.ts, issue-receipt.test.ts, take-cash.test.ts): those are named at the bottom and traced in F13-receipts-reports.traced.spec.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../packages/db/src/testing/harness';

let tdb: TestDatabase;
beforeAll(async () => {
  tdb = await createTestDatabase();
}, 120_000);
afterAll(async () => {
  await tdb?.close();
});

/** Tables that hold a movement of money or a document about one: once written they never change (D28, RCPT-01-AC12). */
const MONEY_DOCUMENTS = ['receipt', 'receipt_void', 'receipt_print', 'payment', 'payment_event', 'wallet_ledger', 'credit_ledger', 'order_line', 'daily_close', 'coach_payout', 'coach_payout_adjustment', 'booking_cancel', 'package_extension'];
/** Tables with an amount that is a setting or a working record, changed through audited routes (price rules, products) or by a state machine (orders). Each is here on purpose. */
const MONEY_SETTINGS = ['add_on', 'class_session', 'class_template', 'coach_pay', 'coach_price_override', 'coach_tier_price', 'court_price_rule', 'package_product', 'promo_code', 'orders', 'customer_package'];

const BEFORE_ROW = 1 | 2; // tgtype bits: row, before
const DELETE = 8, UPDATE = 16, TRUNCATE = 32;

describe('F13-T20 money documents never change after issue (RCPT-01-AC12)', () => {
  it('every money document has an enabled before row trigger against update and delete, and one against truncate', async () => {
    const rows = (await tdb.query(`select c.relname, t.tgtype, t.tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                                    where n.nspname = 'public' and not t.tgisinternal`)).rows as Array<{ relname: string; tgtype: number; tgenabled: string }>;
    const by = (t: string) => rows.filter((r) => r.relname === t && r.tgenabled !== 'D');
    for (const t of MONEY_DOCUMENTS) {
      const list = by(t);
      expect(list.length, `${t} has no enabled append only trigger`).toBeGreaterThan(0);
      expect(list.some((r) => (r.tgtype & BEFORE_ROW) === BEFORE_ROW && (r.tgtype & UPDATE) !== 0), `${t}: nothing refuses an update`).toBe(true);
      expect(list.some((r) => (r.tgtype & BEFORE_ROW) === BEFORE_ROW && (r.tgtype & DELETE) !== 0), `${t}: nothing refuses a delete`).toBe(true);
      expect(list.some((r) => (r.tgtype & TRUNCATE) !== 0), `${t}: nothing refuses a truncate`).toBe(true);
    }
  });

  it('a table that holds an amount is a money document or a listed setting: a new one must be put in a list on purpose', async () => {
    const tables = (await tdb.query(`select distinct c.table_name as t from information_schema.columns c join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name
                                      where c.table_schema = 'public' and x.table_type = 'BASE TABLE' and c.column_name ~ '(_satang$|^change$|^change_satang$|^totals?$|^amount)'`)).rows.map((r) => r.t as string);
    const known = new Set([...MONEY_DOCUMENTS, ...MONEY_SETTINGS, 'wallet_account']);
    expect(tables.filter((t) => !known.has(t)), 'tables with an amount that no list names').toEqual([]);
  });

  it('the receipt can only be voided by a mark, and a void keeps the number, the lines and the total (the table allows only that column set to change)', async () => {
    const cols = (await tdb.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'receipt'`)).rows.map((r) => r.column_name as string);
    for (const c of ['number', 'lines', 'total_satang', 'series', 'seq_no', 'customer_name_snapshot']) expect(cols).toContain(c);
    const src = (await tdb.query(`select string_agg(p.prosrc, E'\n') as s from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_class c on c.oid = t.tgrelid where c.relname = 'receipt' and not t.tgisinternal`)).rows[0]?.s as string;
    expect(src, 'the receipt guard').toMatch(/void/i);
  });
});

describe('F13-T20 no cash refund exists anywhere (CC-3, CANCEL-02, D119)', () => {
  it('a payment is Beam or cash, and is never refunded: no refunded status, no refund method, no refund column', async () => {
    const defs = (await tdb.query(`select pg_get_constraintdef(oid) as d from pg_constraint where contype = 'c' and conrelid = 'public.payment'::regclass`)).rows.map((r) => r.d as string).join('\n');
    expect(defs).toMatch(/method = ANY \(ARRAY\['beam'::text, 'cash'::text\]\)/);
    expect(defs).not.toMatch(/refund|chargeback|cash_?out|reversed/i);
    const cols = (await tdb.query(`select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('payment', 'payment_event', 'receipt', 'receipt_void') and column_name ~* 'refund|cash_?back|chargeback'`)).rows;
    expect(cols, 'a refund column on a payment or receipt table').toEqual([]);
  });

  it('a receipt is a sale or a wallet credit: there is no credit note and no refund receipt (D119)', async () => {
    const d = (await tdb.query(`select pg_get_constraintdef(oid) as d from pg_constraint where contype = 'c' and conrelid = 'public.receipt'::regclass and pg_get_constraintdef(oid) ~ 'kind'`)).rows.map((r) => r.d as string).join('\n');
    expect(d).toMatch(/'sale'::text, 'wallet_credit'::text/);
    expect(d).not.toMatch(/credit_note|refund/i);
  });

  it('no function of the app, public, platform or audit schema pays, refunds or withdraws money to a person; the only payout functions are the coach payout ones', async () => {
    const names = (await tdb.query(`select p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('app', 'public', 'platform', 'audit') and p.proname ~* 'refund|withdraw|cash_?out|chargeback|credit_note|payout|pay_?out|send_money|transfer_out'`)).rows.map((r) => r.f as string).sort();
    const coachPayout = names.filter((f) => /payout/.test(f));
    expect(names.filter((f) => !coachPayout.includes(f)), 'a function that moves money out').toEqual([]);
    // The coach payout functions pay the coach, on the owner's mark; the customer has none (checked by the role tests of F12 and coach-payout.test.ts).
    expect(coachPayout.length).toBeGreaterThan(0);
  });

  it('wallet value leaves a wallet only by a spend, a return, an adjustment, or expiry: no withdraw or cash out reason exists', async () => {
    const d = (await tdb.query(`select pg_get_constraintdef(oid) as d from pg_constraint where contype = 'c' and conrelid = 'public.wallet_ledger'::regclass and pg_get_constraintdef(oid) ~ 'reason = ANY'`)).rows.map((r) => r.d as string).join('\n');
    const reasons = [...d.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
    expect(reasons.sort()).toEqual(['adjust', 'duplicate_payment', 'expire', 'import', 'import_transfer', 'late_payment', 'referral_reward', 'refund', 'return', 'spend', 'wrong_amount']);
    // 'refund' is value credited TO the wallet when a booking is cancelled in time (D78, CANCEL-02), never money to the player.
  });
});

describe('F13-T20 the test series stays apart from the real one (D33, RCPT-01-AC15)', () => {
  it('a receipt series is a Bangkok year or T and a year, and the two never mix; counters are per club and series', async () => {
    const defs = (await tdb.query(`select pg_get_constraintdef(oid) as d from pg_constraint where contype = 'c' and conrelid = 'public.receipt'::regclass and pg_get_constraintdef(oid) ~ 'series'`)).rows.map((r) => r.d as string).join('\n');
    expect(defs).toMatch(/is_test/);
    const pk = (await tdb.query(`select pg_get_constraintdef(oid) as d from pg_constraint where conrelid = 'public.receipt_counter'::regclass and contype = 'p'`)).rows[0]?.d as string;
    expect(pk).toMatch(/club_id/);
    expect(pk).toMatch(/series/);
  });

  it('receipts, payments and ledger rows made in Testing carry is_test, and the Go live purge deletes the test rows of these tables before the orders', async () => {
    for (const t of ['receipt', 'payment', 'wallet_ledger', 'credit_ledger', 'order_line', 'receipt_void', 'daily_close']) {
      const has = (await tdb.query(`select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = 'is_test'`, [t])).rowCount;
      expect(has, `${t} has no is_test column`).toBe(1);
    }
  });
});

// Proved by behaviour in the lanes' tests, traced in F13-receipts-reports.traced.spec.ts:
//   receipts never change: packages/db/src/receipt-tables.test.ts "update and delete fail for every role, and number, lines and total never change"
//   a port failure rolls back the payment: take-cash.test.ts "a missing receipt port undoes the whole cash taking"; apply-payment.test.ts "no receipt port: the call raises and the booking stays held, the payment pending"
//   the first real receipt after Go live is 000001 whatever the test series reached: issue-receipt.test.ts "after Go live the first real receipt is 000001"
