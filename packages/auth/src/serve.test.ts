import { describe, expect, it } from 'vitest';
import { FileReply, Reply, route, RouteError, type RouteSession } from './route';
import { serveRoutes, type ServeDeps } from './serve';
import { createRateLimiter } from './rate-limit';
import { findUndeclaredRoutes } from './check';

// F02 / apps/web transport: serveRoutes turns a table of declared routes into a standard
// (Request, ctx) => Response handler. No Next.js import here: Request and Response are web standards.
const SESSION: RouteSession = { clubId: 'c1', userId: 'u1', roles: ['player'] };
const deps = (over: Partial<ServeDeps> = {}) => ({
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
  route({ method: 'POST', path: '/raw-body', public: true }, async (ctx) => ({ body: ctx.body, input: ctx.input })),
  route({ method: 'GET', path: '/boom', public: true }, async () => {
    throw new Error('secret internals');
  }),
  route({ method: 'GET', path: '/gone', public: true }, async () => {
    throw new RouteError(410, 'expired');
  }),
];
const withHeaders = (r: ReturnType<typeof route<unknown>>, headers: Record<string, string>) => ({ ...r, headers });
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

describe('headers a route asks for', () => {
  const cached = withHeaders(route({ method: 'GET', path: '/schedule', public: true }, async () => 'grid'), { 'Cache-Control': 'no-store', 'X-Route': 'schedule' });
  const evil = withHeaders(route({ method: 'GET', path: '/evil', public: true }, async () => 'x'), { 'Set-Cookie': 'a=b', 'Content-Type': 'text/html', 'X-Content-Type-Options': 'sniff', 'X-Ok': '1' });
  const h = serveRoutes([cached, evil], deps());
  it('are set on the answer, for an ok result and for a refusal', async () => {
    const r = await call(h, 'GET', '/api/c/hunter/schedule');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-route')).toBe('schedule');
  });
  it('can not replace the content type, the sniffing guard or set a cookie', async () => {
    const r = await call(h, 'GET', '/api/c/hunter/evil');
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(r.headers.get('content-type')).toContain('application/json');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-ok')).toBe('1');
  });
  it('a refusal from the route still carries them', async () => {
    const bad = withHeaders(route({ method: 'GET', path: '/gone', public: true }, async () => { throw new RouteError(410, 'expired'); }), { 'X-Route': 'gone' });
    const r = await call(serveRoutes([bad], deps()), 'GET', '/api/c/hunter/gone');
    expect([r.status, r.headers.get('x-route')]).toEqual([410, 'gone']);
  });
});

describe('body and lazy setup', () => {
  it('a route also gets the body exactly as sent, apart from the merged input', async () => {
    const r = await call(handler(), 'POST', '/api/c/hunter/raw-body?q=1', { body: { roles: ['owner'], a: 1 } });
    expect(await r.json()).toEqual({ body: { roles: ['owner'], a: 1 }, input: { q: '1', roles: ['owner'], a: 1, slug: 'hunter' } });
  });
  it('built on the first request, once; a failing setup answers 500 and is retried', async () => {
    let builds = 0;
    const lazy = serveRoutes(() => {
      builds += 1;
      return { table, deps: deps() };
    });
    expect(builds).toBe(0);
    await call(lazy, 'GET', '/api/c/hunter/public/config');
    await call(lazy, 'GET', '/api/c/hunter/public/config');
    expect(builds).toBe(1);
    let first = true;
    const flaky = serveRoutes(() => {
      if (first) {
        first = false;
        throw new Error('settings missing');
      }
      return { table, deps: deps() };
    });
    expect((await call(flaky, 'GET', '/api/c/hunter/public/config')).status).toBe(500);
    expect((await call(flaky, 'GET', '/api/c/hunter/public/config')).status).toBe(200);
  });
});

describe('build check accepts serveRoutes', () => {
  const file = (text: string) => [{ path: 'apps/web/src/app/api/c/[slug]/[...path]/route.ts', text }];
  it('serveRoutes(table, deps) counts as declared; a bare handler or a wrapper around nothing does not', () => {
    expect(findUndeclaredRoutes(file('export const GET = serveRoutes(table, deps);'))).toEqual([]);
    expect(findUndeclaredRoutes(file('export const POST = serveRoutes<unknown>(\n table, deps);'))).toEqual([]);
    expect(findUndeclaredRoutes(file('export const GET = servePlatform(platformSource);'))).toEqual([]);
    expect(findUndeclaredRoutes(file('export const GET = async () => new Response("x");'))).toHaveLength(1);
    expect(findUndeclaredRoutes(file('export const GET = somethingElse(table);'))).toHaveLength(1);
  });
});

describe('Idempotency-Key header', () => {
  const idem = route({ method: 'POST', path: '/pay', public: true }, async (ctx) => ({ key: (ctx.input as { idempotencyKey?: unknown }).idempotencyKey ?? null }));
  const h = serveRoutes([idem], deps());
  it('arrives as input.idempotencyKey, and a value in the body or query cannot stand in for it', async () => {
    const r = await call(h, 'POST', '/api/c/hunter/pay?idempotencyKey=fromquery', { body: { idempotencyKey: 'frombody' }, headers: { 'idempotency-key': 'key-123_ABC' } });
    expect(await r.json()).toEqual({ key: 'key-123_ABC' });
    const none = await call(h, 'POST', '/api/c/hunter/pay?idempotencyKey=fromquery', { body: { idempotencyKey: 'frombody' } });
    expect(await none.json()).toEqual({ key: null });
  });
  it.each(['has space', 'a'.repeat(201), 'ünï'])('refuses the header value %j', async (v) => {
    const r = await call(h, 'POST', '/api/c/hunter/pay', { body: {}, headers: { 'idempotency-key': v } });
    expect(r.status).toBe(400);
  });
});

describe('typed params on a refusal', () => {
  const limited = route({ method: 'GET', path: '/limit', public: true }, async () => {
    throw new RouteError(409, 'limit_reached', { hours: 4 });
  });
  const taken = route({ method: 'GET', path: '/taken', public: true }, async () => {
    throw new RouteError(409, 'slot_unavailable', { by: 'coach' });
  });
  const plain = route({ method: 'GET', path: '/plain', public: true }, async () => {
    throw new RouteError(404, 'not_found');
  });
  const h = serveRoutes([limited, taken, plain], deps());
  it('are returned beside the code, so the client can pick the right text', async () => {
    const a = await call(h, 'GET', '/api/c/hunter/limit');
    expect([a.status, await a.json()]).toEqual([409, { code: 'limit_reached', params: { hours: 4 } }]);
    const b = await call(h, 'GET', '/api/c/hunter/taken');
    expect(await b.json()).toEqual({ code: 'slot_unavailable', params: { by: 'coach' } });
  });
  it('are absent when the route gave none: existing callers still get codes only', async () => {
    const r = await call(h, 'GET', '/api/c/hunter/plain');
    expect(await r.json()).toEqual({ code: 'not_found' });
  });
  it('only plain values are carried: strings, numbers and booleans, short', async () => {
    const weird = route({ method: 'GET', path: '/weird', public: true }, async () => {
      throw new RouteError(400, 'bad', { ok: true, n: 1, s: 'x', obj: { a: 1 } as never, long: 'y'.repeat(300) });
    });
    const r = await call(serveRoutes([weird], deps()), 'GET', '/api/c/hunter/weird');
    expect(await r.json()).toEqual({ code: 'bad', params: { ok: true, n: 1, s: 'x' } });
  });
});

describe('rate limit on chosen routes', () => {
  const at = { t: 5_000_000 };
  const limited = () =>
    serveRoutes(
      [route({ method: 'POST', path: '/auth/session', public: true }, async () => ({ ok: 1 })), route({ method: 'GET', path: '/public/config', public: true }, async () => 'cfg')],
      deps({ rateLimit: { limiter: createRateLimiter({ limit: 2, windowSeconds: 60, now: () => new Date(at.t) }), routes: ['POST /auth/session'] } }),
    );
  it('refuses the attempt after the limit with 429, rate_limited and Retry-After', async () => {
    const h = limited();
    const ip = { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' };
    expect((await call(h, 'POST', '/api/c/hunter/auth/session', { body: {}, headers: ip })).status).toBe(200);
    expect((await call(h, 'POST', '/api/c/hunter/auth/session', { body: {}, headers: ip })).status).toBe(200);
    const third = await call(h, 'POST', '/api/c/hunter/auth/session', { body: {}, headers: ip });
    expect([third.status, await third.json(), third.headers.get('retry-after')]).toEqual([429, { code: 'rate_limited' }, '60']);
  });
  it('counts per caller and per club, leaves other routes alone, and opens when the window ends', async () => {
    const h = limited();
    const a = { 'x-real-ip': '198.51.100.1' };
    for (let i = 0; i < 2; i += 1) await call(h, 'POST', '/api/c/hunter/auth/session', { body: {}, headers: a });
    expect((await call(h, 'POST', '/api/c/hunter/auth/session', { body: {}, headers: a })).status).toBe(429);
    expect((await call(h, 'POST', '/api/c/hunter/auth/session', { body: {}, headers: { 'x-real-ip': '198.51.100.2' } })).status).toBe(200);
    expect((await call(h, 'POST', '/api/c/other-club/auth/session', { body: {}, headers: a })).status).toBe(200);
    expect((await call(h, 'GET', '/api/c/hunter/public/config', { headers: a })).status).toBe(200);
    at.t += 61_000;
    expect((await call(h, 'POST', '/api/c/hunter/auth/session', { body: {}, headers: a })).status).toBe(200);
  });
});

describe('serveRoutes: a file answer', () => {
  it('sends the bytes with the route\'s type, a plain file name, no caching and no sniffing', async () => {
    const h = serveRoutes([route({ method: 'GET', path: '/doc', public: true }, async () => new FileReply(new Uint8Array([37, 80, 68, 70]), { contentType: 'application/pdf', filename: 'ใบเสร็จ HTC-2026-000001.pdf' }))], deps());
    const r = await h(new Request('https://app.example/api/c/hunter/doc'), { params: Promise.resolve({ slug: 'hunter', path: ['doc'] }) });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/pdf');
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="________HTC-2026-000001.pdf"');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([37, 80, 68, 70]);
  });
});
