// The sign-in and step-up pages' logic (F01-T17, D161), apart from the screens so it can be tested without a browser.
// Sign-in is two steps: email and password give a challenge id; the code from the authenticator app, with that id, gives the
// session cookie (set by the server, HttpOnly: the page never sees it). A step-up repeats the password and the code for an
// open session. Every answer becomes a result the screen shows by key; nothing here keeps a password or a code.

type Fetch = typeof fetch;

/** Where to go after sign-in: an address on this site only (no other site, no protocol-relative address). */
export function safeNext(raw: string | null | undefined, fallback = '/staff'): string {
  if (!raw || !/^\/[A-Za-z0-9/_-]*$/.test(raw) || raw.startsWith('//')) return fallback;
  return raw;
}

async function post(f: Fetch, path: string, body: unknown): Promise<{ status: number; json: { code?: string } } | null> {
  try {
    const res = await f(`/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, json: ((await res.json().catch(() => ({}))) ?? {}) as { code?: string } };
  } catch {
    return null;
  }
}

/** The text for a refusal of the sign-in routes. A wrong email and a wrong password are one answer (no one learns which exist). */
function refusal(r: { status: number; json: { code?: string } } | null): string {
  if (!r) return 'X-new.signin_unavailable';
  if (r.status === 429) return 'X-new.signin_rate_limited';
  if (r.status === 423 || r.json.code === 'locked') return 'X-new.signin_locked';
  if (r.status === 503 || r.json.code === 'identity_unavailable') return 'X-new.signin_unavailable';
  if (r.json.code === 'invalid_credentials') return 'X-new.signin_invalid_credentials';
  if (r.json.code === 'bad_code') return 'X-new.enrol_bad_code';
  if (r.json.code === 'challenge_invalid') return 'X-new.signin_challenge_invalid';
  return 'X-new.signin_unavailable';
}

export type FirstStep = { kind: 'challenge'; challengeId: string } | { kind: 'error'; key: string };
export async function signInWithPassword(f: Fetch, email: string, password: string): Promise<FirstStep> {
  const r = await post(f, '/auth/sign-in', { email: email.trim(), password });
  if (r?.status === 200 && typeof (r.json as { challengeId?: unknown }).challengeId === 'string') return { kind: 'challenge', challengeId: (r.json as { challengeId: string }).challengeId };
  return { kind: 'error', key: refusal(r) };
}

export type SecondStep = { kind: 'done' } | { kind: 'error'; key: string; restart?: boolean };
export async function signInWithCode(f: Fetch, challengeId: string, code: string): Promise<SecondStep> {
  const r = await post(f, '/auth/second-factor', { challengeId, code: code.replace(/\s+/g, '') });
  if (r?.status === 200) return { kind: 'done' };
  // An expired or invented challenge cannot be retried with a new code: back to the password step.
  return { kind: 'error', key: refusal(r), restart: r?.json.code === 'challenge_invalid' || r?.json.code === 'locked' };
}

export type StepUp = { kind: 'done' } | { kind: 'error'; key: string; signedOut?: boolean };
export async function stepUp(f: Fetch, password: string, code: string): Promise<StepUp> {
  const r = await post(f, '/auth/step-up', { password, code: code.replace(/\s+/g, '') });
  if (r?.status === 200) return { kind: 'done' };
  if (!r) return { kind: 'error', key: 'X-new.signin_unavailable' };
  if (r.status === 423 || r.json.code === 'locked') return { kind: 'error', key: 'X-new.signin_locked' };
  if (r.status === 503) return { kind: 'error', key: 'X-new.signin_unavailable' };
  if (r.json.code === 'session_invalid' || r.json.code === 'unauthenticated' || (r.status === 401 && r.json.code !== 'bad_code')) return { kind: 'error', key: 'X-new.stepup_session_ended', signedOut: true };
  return { kind: 'error', key: 'X-new.stepup_failed' }; // a wrong password and a wrong code are one answer
}

export async function signOut(f: Fetch): Promise<void> {
  await post(f, '/auth/sign-out', {});
}
