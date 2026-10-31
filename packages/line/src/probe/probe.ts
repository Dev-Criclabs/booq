// probeLine: a read-only check of a club's LINE setup, for the console's support view and the new-club wizard
// (orchestrator, 31 Oct; F10 design 6, the connection test; LINE-06, D27). It answers codes only; the token is never
// echoed, logged or returned, and LINE's answer text is not passed on.
//   messaging_api  GET /v2/bot/info with the channel access token: the documented read-only call for the bot behind it
//   login          the Login channel id has LINE's form (ten digits)
//   liff           the LIFF id has LINE's form and belongs to that Login channel (a LIFF id is {loginChannelId}-{suffix})
// LINE has no read-only lookup of a Login channel or a LIFF app that works with the Messaging API token alone: those
// calls need the Login channel's own token or secret. The two are therefore checked by form; the sign in test of F02
// proves them live. To confirm in F10-T01 against LINE's docs and the test provider (channel 2012300015).

export interface LineSetup {
  channelAccessToken: string;
  loginChannelId: string;
  liffId: string;
}

export interface LineProbeOptions {
  /** https://api.line.me in production; a fake's URL in tests. */
  baseUrl: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

export type LineProbeKey = 'messaging_api' | 'login' | 'liff';
export interface LineProbeCheck {
  key: LineProbeKey;
  ok: boolean;
  /** ok, format_ok, missing, invalid_format, not_in_login_channel, token_rejected, unreachable, http_<status>. */
  code: string;
}
export interface LineProbeResult {
  ok: boolean;
  checks: LineProbeCheck[];
}

const LOGIN_CHANNEL = /^\d{10}$/;
const LIFF = /^(\d{10})-[A-Za-z0-9]{8}$/;

async function checkToken(token: string, options: LineProbeOptions): Promise<LineProbeCheck> {
  if (!token.trim()) return { key: 'messaging_api', ok: false, code: 'missing' };
  const doFetch = options.fetch ?? fetch;
  let status: number;
  try {
    const res = await doFetch(`${options.baseUrl.replace(/\/+$/, '')}/v2/bot/info`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    status = res.status;
    await res.body?.cancel().catch(() => undefined);   // the body is never read: it is LINE's text, not a code
  } catch {
    return { key: 'messaging_api', ok: false, code: 'unreachable' };
  }
  if (status === 200) return { key: 'messaging_api', ok: true, code: 'ok' };
  if (status === 401 || status === 403) return { key: 'messaging_api', ok: false, code: 'token_rejected' };
  if (status >= 500) return { key: 'messaging_api', ok: false, code: 'unreachable' };
  return { key: 'messaging_api', ok: false, code: `http_${status}` };
}

function checkLogin(id: string): LineProbeCheck {
  const v = id.trim();
  if (!v) return { key: 'login', ok: false, code: 'missing' };
  return LOGIN_CHANNEL.test(v) ? { key: 'login', ok: true, code: 'format_ok' } : { key: 'login', ok: false, code: 'invalid_format' };
}

function checkLiff(liffId: string, loginChannelId: string): LineProbeCheck {
  const v = liffId.trim();
  if (!v) return { key: 'liff', ok: false, code: 'missing' };
  const m = LIFF.exec(v);
  if (!m) return { key: 'liff', ok: false, code: 'invalid_format' };
  if (LOGIN_CHANNEL.test(loginChannelId.trim()) && m[1] !== loginChannelId.trim()) return { key: 'liff', ok: false, code: 'not_in_login_channel' };
  return { key: 'liff', ok: true, code: 'format_ok' };
}

export async function probeLine(setup: LineSetup, options: LineProbeOptions): Promise<LineProbeResult> {
  // i18n-ignore configuration error at start up, never shown to anyone
  if (!options.baseUrl) throw new Error('probeLine: a base URL is required');
  // i18n-ignore configuration error at start up, never shown to anyone
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('probeLine: a positive timeout is required');
  const checks = [
    await checkToken(setup.channelAccessToken ?? '', options),
    checkLogin(setup.loginChannelId ?? ''),
    checkLiff(setup.liffId ?? '', setup.loginChannelId ?? ''),
  ];
  return { ok: checks.every((c) => c.ok), checks };
}
