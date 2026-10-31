import { can, isPermission, type Role } from './permissions';

// route() (FA 4.3, F01 design 6.2): every API route is declared through this wrapper, so the
// server decides before the handler runs. The club, user and roles come from the session only,
// never from the request body or path.

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type Method = (typeof METHODS)[number];

export interface RouteDeclaration {
  method: Method;
  /** Path below the app prefix, for example `/settings/:key`. */
  path: string;
  /** Exactly one of `permission`, `public: true` or `needsPerson: true`. */
  permission?: string;
  public?: true;
  /** Any signed-in active person, whatever their roles: checkout, My bookings, Credits and wallet, Refer a friend, Profile (F02-T11). A guest gets `sign_in_required`. */
  needsPerson?: true;
  /** Club feature switch the route needs (PLAT-05-AC2). */
  feature?: string;
}

export interface RouteSession {
  clubId: string;
  userId: string;
  roles: readonly Role[];
  requestId?: string;
}

export interface RouteRequest {
  session: RouteSession | null;
  input: unknown;
  /** The raw Cookie header, for the routes that sign in and out (F02). */
  cookie?: string | undefined;
  /** The JSON body exactly as sent, for routes that must reject unknown fields. `input` is the merge of query, body and path. */
  body?: unknown;
  /** Webhooks only (serveWebhook): the body as the exact text received, for a signature over the bytes. */
  rawBody?: string | undefined;
  /** Webhooks only: the request headers, names in lower case. */
  headers?: Readonly<Record<string, string>> | undefined;
}

export interface RouteDeps {
  hasFeature(clubId: string, featureKey: string): Promise<boolean>;
}

export type RouteContext = RouteSession & { input: unknown; cookie?: string | undefined; body?: unknown; rawBody?: string | undefined; headers?: Readonly<Record<string, string>> | undefined };

/** A handler returns this to set a status or a cookie along with the body. The transport unwraps it. */
export class Reply<T> {
  constructor(readonly body: T, readonly options: { status?: number; setCookie?: string } = {}) {}
}

/** A handler returns this for a file (a receipt PDF): the transport sends the bytes with the type, never sniffed and never cached. */
export class FileReply {
  constructor(readonly bytes: Uint8Array, readonly options: { contentType: string; filename: string }) {}
}

export type RouteResult<T> =
  | { ok: true; status: 200; body: T }
  | { ok: false; status: number; code: string; params?: RouteParams };

/** A typed refusal from a handler: a status and a code, never text (TEXT-01). */
export type RouteParams = Readonly<Record<string, string | number | boolean>>;

export class RouteError extends Error {
  /** `params` carry plain values the client needs to choose the right text (for example `{ hours: 4 }`); they are never text themselves. */
  constructor(readonly status: number, readonly code: string, readonly params?: RouteParams) {
    super(code);
  }
}

export interface Route<T> {
  def: RouteDeclaration;
  /** Headers the transport sets on every answer of this route (for example `Cache-Control: no-store` on a schedule). */
  headers?: Readonly<Record<string, string>>;
  handle(req: RouteRequest, deps: RouteDeps): Promise<RouteResult<T>>;
}

export function validateDeclaration(def: Partial<RouteDeclaration>): string[] {
  const problems: string[] = [];
  if (!def.method || !(METHODS as readonly string[]).includes(def.method)) problems.push('method must be GET, POST, PUT, PATCH or DELETE');
  if (!def.path || !def.path.startsWith('/')) problems.push('path must start with "/"');
  const hasPermission = def.permission !== undefined;
  const isPublic = def.public === true;
  const isPerson = def.needsPerson === true;
  const declared = [hasPermission, isPublic, isPerson].filter(Boolean).length;
  if (declared === 0) problems.push('route must declare a permission, public: true or needsPerson: true');
  if (declared > 1) problems.push('route must declare only one of permission, public and needsPerson');
  if (hasPermission && !isPermission(def.permission as string)) problems.push(`unknown permission "${def.permission}"`);
  if (def.feature !== undefined && def.feature.trim() === '') problems.push('feature must not be empty');
  return problems;
}

export function route<T>(def: RouteDeclaration, handler: (ctx: RouteContext) => Promise<T>): Route<T> {
  const problems = validateDeclaration(def);
  if (problems.length) throw new Error(`route ${def.method} ${def.path}: ${problems.join('; ')}`);

  return {
    def,
    async handle(req, deps) {
      const { session } = req;
      if (def.needsPerson === true && !session) return { ok: false, status: 401, code: 'sign_in_required' };
      if (def.permission !== undefined) {
        if (!session) return { ok: false, status: 401, code: 'unauthenticated' };
        if (!can(session.roles, def.permission)) return { ok: false, status: 403, code: 'forbidden' };
      }
      if (def.feature !== undefined) {
        // The switch belongs to a club, so a gated route without a session fails closed.
        if (!session) return { ok: false, status: 401, code: 'unauthenticated' };
        if (!(await deps.hasFeature(session.clubId, def.feature))) return { ok: false, status: 403, code: 'feature_disabled' };
      }
      try {
        const ctx = { ...(session as RouteSession), input: req.input, cookie: req.cookie, body: req.body, rawBody: req.rawBody, headers: req.headers };
        return { ok: true, status: 200, body: await handler(ctx) };
      } catch (e) {
        if (e instanceof RouteError) return { ok: false, status: e.status, code: e.code, ...(e.params ? { params: e.params } : {}) };
        return { ok: false, status: 500, code: 'internal' };
      }
    },
  };
}

export interface RouteProblem {
  method?: string | undefined;
  path?: string | undefined;
  problem: string;
}

/** Build check over a collected route table: every entry declared, none registered twice. */
export function checkRouteTable(defs: readonly Partial<RouteDeclaration>[]): RouteProblem[] {
  const out: RouteProblem[] = [];
  const seen = new Set<string>();
  for (const d of defs) {
    for (const problem of validateDeclaration(d)) out.push({ method: d.method, path: d.path, problem });
    const key = `${d.method} ${d.path}`;
    if (seen.has(key)) out.push({ method: d.method, path: d.path, problem: 'route registered twice' });
    seen.add(key);
  }
  return out;
}
