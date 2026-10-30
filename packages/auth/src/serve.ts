import type { RateLimiter } from './rate-limit';
import { BODY_METHODS, callerOf, fail, json, matchPath, readJsonBody, withRouteHeaders } from './http';
import { checkRouteTable, Reply, type Route, type RouteDeps, type RouteResult, type RouteSession } from './route';

// serveRoutes (apps/web transport; FA 4.3): turns a table of declared routes into one standard
// `(Request, ctx) => Response` handler, with no framework import. The session comes from the cookie
// through `resolveSession`; the club comes from the address, never from the body. Every entry is a
// Route made by route(), so every one declares a permission, `public` or `needsPerson`; the table is
// checked (declared, no duplicates) when this is called. A body must be JSON, which also stops a
// cross-site form post (the session cookie is SameSite=Lax as well). Errors are codes, not text, and
// an unexpected error answers a plain 500 with no detail.

export interface ServeDeps {
  routeDeps: RouteDeps;
  /** The session for this club address and cookie: a person, null for a guest, or 'not_found' when the club is unknown. */
  resolveSession(slug: string, cookie: string | undefined): Promise<RouteSession | null | 'not_found'>;
  /** Longest request body in bytes. A setting: no default here. */
  maxBodyBytes: number;
  /**
   * A limit on attempts for chosen routes (for example `POST /auth/session`), counted per club address
   * and per caller. Absent means no limit. The caller is `x-real-ip`, else the first `x-forwarded-for`
   * entry, which is only as trustworthy as the platform in front (DevOps sets that up with the host).
   */
  rateLimit?: { limiter: RateLimiter; routes: readonly string[] };
}

export interface ServeContext {
  params: Promise<{ slug: string; path?: string[] | undefined }>;
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,200}$/;

interface Compiled {
  route: Route<unknown>;
  segments: string[];
}

export type ServeSource = { table: readonly Route<unknown>[]; deps: ServeDeps };

/**
 * `serveRoutes(table, deps)`, or `serveRoutes(() => ({ table, deps }))` to build them on the first
 * request: a deployment's settings are read then, so a build does not need them.
 */
export function serveRoutes(table: readonly Route<unknown>[], deps: ServeDeps): (request: Request, context: ServeContext) => Promise<Response>;
export function serveRoutes(source: () => ServeSource): (request: Request, context: ServeContext) => Promise<Response>;
export function serveRoutes(first: readonly Route<unknown>[] | (() => ServeSource), second?: ServeDeps): (request: Request, context: ServeContext) => Promise<Response> {
  if (typeof first === 'function') {
    let built: ((request: Request, context: ServeContext) => Promise<Response>) | undefined;
    return async (request, context) => {
      try {
        built ??= (() => {
          const s = first();
          return serveRoutes(s.table, s.deps);
        })();
      } catch {
        return fail(500, 'internal');
      }
      return built(request, context);
    };
  }
  return serveNow(first, second!);
}

function serveNow(table: readonly Route<unknown>[], deps: ServeDeps): (request: Request, context: ServeContext) => Promise<Response> {
  const problems = checkRouteTable(table.map((r) => r.def));
  if (problems.length) throw new Error(`route table: ${problems.map((p) => `${p.method ?? '?'} ${p.path ?? '?'}: ${p.problem}`).join('; ')}`);
  const compiled: Compiled[] = table.map((route) => ({ route, segments: route.def.path.split('/').filter(Boolean) }));

  return async (request, context) => {
    try {
      const { slug, path = [] } = await context.params;
      const method = request.method.toUpperCase();
      let pathMatched = false;
      let found: { route: Route<unknown>; params: Record<string, string> } | null = null;
      for (const c of compiled) {
        const params = matchPath(c.segments, path);
        if (!params) continue;
        pathMatched = true;
        if (c.route.def.method === method) {
          found = { route: c.route, params };
          break;
        }
      }
      if (!found) return pathMatched ? fail(405, 'method_not_allowed') : fail(404, 'not_found');
      return withRouteHeaders(await answer(request, found, method, slug), found.route.headers);
    } catch {
      return fail(500, 'internal');
    }
  };

  async function answer(request: Request, found: { route: Route<unknown>; params: Record<string, string> }, method: string, slug: string): Promise<Response> {
    let body: Record<string, unknown> = {};
    if (BODY_METHODS.has(method)) {
      const read = await readJsonBody(request, deps.maxBodyBytes);
      if (read instanceof Response) return read;
      body = read;
    }
    if (deps.rateLimit?.routes.includes(`${found.route.def.method} ${found.route.def.path}`)) {
      const caller = callerOf(request);
      const route = `${found.route.def.method} ${found.route.def.path}`;
      const hit = await deps.rateLimit.limiter.hit(`${route}|${slug}|${caller}`, { route, slug, caller });
      if (!hit.allowed) return json(429, { code: 'rate_limited' }, { 'retry-after': String(hit.retryAfterSeconds) });
    }
    const cookie = request.headers.get('cookie') ?? undefined;
    const session = await deps.resolveSession(slug, cookie);
    if (session === 'not_found') return fail(404, 'not_found');

    const query: Record<string, string> = {};
    for (const [k, v] of new URL(request.url).searchParams) query[k] = v;
    const input: Record<string, unknown> = { ...query, ...body, ...found.params, slug };
    // The key comes only from the header: a body or query value cannot stand in for it.
    delete input['idempotencyKey'];
    const key = request.headers.get('idempotency-key');
    if (key !== null) {
      if (!IDEMPOTENCY_KEY.test(key)) return fail(400, 'bad_input');
      input['idempotencyKey'] = key;
    }

    const result: RouteResult<unknown> = await found.route.handle({ session, input, cookie, body: BODY_METHODS.has(method) ? body : undefined }, deps.routeDeps);
    if (!result.ok) return fail(result.status, result.code, result.params);
    if (result.body instanceof Reply) {
      const { status = 200, setCookie } = result.body.options;
      return json(status, result.body.body, setCookie ? { 'set-cookie': setCookie } : {});
    }
    return json(200, result.body);
  }
}

export interface WebhookContext {
  params: Promise<{ token: string }>;
}

/**
 * A provider's call to one public route that is not under a club address (the LINE webhook, F02-T17). The club comes from the
 * token in the path, which the handler looks up; this function knows no club and no session. The handler gets the exact text of
 * the body (`rawBody`) and the headers, because the provider signs the bytes; the body is not parsed here. Answers are JSON codes.
 */
export type WebhookSource = { hook: Route<unknown>; deps: Pick<ServeDeps, 'routeDeps' | 'maxBodyBytes'> };
export function serveWebhook(hook: Route<unknown>, deps: Pick<ServeDeps, 'routeDeps' | 'maxBodyBytes'>): (request: Request, context: WebhookContext) => Promise<Response>;
/** Or `serveWebhook(() => ({ hook, deps }))` to build them on the first request, when the deployment's settings are read. */
export function serveWebhook(source: () => WebhookSource): (request: Request, context: WebhookContext) => Promise<Response>;
export function serveWebhook(first: Route<unknown> | (() => WebhookSource), second?: Pick<ServeDeps, 'routeDeps' | 'maxBodyBytes'>): (request: Request, context: WebhookContext) => Promise<Response> {
  if (typeof first === 'function') {
    let built: ((request: Request, context: WebhookContext) => Promise<Response>) | undefined;
    return async (request, context) => {
      try {
        built ??= (() => {
          const s = first();
          return serveWebhook(s.hook, s.deps);
        })();
      } catch {
        return fail(500, 'internal');
      }
      return built(request, context);
    };
  }
  return serveWebhookNow(first, second!);
}

function serveWebhookNow(
  hook: Route<unknown>,
  deps: Pick<ServeDeps, 'routeDeps' | 'maxBodyBytes'>,
): (request: Request, context: WebhookContext) => Promise<Response> {
  const problems = checkRouteTable([hook.def]);
  if (problems.length) throw new Error(`webhook route: ${problems.map((p) => p.problem).join('; ')}`);
  if (hook.def.public !== true) throw new Error('webhook route must be public: it is authenticated by its signature, not a session');
  return async (request, context) => {
    try {
      if (request.method.toUpperCase() !== hook.def.method) return fail(405, 'method_not_allowed');
      const { token } = await context.params;
      const declared = Number(request.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > deps.maxBodyBytes) return fail(413, 'payload_too_large');
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).length > deps.maxBodyBytes) return fail(413, 'payload_too_large');
      const headers: Record<string, string> = {};
      request.headers.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
      const result = await hook.handle({ session: null, input: { token }, rawBody, headers }, deps.routeDeps);
      if (!result.ok) return fail(result.status, result.code);
      return json(200, result.body instanceof Reply ? result.body.body : result.body);
    } catch {
      return fail(500, 'internal');
    }
  };
}
