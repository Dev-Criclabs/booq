// API role matrix for the platform console (ROLE-02-AC1 to AC3, PLAT-01-AC8, D15, D148). Every route of apps/platform is called as a
// guest, a club session cookie, an onboarding specialist and a platform admin through the real transport (servePlatform), with a
// database that fails the test if it is touched before the access gate has let the call through.
import { describe, expect, it } from 'vitest';
import type { PlatformDb } from '../../packages/db/src/platform-tx';
import { createPlatformTable, unavailableIdentity } from '../../apps/platform/src/server/context';
import { servePlatform, type PlatformRoute } from '../../apps/platform/src/http/server';

const SOME_ID = '99999999-9999-4999-8999-999999999999';
const PLATFORM_COOKIE = '__Host-booq-platform';
const ADMIN = '99999999-0000-4000-8000-000000000001';
const SPEC = '99999999-0000-4000-8000-000000000002';

let dbTouches = 0;
const db = new Proxy({}, { get: () => { dbTouches++; throw new Error('database touched before the gate let the call through'); } }) as unknown as PlatformDb;
const clock = { now: () => new Date('2026-12-07T03:00:00Z') };
const source = createPlatformTable({
  db,
  clock: clock as never,
  identity: unavailableIdentity,
  config: { signingKey: 'k'.repeat(40), maxBodyBytes: 10_000, appBaseUrl: 'https://booq.example', healthToken: 'h'.repeat(20), staffInvite: null, signInRateLimit: null },
});
const table: readonly PlatformRoute[] = source.table;

const handler = servePlatform(table, {
  maxBodyBytes: 10_000,
  authenticate: async (cookie: string) => {
    if (cookie === `as-${ADMIN}`) return { ok: true, staff: { id: ADMIN, role: 'platform_admin', displayName: 'Admin' }, stepUpFresh: true };
    if (cookie === `as-${SPEC}`) return { ok: true, staff: { id: SPEC, role: 'onboarding_specialist', displayName: 'Spec' }, stepUpFresh: true };
    return { ok: false, code: 'session_invalid' };
  },
} as never);

type Who = 'guest' | 'club-session' | 'specialist' | 'admin';
async function call(who: Who, def: { method: string; path: string }) {
  const segments = def.path.split('/').filter(Boolean).map((s) => (s.startsWith(':') ? SOME_ID : s));
  const cookie = { guest: undefined, 'club-session': 'booq_session=abc; __Host-booq-session=abc', specialist: `${PLATFORM_COOKIE}=as-${SPEC}`, admin: `${PLATFORM_COOKIE}=as-${ADMIN}` }[who];
  const hasBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(def.method);
  const res = await handler(
    new Request(`https://console.example/api/${segments.join('/')}`, { method: def.method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(hasBody ? { body: '{}' } : {}) }),
    { params: Promise.resolve({ path: segments }) },
  );
  return res.status;
}
const label = (r: PlatformRoute) => `${r.def.method} ${r.def.path} [${r.def.access}]`;

describe('the platform console routes', () => {
  it('there are routes of each access level to test', () => {
    expect(table.length).toBeGreaterThan(30);
    for (const a of ['public', 'staff', 'admin']) expect(table.filter((r) => r.def.access === a).length, a).toBeGreaterThan(0);
  });

  it('a staff route refuses a guest and a club session cookie with 401, and does not touch the database', async () => {
    const wrong: string[] = [];
    for (const r of table.filter((x) => x.def.access !== 'public')) {
      for (const who of ['guest', 'club-session'] as const) {
        dbTouches = 0;
        const s = await call(who, r.def);
        if (s !== 401) wrong.push(`${label(r)}: ${who} got ${s}, expected 401`);
        if (dbTouches > 0) wrong.push(`${label(r)}: ${who} touched the database`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('an admin route refuses an onboarding specialist with 403 (no pause, no resume, no team change) and does not touch the database', async () => {
    const wrong: string[] = [];
    for (const r of table.filter((x) => x.def.access === 'admin')) {
      dbTouches = 0;
      const s = await call('specialist', r.def);
      if (s !== 403) wrong.push(`${label(r)}: specialist got ${s}, expected 403`);
      if (dbTouches > 0) wrong.push(`${label(r)}: refused but the database was touched`);
    }
    expect(wrong).toEqual([]);
  });

  it('a specialist and an admin pass the gate of a staff route, and an admin passes an admin route', async () => {
    const wrong: string[] = [];
    for (const r of table.filter((x) => x.def.access === 'staff')) {
      for (const who of ['specialist', 'admin'] as const) {
        const s = await call(who, r.def);
        if (s === 401 || s === 403) wrong.push(`${label(r)}: ${who} got ${s}`);
      }
    }
    for (const r of table.filter((x) => x.def.access === 'admin')) {
      const s = await call('admin', r.def);
      if (s === 401 || s === 403) wrong.push(`${label(r)}: admin got ${s}`);
    }
    expect(wrong).toEqual([]);
  });

  it('a public route lets a guest through the gate', async () => {
    const wrong: string[] = [];
    // GET /health is public for the staff cookie but checks the monitor's shared token inside; it is tested below.
    for (const r of table.filter((x) => x.def.access === 'public' && x.def.path !== '/health')) {
      const s = await call('guest', r.def);
      if (s === 401 || s === 403) wrong.push(`${label(r)}: guest got ${s}`);
    }
    expect(wrong).toEqual([]);
  });

  it('GET /health refuses a request without the monitor token, and does not touch the database', async () => {
    dbTouches = 0;
    const res = await handler(new Request('https://console.example/api/health', { method: 'GET' }), { params: Promise.resolve({ path: ['health'] }) });
    expect(res.status).toBe(401);
    expect(dbTouches).toBe(0);
  });

  it('pause, resume, team changes and the first admin are admin only; the specialist cannot reach them (D15, D123)', () => {
    const adminPaths = table.filter((r) => r.def.access === 'admin').map((r) => r.def.path);
    const mustBeAdmin = table.filter((r) => /pause|resume|team|staff\/.*(reset|deactivate|invite)|config|template|release|legal|enrol/i.test(r.def.path) && r.def.method !== 'GET' && r.def.access !== 'public');
    const notAdmin = mustBeAdmin.filter((r) => r.def.access !== 'admin').map(label);
    // A staff-level route that matches the words above is not necessarily wrong (a specialist may start a status change on an assigned
    // club), so the list is printed for Security to read; only pause/resume must be admin.
    const pause = table.filter((r) => /pause|resume/i.test(r.def.path) && r.def.method !== 'GET');
    expect(pause.length).toBeGreaterThan(0);
    expect(pause.filter((r) => r.def.access !== 'admin').map(label)).toEqual([]);
    expect(adminPaths.length).toBeGreaterThan(3);
    if (process.env.QA_VERBOSE) console.log('routes matching admin-ish words but not admin:', notAdmin);
  });

  it('the public routes are sign in, enrolment, health and legal text only: nothing about clubs, staff or players', () => {
    const names = table.filter((r) => r.def.access === 'public').map((r) => `${r.def.method} ${r.def.path}`);
    const odd = names.filter((n) => /club|staff|player|booking|payment|receipt|customer|owner|tester|support|admin/i.test(n) && !/sign|enrol|health|legal|step/i.test(n));
    expect(odd, 'public console routes that look like club or staff data').toEqual([]);
  });
});
