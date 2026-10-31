// Over-HTTP smoke test, one valid request per mounted route family (QA-API-1). serveRoutes adds `slug` to every route's input (packages/auth/src/serve.ts),
// so a handler that counts or checks the keys of its input answered 400 over HTTP while its own test, which called handle() directly, passed.
// This test goes through serveRoutes with a real database and a signed in owner (the session is resolved by the test, as in tests/api/role-matrix.spec.ts).
// Each step is a valid request for its family and must answer with the status the handler gives to a valid one: never the 400 of a refused input.
// Which families: the ones whose handler reads the keys of `ctx.input` (the object that carries `slug`): the club settings family of packages/domain/src/club (settings,
// business, hours, resources, support window), the player profile, and the typed setup routes. The other handlers read named fields or `ctx.body`, which has no slug.
// A reads-only sweep over the staff, person and public families is added so that a new handler on those routes is also seen through the transport.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveRoutes, type Role, type RouteSession } from '../../packages/auth/src/index';
import { createDb, type Db } from '../../packages/db/src/tx';
import { createTestDatabase, type TestDatabase } from '../../packages/db/src/testing/harness';
import { createWebTable } from '../../apps/web/src/server/context';

const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const OWNER = '44444444-4444-4444-8444-444444444444';
const ANN = '11111111-1111-4111-8111-111111111111';
let tdb: TestDatabase;
let db: Db;
let table: ReturnType<typeof createWebTable>['table'];
const asOwner = (): RouteSession => ({ clubId: CLUB, userId: OWNER, roles: ['owner', 'player'] as Role[] });
const asPlayer = (): RouteSession => ({ clubId: CLUB, userId: ANN, roles: ['player'] as Role[] });

async function send(session: () => RouteSession, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const handler = serveRoutes(table, { routeDeps: { hasFeature: async () => true }, maxBodyBytes: 100_000, async resolveSession() { return session(); } });
  const segs = path.split('?')[0]!.split('/').filter(Boolean);
  const res = await handler(
    new Request(`https://booq.example${path}`, { method, headers: { 'content-type': 'application/json', cookie: 'qa=1', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    { params: Promise.resolve({ slug: 'hunter', path: segs }) },
  );
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* a file */ }
  return { status: res.status, json, text };
}

beforeAll(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-07T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'hunter','ก','Hunter','live')`, [CLUB]);
  await tdb.query(`insert into public.line_connection (club_id, liff_id, login_channel_id) values ($1,'liff-x','chan-x')`, [CLUB]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main')`, [CLUB, LOC]);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    for (const [id, roles] of [[OWNER, ['owner', 'player']], [ANN, ['player']]] as const) {
      await c.query(`insert into public.app_user (club_id, id, line_user_id, display_name, phone, phone_normalized) values ($1,$2,$3,$4,$5,$6)`, [CLUB, id, 'L' + id.slice(0, 4), id === OWNER ? 'Owner' : 'Ann Smith', id === OWNER ? null : '+66811111111', id === OWNER ? null : '66811111111']);
      for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [CLUB, id, r]);
    }
    await c.query('commit');
  } finally {
    c.release();
  }
  db = createDb({ connectionString: tdb.url, max: 4 });
  table = createWebTable({ db, verifier: { verifyIdToken: async () => ({ ok: false as const, code: 'offline' as const }) }, now: () => new Date('2026-12-07T03:00:00Z'), config: { sessionSeconds: 60, maxBodyBytes: 100_000, importLimits: null } }).table;
}, 120_000);
afterAll(async () => {
  await db?.end();
  await tdb?.close();
});

const ok = (r: { status: number; text: string }, want: number[] = [200]) => expect(want, `${r.status} ${r.text.slice(0, 160)}`).toContain(r.status);
const covered = new Set<string>();
const hit = (method: string, path: string) => covered.add(`${method} ${path}`);

// QA-API-1 (severity 2): over HTTP these answered 400 invalid_input to a valid request, because serveRoutes puts `slug` into the input and these handlers
// count its keys. Fixed by platform lane 2 (c939a55, not on main when this was written): remove `.fails` when it lands.
describe('club settings family (domain/club): inputs checked key by key', () => {
  it.fails('GET /settings and PUT /settings/:key', async () => {
    hit('GET', '/settings'); hit('PUT', '/settings/:key');
    ok(await send(asOwner, 'GET', '/settings'));
    ok(await send(asOwner, 'PUT', '/settings/hold_minutes', { value: 15 }));
  });
  it.fails('PUT /club/business', async () => {
    hit('PUT', '/club/business');
    ok(await send(asOwner, 'PUT', '/club/business', { legal_name: 'Hunter Co', vat_enabled: false }));
  });
  it.fails('PUT /hours', async () => {
    hit('PUT', '/hours');
    ok(await send(asOwner, 'PUT', '/hours', { hours: [{ weekday: 1, open: '06:00', close: '24:00' }] }));
  });
  it.fails('POST /resources and PUT /resources/:id', async () => {
    hit('POST', '/resources'); hit('PUT', '/resources/:id');
    const made = await send(asOwner, 'POST', '/resources', { name: '1', sport: 'tennis', location_id: LOC });
    ok(made);
    ok(await send(asOwner, 'PUT', `/resources/${made.json.id}`, { name: '1A' }));
  });
  it.fails('PUT /support-window', async () => {
    hit('PUT', '/support-window');
    ok(await send(asOwner, 'PUT', '/support-window', { on: true }));
  });
});

describe('other families: one valid request each', () => {
  it('staff, claims, data requests, receipts, packages, reports (reads)', async () => {
    for (const [m, p] of [['GET', '/staff'], ['GET', '/staff/invites'], ['GET', '/claims'], ['GET', '/data-requests'], ['GET', '/staff/receipts'], ['GET', '/staff/setup'], ['GET', '/staff/shell'], ['GET', '/staff/customers'], ['GET', '/staff/audit'], ['GET', '/staff/coaches'], ['GET', '/staff/class-templates'], ['GET', '/staff/class-sessions'], ['GET', '/staff/leave'], ['GET', '/staff/flagged-sessions'], ['GET', '/staff/waitlist'], ['GET', '/courts'], ['GET', '/classes'], ['GET', '/coaches']] as const) {
      hit(m, p);
      ok(await send(asOwner, m, `${p}`));
    }
  });
  it('person routes as a player', async () => {
    for (const [m, p] of [['GET', '/me/profile'], ['GET', '/me/receipts'], ['GET', '/me/data-requests'], ['GET', '/me/waitlist'], ['GET', '/packages'], ['GET', '/me/credits']] as const) {
      hit(m, p);
      ok(await send(asPlayer, m, `${p}`));
    }
  });
  it('POST /staff/invites, POST /staff/customers and its notes and tags', async () => {
    hit('POST', '/staff/invites'); hit('POST', '/staff/customers'); hit('POST', '/staff/customers/:id/notes'); hit('POST', '/staff/customers/:id/tags');
    // Without the invite link key (a setting of the deployment) the route answers 503 not_configured after it has read its input: the input was accepted.
    ok(await send(asOwner, 'POST', '/staff/invites', { kind: 'staff', roles: ['front_desk'] }), [200, 503]);
    const made = await send(asOwner, 'POST', '/staff/customers', { name: 'Walk In', phone: '081 333 3333' });
    ok(made);
    ok(await send(asOwner, 'POST', `/staff/customers/${made.json.customerId}/notes`, { note: 'left a racket' }));
    ok(await send(asOwner, 'POST', `/staff/customers/${made.json.customerId}/tags`, { tag: 'vip' }));
  });
  it('POST /staff/setup/price-groups (typed fields)', async () => {
    hit('POST', '/staff/setup/price-groups');
    ok(await send(asOwner, 'POST', '/staff/setup/price-groups', { nameTh: 'ผู้ใหญ่', nameEn: 'Adult', rule: { min_age: 18 } }), [200, 201]);
  });
  it('PUT /me/profile', async () => {
    hit('PUT', '/me/profile');
    ok(await send(asPlayer, 'PUT', '/me/profile', { fullName: 'Ann Smith', phone: '0811111111' }));
  });
});
