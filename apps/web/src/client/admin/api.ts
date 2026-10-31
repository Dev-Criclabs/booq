// One way for the console's pages to call the club API and read the answer as an outcome, never as text (CC-5). The answers carry typed
// codes; a page chooses its words by outcome and code. A guest is sent to sign in by the shell, so a page only has to stop.

type Fetch = typeof fetch;

export type Outcome<T> =
  | { kind: 'ok'; body: T }
  | { kind: 'guest' }
  | { kind: 'forbidden' }
  | { kind: 'not_found' }
  /** 400 to 499 others and 409: the typed code the route answered. */
  | { kind: 'refused'; status: number; code: string; params?: Record<string, unknown> }
  | { kind: 'offline' };

export async function call<T>(slug: string, path: string, f: Fetch, init: { method?: string; body?: unknown; key?: string } = {}): Promise<Outcome<T>> {
  try {
    const res = await f(`/api/c/${encodeURIComponent(slug)}${path}`, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      ...(init.body === undefined && init.key === undefined ? {} : { headers: { ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...(init.key === undefined ? {} : { 'idempotency-key': init.key }) }, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) }),
    });
    if (res.status === 401) return { kind: 'guest' };
    if (res.status === 403) return { kind: 'forbidden' };
    if (res.status === 404) return { kind: 'not_found' };
    // A body that is not JSON is a fault; a JSON `null` is an answer (an empty list the database gave as null).
    const json = (await res.json().catch(() => undefined)) as (T & { code?: string; params?: Record<string, unknown> }) | null | undefined;
    // A 5xx with a typed code is a refusal the page can name (BOOQ has not set a value, 503); one without is a fault.
    const typed = json !== null && json !== undefined && typeof (json as { code?: unknown }).code === 'string';
    if (json === undefined || (res.status >= 500 && !typed)) return { kind: 'offline' };
    if (res.status >= 400) {
      const e: { code?: string; params?: Record<string, unknown> } = json ?? {};
      return { kind: 'refused', status: res.status, code: typeof e.code === 'string' ? e.code : 'unknown', ...(e.params ? { params: e.params } : {}) };
    }
    return { kind: 'ok', body: json as T };
  } catch {
    return { kind: 'offline' };
  }
}

/** `{amount}`: whole baht as ฿500, with satang only when there are some (฿500.50). Money is integer satang everywhere (CLAUDE.md). */
export function formatBaht(satang: number): string {
  const sign = satang < 0 ? '-' : '';
  const abs = Math.abs(satang);
  const baht = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${sign}฿${baht.toLocaleString('en-US')}${rest === 0 ? '' : `.${String(rest).padStart(2, '0')}`}`;
}

/** A fresh Idempotency-Key for one change the staff made: the same key repeats the same request safely (a double tap, a retry after a lost answer). */
export const newKey = (): string => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
