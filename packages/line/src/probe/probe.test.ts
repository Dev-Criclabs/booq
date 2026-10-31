import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { probeLine } from './probe';

// probeLine: a read-only check of a club's LINE setup for the console's support view and new-club wizard (orchestrator,
// 31 Oct; F10 design 6, the connection test; LINE-06, D27). Codes only, the token is never echoed. A scripted local
// server stands in for the Messaging API.
type Reply = { status: number; body?: unknown; hang?: boolean };
let server: Server;
let url: string;
let script: Reply[];
let seen: Array<{ method: string; path: string; headers: IncomingHttpHeaders }>;

beforeEach(async () => {
  script = [];
  seen = [];
  server = createServer((req, res) => {
    seen.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers });
    const r = script.shift() ?? { status: 200, body: { userId: 'Ubot', basicId: '@hunter', displayName: 'Hunter' } };
    if (r.hang) return;
    res.writeHead(r.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(r.body ?? {}));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const a = server.address();
  url = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

const TOKEN = 'secret-channel-token-do-not-echo';
const good = { channelAccessToken: TOKEN, loginChannelId: '2012300015', liffId: '2012300015-WIi1jtLB' };
const probe = (o: Partial<typeof good> = {}) => probeLine({ ...good, ...o }, { baseUrl: url, timeoutMs: 200 });

describe('probeLine', () => {
  it('a working setup: three checks, all ok', async () => {
    expect(await probe()).toEqual({
      ok: true,
      checks: [
        { key: 'messaging_api', ok: true, code: 'ok' },
        { key: 'login', ok: true, code: 'format_ok' },
        { key: 'liff', ok: true, code: 'format_ok' },
      ],
    });
  });

  it('checks the token with a read-only call: GET /v2/bot/info with the bearer token, nothing else', async () => {
    await probe();
    expect(seen.map((s) => [s.method, s.path])).toEqual([['GET', '/v2/bot/info']]);
    expect(seen[0]!.headers['authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('a refused token, an unreachable LINE and other answers are codes', async () => {
    script = [{ status: 401, body: { message: `invalid token ${TOKEN}` } }];
    expect((await probe()).checks[0]).toEqual({ key: 'messaging_api', ok: false, code: 'token_rejected' });
    script = [{ status: 500 }];
    expect((await probe()).checks[0]).toEqual({ key: 'messaging_api', ok: false, code: 'unreachable' });
    script = [{ status: 200, hang: true }];
    expect((await probe()).checks[0]).toEqual({ key: 'messaging_api', ok: false, code: 'unreachable' });
    script = [{ status: 429 }];
    expect((await probe()).checks[0]).toEqual({ key: 'messaging_api', ok: false, code: 'http_429' });
  });

  it('never echoes the token, even when LINE puts it in its answer', async () => {
    script = [{ status: 401, body: { message: `invalid token ${TOKEN}` } }];
    const r = await probe();
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(r.ok).toBe(false);
  });

  it('missing values are codes and make no call', async () => {
    const r = await probe({ channelAccessToken: '', loginChannelId: ' ', liffId: '' });
    expect(r).toEqual({
      ok: false,
      checks: [
        { key: 'messaging_api', ok: false, code: 'missing' },
        { key: 'login', ok: false, code: 'missing' },
        { key: 'liff', ok: false, code: 'missing' },
      ],
    });
    expect(seen).toEqual([]);
  });

  it('the Login channel id is ten digits; the LIFF id belongs to that Login channel', async () => {
    expect((await probe({ loginChannelId: '12345' })).checks[1]).toEqual({ key: 'login', ok: false, code: 'invalid_format' });
    expect((await probe({ liffId: 'abc' })).checks[2]).toEqual({ key: 'liff', ok: false, code: 'invalid_format' });
    expect((await probe({ liffId: '2099999999-WIi1jtLB' })).checks[2]).toEqual({ key: 'liff', ok: false, code: 'not_in_login_channel' });
  });

  it('needs a base URL and a timeout: no defaults', async () => {
    await expect(probeLine(good, { baseUrl: '', timeoutMs: 200 })).rejects.toThrow(/base URL/);
    await expect(probeLine(good, { baseUrl: url, timeoutMs: 0 })).rejects.toThrow(/timeout/);
  });
});
