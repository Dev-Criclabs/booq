import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F13-T12, T13 / migration 0711: app.receipt_for_print (RCPT-01-AC9, AC11; RCPT-02-AC8; D35).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const ACC = '55555555-5555-4555-8555-555555555555';
const COACH = '66666666-6666-4666-8666-666666666666';
const OWNER_B = '77777777-7777-4777-8777-777777777777';

let tdb: TestDatabase;
let web: Db;
let rid: string;
let ridB: string;
const ctx = (user: string, roles: string[], club = A) => ({ clubId: club, userId: user, roles, source: 'admin' as const });
const print = async (c: ReturnType<typeof ctx>, id = rid) => (await web.withClubTx(c, (tx) => tx.query('select app.receipt_for_print($1) as r', [id]))).rows[0]!.r as Record<string, any>;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(
    `insert into public.club (id, slug, name_th, name_en, status, receipt_prefix, legal_name, tax_id, tax_branch, registered_address, default_language)
     values ($1,'a','ก','A','live','HTC','บริษัท เอ จำกัด','0135569018041','00000','99 ถนน','en'), ($2,'b','ข','B','live','BBB',null,null,null,null,'th')`, [A, B]);
  for (const [club, u, roles, lang] of [[A, PLAYER, ['player'], 'th'], [A, OTHER, ['player'], null], [A, DESK, ['front_desk', 'player'], null], [A, OWNER, ['owner', 'player'], null], [A, ACC, ['accountant', 'player'], null], [A, COACH, ['coach', 'player'], null], [B, OWNER_B, ['owner', 'player'], null]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id, full_name, language) values ($1,$2,$3,$4,$5)', [club, u, 'L' + u.slice(0, 2), 'Name ' + u.slice(0, 2), lang]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  const mk = async (club: string, customer: string, n: number) => {
    const o = (await tdb.query(`insert into public.orders (club_id, customer_id, source, status) values ($1,$2,'online','paid') returning id`, [club, customer])).rows[0].id as string;
    return (await tdb.query(
      `insert into public.receipt (club_id, order_id, kind, series, seq_no, number, vat_flag, customer_id, customer_name_snapshot, lines, total_satang)
       values ($1,$2,'sale','2026',$3,$4,false,$5,'Somchai','{"items":[]}'::jsonb,50000) returning id`, [club, o, n, `X-2026-00000${n}`, customer])).rows[0].id as string;
  };
  rid = await mk(A, PLAYER, 1);
  ridB = await mk(B, OWNER_B, 1);
  web = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});

describe('who may print', () => {
  it('the customer and owner, accountant and front desk may; another player, a coach, another club and an unknown id get not found', async () => {
    for (const c of [ctx(PLAYER, ['player']), ctx(OWNER, ['owner', 'player']), ctx(ACC, ['accountant', 'player']), ctx(DESK, ['front_desk', 'player'])]) {
      expect((await print(c)).number, c.roles.join()).toBe('X-2026-000001');
    }
    for (const c of [ctx(OTHER, ['player']), ctx(COACH, ['coach', 'player']), ctx(OWNER_B, ['owner', 'player'], B)]) {
      await expect(print(c), c.roles.join()).rejects.toThrow(/receipt:not_found/);
    }
    await expect(print(ctx(OWNER, ['owner', 'player']), 'aaaaaaaa-0000-4000-8000-0000000000ff')).rejects.toThrow(/receipt:not_found/);
    await expect(print(ctx(OWNER, ['owner', 'player']), ridB)).rejects.toThrow(/receipt:not_found/);
  });
  it('only the app role may call it', async () => {
    for (const [role, want] of [['booq_app', true], ['booq_worker', false], ['booq_platform', false], ['anon', false]] as const) {
      expect((await tdb.query(`select has_function_privilege($1, 'app.receipt_for_print(uuid)', 'execute') as ok`, [role])).rows[0].ok, role).toBe(want);
    }
  });
});

describe('original and copy (RCPT-01-AC11)', () => {
  it('the customer\'s first print is the original; every later print, by anyone, is a copy', async () => {
    expect((await print(ctx(PLAYER, ['player']))).original).toBe(true);
    expect((await print(ctx(PLAYER, ['player']))).original).toBe(false);
    expect((await print(ctx(OWNER, ['owner', 'player']))).original).toBe(false);
  });
  it('a staff print is always a copy and never uses up the customer\'s original', async () => {
    expect((await print(ctx(DESK, ['front_desk', 'player']))).original).toBe(false);
    expect((await tdb.query(`select count(*)::int as n from public.receipt_print`)).rows[0].n).toBe(0);
    expect((await print(ctx(PLAYER, ['player']))).original).toBe(true);
  });
  it('the print record is append-only and written by no role directly', async () => {
    await print(ctx(PLAYER, ['player']));
    await expect(tdb.query(`delete from public.receipt_print`)).rejects.toThrow(/append-only/);
    for (const role of ['booq_app', 'booq_worker', 'booq_platform']) {
      expect((await tdb.query(`select has_table_privilege($1, 'public.receipt_print', 'select,insert,update,delete') as ok`, [role])).rows[0].ok, role).toBe(false);
    }
  });
});

describe('what it returns (RCPT-02; D35)', () => {
  it('the snapshot, the club\'s legal details and the language: the player\'s own, else the club default', async () => {
    const p = await print(ctx(PLAYER, ['player']));
    expect(p).toMatchObject({ number: 'X-2026-000001', kind: 'sale', status: 'issued', customer_name: 'Somchai', total_satang: 50000, language: 'th', void_reason: null,
      club: { legal_name: 'บริษัท เอ จำกัด', name_th: 'ก', tax_id: '0135569018041', tax_branch: '00000', registered_address: '99 ถนน' } });
    const o = await tdb.query(`insert into public.orders (club_id, customer_id, source, status) values ($1,$2,'online','paid') returning id`, [A, OTHER]);
    const r2 = (await tdb.query(`insert into public.receipt (club_id, order_id, kind, series, seq_no, number, vat_flag, customer_id, customer_name_snapshot, lines, total_satang) values ($1,$2,'sale','2026',2,'X-2026-000002',false,$3,'N','{}'::jsonb,1) returning id`, [A, o.rows[0].id, OTHER])).rows[0].id as string;
    expect((await print(ctx(OTHER, ['player']), r2)).language).toBe('en');   // no saved language: the club's default
  });
  it('a voided receipt carries its reason; nothing personal beyond the name snapshot is returned', async () => {
    await web.withClubTx(ctx(OWNER, ['owner', 'player']), (tx) => tx.query('select app.void_receipt($1, $2)', [rid, 'wrong item']));
    const p = await print(ctx(ACC, ['accountant', 'player']));
    expect(p).toMatchObject({ status: 'void', void_reason: 'wrong item' });
    expect(JSON.stringify(p)).not.toMatch(/phone|date_of_birth|line_user_id/);
  });
  it('a staff print is in the club audit log with the staff member as the actor and no personal data', async () => {
    await print(ctx(DESK, ['front_desk', 'player']));
    await print(ctx(PLAYER, ['player']));
    expect((await tdb.query(`select actor_user_id, record_id, new_value from public.audit_entry where action = 'receipt.printed'`)).rows).toEqual([{ actor_user_id: DESK, record_id: rid, new_value: { number: 'X-2026-000001' } }]);
  });
});
