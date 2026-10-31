import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { createWebTable } from '../../server/context';

// GET /club/setup (F01 design 5.1; F11 design 5.14; ADMIN-16; ROLE-01-AC8; D115): the Settings page's reads. The owner gets business details, VAT, hours, courts and the support window; the accountant business details and VAT only.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const ACC = '55555555-5555-4555-8555-555555555555';
const OWNER_B = '77777777-7777-4777-8777-777777777777';
const deps = { hasFeature: async () => true };

let tdb: TestDatabase;
let db: Db;
const sess = (userId: string, roles: string[], clubId = A) => ({ clubId, userId, roles: roles as never });
const table = () => createWebTable({ db, verifier: { verifyIdToken: async () => ({ ok: false as const, code: 'offline' as const }) }, now: () => new Date('2026-10-31T00:00:00Z'), config: { sessionSeconds: 60, maxBodyBytes: 1000, importLimits: null } }).table;
const run = (m: string, p: string, session: ReturnType<typeof sess> | null, input: Record<string, unknown> = {}) =>
  table().find((r) => r.def.method === m && r.def.path === p)!.handle({ session, input }, deps);
const owner = sess(OWNER, ['owner', 'player']);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, payment_option) values ($1,'a','ก','A','beam'), ($2,'b','ข','B','beam')`, [A, B]);
  for (const [club, u, roles] of [[A, PLAYER, ['player']], [A, DESK, ['front_desk', 'player']], [A, OWNER, ['owner', 'player']], [A, ACC, ['accountant', 'player']], [B, OWNER_B, ['owner', 'player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id, full_name) values ($1,$2,$3,$3)', [club, u, 'L' + u.slice(0, 2)]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, u, r]);
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

describe('GET /club/setup', () => {
  const get = (s: ReturnType<typeof sess> | null) => run('GET', '/club/setup', s);
  it('is in the web table with the business read permission', () => {
    expect(table().map((r) => `${r.def.method} ${r.def.path} ${r.def.permission}`)).toContain('GET /club/setup settings.business.read');
  });
  it('an empty club answers nulls and empty lists: nothing is supplied', async () => {
    expect(await get(owner)).toMatchObject({ ok: true, body: { business: { legal_name: null, tax_id: null, tax_branch: null, registered_address: null, receipt_prefix: null, vat_enabled: null }, hours: [], locations: [], resources: [], supportWindowUntil: null } });
  });
  it('the owner reads what was set: business details, VAT, hours, every court with its location, and the support window', async () => {
    await run('PUT', '/club/business', owner, { legal_name: 'Club A Co', tax_id: '0135569018041', vat_enabled: true });
    await tdb.query(`update public.club set receipt_prefix = 'HTC' where id = $1`, [A]);
    const loc = (await tdb.query(`insert into public.location (club_id, name) values ($1, 'Main') returning id`, [A])).rows[0].id as string;
    await tdb.query(`insert into public.resource (club_id, location_id, name, sport, active) values ($1,$2,'1','tennis',true), ($1,$2,'2','tennis',false)`, [A, loc]);
    await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1, 1, '06:00', '24:00'), ($1, 2, '07:00', '22:30')`, [A]);
    await tdb.query(`update public.club set allow_booq_changes_until = app.now() + interval '1 hour', allow_booq_changes_set_at = app.now() where id = $1`, [A]);
    const r = (await get(owner)) as { ok: boolean; body: Record<string, any> };
    expect(r.body.business).toEqual({ legal_name: 'Club A Co', tax_id: '0135569018041', tax_branch: null, registered_address: null, receipt_prefix: 'HTC', vat_enabled: true });
    expect(r.body.hours).toEqual([{ weekday: 1, open: '06:00', close: '24:00' }, { weekday: 2, open: '07:00', close: '22:30' }]);
    expect(r.body.locations).toEqual([{ id: loc, name: 'Main' }]);
    expect(r.body.resources.map((c: { name: string; active: boolean }) => [c.name, c.active])).toEqual([['1', true], ['2', false]]);
    expect(typeof r.body.supportWindowUntil).toBe('string');
    expect(Date.parse(r.body.supportWindowUntil)).toBeGreaterThan(Date.now() - 86_400_000);
  });
  it('the accountant reads the business details and VAT only; front desk, a player and a guest are refused', async () => {
    await run('PUT', '/club/business', owner, { legal_name: 'Club A Co', vat_enabled: false });
    const acc = (await get(sess(ACC, ['accountant', 'player']))) as { ok: boolean; body: Record<string, unknown> };
    expect(acc.ok).toBe(true);
    expect(Object.keys(acc.body)).toEqual(['business']);
    expect(acc.body['business']).toMatchObject({ legal_name: 'Club A Co', vat_enabled: false });
    expect(await get(sess(DESK, ['front_desk', 'player']))).toMatchObject({ ok: false, status: 403 });
    expect(await get(sess(PLAYER, ['player']))).toMatchObject({ ok: false, status: 403 });
    expect(await get(null)).toMatchObject({ ok: false, status: 401 });
  });
  it('another club sees only its own', async () => {
    await run('PUT', '/club/business', owner, { legal_name: 'Club A Co' });
    const b = (await get(sess(OWNER_B, ['owner', 'player'], B))) as { body: { business: { legal_name: string | null } } };
    expect(b.body.business.legal_name).toBeNull();
  });
});
