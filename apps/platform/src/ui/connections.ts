// The LINE and payment connections in the wizard (steps 4 and 5) and the support view (P3b), apart from the screen so it can be tested
// without a browser (D167). A save is tested first with the values just typed: a failed test saves nothing unless the staff member chooses
// "save anyway". Secrets are only ever typed and sent; nothing here can read one back (the console cannot, SR-03).

import { errorKey, type Failure } from './club';

type Fetch = typeof fetch;

export type ConnectionKind = 'line' | 'payments';
export interface FieldDef { name: string; label: string; secret?: boolean; optional?: boolean; testNeeds?: boolean }

/** LINE: ids in the clear, three secrets. The token is needed for the test. Labels are keys: board keys where the board has the field. */
export const LINE_FIELDS: readonly FieldDef[] = [
  { name: 'oa_basic_id', label: 'X-0103' },
  { name: 'messaging_channel_id', label: 'X-new.conn_messaging_channel' },
  { name: 'login_channel_id', label: 'X-0105' },
  { name: 'liff_id', label: 'X-0107' },
  { name: 'line_channel_token', label: 'X-0110', secret: true, testNeeds: true },
  { name: 'line_channel_secret', label: 'X-new.conn_channel_secret', secret: true },
  { name: 'line_login_secret', label: 'X-new.conn_login_secret', secret: true },
];
export type Mode = 'test' | 'live';
export const MODES: readonly Mode[] = ['test', 'live'];
export const beamFields = (mode: Mode): readonly FieldDef[] => [
  { name: `merchant_id_${mode}`, label: 'X-0123', testNeeds: true },
  { name: `beam_api_key_${mode}`, label: 'X-0127', secret: true, testNeeds: true },
  { name: `beam_hmac_key_${mode}`, label: 'X-new.conn_hmac_key', secret: true },
];

export type Values = Record<string, string>;

/** Only filled boxes are sent (the API refuses an empty value). A test needs the token, or the merchant id and key of the mode. */
export function buildBody(kind: ConnectionKind, values: Values, opts: { mode?: Mode; option?: 'beam' | 'slip' | ''; planKind?: string; limit?: string }): { ok: true; body: Record<string, unknown> } | { ok: false; key: string } {
  const defs = kind === 'line' ? LINE_FIELDS : beamFields(opts.mode ?? 'test');
  const body: Record<string, unknown> = {};
  for (const d of defs) {
    const v = (values[d.name] ?? '').trim();
    if (v !== '') body[d.name] = v;
  }
  if (kind === 'line') {
    if (opts.planKind) body['line_plan_kind'] = opts.planKind;
    const limit = (opts.limit ?? '').trim();
    if (limit !== '') {
      if (!/^[1-9]\d*$/.test(limit)) return { ok: false, key: 'X-new.conn_limit_bad' };
      body['plan_message_limit'] = Number(limit);
    }
  } else {
    if (opts.option) body['payment_option'] = opts.option;
    body['test_mode'] = opts.mode ?? 'test';
  }
  const need = defs.filter((d) => d.testNeeds && !(d.name in body));
  if (need.length > 0) return { ok: false, key: 'X-new.conn_test_needs' };
  return { ok: true, body };
}

/** The text of each failure code of the checks; an unknown code shows the generic line with the code itself. */
export const PROBE_KEY: Record<string, string> = {
  messaging_api_token_rejected: 'X-new.probe_token_rejected',
  messaging_api_unreachable: 'X-new.probe_unreachable',
  messaging_api_missing: 'X-new.probe_token_missing',
  login_invalid_format: 'X-new.probe_login_format',
  liff_invalid_format: 'X-new.probe_liff_format',
  liff_not_in_login_channel: 'X-new.probe_liff_channel',
  oa_mismatch: 'X-new.probe_oa_mismatch',
  key_refused: 'X-new.probe_key_refused',
  not_configured: 'X-new.probe_not_configured',
  unreachable: 'X-new.probe_unreachable',
  unexpected: 'X-new.probe_unexpected',
  hmac_key_invalid: 'X-new.probe_hmac_invalid',
  merchant_mismatch: 'X-new.probe_merchant_mismatch',
};
export const probeKey = (code: string): string => PROBE_KEY[code] ?? 'X-new.probe_failed';

export type SendOutcome = { kind: 'saved'; tested: 'pass' | 'fail' | null } | { kind: 'test_failed'; code: string } | Failure;

export async function sendConnection(f: Fetch, id: string, kind: ConnectionKind, body: Record<string, unknown>, opts: { saveAnyway?: boolean } = {}): Promise<SendOutcome> {
  const section = kind === 'line' ? 'line' : 'payments';
  try {
    const res = await f(`/api/clubs/${encodeURIComponent(id)}/support/setup/${section}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, test: true, ...(opts.saveAnyway ? { save_anyway: true } : {}) }),
    });
    const json = ((await res.json().catch(() => ({}))) ?? {}) as { code?: string; connectionTest?: { result?: string; code?: string } };
    if (res.status === 200) return { kind: 'saved', tested: json.connectionTest?.result === 'pass' ? 'pass' : json.connectionTest?.result === 'fail' ? 'fail' : null };
    if (json.code === 'connection_test_failed') return { kind: 'test_failed', code: json.connectionTest?.code ?? 'unexpected' };
    return { kind: 'error', key: errorKey(res.status, json.code), ...(json.code === 'step_up_required' ? { stepUp: true } : {}), ...(res.status === 401 ? { signIn: true } : {}) };
  } catch {
    return { kind: 'error', key: 'X-new.club_unavailable' };
  }
}
