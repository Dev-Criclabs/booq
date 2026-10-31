import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { serveRoutes } from '@booq/auth';
import { createWebTable } from '../../server/context';

// The owner's Settings routes OVER HTTP (F01 design 5.1; ADMIN-16): the transport adds the club slug to every route's input, so a route that insists
// on an exact set of fields must expect it. Found while building A16: calling the handlers directly hides this.
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

const call = async (method: string, path: string, body?: unknown, who = owner) => {
  const t = table();
  const handler = serveRoutes(t, {
    routeDeps: deps,
    maxBodyBytes: 10_000,
    resolveSession: async (slug) => (slug === 'a' ? who : 'not_found'),
  });
  const res = await handler(new Request(`https://x.test/api/c/a${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { params: Promise.resolve({ slug: 'a', path: path.split('/').filter(Boolean) }) });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
};

describe('the owner settings routes over HTTP', () => {
  it('PUT /settings/:key sets a setting', async () => {
    expect(await call('PUT', '/settings/hold_minutes', { value: 15 })).toMatchObject({ status: 200, body: { key: 'hold_minutes', value: 15 } });
  });
  it('PUT /club/business sets the business details and VAT', async () => {
    expect(await call('PUT', '/club/business', { legal_name: 'Club A Co', vat_enabled: true })).toMatchObject({ status: 200, body: { legal_name: 'Club A Co', vat_enabled: true } });
  });
  it('PUT /hours sets opening hours', async () => {
    expect(await call('PUT', '/hours', { hours: [{ weekday: 1, open: '06:00', close: '24:00' }] })).toMatchObject({ status: 200 });
  });
  it('PUT /support-window turns BOOQ access on', async () => {
    expect(await call('PUT', '/support-window', { on: true })).toMatchObject({ status: 200, body: { on: true } });
  });
  it('POST /resources and PUT /resources/:id add and change a court', async () => {
    const loc = (await tdb.query(`insert into public.location (club_id, name) values ($1, 'Main') returning id`, [A])).rows[0].id as string;
    const made = await call('POST', '/resources', { location_id: loc, name: '1', sport: 'tennis' });
    expect(made).toMatchObject({ status: 200 });
    const id = (made.body as { id: string }).id;
    expect(await call('PUT', `/resources/${id}`, { name: '2', active: true })).toMatchObject({ status: 200 });
  });
  it('GET /settings and GET /club/setup read', async () => {
    expect((await call('GET', '/settings')).status).toBe(200);
    expect((await call('GET', '/club/setup')).status).toBe(200);
  });
});
