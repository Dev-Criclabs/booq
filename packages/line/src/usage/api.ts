import { bearer, failureCode, lineCall } from '../http/call';

// LINE's monthly usage figures (F10-T13; FA 5.6, from LINE's public documentation read 30 Oct 2026; G2 to confirm in
// F10-T01): GET /v2/bot/message/quota answers type ("none": no target limit set; "limited": one is set) and value (the
// month's free plus additional messages, when limited); GET /v2/bot/message/quota/consumption answers totalUsage,
// which LINE calls approximate. Both take the club's channel access token. Answers are values or codes: unreachable,
// token_rejected, http_NNN, or bad_answer for a body that is not the documented shape.

export type UsageFailure = { ok: false; code: string };
export type QuotaResult = { ok: true; type: 'none' | 'limited'; value: number | null } | UsageFailure;
export type ConsumptionResult = { ok: true; totalUsage: number } | UsageFailure;

export interface LineUsageApi {
  quota(token: string): Promise<QuotaResult>;
  consumption(token: string): Promise<ConsumptionResult>;
}

export interface LineUsageHttpApiOptions {
  /** https://api.line.me */
  baseUrl: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

const count = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

export function createLineUsageHttpApi(options: LineUsageHttpApiOptions): LineUsageApi {
  // i18n-ignore configuration error at start up, never shown to anyone
  if (!options.baseUrl) throw new Error('createLineUsageHttpApi: the base URL is required');
  // i18n-ignore configuration error at start up, never shown to anyone
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('createLineUsageHttpApi: a positive timeout is required');
  const api = options.baseUrl.replace(/\/+$/, '');
  const doFetch = options.fetch ?? fetch;
  const get = (path: string, token: string) => lineCall(doFetch, `${api}${path}`, { method: 'GET', headers: bearer(token) }, options.timeoutMs);

  return {
    async quota(token) {
      const r = await get('/v2/bot/message/quota', token);
      if (!r || r.status !== 200) return failureCode(r);
      const b = r.body as { type?: unknown; value?: unknown } | null;
      if (b?.type === 'none') return { ok: true, type: 'none', value: null };
      if (b?.type === 'limited' && count(b.value)) return { ok: true, type: 'limited', value: b.value };
      return { ok: false, code: 'bad_answer' };
    },
    async consumption(token) {
      const r = await get('/v2/bot/message/quota/consumption', token);
      if (!r || r.status !== 200) return failureCode(r);
      const total = (r.body as { totalUsage?: unknown } | null)?.totalUsage;
      return count(total) ? { ok: true, totalUsage: total } : { ok: false, code: 'bad_answer' };
    },
  };
}
