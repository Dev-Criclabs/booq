import type { SupabaseIdentity } from './handler';

// The identity provider's sign-in API (Supabase Auth, GoTrue), over fetch, for BOOQ staff sign-in (D148, D160). This is
// the only file that sends the provider's anon (publishable) key. Sign-in is two calls: the password grant gives a
// first-step token and the person's enrolled authenticator factor; the code is then checked against that factor with
// that token. The token never leaves the servers: apps/platform keeps it sealed under the challenge id and sends it back
// with the code. The key, the token, the password and the code never appear in a thrown error.

export interface SupabaseIdentityOptions {
  /** The project's address, for example https://abcd.supabase.co (no trailing slash needed). */
  url: string;
  anonKey: string;
  fetch?: typeof fetch;
}

interface State {
  u: string; // auth user id
  t: string; // first-step access token
  f: string; // the verified authenticator factor
}

const encode = (s: State) => Buffer.from(JSON.stringify(s), 'utf8').toString('base64url');
function decode(state: string): State | null {
  try {
    const s = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as Partial<State>;
    return typeof s.u === 'string' && typeof s.t === 'string' && typeof s.f === 'string' ? { u: s.u, t: s.t, f: s.f } : null;
  } catch {
    return null;
  }
}

export function createSupabaseIdentity(options: SupabaseIdentityOptions): SupabaseIdentity {
  const base = options.url.replace(/\/+$/, '');
  const doFetch = options.fetch ?? fetch;
  async function call(method: string, path: string, init: { body?: unknown; bearer?: string } = {}): Promise<{ status: number; json: unknown }> {
    const res = await doFetch(`${base}/auth/v1${path}`, {
      method,
      headers: {
        apikey: options.anonKey,
        ...(init.bearer ? { authorization: `Bearer ${init.bearer}` } : {}),
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text === '' ? null : JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }

  return {
    async passwordGrant(email, password) {
      const r = await call('POST', '/token?grant_type=password', { body: { email, password } });
      if (r.status === 400 || r.status === 401 || r.status === 422) return null; // wrong email or password
      if (r.status !== 200) throw new Error(`identity provider answered ${r.status} for the password grant`);
      const j = r.json as { access_token?: unknown; user?: { id?: unknown; factors?: Array<{ id?: unknown; factor_type?: unknown; status?: unknown }> } } | null;
      const userId = j?.user?.id;
      if (typeof j?.access_token !== 'string' || typeof userId !== 'string') throw new Error('identity provider gave no session');
      const factor = (j.user?.factors ?? []).find((f) => f.factor_type === 'totp' && f.status === 'verified' && typeof f.id === 'string');
      // A person with no enrolled authenticator has no second step to take: they sign in no further.
      return { authUserId: userId, ...(factor ? { state: encode({ u: userId, t: j.access_token, f: factor.id as string }) } : {}) };
    },
    async startEnrolment(email, password) {
      const r = await call('POST', '/token?grant_type=password', { body: { email, password } });
      if (r.status === 400 || r.status === 401 || r.status === 422) return null;
      if (r.status !== 200) throw new Error(`identity provider answered ${r.status} for the password grant`);
      const j = r.json as { access_token?: unknown; user?: { id?: unknown } } | null;
      const userId = j?.user?.id;
      if (typeof j?.access_token !== 'string' || typeof userId !== 'string') throw new Error('identity provider gave no session');
      const f = await call('POST', '/factors', { bearer: j.access_token, body: { factor_type: 'totp', friendly_name: 'BOOQ console', issuer: 'BOOQ' } });
      const factor = f.json as { id?: unknown; totp?: { secret?: unknown; uri?: unknown } } | null;
      if (f.status !== 200 || typeof factor?.id !== 'string' || typeof factor.totp?.secret !== 'string' || typeof factor.totp.uri !== 'string') {
        throw new Error(`identity provider answered ${f.status} for the factor enrolment`);
      }
      return { authUserId: userId, state: encode({ u: userId, t: j.access_token, f: factor.id }), secret: factor.totp.secret, uri: factor.totp.uri };
    },
    async verifyCode(authUserId, state, code) {
      const s = decode(state);
      if (!s || s.u !== authUserId) return false;
      const challenge = await call('POST', `/factors/${encodeURIComponent(s.f)}/challenge`, { bearer: s.t, body: {} });
      if (challenge.status === 400 || challenge.status === 401 || challenge.status === 403 || challenge.status === 422) return false;
      const challengeId = (challenge.json as { id?: unknown } | null)?.id;
      if (challenge.status !== 200 || typeof challengeId !== 'string') throw new Error(`identity provider answered ${challenge.status} for the factor challenge`);
      const verified = await call('POST', `/factors/${encodeURIComponent(s.f)}/verify`, { bearer: s.t, body: { challenge_id: challengeId, code } });
      if (verified.status === 400 || verified.status === 401 || verified.status === 403 || verified.status === 422) return false;
      if (verified.status !== 200) throw new Error(`identity provider answered ${verified.status} for the factor verify`);
      // The provider now holds a second session we never use: end it so nothing is left open there.
      const token = (verified.json as { access_token?: unknown } | null)?.access_token;
      if (typeof token === 'string') await call('POST', '/logout', { bearer: token }).catch(() => undefined);
      return true;
    },
  };
}
