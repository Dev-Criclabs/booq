import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F11-T04 / migration 1102: customer_list, customer_tag_set, staff_add_customer, audit_customer_export (ADMIN-06, ADMIN-04; D168).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER = '44444444-4444-4444-8444-444444444444';
const DESK = '33333333-3333-4333-8333-333333333333';
const ACC = '55555555-5555-4555-8555-555555555555';
const ANN = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const BUSER = '99999999-9999-4999-8999-999999999999';
let tdb: TestDatabase;
let db: Db;

const ctx = (user: string, roles: string[], club = A) => ({ clubId: club, userId: user, roles: roles as never, source: 'admin' as const });
const owner = () => ctx(OWNER, ['owner', 'player']);
const desk = () => ctx(DESK, ['front_desk', 'player']);
const run = <T>(c: ReturnType<typeof ctx>, sql: string, params: unknown[] = []) => db.withClubTx(c, async (tx) => (await tx.query(sql, params)).rows as T[]);
const list = (c = desk(), q: string | null = null, tag: string | null = null) =>
  run<{ id: string; display_name: string; tags: string[]; booking_count: number; phone: string | null }>(c, `select * from public.customer_list($1, $2)`, [q, tag]);

async function person(club: string, id: string, roles: string[], name: string, phone: string | null = null) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, display_name, phone, phone_normalized) values ($1,$2,$3,$4,$5,$6)`,
      [club, id, 'L' + id, name, phone, phone ? phone.replace('+', '') : null]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [club, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await person(A, OWNER, ['owner', 'player'], 'Owner');
  await person(A, DESK, ['front_desk', 'player'], 'Desk');
  await person(A, ACC, ['accountant', 'player'], 'Acc');
  await person(A, ANN, ['player'], 'Ann Smith', '+66811111111');
  await person(A, BOB, ['player'], 'Bob Jones', '+66822222222');
  await person(B, BUSER, ['player'], 'Other Club');
  db = createDb({ connectionString: tdb.url, max: 4 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('customer_list', () => {
  it('lists this club only, in name order, with phone and no date of birth column', async () => {
    const rows = await list();
    expect(rows.map((r) => r.display_name)).toEqual(['Acc', 'Ann Smith', 'Bob Jones', 'Desk', 'Owner']);
    expect(Object.keys(rows[0]!)).not.toContain('date_of_birth');
    expect(rows.find((r) => r.display_name === 'Ann Smith')!.phone).toBe('+66811111111');
  });
  it('searches by name part, phone digits and tag; the tag filter narrows', async () => {
    expect((await list(desk(), 'smith')).map((r) => r.display_name)).toEqual(['Ann Smith']);
    expect((await list(desk(), '0822222')).map((r) => r.display_name)).toEqual([]);
    expect((await list(desk(), '6682222')).map((r) => r.display_name)).toEqual(['Bob Jones']);
    await run(desk(), `select app.customer_tag_set($1, 'VIP', true)`, [ANN]);
    expect((await list(desk(), 'vip')).map((r) => r.display_name)).toEqual(['Ann Smith']);
    expect((await list(desk(), null, 'vip')).map((r) => r.display_name)).toEqual(['Ann Smith']);
  });
  it('% and _ in the search are literal', async () => {
    expect(await list(desk(), '%')).toEqual([]);
  });
  it('keyset paging gives every row once', async () => {
    const first = await run<{ id: string; display_name: string }>(desk(), `select * from public.customer_list(null, null, null, null, 2)`);
    const last = first[first.length - 1]!;
    const second = await run<{ id: string }>(desk(), `select * from public.customer_list(null, null, $1, $2, 10)`, [last.display_name, last.id]);
    expect(first.length + second.length).toBe(5);
    expect(new Set([...first, ...second].map((r) => r.id)).size).toBe(5);
  });
  it('the accountant and a player are refused; an anonymised person is not listed', async () => {
    await expect(list(ctx(ACC, ['accountant', 'player']))).rejects.toThrow(/not allowed/);
    await expect(list(ctx(ANN, ['player']))).rejects.toThrow(/not allowed/);
    await tdb.query(`update public.app_user set anonymised_at = app.now(), active = false where id = $1`, [BOB]);
    expect((await list()).map((r) => r.display_name)).not.toContain('Bob Jones');
  });
});

describe('customer_tag_set', () => {
  it('adds once, removes case insensitively, trims; refuses blank, long and unknown people; is audited', async () => {
    await run(desk(), `select app.customer_tag_set($1, '  Junior ', true)`, [ANN]);
    await run(desk(), `select app.customer_tag_set($1, 'Junior', true)`, [ANN]);
    expect((await list()).find((r) => r.id === ANN)!.tags).toEqual(['Junior']);
    expect((await tdb.query(`select count(*)::int as n from public.audit_entry where record_type = 'customer_tag'`)).rows[0].n).toBe(1);
    await run(desk(), `select app.customer_tag_set($1, 'junior', false)`, [ANN]);
    expect((await list()).find((r) => r.id === ANN)!.tags).toEqual([]);
    await expect(run(desk(), `select app.customer_tag_set($1, '   ', true)`, [ANN])).rejects.toThrow(/invalid tag/);
    await expect(run(desk(), `select app.customer_tag_set($1, $2, true)`, [ANN, 'x'.repeat(41)])).rejects.toThrow(/invalid tag/);
    await expect(run(desk(), `select app.customer_tag_set($1, 'a', true)`, [BUSER])).rejects.toThrow(/unknown customer/);
    await expect(run(ctx(ACC, ['accountant', 'player']), `select app.customer_tag_set($1, 'a', true)`, [ANN])).rejects.toThrow(/not allowed/);
  });
  it("another club's tags are invisible", async () => {
    await run(ctx(BUSER, ['owner', 'player'], B), `select app.customer_tag_set($1, 'x', true)`, [BUSER]);
    expect((await list()).flatMap((r) => r.tags)).toEqual([]);
  });
});

describe('staff_add_customer', () => {
  it('makes an unclaimed player with no LINE id, name and phone only', async () => {
    const id = (await run<{ id: string }>(desk(), `select app.staff_add_customer('Walk In', '+66833333333', '66833333333') as id`))[0]!.id;
    const u = (await tdb.query(`select full_name, phone, claim_state, line_user_id, date_of_birth, active from public.app_user where id = $1`, [id])).rows[0];
    expect(u).toEqual({ full_name: 'Walk In', phone: '+66833333333', claim_state: 'unclaimed', line_user_id: null, date_of_birth: null, active: true });
    expect((await tdb.query(`select role from public.app_user_role where user_id = $1`, [id])).rows).toEqual([{ role: 'player' }]);
    expect((await list()).map((r) => r.display_name)).toContain(null);
  });
  it('refuses a phone already held by an unclaimed person, bad input, and other roles', async () => {
    await run(desk(), `select app.staff_add_customer('Walk In', '+66833333333', '66833333333')`);
    await expect(run(desk(), `select app.staff_add_customer('Again', '+66833333333', '66833333333')`)).rejects.toMatchObject({ code: 'BK001', message: 'phone_in_use' });
    await expect(run(desk(), `select app.staff_add_customer('  ', '+66833333334', '66833333334')`)).rejects.toThrow(/invalid customer/);
    await expect(run(ctx(ACC, ['accountant', 'player']), `select app.staff_add_customer('X', '+66833333335', '66833333335')`)).rejects.toThrow(/not allowed/);
  });
});

describe('audit_customer_export', () => {
  it('writes one entry with the count and no row', async () => {
    await run(desk(), `select app.audit_customer_export(5)`);
    const e = (await tdb.query(`select action, new_value from public.audit_entry where action = 'customers.exported'`)).rows;
    expect(e).toHaveLength(1);
    await expect(run(ctx(ACC, ['accountant', 'player']), `select app.audit_customer_export(1)`)).rejects.toThrow(/not allowed/);
  });
});
