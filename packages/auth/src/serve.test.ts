import { describe, expect, it } from 'vitest';
import { Reply, route, RouteError, type RouteSession } from './route';
import { serveRoutes } from './serve';
import { findUndeclaredRoutes } from './check';

// F02 / apps/web transport: serveRoutes turns a table of declared routes into a standard
// (Request, ctx) => Response handler. No Next.js import here: Request and Response are web standards.
const SESSION: RouteSession = { clubId: 'c1', userId: 'u1', roles: ['player'] };
const deps = (over: Partial<Parameters<typeof serveRoutes>[1]> = {}) => ({
  routeDeps: { hasFeature: async () => true },
  resolveSession: async (_slug: string, cookie: string | undefined) => (cookie === 'good' ? SESSION : null),
  maxBodyBytes: 1000,
  ...over,
});
const table = [
  route({ method: 'GET', path: '/public/config', public: true }, async () => ({ hello: 'world' })),
  route({ method: 'GET', path: '/me/bookings', needsPerson: true }, async (ctx) => ({ user: ctx.userId })),
  route({ method: 'POST', path: '/echo/:id', public: true }, async (ctx) => ({ input: ctx.input })),
  route({ method: 'POST', path: '/login', public: true }, async (ctx) => new Reply({ ok: true, cookie: ctx.cookie ?? null }, { setCookie: 'a=b; Path=/' })),
  route({ method: 'GET', path: '/boom', public: true }, async () => {
    throw new Error('secret internals');
  }),
  route({ method: 'GET', path: '/gone', public: true }, async () => {
    throw new RouteError(410, 'expired');
  }),
];
const handler = (d = deps()) => serveRoutes(table, d);
const call = (h: ReturnType<typeof handler>, method: string, url: string, init: { body?: unknown; headers?: Record<string, string>; raw?: string } = {}) => {
  const u = new URL(url, 'https://app.example');
  const segs = u.pathname.replace(/^\/api\/c\//, '').split('/');
  const slug = segs.shift()!;
  const body = init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
  return h(new Request(u, { method, ...(body === undefined ? {} : { body }), headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(init.headers ?? {}) } }), {
    params: Promise.resolve({ slug, path: segs }),
  });
};

describe('serveRoutes', () => {
  it('answers a public route as JSON, never cached', async () => {
    const r = await call(handler(), 'GET', '/api/c/hunter/public/config');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ hello: 'world' });
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('content-type')).toContain('application/json');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });
  it('a guest on a person route gets 401 sign_in_required; the cookie makes it pass', async () => {
    const h = handler();
    const guest = await call(h, 'GET', '/api/c/hunter/me/bookings');
    expect(guest.status).toBe(401);
    expect(await guest.json()).toEqual({ code: 'sign_in_required' });
    const ok = await call(h, 'GET', '/api/c/hunter/me/bookings', { headers: { cookie: 'good' } });
    expect(await ok.json()).toEqual({ user: 'u1' });
  });
  it('merges query, body, path and the club address into the input; the path and address win over anything in the body', async () => {
    const r = await call(handler(), 'POST', '/api/c/hunter/echo/real?x=1&id=query', { body: { y: 2, id: 'body', slug: 'other-club' } });
    expect(await r.json()).toEqual({ input: { x: '1', y: 2, id: 'real', slug: 'hunter' } });
  });
  it('a route can set a cookie and sees the Cookie header', async () => {
    const r = await call(handler(), 'POST', '/api/c/hunter/login', { body: {}, headers: { cookie: 'k=v' } });
    expect(r.headers.get('set-cookie')).toBe('a=b; Path=/');
    expect(await r.json()).toEqual({ ok: true, cookie: 'k=v' });
  });
  it('an unknown path is 404 and a known path with the wrong method is 405', async () => {
    const h = handler();
    expect((await call(h, 'GET', '/api/c/hunter/nope')).status).toBe(404);
    const wrong = await call(h, 'DELETE', '/api/c/hunter/public/config');
    expect(wrong.status).toBe(405);
  });
  it('a body must be JSON: another content type is 415, bad JSON 400, a non-object 400', async () => {
    const h = handler();
    expect((await call(h, 'POST', '/api/c/hunter/echo/1', { raw: 'a=b', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status).toBe(415);
    expect((await call(h, 'POST', '/api/c/hunter/echo/1', { raw: '{nope' })).status).toBe(400);
    expect((await call(h, 'POST', '/api/c/hunter/echo/1', { raw: '[1,2]' })).status).toBe(400);
    expect((await call(h, 'POST', '/api/c/hunter/echo/1', { raw: '"x"' })).status).toBe(400);
  });
  it('a body larger than the limit is 413, whether or not it says how long it is', async () => {
    const h = handler(deps({ maxBodyBytes: 50 }));
    expect((await call(h, 'POST', '/api/c/hunter/echo/1', { body: { pad: 'x'.repeat(200) } })).status).toBe(413);
  });
  it('an empty body on a body method is an empty input', async () => {
    const r = await call(handler(), 'POST', '/api/c/hunter/echo/9', { raw: '' });
    expect(await r.json()).toEqual({ input: { id: '9', slug: 'hunter' } });
  });
  it('a typed refusal keeps its status and code; any other error is a plain 500 with no detail', async () => {
    const h = handler();
    const gone = await call(h, 'GET', '/api/c/hunter/gone');
    expect([gone.status, await gone.json()]).toEqual([410, { code: 'expired' }]);
    const boom = await call(h, 'GET', '/api/c/hunter/boom');
    expect(boom.status).toBe(500);
    expect(JSON.stringify(await boom.json())).not.toContain('secret');
  });
  it('an unknown club is 404 before the route runs', async () => {
    const h = handler(deps({ resolveSession: async () => 'not_found' as const }));
    const r = await call(h, 'GET', '/api/c/nope/public/config');
    expect([r.status, await r.json()]).toEqual([404, { code: 'not_found' }]);
  });
  it('refuses a table with an undeclared or duplicate route at start', () => {
    const dup = route({ method: 'GET', path: '/public/config', public: true }, async () => 1);
    expect(() => serveRoutes([table[0]!, dup], deps())).toThrow(/registered twice/);
  });
  it('a prototype-polluting body key stays a plain data key', async () => {
    const r = await call(handler(), 'POST', '/api/c/hunter/echo/1', { raw: '{"__proto__":{"polluted":true},"a":1}' });
    expect(((await r.json()) as { input: Record<string, unknown> }).input['a']).toBe(1);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('build check accepts serveRoutes', () => {
  const file = (text: string) => [{ path: 'apps/web/src/app/api/c/[slug]/[...path]/route.ts', text }];
  it('serveRoutes(table, deps) counts as declared; a bare handler or a wrapper around nothing does not', () => {
    expect(findUndeclaredRoutes(file('export const GET = serveRoutes(table, deps);'))).toEqual([]);
    expect(findUndeclaredRoutes(file('export const POST = serveRoutes<unknown>(\n table, deps);'))).toEqual([]);
    expect(findUndeclaredRoutes(file('export const GET = async () => new Response("x");'))).toHaveLength(1);
    expect(findUndeclaredRoutes(file('export const GET = somethingElse(table);'))).toHaveLength(1);
  });
});
