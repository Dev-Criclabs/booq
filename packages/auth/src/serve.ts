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
}

export interface ServeContext {
  params: Promise<{ slug: string; path?: string[] | undefined }>;
}

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
}
const fail = (status: number, code: string) => json(status, { code });

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

      let body: Record<string, unknown> = {};
      if (BODY_METHODS.has(method)) {
        const read = await readBody(request);
        if (read instanceof Response) return read;
        body = read;
      }
      const cookie = request.headers.get('cookie') ?? undefined;
      const session = await deps.resolveSession(slug, cookie);
      if (session === 'not_found') return fail(404, 'not_found');

      const query: Record<string, string> = {};
      for (const [k, v] of new URL(request.url).searchParams) query[k] = v;
      const input = { ...query, ...body, ...found.params, slug };

      const result: RouteResult<unknown> = await found.route.handle({ session, input, cookie, body: BODY_METHODS.has(method) ? body : undefined }, deps.routeDeps);
      if (!result.ok) return fail(result.status, result.code);
      if (result.body instanceof Reply) {
        const { status = 200, setCookie } = result.body.options;
        return json(status, result.body.body, setCookie ? { 'set-cookie': setCookie } : {});
      }
      return json(200, result.body);
    } catch {
      return fail(500, 'internal');
    }
  };
}
