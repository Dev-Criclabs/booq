import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLineHttpTransport } from './http-transport';

// F10-T09: the LINE push over HTTP (F10 design 5.2 steps 5 and 6; FA 5.3, 5.6). LINE-03-AC5, LINE-07-AC5, D9.
// A scripted local server stands in for the Messaging API so a test can hang a request, answer a status and read the
// headers the adapter sent. Statuses follow FA 5.3 and 5.6 (STATED there); 409 for a repeated retry key is checked
// against LINE's docs in F10-T01.
type Reply = { status: number; body?: unknown; hang?: boolean };
let server: Server;
let url: string;
let script: Reply[];
let seen: Array<{ path: string; headers: IncomingHttpHeaders; body: unknown }>;

beforeEach(async () => {
  script = [];
  seen = [];
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen.push({ path: req.url ?? '', headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') });
      const r = script.shift() ?? { status: 200, body: {} };
      if (r.hang) return;   // never answers: the adapter's timeout fires
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.body ?? {}));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const a = server.address();
  url = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

const input = { clubId: 'c1', channelAccessToken: 'tok-c1', to: 'U1', messages: [{ type: 'text', text: 'x' }], retryKey: '7b1f0c1e-0a6b-4f3f-9a51-2d3c4b5a6f70' };
const transport = () => createLineHttpTransport({ baseUrl: url, timeoutMs: 200 });

describe('createLineHttpTransport', () => {
  it('pushes to /v2/bot/message/push with the club token and the row’s retry key', async () => {
    expect(await transport().push(input)).toEqual({ ok: true });
    expect(seen[0]).toMatchObject({
      path: '/v2/bot/message/push',
      headers: { authorization: 'Bearer tok-c1', 'x-line-retry-key': input.retryKey, 'content-type': 'application/json' },
      body: { to: 'U1', messages: input.messages },
    });
  });

  it('a timeout is a retry, and the retry carries the same retry key (FA 5.3)', async () => {
    script = [{ status: 200, hang: true }, { status: 200 }];
    const t = transport();
    expect(await t.push(input)).toMatchObject({ ok: false, outcome: 'retry', status: 0, code: 'timeout' });
    expect(await t.push(input)).toEqual({ ok: true });
    expect(seen.map((s) => s.headers['x-line-retry-key'])).toEqual([input.retryKey, input.retryKey]);
  });

  it('409 for a retry key LINE already accepted means it was sent: ok, not a second message', async () => {
    script = [{ status: 409, body: { message: 'The retry key is already accepted' } }];
    expect(await transport().push(input)).toEqual({ ok: true });
  });

  it('maps the answers to what the sender does (design 5.2 step 6)', async () => {
    script = [
      { status: 401, body: { message: 'Authentication failed' } },
      { status: 429, body: { message: 'You have reached your monthly limit.' } },
      { status: 429, body: { message: 'Too Many Requests' } },
      { status: 500 },
      { status: 400, body: { message: 'The request body has invalid properties' } },
    ];
    const t = transport();
    const out = [];
    for (let i = 0; i < 5; i++) out.push(await t.push(input));
    expect(out).toEqual([
      { ok: false, outcome: 'token', status: 401, code: 'http_401' },
      { ok: false, outcome: 'cap', status: 429, code: 'cap' },
      { ok: false, outcome: 'retry', status: 429, code: 'rate_limited' },
      { ok: false, outcome: 'retry', status: 500, code: 'http_500' },
      { ok: false, outcome: 'failed', status: 400, code: 'http_400' },
    ]);
  });

  it('a network error is a retry; the code never carries LINE’s message text', async () => {
    const t = createLineHttpTransport({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 200 });
    const r = await t.push(input);
    expect(r).toMatchObject({ ok: false, outcome: 'retry', status: 0, code: 'network' });
  });

  it('needs a base URL and a timeout: no defaults (config comes from the environment)', () => {
    expect(() => createLineHttpTransport({ baseUrl: '', timeoutMs: 200 })).toThrow(/base URL/);
    expect(() => createLineHttpTransport({ baseUrl: url, timeoutMs: 0 })).toThrow(/timeout/);
  });
});
