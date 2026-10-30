import { describe, expect, it } from 'vitest';
import { createRateLimiter, Reply, RouteError } from '@booq/auth';
import { platformRoute, servePlatform, type PlatformServeDeps } from './server';

// The platform console's HTTP layer (F01-T17, T18; ROLE-02; D148): staff cookie only, no club session,
// access declared on every route, JSON in and out, codes only.
const ADMIN = { id: 's-admin', role: 'platform_admin' as const, displayName: 'Ada' };
const SPEC = { id: 's-spec', role: 'onboarding_specialist' as const, displayName: 'Sam' };
const deps = (over: Partial<PlatformServeDeps> = {}): PlatformServeDeps => ({
  authenticate: async (cookie) => (cookie === 'admin' ? { ok: true, staff: ADMIN, stepUpFresh: true } : cookie === 'spec' ? { ok: true, staff: SPEC, stepUpFresh: false } : { ok: false, code: 'session_invalid' }),
  maxBodyBytes: 1000,
  ...over,
});
const table = [
  platformRoute({ method: 'GET', path: '/ping', access: 'public' }, async () => ({ pong: true })),
  platformRoute({ method: 'GET', path: '/whoami', access: 'staff' }, async (ctx) => ({ id: ctx.staff!.id, fresh: ctx.stepUpFresh })),
  platformRoute({ method: 'POST', path: '/clubs/:id/pause', access: 'admin' }, async (ctx) => ({ id: ctx.input['id'], body: ctx.body })),
  platformRoute({ method: 'POST', path: '/auth/second-factor', access: 'public' }, async () => new Reply({ ok: true }, { setCookie: '__Host-booq-platform=abc; Path=/; HttpOnly; Secure; SameSite=Strict' })),
  platformRoute({ method: 'GET', path: '/gone', access: 'staff' }, async () => {
    throw new RouteError(410, 'expired', { minutes: 5 });
  }),
  platformRoute({ method: 'GET', path: '/boom', access: 'public' }, async () => {
    throw new Error('secret internals');
  }),
];
const h = (d = deps()) => servePlatform(table, d);
const call = (handler: ReturnType<typeof h>, method: string, path: string, init: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) =>
  handler(
    new Request(`https://console.example/api${path}`, {
      method,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      headers: { ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...(init.cookie ? { cookie: `__Host-booq-platform=${init.cookie}` } : {}), ...(init.headers ?? {}) },
    }),
    { params: Promise.resolve({ path: path.split('?')[0]!.split('/').filter(Boolean) }) },
  );

describe('access', () => {
  it('public needs nothing; staff and admin routes without a session are 401', async () => {
    expect((await call(h(), 'GET', '/ping')).status).toBe(200);
    expect(await (await call(h(), 'GET', '/whoami')).json()).toEqual({ code: 'unauthenticated' });
    expect((await call(h(), 'POST', '/clubs/c1/pause', { body: {} })).status).toBe(401);
  });
  it('a staff session passes and sees whether its second factor is fresh', async () => {
    expect(await (await call(h(), 'GET', '/whoami', { cookie: 'spec' })).json()).toEqual({ id: 's-spec', fresh: false });
  });
  it('an admin route is 403 for a specialist before the handler runs', async () => {
    const r = await call(h(), 'POST', '/clubs/c1/pause', { body: {}, cookie: 'spec' });
    expect([r.status, await r.json()]).toEqual([403, { code: 'forbidden' }]);
    expect(await (await call(h(), 'POST', '/clubs/c1/pause', { body: { reason: 'x' }, cookie: 'admin' })).json()).toEqual({ id: 'c1', body: { reason: 'x' } });
  });
  it('a bad cookie is the same 401 as none; only the platform cookie counts, never a club session cookie', async () => {
    expect((await call(h(), 'GET', '/whoami', { cookie: 'forged' })).status).toBe(401);
    const club = await call(h(), 'GET', '/whoami', { headers: { cookie: '__Host-booq_session=abc_def' } });
    expect(club.status).toBe(401);
  });
});

describe('transport rules', () => {
  it('JSON only for bodies, size limited, answers never cached', async () => {
    expect((await call(h(), 'POST', '/clubs/c1/pause', { cookie: 'admin', headers: { 'content-type': 'text/plain' }, body: undefined })).status).toBe(200);
    const big = await call(h(deps({ maxBodyBytes: 20 })), 'POST', '/clubs/c1/pause', { body: { pad: 'x'.repeat(100) }, cookie: 'admin' });
    expect(big.status).toBe(413);
    const ok = await call(h(), 'GET', '/ping');
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
  });
  it('404 for an unknown path, 405 for a known path with the wrong method', async () => {
    expect((await call(h(), 'GET', '/nope')).status).toBe(404);
    expect((await call(h(), 'DELETE', '/ping')).status).toBe(405);
  });
  it('a route sets a cookie through Reply; typed refusals keep status, code and params; other errors are a bare 500', async () => {
    expect((await call(h(), 'POST', '/auth/second-factor', { body: {} })).headers.get('set-cookie')).toContain('SameSite=Strict');
    const gone = await call(h(), 'GET', '/gone', { cookie: 'admin' });
    expect([gone.status, await gone.json()]).toEqual([410, { code: 'expired', params: { minutes: 5 } }]);
    const boom = await call(h(), 'GET', '/boom');
    expect(boom.status).toBe(500);
    expect(JSON.stringify(await boom.json())).not.toContain('secret');
  });
  it('the sign-in routes can be rate limited per caller', async () => {
    const at = { t: 1_000_000 };
    const limited = h(deps({ rateLimit: { limiter: createRateLimiter({ limit: 1, windowSeconds: 60, now: () => new Date(at.t) }), routes: ['POST /auth/second-factor'] } }));
    const ip = { 'x-real-ip': '203.0.113.5' };
    expect((await call(limited, 'POST', '/auth/second-factor', { body: {}, headers: ip })).status).toBe(200);
    const blocked = await call(limited, 'POST', '/auth/second-factor', { body: {}, headers: ip });
    expect([blocked.status, blocked.headers.get('retry-after')]).toEqual([429, '60']);
  });
  it('the table is checked: a route needs an access level and a path may not repeat', () => {
    expect(() => servePlatform([table[0]!, table[0]!], deps())).toThrow(/registered twice/);
    expect(() => platformRoute({ method: 'GET', path: '/x', access: 'anyone' as never }, async () => 1)).toThrow(/access/);
  });
  it('built on the first request when given a factory, so a missing setting is a 500 and not a failed build', async () => {
    let built = 0;
    const lazy = servePlatform(() => {
      built += 1;
      return { table, deps: deps() };
    });
    expect(built).toBe(0);
    await call(lazy, 'GET', '/ping');
    await call(lazy, 'GET', '/ping');
    expect(built).toBe(1);
    const broken = servePlatform(() => {
      throw new Error('settings missing');
    });
    expect((await call(broken, 'GET', '/ping')).status).toBe(500);
  });
});
