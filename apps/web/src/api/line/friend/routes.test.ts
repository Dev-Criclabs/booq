import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { lineFriendRoutes } from './routes';

// F02-T17 POST /me/line-friend (LINE-01-AC7 to AC9; design 5.2): the client reports liff.getFriendship();
// it is only for the in-app ask and the push choice, and never blocks booking or payment.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const ME = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const ME_B = '55555555-5555-4555-8555-555555555555';
const deps = { hasFeature: async () => true };
let tdb: TestDatabase;
let db: Db;
const s = { clubId: A, userId: ME, roles: ['player'] as never };
const route = () => lineFriendRoutes({ db })[0]!;
const post = (session: typeof s | null, body: unknown) => route().handle({ session, input: body, body }, deps);
const friend = async (id: string) => (await tdb.query(`select line_friend from public.app_user where id = $1`, [id])).rows[0].line_friend as boolean | null;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A'), ($2,'b','ข','B')`, [A, B]);
  for (const [club, id, line] of [[A, ME, 'L1'], [A, OTHER, 'L2'], [B, ME_B, 'L1']] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)`, [club, id, line]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [club, id]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('POST /me/line-friend', () => {
  it('is a person route: a guest gets sign_in_required', async () => {
    expect(route().def).toMatchObject({ method: 'POST', path: '/me/line-friend', needsPerson: true });
    expect(await post(null, { friendFlag: true })).toEqual({ ok: false, status: 401, code: 'sign_in_required' });
  });
  it('saves true and false on the signed-in person only', async () => {
    expect(await post(s, { friendFlag: true })).toMatchObject({ ok: true, body: { lineFriend: true } });
    expect(await friend(ME)).toBe(true);
    expect(await friend(OTHER)).toBeNull();
    expect(await friend(ME_B)).toBeNull();
    expect(await post(s, { friendFlag: false })).toMatchObject({ ok: true, body: { lineFriend: false } });
    expect(await friend(ME)).toBe(false);
  });
  it('the body is exactly { friendFlag: boolean }: anything else is 400 and nothing changes', async () => {
    for (const body of [{}, { friendFlag: 'yes' }, { friendFlag: null }, { friendFlag: true, userId: OTHER }, { lineFriend: true }]) {
      expect(await post(s, body), JSON.stringify(body)).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
    }
    expect(await friend(ME)).toBeNull();
  });
});
