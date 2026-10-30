import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F07-T02 / migration 0802: coach_pay (COACH-02, R2, CC-3; D156). Owner only. A null is "not set" and never replaced
// by a default (HO open items). F13's payouts and F12's K6 read it through their own functions, not the coach.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const COACH = '11111111-1111-4111-8111-111111111111';
const OWNER = '44444444-4444-4444-8444-444444444444';
const DESK = '33333333-3333-4333-8333-333333333333';
const ACC = '55555555-5555-4555-8555-555555555555';
const BCOACH = '66666666-6666-4666-8666-666666666666';
let tdb: TestDatabase;
let web: Db;

const ctx = (user: string | null, roles: string[], club = A) => ({ clubId: club, userId: user, roles: roles as never, source: 'admin' as const });
const as = (c: ReturnType<typeof ctx>, sql: string, params: unknown[] = []) => web.withClubTx(c, async (tx) => (await tx.query(sql, params)).rows);
const owner = () => ctx(OWNER, ['owner', 'player']);

async function person(club: string, id: string, roles: string[]) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [club, id, 'L' + id.slice(0, 4)]);
    for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await person(A, OWNER, ['owner', 'player']);
  await person(A, DESK, ['front_desk', 'player']);
  await person(A, ACC, ['accountant', 'player']);
  await tdb.seedCoach(A, COACH);
  await tdb.seedCoach(B, BCOACH);
  web = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});

describe('who reads and writes coach_pay', () => {
  it('the owner inserts, reads and updates it', async () => {
    await as(owner(), `insert into public.coach_pay (club_id, coach_id, monthly_base_satang, solo_pay_kind, solo_pay_value) values ($1,$2,2000000,'percent',5000)`, [A, COACH]);
    expect(await as(owner(), `select monthly_base_satang, solo_pay_kind, solo_pay_value from public.coach_pay`)).toEqual([{ monthly_base_satang: 2000000, solo_pay_kind: 'percent', solo_pay_value: 5000 }]);
    await as(owner(), `update public.coach_pay set solo_pay_value = 6000 where coach_id = $1`, [COACH]);
    expect((await as(owner(), `select solo_pay_value from public.coach_pay`))[0]).toEqual({ solo_pay_value: 6000 });
  });

  it('front desk, accountant, the coach, a player and a guest see no row and cannot write', async () => {
    await tdb.query(`insert into public.coach_pay (club_id, coach_id, monthly_base_satang) values ($1,$2,1)`, [A, COACH]);
    for (const c of [ctx(DESK, ['front_desk', 'player']), ctx(ACC, ['accountant', 'player']), ctx(COACH, ['coach', 'player']), ctx(null, ['guest']), ctx(null, [])]) {
      expect(await as(c, `select * from public.coach_pay`), JSON.stringify(c.roles)).toEqual([]);
      await expect(as(c, `insert into public.coach_pay (club_id, coach_id) values ($1,$2)`, [A, BCOACH]), JSON.stringify(c.roles)).rejects.toThrow(/row-level security|permission denied|foreign key/i);
      expect(await as(c, `update public.coach_pay set monthly_base_satang = 2 returning coach_id`)).toEqual([]);
    }
    expect((await tdb.query(`select monthly_base_satang from public.coach_pay`)).rows[0].monthly_base_satang).toBe(1);
  });

  it('BOOQ staff, the worker and the other roles have no privilege on the table; nobody deletes', async () => {
    for (const role of ['booq_platform', 'booq_worker', 'booq_audit', 'booq_anonymiser']) {
      expect((await tdb.query(`select has_table_privilege($1, 'public.coach_pay', 'select') as ok`, [role])).rows[0].ok, role).toBe(false);
    }
    expect((await tdb.query(`select has_table_privilege('booq_app', 'public.coach_pay', 'delete') as ok`)).rows[0].ok).toBe(false);
  });

  it('another club’s owner sees nothing and cannot reach the coach', async () => {
    await tdb.query(`insert into public.coach_pay (club_id, coach_id, monthly_base_satang) values ($1,$2,1)`, [A, COACH]);
    await person(B, '77777777-7777-4777-8777-777777777777', ['owner', 'player']);
    const bOwner = ctx('77777777-7777-4777-8777-777777777777', ['owner', 'player'], B);
    expect(await as(bOwner, `select * from public.coach_pay`)).toEqual([]);
    await expect(as(owner(), `insert into public.coach_pay (club_id, coach_id) values ($1,$2)`, [A, BCOACH])).rejects.toThrow(/foreign key/i);
  });
});

describe('what the row may hold', () => {
  it('nulls mean not set, and no default is written', async () => {
    await as(owner(), `insert into public.coach_pay (club_id, coach_id) values ($1,$2)`, [A, COACH]);
    expect((await as(owner(), `select monthly_base_satang, solo_pay_kind, solo_pay_value, group_pay_kind, group_pay_value from public.coach_pay`))[0]).toEqual({ monthly_base_satang: null, solo_pay_kind: null, solo_pay_value: null, group_pay_kind: null, group_pay_value: null });
  });

  it('a pay kind and its value come together; percent is 0 to 10000 basis points; amounts are not negative', async () => {
    const ins = (cols: string, vals: unknown[]) => as(owner(), `insert into public.coach_pay (club_id, coach_id, ${cols}) values ($1,$2, ${vals.map((_, i) => '$' + (i + 3)).join(',')})`, [A, COACH, ...vals]);
    await expect(ins('solo_pay_kind', ['fixed'])).rejects.toThrow(/coach_pay_solo_pair/);
    await expect(ins('solo_pay_value', [5000])).rejects.toThrow(/coach_pay_solo_pair/);
    await expect(ins('group_pay_kind', ['percent'])).rejects.toThrow(/coach_pay_group_pair/);
    await expect(ins('solo_pay_kind, solo_pay_value', ['percent', 10001])).rejects.toThrow(/coach_pay_solo_value/);
    await expect(ins('solo_pay_kind, solo_pay_value', ['fixed', -1])).rejects.toThrow(/coach_pay_solo_value/);
    await expect(ins('solo_pay_kind, solo_pay_value', ['hourly', 1])).rejects.toThrow(/coach_pay_solo_kind/);
    await expect(ins('monthly_base_satang', [-1])).rejects.toThrow(/coach_pay_base/);
    await ins('solo_pay_kind, solo_pay_value, group_pay_kind, group_pay_value', ['fixed', 50000, 'percent', 4000]);
  });

  it('is one row per coach', async () => {
    await tdb.query(`insert into public.coach_pay (club_id, coach_id) values ($1,$2)`, [A, COACH]);
    await expect(tdb.query(`insert into public.coach_pay (club_id, coach_id) values ($1,$2)`, [A, COACH])).rejects.toThrow(/duplicate key|pkey/);
  });

  it('keeps the amounts apart in the audit log as personal data', async () => {
    await as(owner(), `insert into public.coach_pay (club_id, coach_id, monthly_base_satang) values ($1,$2,2345678)`, [A, COACH]);
    const e = (await tdb.query(`select new_value, pii_new from public.audit_entry where record_type = 'coach_pay'`)).rows;
    expect(e).toHaveLength(1);
    expect(JSON.stringify(e[0].new_value)).not.toContain('2345678');
    expect(JSON.stringify(e[0].pii_new)).toContain('2345678');
  });
});
