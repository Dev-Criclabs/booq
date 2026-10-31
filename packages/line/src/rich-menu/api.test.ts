import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRichMenuHttpApi } from './api';

// F10-T12: LINE's rich menu calls over HTTP (F10 design 5.5; G1: create, upload image, set default, delete, as LINE's
// Messaging API documentation states them; to confirm in F10-T01). A scripted local server stands in for both hosts.
type Reply = { status: number; body?: unknown };
let server: Server;
let url: string;
let script: Reply[];
let seen: Array<{ method: string; path: string; headers: IncomingHttpHeaders; bytes: number; json: unknown }>;

beforeEach(async () => {
  script = [];
  seen = [];
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      let json: unknown = null;
      if ((req.headers['content-type'] ?? '').includes('json')) json = JSON.parse(raw.toString('utf8') || 'null');
      seen.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers, bytes: raw.length, json });
      const r = script.shift() ?? { status: 200, body: {} };
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

const api = () => createRichMenuHttpApi({ baseUrl: url, dataBaseUrl: `${url}/data`, timeoutMs: 500 });
const TOKEN = 'tok';
const menu = { size: { width: 2500, height: 1686 }, selected: true, name: 'booq', chatBarText: 'x', areas: [] };

describe('createRichMenuHttpApi', () => {
  it('create posts the menu and gives back LINE’s id', async () => {
    script = [{ status: 200, body: { richMenuId: 'richmenu-1' } }];
    expect(await api().create(TOKEN, menu)).toEqual({ ok: true, richMenuId: 'richmenu-1' });
    expect(seen[0]).toMatchObject({ method: 'POST', path: '/v2/bot/richmenu', json: menu });
    expect(seen[0]!.headers['authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('upload sends the PNG to the data host; set default and delete use the menu id', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    expect(await api().upload(TOKEN, 'richmenu-1', png)).toEqual({ ok: true });
    expect(await api().setDefault(TOKEN, 'richmenu-1')).toEqual({ ok: true });
    expect(await api().remove(TOKEN, 'richmenu-0')).toEqual({ ok: true });
    expect(seen.map((s) => [s.method, s.path])).toEqual([
      ['POST', '/data/v2/bot/richmenu/richmenu-1/content'],
      ['POST', '/v2/bot/user/all/richmenu/richmenu-1'],
      ['DELETE', '/v2/bot/richmenu/richmenu-0'],
    ]);
    expect(seen[0]!.headers['content-type']).toBe('image/png');
    expect(seen[0]!.bytes).toBe(png.length);
  });

  it('a refusal is a code, never LINE’s text; a refused token says so', async () => {
    script = [{ status: 400, body: { message: 'must be 2500x1686' } }, { status: 401 }, { status: 500 }];
    expect(await api().create(TOKEN, menu)).toEqual({ ok: false, code: 'http_400' });
    expect(await api().upload(TOKEN, 'richmenu-r', Buffer.alloc(1))).toEqual({ ok: false, code: 'token_rejected' });
    expect(await api().setDefault(TOKEN, 'richmenu-r')).toEqual({ ok: false, code: 'http_500' });
  });

  it('a create answer without an id is a failure', async () => {
    script = [{ status: 200, body: {} }];
    expect(await api().create(TOKEN, menu)).toEqual({ ok: false, code: 'no_rich_menu_id' });
  });

  it('a menu id that is not LINE’s form is refused before any call', async () => {
    expect(await api().setDefault(TOKEN, '../x')).toEqual({ ok: false, code: 'bad_rich_menu_id' });
    expect(seen).toEqual([]);
  });
});
