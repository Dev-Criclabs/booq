// Shared by the HTTP transports (serveRoutes for the club apps, the platform console server):
// plain Request/Response helpers with no framework import. Bodies are JSON, answers are JSON and never
// cached, errors are codes, and a route can add headers but not replace the safe ones.

/** A route may add headers but not take over these: the body is JSON, never sniffed, and only a Reply sets a cookie. */
const RESERVED = new Set(['content-type', 'content-length', 'x-content-type-options', 'set-cookie', 'transfer-encoding']);

export function withRouteHeaders(res: Response, extra: Readonly<Record<string, string>> | undefined): Response {
  if (!extra) return res;
  for (const [k, v] of Object.entries(extra)) if (!RESERVED.has(k.toLowerCase())) res.headers.set(k, v);
  return res;
}

export const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

export function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
}

/** Only short plain values go out as params: strings, finite numbers, booleans. */
export function cleanParams(params: Readonly<Record<string, unknown>> | undefined): Record<string, string | number | boolean> | undefined {
  if (!params) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params).slice(0, 10)) {
    if ((typeof v === 'string' && v.length <= 200) || (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean') out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export const fail = (status: number, code: string, params?: Readonly<Record<string, unknown>>) => {
  const p = cleanParams(params);
  return json(status, p ? { code, params: p } : { code });
};

export function matchPath(segments: string[], actual: string[]): Record<string, string> | null {
  if (segments.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i += 1) {
    const want = segments[i]!;
    const got = actual[i]!;
    if (want.startsWith(':')) {
      try {
        params[want.slice(1)] = decodeURIComponent(got);
      } catch {
        return null; // a malformed escape never matches
      }
    } else if (want !== got) return null;
  }
  return params;
}

/** The JSON object body, or the Response to send: 415 for another content type, 413 for too large, 400 for bad JSON or a non-object. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<Record<string, unknown> | Response> {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    // An empty body needs no content type.
    const text = await request.clone().text();
    return text === '' ? {} : fail(415, 'unsupported_media_type');
  }
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return fail(413, 'payload_too_large');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) return fail(413, 'payload_too_large');
  if (text === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail(400, 'bad_input');
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : fail(400, 'bad_input');
}

/** The caller, as the proxy in front reports it: the leftmost `x-forwarded-for` entry, else `x-real-ip`. Only as trustworthy as that proxy. */
export function callerOf(request: Request): string {
  // The leftmost x-forwarded-for entry is the address the host documents as trustworthy (DevOps, docs/ops/web.md);
  // x-real-ip is only a fallback, since it is not confirmed.
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'unknown';
}
