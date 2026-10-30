import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectRegistry } from './registry';
import { checkTableClasses } from './registry/check';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F06-T02 / migration 0502: credit_ledger and wallet_ledger (PKG-01-AC1 to AC3, AC5, AC7; D28, D78, D83).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const DESK = '33333333-3333-4333-8333-333333333333';
const PLAYER_B = '22222222-2222-4222-8222-222222222222';
const PRODUCT = '00000000-0000-4000-8000-0000000000d1';

let tdb: TestDatabase;
let pkg: string;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  for (const [club, u, roles] of [[A, PLAYER, ['player']], [A, DESK, ['front_desk', 'player']], [B, PLAYER_B, ['player']]] as const) {
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
  await tdb.query(`insert into public.package_product (club_id, id, name_th, name_en, credit_type, credits, validity_months, price_satang)
                   values ($1,$2,'10 ชั่วโมง','10 hours','court_hour',10,3,450000)`, [A, PRODUCT]);
  pkg = (await tdb.query(`insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, expires_at)
                          values ($1,$2,$3,'{}',2,'2027-01-04T17:30:00Z','2027-04-05T16:59:59.999Z') returning id`, [A, PLAYER, PRODUCT])).rows[0].id;
});
afterEach(async () => {
  await tdb.close();
});

const credit = (reason: string, change: number, extra: { staff?: string; note?: string; key?: string } = {}) =>
  tdb.query(`insert into public.credit_ledger (club_id, package_id, change, reason, staff_id, note, dedupe_key) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [A, pkg, change, reason, extra.staff ?? null, extra.note ?? null, extra.key ?? null]);
const wallet = (reason: string, satang: number, extra: { staff?: string; note?: string; key?: string; customer?: string } = {}) =>
  tdb.query(`insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, staff_id, note, dedupe_key) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [A, extra.customer ?? PLAYER, satang, reason, extra.staff ?? null, extra.note ?? null, extra.key ?? null]);
const creditsLeft = async () =>
  Number((await tdb.query(`select p.credits_total + coalesce(sum(l.change), 0) as n from public.customer_package p left join public.credit_ledger l on l.package_id = p.id where p.id = $1 group by p.credits_total`, [pkg])).rows[0].n);
const walletSum = async () => Number((await tdb.query(`select coalesce(sum(change_satang), 0) as n from public.wallet_ledger where customer_id = $1`, [PLAYER])).rows[0].n);
const checkValues = async (name: string) =>
  [...((await tdb.query(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = $1`, [name])).rows[0].d as string).matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort();

describe('reasons (PKG-01-AC2, AC3; D78)', () => {
  it('the credit reasons are the hand-off list; the wallet reasons are the D78 list (import_transfer comes with F06-T08)', async () => {
    expect(await checkValues('credit_ledger_reason_values')).toEqual(['adjust', 'expire', 'forfeit', 'import', 'reserve', 'return', 'use'].sort());
    expect(await checkValues('wallet_ledger_reason_values')).toEqual(
      ['refund', 'late_payment', 'wrong_amount', 'duplicate_payment', 'referral_reward', 'spend', 'return', 'adjust', 'import', 'expire'].sort());
    await expect(credit('gift', 1)).rejects.toThrow(/reason_values/);
    await expect(wallet('withdraw', -100)).rejects.toThrow(/reason_values/);
    await expect(wallet('import_transfer', 100)).rejects.toThrow(/reason_values/);
  });
  it('credit sign rules: reserve -1, return +1, use and forfeit 0, expire negative, adjust and import never zero (FA Q4)', async () => {
    await expect(credit('reserve', -2)).rejects.toThrow(/credit_ledger_sign/);
    await expect(credit('return', 2)).rejects.toThrow(/credit_ledger_sign/);
    await expect(credit('use', -1)).rejects.toThrow(/credit_ledger_sign/);
    await expect(credit('forfeit', 1)).rejects.toThrow(/credit_ledger_sign/);
    await expect(credit('expire', 0)).rejects.toThrow(/credit_ledger_sign/);
    await expect(credit('import', 0)).rejects.toThrow(/credit_ledger_sign/);
    await expect(credit('adjust', 0, { staff: DESK, note: 'x' })).rejects.toThrow(/credit_ledger_sign/);
    await credit('reserve', -1);
    await credit('use', 0);
    await credit('return', 1);
    await credit('import', 3);
  });
  it('wallet sign rules: money in positive, spend and expire negative, adjust either way', async () => {
    for (const r of ['refund', 'late_payment', 'wrong_amount', 'duplicate_payment', 'referral_reward', 'return', 'import']) {
      await expect(wallet(r, -100), r).rejects.toThrow(/wallet_ledger_sign/);
    }
    await expect(wallet('expire', 100)).rejects.toThrow(/wallet_ledger_sign/);
    await expect(wallet('refund', 0)).rejects.toThrow(/check/);
    await wallet('refund', 10000);
    await wallet('adjust', -500, { staff: DESK, note: 'typo' });
    expect(await walletSum()).toBe(9500);
  });
  it('a spend names its order and line', async () => {
    await wallet('refund', 10000);
    await expect(wallet('spend', -100)).rejects.toThrow(/spend_has_line/);
  });
});

describe('staff notes and dedupe keys (PKG-01-AC4)', () => {
  it('a staff row without a written note is refused; an adjustment is always a staff row', async () => {
    await expect(credit('adjust', 1, { staff: DESK })).rejects.toThrow(/staff_note/);
    await expect(credit('adjust', 1, { staff: DESK, note: '   ' })).rejects.toThrow(/staff_note/);
    await expect(credit('adjust', 1)).rejects.toThrow(/adjust_by_staff/);
    await expect(wallet('adjust', 100, { staff: DESK })).rejects.toThrow(/staff_note/);
    await expect(wallet('adjust', 100)).rejects.toThrow(/adjust_by_staff/);
    await credit('adjust', 1, { staff: DESK, note: 'goodwill' });
    await wallet('adjust', 100, { staff: DESK, note: 'goodwill' });
  });
  it('a dedupe key writes once per club; rows without a key are not limited', async () => {
    await wallet('late_payment', 100, { key: 'late_payment:p1' });
    await expect(wallet('late_payment', 100, { key: 'late_payment:p1' })).rejects.toThrow(/wallet_ledger_dedupe/);
    await credit('reserve', -1, { key: 'reserve:l1:1' });
    await expect(credit('reserve', -1, { key: 'reserve:l1:1' })).rejects.toThrow(/credit_ledger_dedupe/);
    await wallet('refund', 100);
    await wallet('refund', 100);
  });
  it('another club’s customer or package cannot be referenced', async () => {
    await expect(wallet('refund', 100, { customer: PLAYER_B })).rejects.toThrow(/foreign key/i);
    await expect(tdb.query(`insert into public.credit_ledger (club_id, package_id, change, reason) values ($1,$2,1,'import')`, [B, pkg])).rejects.toThrow(/foreign key/i);
  });
});

describe('no balance below zero (PKG-01-AC7, D83)', () => {
  it('using a credit that is not there, or an adjust below zero, is refused at commit', async () => {
    await credit('reserve', -1);
    await credit('reserve', -1);
    await expect(credit('reserve', -1)).rejects.toThrow(/credits below zero/);
    await expect(credit('adjust', -1, { staff: DESK, note: 'x' })).rejects.toThrow(/credits below zero/);
    expect(await creditsLeft()).toBe(0);
  });
  it('spending more than the wallet holds, or an adjust below zero, is refused at commit', async () => {
    await wallet('refund', 10000);
    await expect(wallet('adjust', -10001, { staff: DESK, note: 'x' })).rejects.toThrow(/wallet below zero/);
    await expect(wallet('adjust', -1, { staff: DESK, note: 'x', customer: DESK })).rejects.toThrow(/wallet below zero/);
    expect(await walletSum()).toBe(10000);
  });
  it('the check is deferred: a transaction may go below zero in between if it ends at zero or more', async () => {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, staff_id, note) values ($1,$2,-500,'adjust',$3,'x')`, [A, PLAYER, DESK]);
      await c.query(`insert into public.wallet_ledger (club_id, customer_id, change_satang, reason) values ($1,$2,500,'refund')`, [A, PLAYER]);
      await c.query('commit');
    } finally {
      c.release();
    }
    expect(await walletSum()).toBe(0);
  });
  it('after random movements the balance equals the ledger sum and is never negative (PKG-01-AC1)', async () => {
    let expected = 0;
    for (let i = 0; i < 40; i++) {
      const amount = 100 * (1 + ((i * 37) % 13));
      const spend = i % 3 === 2;
      const delta = spend ? -amount : amount;
      try {
        await wallet(spend ? 'adjust' : 'refund', delta, spend ? { staff: DESK, note: 'n' } : {});
        expected += delta;
      } catch (e) {
        expect(String(e)).toMatch(/wallet below zero/);
        expect(expected + delta).toBeLessThan(0);
      }
      expect(await walletSum()).toBe(expected);
      expect(expected).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('append-only (PKG-01-AC5, D28)', () => {
  it('UPDATE and DELETE fail as every role, including the owner and a superuser; truncate too', async () => {
    await credit('import', 1);
    await wallet('refund', 100);
    for (const t of ['credit_ledger', 'wallet_ledger']) {
      await expect(tdb.query(`update public.${t} set note = 'x'`)).rejects.toThrow(/append-only/);
      await expect(tdb.query(`delete from public.${t}`)).rejects.toThrow(/append-only/);
      await expect(tdb.query(`truncate public.${t}`)).rejects.toThrow(/append-only/);
      for (const role of ['booq_owner', 'booq_app', 'booq_worker', 'booq_platform']) {
        for (const stmt of [`update public.${t} set note = 'x'`, `delete from public.${t}`]) {
          const c = await tdb.pool.connect();
          try {
            await c.query('begin');
            await c.query(`set local role ${role}`);
            await c.query(`select set_config('app.club_id', $1, true)`, [A]);
            await expect(c.query(stmt), `${role}: ${stmt}`).rejects.toThrow(/append-only|permission denied/);
          } finally {
            await c.query('rollback');
            c.release();
          }
        }
        for (const priv of ['update', 'delete', 'truncate']) {
          expect((await tdb.query('select has_table_privilege($1, $2, $3) as ok', [role, `public.${t}`, priv])).rows[0].ok, `${role} ${t} ${priv}`).toBe(role === 'booq_owner');
        }
      }
    }
    expect(await walletSum()).toBe(100);
  });
  it('forced RLS, classes, test flag and audit registration are in place', async () => {
    expect((await checkTableClasses(tdb.pool, await collectRegistry())).problems.filter((p) => p.table !== 'app.test_clock')).toEqual([]);
    const r = (await tdb.query(`select table_name, delete_order from app.test_tables where table_name in ('credit_ledger','wallet_ledger','order_line','booking','customer_package') order by delete_order, table_name`)).rows;
    expect(r.map((x) => x.table_name)).toEqual(['credit_ledger', 'wallet_ledger', 'order_line', 'booking', 'customer_package']);
  });
  it('a movement made in Testing is a test row (PKG-01-AC11)', async () => {
    await tdb.query(`update public.club set status = 'testing' where id = $1`, [A]);
    const id = (await wallet('refund', 100)).rows[0].id;
    expect((await tdb.query(`select is_test from public.wallet_ledger where id = $1`, [id])).rows[0].is_test).toBe(true);
  });
});
