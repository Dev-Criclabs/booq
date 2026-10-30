import { describe, expect, it } from 'vitest';
import { route, RouteError } from './route';
import { serveWebhook } from './serve';
import { findUndeclaredRoutes } from './check';

// serveWebhook: a provider's call to a public route outside any club address (F02-T17, LINE; F05 Beam later). The handler
// gets the exact raw body and the headers, because the signature is over the bytes; the body is not parsed here.
const seen: Array<{ token: unknown; raw: string | undefined; sig: string | undefined }> = [];
const r = route({ method: 'POST', path: '/webhooks/line/:token', public: true }, async (ctx) => {
  seen.push({ token: (ctx.input as { token?: unknown }).token, raw: ctx.rawBody, sig: ctx.headers?.['x-line-signature'] });
  if (ctx.rawBody === 'bad') throw new RouteError(401, 'bad_signature');
  return { ok: true };
});
const call = (raw: string | undefined, headers: Record<string, string> = {}, max = 1000, token = 'tok123') =>
  serveWebhook(r, { maxBodyBytes: max, routeDeps: { hasFeature: async () => true } })(
    new Request('https://app.example/api/webhooks/line/' + token, { method: 'POST', ...(raw === undefined ? {} : { body: raw }), headers }),
    { params: Promise.resolve({ token }) },
  );

describe('serveWebhook', () => {
  it('passes the path token, the raw body byte for byte and the headers; answers JSON, never cached', async () => {
    seen.length = 0;
    const raw = '{"events": [ ],  "x":"ก"}';
    const res = await call(raw, { 'x-line-signature': 'abc', 'content-type': 'application/json' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(seen).toEqual([{ token: 'tok123', raw, sig: 'abc' }]);
  });
  it('a typed refusal is its status and code; an unexpected error is a plain 500', async () => {
    const res = await call('bad');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'bad_signature' });
  });
  it('a body over the limit is 413 and the handler never runs', async () => {
    seen.length = 0;
    expect((await call('x'.repeat(2000), {}, 1000)).status).toBe(413);
    expect(seen).toEqual([]);
  });
  it('only POST is served by a POST route', async () => {
    const res = await serveWebhook(r, { maxBodyBytes: 10, routeDeps: { hasFeature: async () => true } })(new Request('https://x/api/webhooks/line/t', { method: 'GET' }), { params: Promise.resolve({ token: 't' }) });
    expect(res.status).toBe(405);
  });
  it('a route file exporting serveWebhook(...) counts as declared', () => {
    expect(findUndeclaredRoutes([{ path: 'apps/web/src/app/api/webhooks/line/[token]/route.ts', text: 'export const POST = serveWebhook(lineRoute, deps);' }])).toEqual([]);
    expect(findUndeclaredRoutes([{ path: 'apps/web/src/app/api/webhooks/line/[token]/route.ts', text: 'export const POST = async () => new Response();' }])).toHaveLength(1);
  });
});
