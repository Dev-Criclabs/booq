import { signInternalCall } from '@booq/auth';
import { IdentityUnavailable } from '../auth/adapters';
import type { IdentityProvider } from '../auth/sign-in';

// The console's identity provider (D148, D160, D161): the password and the authenticator code are checked by
// apps/staff-invite, which holds the provider's keys; this app holds only the shared signing secret and that app's
// address. Each call is signed. "Not the right credentials" is an answer (null or false); anything else, such as the
// other app being unreachable, refusing the signature or failing at the provider, is IdentityUnavailable, which the
// sign-in routes show as 503 identity_unavailable, so an outage is never taken for a wrong password.

export function createStaffIdentityClient(deps: { url: string; signingSecret: string; fetch?: typeof fetch; now(): Date }): IdentityProvider {
  const base = deps.url.replace(/\/+$/, '');
  const doFetch = deps.fetch ?? fetch;

  async function post(path: string, body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
    const raw = JSON.stringify(body);
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', ...signInternalCall(deps.signingSecret, deps.now(), raw) } });
    } catch {
      throw new IdentityUnavailable();
    }
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: res.status, json: json && typeof json === 'object' ? json : {} };
  }

  function person(r: { status: number; json: Record<string, unknown> }, wrong: string): { authUserId: string; state?: string } | null {
    if (r.status === 401 && r.json['code'] === wrong) return null;
    if (r.status !== 200 || typeof r.json['authUserId'] !== 'string') throw new IdentityUnavailable();
    return { authUserId: r.json['authUserId'], ...(typeof r.json['state'] === 'string' ? { state: r.json['state'] } : {}) };
  }

  return {
    async verifyPassword(email, password) {
      return person(await post('/identity/password', { email, password }), 'invalid_credentials');
    },
    async verifyPasswordFor(authUserId, password) {
      return person(await post('/identity/password-for', { authUserId, password }), 'invalid_credentials');
    },
    async verifyTotp(authUserId, code, state) {
      if (state === undefined) return false; // no first step was taken for this code: it cannot be checked
      const r = await post('/identity/totp', { authUserId, state, code });
      if (r.status === 200 && r.json['ok'] === true) return true;
      if (r.status === 401 && r.json['code'] === 'bad_code') return false;
      throw new IdentityUnavailable();
    },
  };
}
