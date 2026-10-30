import type { RateLimiter } from './rate-limit';
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

/** A route may add headers but not take over these: the body is JSON, never sniffed, and only a Reply sets a cookie. */
const RESERVED = new Set(['content-type', 'content-length', 'x-content-type-options', 'set-cookie', 'transfer-encoding']);

function withRouteHeaders(res: Response, extra: Readonly<Record<string, string>> | undefined): Response {
  if (!extra) return res;
  for (const [k, v] of Object.entries(extra)) if (!RESERVED.has(k.toLowerCase())) res.headers.set(k, v);
  return res;
}

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
}
/** Only short plain values go out as params: strings, finite numbers, booleans. */
function cleanParams(params: Readonly<Record<string, unknown>> | undefined): Record<string, string | number | boolean> | undefined {
  if (!params) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params).slice(0, 10)) {
    if ((typeof v === 'string' && v.length <= 200) || (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean') out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}
const fail = (status: number, code: string, params?: Readonly<Record<string, unknown>>) => {
  const p = cleanParams(params);
  return json(status, p ? { code, params: p } : { code });
};
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,200}$/;

interface Compiled {
  route: Route<unknown>;
  segments: string[];
}

function matchPath(segments: string[], actual: string[]): Record<string, string> | null {
  if (segments.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i += 1) {
    const want = segments[i]!;
    const got = actual[i]!;
    if (want.startsWith(':')) params[want.slice(1)] = decodeURIComponent(got);
    else if (want !== got) return null;
  }
  return params;
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

  async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
    if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
      // An empty body needs no content type.
      const text = await request.clone().text();
      return text === '' ? {} : fail(415, 'unsupported_media_type');
    }
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > deps.maxBodyBytes) return fail(413, 'payload_too_large');
    const text = await request.text();
    if (new TextEncoder().encode(text).length > deps.maxBodyBytes) return fail(413, 'payload_too_large');
    if (text === '') return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return fail(400, 'bad_input');
    }
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : fail(400, 'bad_input');
  }

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
      const read = await readBody(request);
      if (read instanceof Response) return read;
      body = read;
    }
    if (deps.rateLimit?.routes.includes(`${found.route.def.method} ${found.route.def.path}`)) {
      const caller = request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
      const hit = deps.rateLimit.limiter.hit(`${found.route.def.method} ${found.route.def.path}|${slug}|${caller}`);
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
