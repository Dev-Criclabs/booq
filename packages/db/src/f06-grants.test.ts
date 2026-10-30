import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F06-T11 / migration 0513: who reads what of F06, and an extended package expires again (PKG-01, PKG-03-AC3, CC-1,
// CC-3; D27, D35, D103, D118).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const ACC = '55555555-5555-4555-8555-555555555555';
const COACH = '66666666-6666-4666-8666-666666666666';
const PB = '77777777-7777-4777-8777-777777777777';
const OB = '88888888-8888-4888-8888-888888888888';
const EXPIRES = '2027-04-05T16:59:59.999Z';
const D_TABLES = ['customer_package', 'package_extension', 'wallet_account', 'credit_ledger', 'wallet_ledger'];
const VIEWS = ['wallet_balance', 'package_balance', 'package_status'];

let tdb: TestDatabase;
let db: Db;
const product: Record<string, string> = {};
const pkgs: Record<string, string> = {};
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  const people: [string, string, string[]][] = [
    [A, P1, ['player']], [A, P2, ['player']], [A, DESK, ['front_desk', 'player']], [A, OWNER, ['owner', 'player']],
    [A, ACC, ['accountant', 'player']], [A, COACH, ['coach', 'player']], [B, PB, ['player']], [B, OB, ['owner', 'player']],
  ];
  for (const [club, u, roles] of people) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into public.app_user (club_id, id, line_user_id, phone, phone_normalized, date_of_birth) values ($1,$2,$3,'0812345678','0812345678','1990-01-01')`, [club, u, 'L' + u.slice(0, 2)]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  for (const club of [A, B]) {
    product[club] = (await tdb.query(`insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_satang)
                                       values ($1,'10','10 hours','court_hour',10,3,450000) returning id`, [club])).rows[0].id;
  }
  for (const [club, u] of [[A, P1], [A, P2], [B, PB]] as const) {
    pkgs[u] = (await tdb.query(`insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, expires_at)
                                values ($1,$2,$3,'{"credit_type":"court_hour"}',5,'2027-01-04T17:30:00Z',$4) returning id`, [club, u, product[club], EXPIRES])).rows[0].id;
    await tdb.query(`insert into public.credit_ledger (club_id, package_id, change, reason) values ($1,$2,1,'import')`, [club, pkgs[u]]);
    await tdb.query(`insert into public.wallet_account (club_id, customer_id) values ($1,$2)`, [club, u]);
    await tdb.query(`insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, dedupe_key) values ($1,$2,1000,'refund',$3)`, [club, u, 'r:' + u]);
    await tdb.query(`insert into public.package_extension (club_id, package_id, kind, old_expires_at, new_expires_at, reason, staff_id)
                     values ($1,$2,'owner',$3,'2027-05-05T16:59:59.999Z','x',$4)`, [club, pkgs[u], EXPIRES, club === A ? OWNER : OB]);
  }
  db = createDb({ connectionString: tdb.url, max: 1 });
  await tdb.setNow('2027-02-01T03:00:00Z');
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

const as = async (user: string | null, roles: string[], sql: string, club = A) =>
  (await db.withClubTx({ clubId: club, userId: user, roles: roles as never, source: 'player_app' }, (tx) => tx.query(sql))).rows;
const customersIn = async (user: string | null, roles: string[], table: string, club = A) => {
  const col = table === 'credit_ledger' || table === 'package_extension' ? 'package_id' : 'customer_id';
  return (await as(user, roles, `select ${col} as k from public.${table}`, club)).map((r) => r.k as string);
};

describe('a player reads only their own (PKG-01, CC-3)', () => {
  it('own packages, extensions, wallet, both ledgers and the three views; never another player’s', async () => {
    for (const t of D_TABLES) {
      const keys = await customersIn(P1, ['player'], t);
      expect(keys.length, t).toBeGreaterThan(0);
      expect(keys.every((k) => k === P1 || k === pkgs[P1]), t).toBe(true);
    }
    for (const v of VIEWS) {
      expect((await as(P1, ['player'], `select customer_id from public.${v}`)).map((r) => r.customer_id), v).toEqual([P1]);
    }
  });
  it('a coach reads only their own too; a guest reads nothing', async () => {
    for (const t of [...D_TABLES, ...VIEWS]) {
      expect(await as(COACH, ['coach', 'player'], `select 1 from public.${t}`), t).toEqual([]);
      expect(await as(null, ['guest'], `select 1 from public.${t}`), t).toEqual([]);
    }
    expect(await as(null, ['guest'], 'select 1 from public.package_product')).toEqual([]);
    expect(await as(P1, ['player'], 'select name_en from public.package_product')).toEqual([{ name_en: '10 hours' }]);
  });
  it('no app role writes a ledger, a package or an extension directly', async () => {
    for (const t of D_TABLES) {
      for (const priv of ['insert', 'update', 'delete']) {
        expect((await tdb.query('select has_table_privilege($1, $2, $3) as ok', ['booq_app', `public.${t}`, priv])).rows[0].ok, `${t} ${priv}`).toBe(false);
      }
    }
  });
});

describe('staff and the accountant (design 7; D35)', () => {
  it('front desk, owner and accountant read the club’s rows, and only this club’s', async () => {
    for (const [u, roles] of [[DESK, ['front_desk', 'player']], [OWNER, ['owner', 'player']], [ACC, ['accountant', 'player']]] as const) {
      expect((await customersIn(u, [...roles], 'wallet_ledger')).sort(), u).toEqual([P1, P2].sort());
      expect((await customersIn(u, [...roles], 'credit_ledger')).sort(), u).toEqual([pkgs[P1], pkgs[P2]].sort());
      expect((await as(u, [...roles], 'select customer_id from public.wallet_balance')).length, u).toBe(2);
    }
    expect(await customersIn(OB, ['owner', 'player'], 'wallet_ledger', B)).toEqual([PB]);
  });
  it('the accountant sees names but no phone or date of birth', async () => {
    const names = await as(ACC, ['accountant', 'player'], 'select * from public.app_user_names');
    expect(names.length).toBeGreaterThan(0);
    expect(Object.keys(names[0] ?? {}).filter((c) => /phone|birth|dob|line/.test(c))).toEqual([]);
    const own = await as(ACC, ['accountant', 'player'], 'select id from public.app_user');
    expect(own.map((r) => r.id)).toEqual([ACC]);                     // app_user itself: only their own row
  });
  it('only the owner adds or edits a product; nobody deletes one', async () => {
    await expect(as(DESK, ['front_desk', 'player'], `update public.package_product set price_satang = 1 where id = '${product[A]}' returning id`)).resolves.toEqual([]);
    expect(await as(OWNER, ['owner', 'player'], `update public.package_product set price_satang = 480000 where id = '${product[A]}' returning price_satang`)).toEqual([{ price_satang: 480000 }]);
    await expect(as(OWNER, ['owner', 'player'], `delete from public.package_product where id = '${product[A]}'`)).rejects.toThrow(/permission denied/);
  });
});

describe('another club and BOOQ staff (CC-1, D27)', () => {
  it('another club’s rows are never visible: a request for them finds nothing (404)', async () => {
    for (const t of ['customer_package', 'wallet_account', 'wallet_ledger', ...VIEWS]) {
      expect(await as(OWNER, ['owner', 'player'], `select 1 from public.${t} where customer_id = '${PB}'`), t).toEqual([]);
    }
    for (const t of ['credit_ledger', 'package_extension']) {
      expect(await as(OWNER, ['owner', 'player'], `select 1 from public.${t} where package_id = '${pkgs[PB]}'`), t).toEqual([]);
    }
  });
  it('BOOQ staff hold no privilege on any class D table or view of F06', async () => {
    for (const t of [...D_TABLES, ...VIEWS]) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        expect((await tdb.query('select has_table_privilege($1, $2, $3) as ok', ['booq_platform', `public.${t}`, priv])).rows[0].ok, `${t} ${priv}`).toBe(false);
      }
    }
    expect((await tdb.query('select has_table_privilege($1, $2, $3) as ok', ['booq_platform', 'public.package_product', 'select'])).rows[0].ok).toBe(true);
  });
});

describe('an extended package expires again at its new date (D118, PKG-03-AC3)', () => {
  it('return after expiry, extend, then expire again at the new date, once', async () => {
    const pkg = pkgs[P1]!;                                         // 6 credits: 5 + 1 imported
    const one = async <T = unknown>(sql: string, args: unknown[]) => {
      const c = await tdb.pool.connect();
      try {
        await c.query('begin');
        await c.query('set local role booq_owner');
        await c.query(`select set_config('app.club_id', $1, true), set_config('app.user_id', $2, true), set_config('app.roles', 'owner', true), set_config('app.source', 'admin', true)`, [A, OWNER]);
        const r = Object.values((await c.query(sql, args)).rows[0] ?? {})[0] as T;
        await c.query('commit');
        return r;
      } finally {
        c.release();
      }
    };
    const left = async () => Number((await tdb.query(`select 5 + coalesce(sum(change), 0) as n from public.credit_ledger where package_id = $1`, [pkg])).rows[0].n);
    await tdb.setNow('2027-04-06T03:00:00Z');                     // past the 5 Apr expiry
    expect(await one<number>('select app.credit_expire($1)', [pkg])).toBe(6);
    expect(await left()).toBe(0);
    // a closure returns a credit reserved before the expiry, as F09 does: a return row
    await tdb.query(`insert into public.credit_ledger (club_id, package_id, change, reason) values ($1,$2,1,'return')`, [A, pkg]);
    expect(await one<number>('select app.credit_expire($1)', [pkg])).toBe(0);   // same expiry date: written off once
    expect(await left()).toBe(1);
    await one('select app.extend_package($1, $2, $3)', [pkg, '2027-04-20T16:59:59.999Z', 'closure on 2 Apr']);
    expect(await one<number>('select app.credit_expire($1)', [pkg])).toBe(0);   // not yet: the new date is later
    await tdb.setNow('2027-04-20T16:59:59.999Z');
    const worker = createDb({ connectionString: tdb.url, max: 1, role: 'booq_worker' });
    try {
      const due = await worker.withClubTx({ clubId: '00000000-0000-0000-0000-000000000000', userId: null, roles: [] as never }, (tx) => tx.query('select package_id from app.due_package_expiry(10)'));
      expect(due.rows).toContainEqual({ package_id: pkg });          // listed again for its new date
    } finally {
      await worker.end();
    }
    expect(await one<number>('select app.credit_expire($1)', [pkg])).toBe(1);
    expect(await one<number>('select app.credit_expire($1)', [pkg])).toBe(0);
    expect(await left()).toBe(0);
    expect((await tdb.query(`select count(*)::int as n from public.credit_ledger where package_id = $1 and reason = 'expire'`, [pkg])).rows[0].n).toBe(2);
  });
});
