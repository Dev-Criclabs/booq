// The connection checks of a club in the support view (D167): the last result of each, and "Test all again". A recheck of what is
// stored is a request the worker answers (the console cannot open a stored secret); the page asks again for the setup until the request
// is gone. Results are codes; the words come from the language files.

import { errorKey, type Failure } from './club';
import { PROBE_KEY } from './connections';

type Fetch = typeof fetch;

export const CHECK_KEY: Record<string, string> = { line_token: 'X-new.health_line_token', beam_keys: 'X-new.health_beam_keys', beam_charge: 'X-new.health_beam_charge' };
/** The words of a stored reason code. The codes of the worker and of the entry checks overlap; an unknown one shows the generic line with the code. */
export const REASON_KEY: Record<string, string> = {
  ...PROBE_KEY,
  token_rejected: 'X-new.probe_token_rejected',
  token_missing: 'X-new.probe_token_missing',
  keys_missing: 'X-new.probe_not_configured',
  key_refused: 'X-new.probe_key_refused',
  unreachable: 'X-new.probe_unreachable',
};
export const reasonKey = (reason: string | null): string => (reason ? REASON_KEY[reason] ?? 'X-new.probe_failed' : 'X-new.health_ok');
/** While a request is open, ask again every few seconds, for at most this long (then the page says it is taking long). */
export const POLL_MS = 3000;
export const GIVE_UP_MS = 120_000;

export async function requestRecheck(f: Fetch, id: string): Promise<{ kind: 'asked' } | Failure> {
  try {
    const res = await f(`/api/clubs/${encodeURIComponent(id)}/support/connection-check`, { method: 'POST' });
    if (res.status === 200) return { kind: 'asked' };
    const json = ((await res.json().catch(() => ({}))) ?? {}) as { code?: string };
    return { kind: 'error', key: errorKey(res.status, json.code), ...(res.status === 401 ? { signIn: true } : {}) };
  } catch {
    return { kind: 'error', key: 'X-new.club_unavailable' };
  }
}
