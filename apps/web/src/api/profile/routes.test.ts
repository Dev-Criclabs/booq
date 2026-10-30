import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { createProfileEditService } from '@booq/domain';
import { profileRoutes } from './routes';

// F02-T14 GET and PUT /me/profile (AUTH-02-AC18 to AC23): any signed-in person, their own row only.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const ME = '33333333-3333-4333-8333-333333333333';
const deps = { hasFeature: async () => true };
let tdb: TestDatabase;
let db: Db;
const s = { clubId: A, userId: ME, roles: ['player'] as never };
const routes = () => profileRoutes({ db, service: () => createProfileEditService({ today: () => '2026-10-30' }) });
const find = (m: string, p: string) => routes().find((r) => r.def.method === m && r.def.path === p)!;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A')`, [A]);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, full_name, phone, phone_normalized, language) values ($1,$2,'L1','Somchai Jaidee','0812345678','66812345678','th')`, [A, ME]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, ME]);
    await c.query('commit');
  } finally {
    c.release();
  }
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('profile routes', () => {
  it('both are person routes: a guest gets sign_in_required', async () => {
    expect(routes().map((r) => `${r.def.method} ${r.def.path} ${r.def.needsPerson}`).sort()).toEqual(['GET /me/profile true', 'PUT /me/profile true']);
    expect(await find('GET', '/me/profile').handle({ session: null, input: {} }, deps)).toEqual({ ok: false, status: 401, code: 'sign_in_required' });
    expect(await find('PUT', '/me/profile').handle({ session: null, input: {}, body: { level: 'new' } }, deps)).toMatchObject({ ok: false, status: 401 });
  });
  it('reads and saves; the answer carries the price group', async () => {
    expect(await find('GET', '/me/profile').handle({ session: s, input: {} }, deps)).toMatchObject({ ok: true, body: { fullName: 'Somchai Jaidee', priceGroup: 'adult' } });
    const saved = await find('PUT', '/me/profile').handle({ session: s, input: { slug: 'a', dateOfBirth: '2012-05-05' }, body: { dateOfBirth: '2012-05-05' } }, deps);
    expect(saved).toMatchObject({ ok: true, body: { dateOfBirth: '2012-05-05', priceGroup: 'student' } });
  });
  it('field errors come back as codes per field, and unknown fields are refused', async () => {
    const bad = await find('PUT', '/me/profile').handle({ session: s, input: {}, body: { dateOfBirth: '2099-01-01', level: 'x' } }, deps);
    expect(bad).toMatchObject({ ok: true, body: expect.anything() });
    expect((bad as { body: { options?: unknown; body: unknown } }).body).toMatchObject({ body: { code: 'invalid', fields: { dateOfBirth: 'dob_future', level: 'level_invalid' } }, options: { status: 400 } });
    expect(await find('PUT', '/me/profile').handle({ session: s, input: {}, body: { roles: ['owner'] } }, deps)).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
  });
  it('the input merged with the query is not the body: a query value cannot change the profile', async () => {
    const r = await find('PUT', '/me/profile').handle({ session: s, input: { fullName: 'From Query' }, body: { level: 'beginner' } }, deps);
    expect(r).toMatchObject({ ok: true });
    expect((await tdb.query('select full_name from public.app_user')).rows[0].full_name).toBe('Somchai Jaidee');
  });
});
