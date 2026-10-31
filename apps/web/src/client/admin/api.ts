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

export async function call<T>(slug: string, path: string, f: Fetch, init: { method?: string; body?: unknown } = {}): Promise<Outcome<T>> {
  try {
    const res = await f(`/api/c/${encodeURIComponent(slug)}${path}`, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      ...(init.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }),
    });
    if (res.status === 401) return { kind: 'guest' };
    if (res.status === 403) return { kind: 'forbidden' };
    if (res.status === 404) return { kind: 'not_found' };
    const json = (await res.json().catch(() => null)) as (T & { code?: string; params?: Record<string, unknown> }) | null;
    if (res.status >= 500 || json === null) return { kind: 'offline' };
    if (res.status >= 400) return { kind: 'refused', status: res.status, code: typeof json.code === 'string' ? json.code : 'unknown', ...(json.params ? { params: json.params } : {}) };
    return { kind: 'ok', body: json };
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
