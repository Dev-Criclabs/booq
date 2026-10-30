// The enrolment page's logic (F01-T17c), apart from the screen so it can be tested without a browser. It talks to the
// console's public enrolment routes with fetch and turns every answer into a result the screen shows by key. The link's
// token is read from the address fragment (never sent to a server) and the fragment is cleared once it is read. Nothing here
// keeps the password; the setup key goes to the screen only to be shown.

export type Step = 'checking' | 'invalid' | 'password' | 'code' | 'done' | 'unavailable';
type Fetch = typeof fetch;

export function tokenFromHash(hash: string): string | null {
  const t = hash.replace(/^#/, '');
  return /^[A-Za-z0-9_-]{20,200}$/.test(t) ? t : null;
}

/** The setup key in groups of four, to read it off a screen and type it into an app. */
export function groupSecret(secret: string): string {
  return secret.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
}

async function post(f: Fetch, path: string, body: unknown): Promise<{ status: number; json: { code?: string } & Record<string, unknown> } | null> {
  try {
    const res = await f(`/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, json: ((await res.json().catch(() => ({}))) ?? {}) as { code?: string } & Record<string, unknown> };
  } catch {
    return null;
  }
}

export type CheckOutcome = { kind: 'ok'; displayName: string } | { kind: 'invalid' } | { kind: 'unavailable' };
export async function checkLink(f: Fetch, token: string): Promise<CheckOutcome> {
  const r = await post(f, '/enrol/check', { token });
  if (!r) return { kind: 'unavailable' };
  if (r.status === 200 && typeof r.json['displayName'] === 'string') return { kind: 'ok', displayName: r.json['displayName'] };
  return r.status === 404 ? { kind: 'invalid' } : { kind: 'unavailable' };
}

export type StartOutcome = { kind: 'ok'; enrolmentId: string; secret: string; uri: string } | { kind: 'error'; key: string; link?: boolean };
export async function startEnrolment(f: Fetch, token: string, password: string): Promise<StartOutcome> {
  const r = await post(f, '/enrol/start', { token, password });
  if (!r) return { kind: 'error', key: 'X-new.enrol_unavailable' };
  const { enrolmentId, secret, uri } = r.json;
  if (r.status === 200 && typeof enrolmentId === 'string' && typeof secret === 'string' && typeof uri === 'string') return { kind: 'ok', enrolmentId, secret, uri };
  if (r.status === 404) return { kind: 'error', key: 'X-new.enrol_invalid_link', link: true };
  if (r.status === 400 && r.json.code === 'weak_password') return { kind: 'error', key: 'X-new.enrol_weak_password' };
  return { kind: 'error', key: r.status === 429 || r.status === 503 || r.status >= 500 ? 'X-new.enrol_unavailable' : 'X-new.enrol_weak_password' };
}

export type FinishOutcome = { kind: 'done' } | { kind: 'error'; key: string; restart?: boolean };
export async function finishEnrolment(f: Fetch, enrolmentId: string, code: string): Promise<FinishOutcome> {
  const r = await post(f, '/enrol/finish', { enrolmentId, code: code.replace(/\s+/g, '') });
  if (!r) return { kind: 'error', key: 'X-new.enrol_unavailable' };
  if (r.status === 200) return { kind: 'done' };
  if (r.json.code === 'bad_code') return { kind: 'error', key: 'X-new.enrol_bad_code' };
  if (r.json.code === 'too_many_attempts') return { kind: 'error', key: 'X-new.enrol_too_many_attempts', restart: true };
  if (r.json.code === 'invalid_enrolment') return { kind: 'error', key: 'X-new.enrol_invalid_enrolment', restart: true };
  return { kind: 'error', key: 'X-new.enrol_unavailable' };
}
