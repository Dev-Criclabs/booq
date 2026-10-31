import { bearer, failureCode, lineCall } from '../http/call';
import type { RichMenuObject } from './menu';

// LINE's rich menu calls (F10-T12; F10 design 5.5). G1, as LINE's Messaging API documentation states them and to confirm
// in F10-T01: POST /v2/bot/richmenu creates a menu and answers its richMenuId; POST {data host}/v2/bot/richmenu/{id}/content
// uploads its image (the data host is https://api-data.line.me); POST /v2/bot/user/all/richmenu/{id} makes it the default
// for every user of the Official Account; DELETE /v2/bot/richmenu/{id} removes one. Answers are codes, never LINE's text;
// the token is never returned.

export type RichMenuCallResult = { ok: true } | { ok: false; code: string };

export interface RichMenuApi {
  create(token: string, menu: RichMenuObject): Promise<{ ok: true; richMenuId: string } | { ok: false; code: string }>;
  upload(token: string, richMenuId: string, png: Buffer): Promise<RichMenuCallResult>;
  setDefault(token: string, richMenuId: string): Promise<RichMenuCallResult>;
  remove(token: string, richMenuId: string): Promise<RichMenuCallResult>;
}

export interface RichMenuHttpApiOptions {
  /** https://api.line.me */
  baseUrl: string;
  /** https://api-data.line.me (image upload) */
  dataBaseUrl: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

const RICH_MENU_ID = /^richmenu-[A-Za-z0-9-]{1,80}$/;

export function createRichMenuHttpApi(options: RichMenuHttpApiOptions): RichMenuApi {
  // i18n-ignore configuration error at start up, never shown to anyone
  if (!options.baseUrl || !options.dataBaseUrl) throw new Error('createRichMenuHttpApi: both base URLs are required');
  // i18n-ignore configuration error at start up, never shown to anyone
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('createRichMenuHttpApi: a positive timeout is required');
  const api = options.baseUrl.replace(/\/+$/, '');
  const data = options.dataBaseUrl.replace(/\/+$/, '');
  const doFetch = options.fetch ?? fetch;

  const call = (url: string, init: RequestInit) => lineCall(doFetch, url, init, options.timeoutMs);
  const failure = failureCode;
  const auth = bearer;

  return {
    async create(token, menu) {
      const r = await call(`${api}/v2/bot/richmenu`, { method: 'POST', headers: { ...auth(token), 'content-type': 'application/json' }, body: JSON.stringify(menu) });
      if (!r || r.status !== 200) return failure(r);
      const id = (r.body as { richMenuId?: unknown } | null)?.richMenuId;
      return typeof id === 'string' && RICH_MENU_ID.test(id) ? { ok: true, richMenuId: id } : { ok: false, code: 'no_rich_menu_id' };
    },
    async upload(token, richMenuId, png) {
      if (!RICH_MENU_ID.test(richMenuId)) return { ok: false, code: 'bad_rich_menu_id' };
      const r = await call(`${data}/v2/bot/richmenu/${richMenuId}/content`, { method: 'POST', headers: { ...auth(token), 'content-type': 'image/png' }, body: new Uint8Array(png) });
      return r && r.status === 200 ? { ok: true } : failure(r);
    },
    async setDefault(token, richMenuId) {
      if (!RICH_MENU_ID.test(richMenuId)) return { ok: false, code: 'bad_rich_menu_id' };
      const r = await call(`${api}/v2/bot/user/all/richmenu/${richMenuId}`, { method: 'POST', headers: auth(token) });
      return r && r.status === 200 ? { ok: true } : failure(r);
    },
    async remove(token, richMenuId) {
      if (!RICH_MENU_ID.test(richMenuId)) return { ok: false, code: 'bad_rich_menu_id' };
      const r = await call(`${api}/v2/bot/richmenu/${richMenuId}`, { method: 'DELETE', headers: auth(token) });
      return r && r.status === 200 ? { ok: true } : failure(r);
    },
  };
}
