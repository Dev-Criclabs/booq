import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { notificationPrefRoutes } from './routes';

// F10-T14 GET and PUT /me/notification-prefs (F10 design 5.10, 6; LINE-05, D94; A-2): the two C17 switches. Booking
// reminders controls the 24 and 2 hour reminders, Promotions the birthday discount and referral reward; everything else
// (confirmations, payment and cancellation results) is always sent and has no switch here (CC-3).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const ME = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const ME_B = '55555555-5555-4555-8555-555555555555';
const deps = { hasFeature: async () => true };
let tdb: TestDatabase;
let db: Db;
const s = { clubId: A, userId: ME, roles: ['player'] as never };
const routes = () => notificationPrefRoutes({ db });
const get = (session: typeof s | null) => routes().find((r) => r.def.method === 'GET')!.handle({ session, input: undefined, body: undefined }, deps);
const put = (session: typeof s | null, body: unknown) => routes().find((r) => r.def.method === 'PUT')!.handle({ session, input: body, body }, deps);
const rows = async () => (await tdb.query(`select club_id, user_id, reminders, promotions from public.notification_pref order by club_id, user_id`)).rows;

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

describe('GET and PUT /me/notification-prefs', () => {
  it('are person routes: a guest gets sign_in_required', async () => {
    expect(routes().map((r) => r.def)).toEqual([
      expect.objectContaining({ method: 'GET', path: '/me/notification-prefs', needsPerson: true }),
      expect.objectContaining({ method: 'PUT', path: '/me/notification-prefs', needsPerson: true }),
    ]);
    expect(await get(null)).toEqual({ ok: false, status: 401, code: 'sign_in_required' });
    expect(await put(null, { reminders: false })).toEqual({ ok: false, status: 401, code: 'sign_in_required' });
  });

  it('no row yet: the defaults, reminders on and promotions off (A-2); nothing is written by a read', async () => {
    expect(await get(s)).toEqual({ ok: true, status: 200, body: { reminders: true, promotions: false } });
    expect(await rows()).toEqual([]);
  });

  it('a save changes only the signed-in person’s switches; a partial save keeps the other one', async () => {
    expect(await put(s, { promotions: true })).toMatchObject({ ok: true, body: { reminders: true, promotions: true } });
    expect(await put(s, { reminders: false })).toMatchObject({ ok: true, body: { reminders: false, promotions: true } });
    expect(await get(s)).toMatchObject({ body: { reminders: false, promotions: true } });
    expect(await rows()).toEqual([{ club_id: A, user_id: ME, reminders: false, promotions: true }]);
    expect(await get({ ...s, userId: OTHER })).toMatchObject({ body: { reminders: true, promotions: false } });
    expect(await get({ clubId: B, userId: ME_B, roles: ['player'] as never })).toMatchObject({ body: { reminders: true, promotions: false } });
  });

  it('only the two switches are writable: confirmations stay always sent, and nothing else is accepted (D94)', async () => {
    for (const body of [{}, { reminders: 'no' }, { promotions: null }, { confirmations: false }, { reminders: true, userId: OTHER }, { reminders: true, user_id: OTHER }, [true], null]) {
      expect(await put(s, body), JSON.stringify(body)).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
    }
    expect(await rows()).toEqual([]);
  });

  it('a change of Promotions is kept in the audit log (the opt in to promotional messages, PDPA)', async () => {
    await put(s, { promotions: true });
    await put(s, { promotions: false });
    const log = (await tdb.query(`select action, actor_user_id from public.audit_entry where record_type = 'notification_pref' order by seq`)).rows;
    expect(log.map((l) => l.action)).toEqual(['insert', 'update']);
    expect(log.every((l) => l.actor_user_id === ME)).toBe(true);
  });
});
