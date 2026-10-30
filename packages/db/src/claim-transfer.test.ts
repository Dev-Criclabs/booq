import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F06-T08 / migration 0510: the claim handler wallet_transfer and the reason import_transfer
// (PLAT-06-AC3, AC7, PKG-01-AC1 to AC3; D13, D105, D154).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const CLAIMANT = '11111111-1111-4111-8111-111111111111';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const IMPORTED = '66666666-6666-4666-8666-666666666666';
const COURT = '00000000-0000-4000-8000-0000000000e1';
const EXPIRES = '2027-04-05T16:59:59.999Z';

let tdb: TestDatabase;
let product: string;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  for (const [u, roles] of [[CLAIMANT, ['player']], [DESK, ['front_desk', 'player']], [OWNER, ['owner', 'player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [A, u, 'L' + u.slice(0, 2)]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [A, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, claim_state, phone, phone_normalized) values ($1,$2,null,'unclaimed','0812345678','0812345678')`, [A, IMPORTED]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, IMPORTED]);
    await c.query('commit');
  } finally {
    c.release();
  }
  product = (await tdb.query(`insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_satang)
                              values ($1,'10 ชั่วโมง','10 hours','court_hour',10,3,450000) returning id`, [A])).rows[0].id;
  const loc = (await tdb.query(`insert into public.location (club_id, name) values ($1,'Main') returning id`, [A])).rows[0].id;
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'Court 1','tennis')`, [A, COURT, loc]);
  await tdb.query(`insert into public.claim_request (club_id, imported_user_id, claimant_user_id, typed_full_name, typed_phone) values ($1,$2,$3,'Somchai','0812345678')`, [A, IMPORTED, CLAIMANT]);
  await tdb.setNow('2027-02-01T03:00:00Z');
});
afterEach(async () => {
  await tdb.close();
});

/** Runs as booq_owner in a context: a definer caller (no user) or a staff member at the counter. */
async function run<T = unknown>(sql: string, args: unknown[] = [], staff?: { id: string; roles: string[] }): Promise<T> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role booq_owner');
    await c.query(`select set_config('app.club_id', $1, true)`, [A]);
    if (staff) {
      await c.query(`select set_config('app.user_id', $1, true), set_config('app.roles', $2, true), set_config('app.source', 'admin', true)`, [staff.id, staff.roles.join(',')]);
    }
    const r = Object.values((await c.query(sql, args)).rows[0] ?? {})[0] as T;
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const confirm = () => run('select app.claim_confirm($1, $2)', [IMPORTED, CLAIMANT], { id: DESK, roles: ['front_desk', 'player'] });
/** The import of F01: a wallet balance and a package with credits, written with reason import. */
async function importBalances(walletSatang: number, credits: number) {
  if (walletSatang > 0) await run('select app.wallet_credit($1, $2, $3, $4)', [IMPORTED, walletSatang, 'import', 'import:wallet:1']);
  if (credits > 0) {
    const pkg = (await tdb.query(`insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, expires_at)
                                  values ($1,$2,$3,'{"credit_type":"court_hour"}',$4,'2027-01-04T17:30:00Z',$5) returning id`, [A, IMPORTED, product, credits, EXPIRES])).rows[0].id as string;
    return pkg;
  }
  return null;
}
const wallet = async (u: string) => Number((await tdb.query(`select coalesce(sum(change_satang), 0) as n from public.wallet_ledger where customer_id = $1`, [u])).rows[0].n);
const creditsOf = async (u: string) =>
  (await tdb.query(`select p.id, p.expires_at, p.product_snapshot, p.credits_total + coalesce((select sum(l.change) from public.credit_ledger l where l.package_id = p.id), 0) as left
                      from public.customer_package p where p.customer_id = $1 order by p.created_at, p.id`, [u])).rows.map((r) => ({ ...r, left: Number(r.left) }));

describe('the reason import_transfer (D154)', () => {
  it('is in both reason sets, signed, and only with a claim_ key', async () => {
    const values = async (name: string) =>
      [...((await tdb.query(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = $1`, [name])).rows[0].d as string).matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
    expect(await values('credit_ledger_reason_values')).toContain('import_transfer');
    expect(await values('wallet_ledger_reason_values')).toContain('import_transfer');
    await expect(tdb.query(`insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, dedupe_key) values ($1,$2,100,'import_transfer','x:1')`, [A, CLAIMANT])).rejects.toThrow(/import_transfer_key/);
    await expect(tdb.query(`insert into public.wallet_ledger (club_id, customer_id, change_satang, reason) values ($1,$2,100,'import_transfer')`, [A, CLAIMANT])).rejects.toThrow(/import_transfer_key/);
    await expect(tdb.query(`insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, dedupe_key) values ($1,$2,0,'import_transfer','claim_x')`, [A, CLAIMANT])).rejects.toThrow(/check/);
  });
  it('a sold package still starts with its credits; only a package without an order may start at zero', async () => {
    const o = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, CLAIMANT])).rows[0].id;
    await expect(tdb.query(`insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, expires_at, order_id) values ($1,$2,$3,'{}',0,$4,$5)`, [A, CLAIMANT, product, EXPIRES, o])).rejects.toThrow(/credits_total_check/);
  });
});

describe('imported value is inert until the claim is confirmed (design 4.8)', () => {
  it('cannot be spent, reserved, listed or reduced (customer_not_claimed)', async () => {
    const pkg = await importBalances(10000, 5);
    await expect(run('select * from app.eligible_credits($1, $2)', [IMPORTED, '{"credit_type":"court_hour"}'])).rejects.toThrow(/customer_not_claimed/);
    await expect(run('select app.wallet_adjust($1, -100, $2)', [IMPORTED, 'x'], { id: DESK, roles: ['front_desk'] })).rejects.toThrow(/customer_not_claimed/);
    await expect(run('select app.credit_adjust($1, -1, $2)', [pkg, 'x'], { id: DESK, roles: ['front_desk'] })).rejects.toThrow(/customer_not_claimed/);
    const o = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'staff') returning id`, [A, IMPORTED])).rows[0].id;
    await expect(run('select app.wallet_spend($1, 100, $2, gen_random_uuid())', [IMPORTED, o])).rejects.toThrow(/customer_not_claimed/);
    expect(await wallet(IMPORTED)).toBe(10000);
  });
});

describe('confirming a claim moves the value by paired rows (PLAT-06-AC7, D13)', () => {
  it('the imported user ends at zero and the claimant gains exactly the amount', async () => {
    await importBalances(12345, 7);
    await run('select app.wallet_credit($1, 5000, $2, $3)', [CLAIMANT, 'refund', 'refund:own']);
    await confirm();
    expect(await wallet(IMPORTED)).toBe(0);
    expect(await wallet(CLAIMANT)).toBe(5000 + 12345);
    expect((await creditsOf(IMPORTED)).map((p) => p.left)).toEqual([0]);
    expect((await creditsOf(CLAIMANT)).map((p) => p.left)).toEqual([7]);
    const rows = (await tdb.query(`select customer_id, change_satang from public.wallet_ledger where reason = 'import_transfer' order by change_satang`)).rows;
    expect(rows).toEqual([{ customer_id: IMPORTED, change_satang: '-12345' }, { customer_id: CLAIMANT, change_satang: '12345' }]);
    expect((await tdb.query(`select change from public.credit_ledger where reason = 'import_transfer' order by change`)).rows).toEqual([{ change: -7 }, { change: 7 }]);
  });
  it('packages keep their expiry and product snapshot; a package with nothing left is not copied', async () => {
    const pkg = await importBalances(0, 5);
    const empty = (await tdb.query(`insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, expires_at)
                                    values ($1,$2,$3,'{"credit_type":"court_hour"}',1,'2027-01-04T17:30:00Z',$4) returning id`, [A, IMPORTED, product, EXPIRES])).rows[0].id;
    await tdb.query(`insert into public.credit_ledger (club_id, package_id, change, reason) values ($1,$2,-1,'import')`, [A, empty]);
    await confirm();
    const [copy] = await creditsOf(CLAIMANT);
    expect(await creditsOf(CLAIMANT)).toHaveLength(1);
    expect(copy?.left).toBe(5);
    expect(new Date(copy?.expires_at).toISOString()).toBe(EXPIRES);
    expect(copy?.product_snapshot).toEqual({ credit_type: 'court_hour' });
    expect((await tdb.query(`select count(*)::int as n from public.package_extension`)).rows[0].n).toBe(0);
    expect(pkg).not.toBe(copy?.id);
  });
  it('a repeated confirm transfers once', async () => {
    await importBalances(10000, 3);
    await confirm();
    await expect(confirm()).rejects.toThrow(/no open request/);
    await run('select app.f06_claim_transfer($1, $2, $3)', [A, IMPORTED, CLAIMANT], { id: DESK, roles: ['front_desk'] });   // a retried handler
    expect(await wallet(CLAIMANT)).toBe(10000);
    expect((await creditsOf(CLAIMANT)).map((p) => p.left)).toEqual([3]);
    expect((await tdb.query(`select count(*)::int as n from public.wallet_ledger where reason = 'import_transfer'`)).rows[0].n).toBe(2);
  });
  it('the sum of import and import_transfer rows equals the amount imported (PKG-01-AC1)', async () => {
    await importBalances(8000, 4);
    await tdb.query(`insert into public.credit_ledger (club_id, package_id, change, reason) select club_id, id, 2, 'import' from public.customer_package where customer_id = $1`, [IMPORTED]);
    await confirm();
    const w = Number((await tdb.query(`select sum(change_satang) as n from public.wallet_ledger where reason in ('import', 'import_transfer')`)).rows[0].n);
    expect(w).toBe(8000);
    const c = Number((await tdb.query(`select sum(change) as n from public.credit_ledger where reason in ('import', 'import_transfer')`)).rows[0].n);
    expect(c).toBe(2);                                    // the import rows only; the transfer pair nets to zero
    expect((await creditsOf(CLAIMANT)).map((p) => p.left)).toEqual([6]);
  });
  it('the claimant can then use the value; the audit entry lists the amounts moved', async () => {
    await importBalances(10000, 2);
    await confirm();
    const spec = { credit_type: 'court_hour' };
    expect(await run<string | null>('select package_id from app.eligible_credits($1, $2)', [CLAIMANT, JSON.stringify(spec)])).toBe((await creditsOf(CLAIMANT))[0]?.id);
    const a = (await tdb.query(`select new_value from public.audit_entry where action = 'claim.balances_transferred'`)).rows;
    expect(a).toHaveLength(1);
    expect(a[0].new_value).toMatchObject({ imported_user_id: IMPORTED, wallet_satang: 10000, credits: 2 });
  });
  it('is registered as the claim handler wallet_transfer; a pair that was not merged is refused', async () => {
    expect((await tdb.query(`select handler::text from app.claim_handlers where handler_key = 'wallet_transfer'`)).rows).toEqual([{ handler: 'app.f06_claim_transfer(uuid,uuid,uuid)' }]);
    await expect(run('select app.f06_claim_transfer($1, $2, $3)', [A, IMPORTED, CLAIMANT])).rejects.toThrow(/not merged/);
  });
});
