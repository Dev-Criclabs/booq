// F06-T23 (QA): append-only and blind suite for F06. IDs: PKG-01-AC5, AC9, CANCEL-02, CC-1 (BOOQ staff never see a club's wallets or packages).
// The behaviour of update, delete and truncate on the two ledgers as every role is proved by packages/db/src/ledgers.test.ts; the trigger inventory in
// F13-cross-cutting.new.spec.ts covers wallet_ledger, credit_ledger and package_extension. This file adds the blind side from the grants, for every F06 table and function.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../packages/db/src/testing/harness';

let tdb: TestDatabase;
beforeAll(async () => {
  tdb = await createTestDatabase();
}, 120_000);
afterAll(async () => {
  await tdb?.close();
});

/** package_product is the club's own price list (table class S, set up by BOOQ staff in a Draft or Testing club, PLAT-02-AC2); the others hold a customer's value. */
const F06_TABLES = ['customer_package', 'package_extension', 'wallet_account', 'credit_ledger', 'wallet_ledger'];

describe('F06-T23 BOOQ staff are blind to wallets and packages (CC-1)', () => {
  it('the platform role has no privilege of any kind on an F06 table', async () => {
    for (const t of F06_TABLES) {
      for (const priv of ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) {
        const ok = (await tdb.query(`select has_table_privilege('booq_platform', $1, $2) as ok`, [`public.${t}`, priv])).rows[0].ok;
        expect(ok, `booq_platform ${priv} on ${t}`).toBe(false);
      }
    }
  });

  it('the platform role may not run any function that touches wallets, credits or packages', async () => {
    const fns = (await tdb.query(`select p.oid::regprocedure::text as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname ~ '(wallet|credit_|package|extend_package|grant_package)'`)).rows.map((r) => r.f as string);
    expect(fns.length, 'the scan found the F06 functions').toBeGreaterThan(15);
    for (const f of fns) {
      const ok = (await tdb.query(`select has_function_privilege('booq_platform', $1::regprocedure, 'execute') as ok`, [f])).rows[0].ok;
      expect(ok, `booq_platform may execute ${f}`).toBe(false);
    }
  });

  it('the app and worker roles cannot write the ledgers or the extension log directly: only the definer functions do (no insert, update, delete or truncate grant)', async () => {
    for (const t of ['credit_ledger', 'wallet_ledger', 'package_extension']) {
      for (const role of ['booq_app', 'booq_worker']) {
        for (const priv of ['insert', 'update', 'delete', 'truncate']) {
          const ok = (await tdb.query(`select has_table_privilege($1, $2, $3) as ok`, [role, `public.${t}`, priv])).rows[0].ok;
          expect(ok, `${role} ${priv} on ${t}`).toBe(false);
        }
      }
    }
  });

  it('every wallet function is one this suite knows; the ones the app role may call are only the staff adjustment and the two pay time helpers', async () => {
    const rows = (await tdb.query(`select p.proname as f, has_function_privilege('booq_app', p.oid, 'execute') as app from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname ~ 'wallet'`)).rows as Array<{ f: string; app: boolean }>;
    const known = ['check_wallet_balance', 'due_wallet_expiry', 'lock_wallet', 'lock_wallet_and_packages', 'pay_to_wallet', 'port_credit_wallet', 'port_reserve_credit_and_wallet', 'wallet_adjust', 'wallet_credit', 'wallet_credit_order', 'wallet_expire', 'wallet_return', 'wallet_return_line', 'wallet_spend', 'wallet_sum', 'wallet_value_expires_at'];
    expect(rows.map((r) => r.f).filter((n) => !known.includes(n)), 'a wallet function this suite does not know: check that it does not pay money out, then list it').toEqual([]);
    expect(rows.filter((r) => r.app).map((r) => r.f).sort(), 'wallet functions the app role may call').toEqual(['lock_wallet_and_packages', 'port_reserve_credit_and_wallet', 'wallet_adjust']);
  });
});
