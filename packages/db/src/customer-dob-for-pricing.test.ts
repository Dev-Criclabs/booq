import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F04-T13-db / migration 0320: app.customer_dob_for_pricing (D12, D35, CC-1).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER = '44444444-4444-4444-8444-444444444444';
const DESK = '33333333-3333-4333-8333-333333333333';
const ACC = '66666666-6666-4666-8666-666666666666';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const IMPORTED = '77777777-7777-4777-8777-777777777777';
const GONE = '88888888-8888-4888-8888-888888888888';
const ANON = '99999999-9999-4999-8999-999999999990';
const PB = '55555555-5555-4555-8555-555555555555';
let tdb: TestDatabase;
let db: Db;

const ctx = (user: string | null, roles: string[]) => ({ clubId: A, userId: user, roles: roles as never, source: 'admin' as const });
const dob = (customer: string, c = ctx(DESK, ['front_desk', 'player'])) =>
  db.withClubTx(c, async (tx) => (await tx.query(`select app.customer_dob_for_pricing($1)::text as d`, [customer])).rows[0]?.d as string | null);

async function person(club: string, id: string, roles: string[], opts: { line?: boolean; active?: boolean; dob?: string | null } = {}) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('insert into public.app_user (club_id, id, line_user_id, active, date_of_birth, claim_state) values ($1,$2,$3,$4,$5,$6)',
      [club, id, opts.line === false ? null : 'L' + id.slice(0, 4), opts.active ?? true, opts.dob ?? null, opts.line === false ? 'unclaimed' : null]);
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
  await person(A, P1, ['player'], { dob: '2012-05-17' });
  await person(A, P2, ['player']);
  await person(A, IMPORTED, ['player'], { line: false, dob: '1990-01-01' });
  await person(A, GONE, ['player'], { active: false, dob: '1990-01-01' });
  await person(A, ANON, ['player'], { dob: '1990-01-01' });
  await tdb.query(`update public.app_user set anonymised_at = app.now(), active = false where id = $1`, [ANON]);
  await person(B, PB, ['player'], { dob: '1985-03-03' });
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('app.customer_dob_for_pricing', () => {
  it('front desk and owner get the date of birth, or null when none is stored', async () => {
    expect(await dob(P1)).toBe('2012-05-17');
    expect(await dob(P1, ctx(OWNER, ['owner', 'player']))).toBe('2012-05-17');
    expect(await dob(P2)).toBeNull();
  });

  it('a player, the accountant, a coach and a guest are refused, even for themselves', async () => {
    for (const c of [ctx(P1, ['player']), ctx(ACC, ['accountant', 'player']), ctx(P1, ['coach', 'player']), ctx(null, ['guest'])]) {
      await expect(dob(P1, c)).rejects.toThrow(/not allowed/);
    }
  });

  it('an unclaimed import, an inactive or deleted person, an unknown id and another club’s customer all give the same not found', async () => {
    for (const id of [IMPORTED, GONE, ANON, '00000000-0000-4000-8000-0000000000ff', PB]) {
      await expect(dob(id), id).rejects.toThrow(/^customer: not found$/);
    }
  });

  it('is granted to booq_app only', async () => {
    const f = (r: string) => tdb.query(`select has_function_privilege($1, 'app.customer_dob_for_pricing(uuid)', 'execute') as ok`, [r]).then((x) => x.rows[0].ok);
    expect(await f('booq_app')).toBe(true);
    expect(await f('booq_worker')).toBe(false);
    expect(await f('booq_platform')).toBe(false);
  });
});
