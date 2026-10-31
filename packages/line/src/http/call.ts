// One HTTP call to LINE with a timeout, for the server side clients (rich menu, usage). The answer is the status and
// the parsed JSON body (null when there is none or it is not JSON); a network failure or a timeout is null. LINE's
// own text never leaves here as a result: callers turn a status into a code with failureCode.
export type LineFetch = typeof fetch;

export async function lineCall(doFetch: LineFetch, url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; body: unknown } | null> {
  try {
    const res = await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text().catch(() => '');
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch {
    return null;
  }
}

/** unreachable (network or timeout), token_rejected (401 or 403) or http_NNN. */
export function failureCode(r: { status: number } | null): { ok: false; code: string } {
  if (r === null) return { ok: false, code: 'unreachable' };
  if (r.status === 401 || r.status === 403) return { ok: false, code: 'token_rejected' };
  return { ok: false, code: `http_${r.status}` };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
