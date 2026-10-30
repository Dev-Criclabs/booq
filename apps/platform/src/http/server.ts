import { BODY_METHODS, callerOf, failResponse as fail, jsonResponse as json, matchPath, readJsonBody, Reply, RouteError, withRouteHeaders, type RateLimiter, type RouteParams } from '@booq/auth';
import { PLATFORM_COOKIE, type AuthenticateResult } from '../auth/sign-in';

// The platform console's HTTP layer (F01-T17, T18; ROLE-02; D148; FA 4.4). Like serveRoutes for the
// club apps, but for BOOQ staff: the only credential is the platform cookie, checked by the staff
// auth module (second factor, idle and absolute limits, step-up freshness). A club session cookie
// is never read here and a platform cookie is never read by the club app. Each route declares who
// may call it (`public`, `staff`, `admin`); the table is checked when it is built. JSON in and out,
// codes only, answers never cached.

export type Access = 'public' | 'staff' | 'admin';
export interface PlatformStaff {
  id: string;
  role: 'platform_admin' | 'onboarding_specialist';
  displayName: string;
}
export interface PlatformContext {
  /** The signed-in staff member; null only on a `public` route. */
  staff: PlatformStaff | null;
  /** Whether the staff member passed a second factor within the step-up window (SR-16). */
  stepUpFresh: boolean;
  /** Query, body and path merged; the path wins. */
  input: Record<string, unknown>;
  /** The JSON body as sent. */
  body: Record<string, unknown>;
  /** The platform cookie value, for the routes that end or step up a session. */
  cookie: string | undefined;
  request: Request;
}
export interface PlatformRoute {
  def: { method: string; path: string; access: Access };
  headers?: Readonly<Record<string, string>>;
  run(ctx: PlatformContext): Promise<unknown>;
}

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const ACCESS = new Set<string>(['public', 'staff', 'admin']);

export function platformRoute(def: PlatformRoute['def'], run: (ctx: PlatformContext) => Promise<unknown>): PlatformRoute {
  if (!METHODS.has(def.method)) throw new Error(`platform route ${def.method} ${def.path}: method must be GET, POST, PUT, PATCH or DELETE`);
  if (!def.path.startsWith('/')) throw new Error(`platform route ${def.method} ${def.path}: path must start with "/"`);
  if (!ACCESS.has(def.access)) throw new Error(`platform route ${def.method} ${def.path}: access must be public, staff or admin`);
  return { def, run };
}

export interface PlatformServeDeps {
  authenticate(cookie: string): Promise<AuthenticateResult>;
  /** Longest request body in bytes. A setting: no default here. */
  maxBodyBytes: number;
  /** A limit on attempts for chosen routes (sign-in, second factor, step-up), per caller. Absent means none. */
  rateLimit?: { limiter: RateLimiter; routes: readonly string[] };
}
export interface PlatformServeContext {
  params: Promise<{ path?: string[] | undefined }>;
}
export type PlatformHandler = (request: Request, context: PlatformServeContext) => Promise<Response>;
export type PlatformSource = { table: readonly PlatformRoute[]; deps: PlatformServeDeps };

export function parsePlatformCookie(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === PLATFORM_COOKIE) return rest.join('=') || undefined;
  }
  return undefined;
}

export function servePlatform(table: readonly PlatformRoute[], deps: PlatformServeDeps): PlatformHandler;
export function servePlatform(source: () => PlatformSource): PlatformHandler;
export function servePlatform(first: readonly PlatformRoute[] | (() => PlatformSource), second?: PlatformServeDeps): PlatformHandler {
  if (typeof first === 'function') {
    let built: PlatformHandler | undefined;
    return async (request, context) => {
      try {
        built ??= (() => {
          const s = first();
          return servePlatform(s.table, s.deps);
        })();
      } catch {
        return fail(500, 'internal');
      }
      return built(request, context);
    };
  }
  return serveNow(first, second!);
}

function serveNow(table: readonly PlatformRoute[], deps: PlatformServeDeps): PlatformHandler {
  const seen = new Set<string>();
  for (const r of table) {
    const key = `${r.def.method} ${r.def.path}`;
    if (seen.has(key)) throw new Error(`platform route table: ${key} registered twice`);
    seen.add(key);
  }
  const compiled = table.map((route) => ({ route, segments: route.def.path.split('/').filter(Boolean) }));

  return async (request, context) => {
    try {
      const { path = [] } = await context.params;
      const method = request.method.toUpperCase();
      let pathMatched = false;
      let found: { route: PlatformRoute; params: Record<string, string> } | null = null;
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
      const { route } = found;

      if (deps.rateLimit?.routes.includes(`${route.def.method} ${route.def.path}`)) {
        const hit = await deps.rateLimit.limiter.hit(`${route.def.method} ${route.def.path}|${callerOf(request)}`);
        if (!hit.allowed) return json(429, { code: 'rate_limited' }, { 'retry-after': String(hit.retryAfterSeconds) });
      }

      let body: Record<string, unknown> = {};
      if (BODY_METHODS.has(method)) {
        const read = await readJsonBody(request, deps.maxBodyBytes);
        if (read instanceof Response) return read;
        body = read;
      }

      const cookie = parsePlatformCookie(request.headers.get('cookie'));
      let staff: PlatformStaff | null = null;
      let stepUpFresh = false;
      if (route.def.access !== 'public' || cookie) {
        const auth = cookie ? await deps.authenticate(cookie) : null;
        if (auth?.ok) {
          staff = auth.staff;
          stepUpFresh = auth.stepUpFresh;
        } else if (route.def.access !== 'public') {
          return fail(401, 'unauthenticated');
        }
      }
      if (route.def.access === 'admin' && staff?.role !== 'platform_admin') return fail(403, 'forbidden');

      const query: Record<string, string> = {};
      for (const [k, v] of new URL(request.url).searchParams) query[k] = v;
      const input = { ...query, ...body, ...found.params };

      try {
        const result = await route.run({ staff, stepUpFresh, input, body, cookie, request });
        if (result instanceof Reply) {
          const { status = 200, setCookie } = result.options;
          return withRouteHeaders(json(status, result.body, setCookie ? { 'set-cookie': setCookie } : {}), route.headers);
        }
        return withRouteHeaders(json(200, result ?? {}), route.headers);
      } catch (e) {
        if (e instanceof RouteError) return withRouteHeaders(fail(e.status, e.code, e.params as RouteParams | undefined), route.headers);
        return fail(500, 'internal');
      }
    } catch {
      return fail(500, 'internal');
    }
  };
}
