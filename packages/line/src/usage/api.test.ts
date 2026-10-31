import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLineUsageHttpApi } from './api';

// F10-T13: LINE's quota and consumption calls (FA 5.6, read 30 Oct 2026; G2 to confirm in F10-T01 on the test OA).
// GET /v2/bot/message/quota answers type (none or limited) and value; GET /v2/bot/message/quota/consumption answers
// totalUsage (approximate). A scripted local server stands in for LINE.
type Reply = { status: number; body?: unknown; raw?: string };
let server: Server;
let url: string;
let script: Reply[];
let seen: Array<{ method: string; path: string; headers: IncomingHttpHeaders }>;

beforeEach(async () => {
  script = [];
  seen = [];
  server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      seen.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers });
      const r = script.shift() ?? { status: 200, body: {} };
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(r.raw ?? JSON.stringify(r.body ?? {}));
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

const api = () => createLineUsageHttpApi({ baseUrl: url, timeoutMs: 500 });

describe('createLineUsageHttpApi', () => {
  it('quota: limited with its value, or none; with the club’s token', async () => {
    script = [{ status: 200, body: { type: 'limited', value: 1000 } }, { status: 200, body: { type: 'none' } }];
    expect(await api().quota('tok')).toEqual({ ok: true, type: 'limited', value: 1000 });
    expect(await api().quota('tok')).toEqual({ ok: true, type: 'none', value: null });
    expect(seen.map((s) => [s.method, s.path])).toEqual([['GET', '/v2/bot/message/quota'], ['GET', '/v2/bot/message/quota']]);
    expect(seen[0]!.headers['authorization']).toBe('Bearer tok');
  });

  it('consumption: totalUsage', async () => {
    script = [{ status: 200, body: { totalUsage: 432 } }];
    expect(await api().consumption('tok')).toEqual({ ok: true, totalUsage: 432 });
    expect(seen[0]!.path).toBe('/v2/bot/message/quota/consumption');
  });

  it('an answer not in the documented shape is bad_answer, never a guess', async () => {
    script = [{ status: 200, body: { type: 'limited' } }, { status: 200, body: { type: 'other' } }, { status: 200, body: { totalUsage: -1 } }, { status: 200, raw: 'oops' }];
    expect(await api().quota('tok')).toEqual({ ok: false, code: 'bad_answer' });
    expect(await api().quota('tok')).toEqual({ ok: false, code: 'bad_answer' });
    expect(await api().consumption('tok')).toEqual({ ok: false, code: 'bad_answer' });
    expect(await api().consumption('tok')).toEqual({ ok: false, code: 'bad_answer' });
  });

  it('a refused token, an error status and an unreachable LINE are codes', async () => {
    script = [{ status: 401 }, { status: 500 }];
    expect(await api().quota('tok')).toEqual({ ok: false, code: 'token_rejected' });
    expect(await api().consumption('tok')).toEqual({ ok: false, code: 'http_500' });
    const down = createLineUsageHttpApi({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });
    expect(await down.consumption('tok')).toEqual({ ok: false, code: 'unreachable' });
  });
});
