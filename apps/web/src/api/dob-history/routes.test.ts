import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { dobHistoryRoutes } from './routes';

// F02-T15 GET /customers/:id/dob-history (AUTH-02-AC21, AC24; D12, D55): owner only.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER = '11111111-1111-4111-8111-111111111111';
const DESK = '22222222-2222-4222-8222-222222222222';
const ACC = '66666666-6666-4666-8666-666666666666';
const P = '44444444-4444-4444-8444-444444444444';
const P_B = '55555555-5555-4555-8555-555555555555';
const deps = { hasFeature: async () => true };
let tdb: TestDatabase;
let db: Db;
const sess = (userId: string, roles: string[], club = A) => ({ clubId: club, userId, roles: roles as never });
const routes = () => dobHistoryRoutes({ db });
const route = () => routes()[0]!;
const get = (s: ReturnType<typeof sess> | null, id: string) => route().handle({ session: s, input: { id } }, deps);

async function person(club: string, id: string, line: string, roles: string[]) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, display_name) values ($1,$2,$3,$3)`, [club, id, line]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [club, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
/** The player changes their own date of birth, as the app does: the table trigger writes the audit entry. */
const setDob = (club: string, id: string, dob: string | null) =>
  db.withClubTx({ clubId: club, userId: id, roles: ['player'] as never, source: 'player_app' }, (tx) => tx.query(`update public.app_user set date_of_birth = $2 where id = $1`, [id, dob]));

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await person(A, OWNER, 'L1', ['owner', 'player']);
  await person(A, DESK, 'L2', ['front_desk', 'player']);
  await person(A, ACC, 'L3', ['accountant', 'player']);
  await person(A, P, 'L4', ['player']);
  await person(B, P_B, 'L5', ['player']);
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('GET /customers/:id/dob-history', () => {
  it('is one route, owner only', () => {
    expect(routes().map((r) => `${r.def.method} ${r.def.path} ${r.def.permission}`)).toEqual(['GET /customers/:id/dob-history customer.dob-history.read']);
  });

  it('the owner sees each change with the old and new value, who made it and when, oldest first', async () => {
    await tdb.setNow('2026-11-01T03:00:00Z');
    await setDob(A, P, '2010-05-05');
    await tdb.setNow('2026-11-02T03:00:00Z');
    await setDob(A, P, '2009-05-05');
    await setDob(A, P, null);
    const r = await get(sess(OWNER, ['owner', 'player']), P);
    expect(r).toMatchObject({ ok: true });
    const body = (r as { body: Array<Record<string, unknown>> }).body;
    expect(body.map((e) => [e['old'], e['new']])).toEqual([[null, '2010-05-05'], ['2010-05-05', '2009-05-05'], ['2009-05-05', null]]);
    expect(body[0]).toMatchObject({ actor: expect.any(String) });
    expect(Object.keys(body[0]!).sort()).toEqual(['actor', 'at', 'new', 'old']);
    expect(body[0]!['at']).toBe('2026-11-01T03:00:00.000Z');
  });

  it('other changes to the person are not in it, and a person with none has an empty list', async () => {
    await db.withClubTx({ clubId: A, userId: P, roles: ['player'] as never, source: 'player_app' }, (tx) => tx.query(`update public.app_user set display_name = 'New' where id = $1`, [P]));
    expect(await get(sess(OWNER, ['owner', 'player']), P)).toMatchObject({ ok: true, body: [] });
  });

  it('front desk, accountant and the player are refused; a guest gets 401', async () => {
    await setDob(A, P, '2010-05-05');
    for (const s of [sess(DESK, ['front_desk', 'player']), sess(ACC, ['accountant', 'player']), sess(P, ['player'])]) {
      expect(await get(s, P)).toMatchObject({ ok: false, status: 403 });
    }
    expect(await get(null, P)).toMatchObject({ ok: false, status: 401 });
  });

  it('a person of another club or an unknown or malformed id is 404 / 400; one club never reads the other', async () => {
    await setDob(B, P_B, '2010-05-05');
    expect(await get(sess(OWNER, ['owner', 'player']), P_B)).toMatchObject({ ok: false, status: 404, code: 'not_found' });
    expect(await get(sess(OWNER, ['owner', 'player']), 'aaaaaaaa-0000-4000-8000-0000000000ff')).toMatchObject({ ok: false, status: 404 });
    expect(await get(sess(OWNER, ['owner', 'player']), 'nope')).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
  });
});
