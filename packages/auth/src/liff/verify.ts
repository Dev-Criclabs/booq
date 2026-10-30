// LINE ID token verification (F02-T04; LINE-01-AC4, AC11; CC-2; design 4.4). One interface,
// a real client that calls LINE's verify endpoint and a fake for tests of the routes above it.
// The result holds codes and the two fields we keep (LINE user id, display name). The token,
// the raw response and `picture` are never returned, stored or logged (AC13, A-3).

export type VerifyFailure = 'wrong_audience' | 'expired' | 'invalid_token' | 'offline';
export type VerifyResult = { ok: true; lineUserId: string; displayName: string | null } | { ok: false; code: VerifyFailure };

export interface VerifyRequest {
  idToken: string;
  /** The Login channel id of the club in the URL (`line_connection.login_channel_id`). */
  loginChannelId: string;
}
export interface LineVerifier {
  verifyIdToken(req: VerifyRequest): Promise<VerifyResult>;
}

export interface LineVerifierOptions {
  /** `https://api.line.me` in production; the fake server's url in tests. */
  baseUrl: string;
  now(): Date;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const LINE_ISSUER = 'https://access.line.me';
const fail = (code: VerifyFailure): VerifyResult => ({ ok: false, code });

export function createLineVerifier(opts: LineVerifierOptions): LineVerifier {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5000;
  return {
    async verifyIdToken({ idToken, loginChannelId }) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      let res: Response;
      let text: string;
      try {
        res = await doFetch(`${opts.baseUrl}/oauth2/v2.1/verify`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ id_token: idToken, client_id: loginChannelId }).toString(),
          signal: ctl.signal,
        });
        text = await res.text();
      } catch {
        return fail('offline'); // unreachable or timed out: nothing is created (AC11)
      } finally {
        clearTimeout(timer);
      }
      if (res.status >= 500) return fail('offline');
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return fail('invalid_token');
      }
      if (res.status !== 200) {
        const why = String(body.error_description ?? '');
        if (/audience/i.test(why)) return fail('wrong_audience');
        if (/expired/i.test(why)) return fail('expired');
        return fail('invalid_token');
      }
      // Trust nothing in a 200 without checking it ourselves (design 4.4).
      if (body.aud !== loginChannelId) return fail('wrong_audience');
      if (body.iss !== LINE_ISSUER) return fail('invalid_token');
      if (typeof body.exp !== 'number' || body.exp * 1000 <= opts.now().getTime()) return fail('expired');
      if (typeof body.sub !== 'string' || body.sub === '') return fail('invalid_token');
      return { ok: true, lineUserId: body.sub, displayName: typeof body.name === 'string' && body.name !== '' ? body.name : null };
    },
  };
}

export type FakeVerifierMode = 'valid' | 'wrong_audience' | 'expired' | 'bad_signature' | 'unreachable';

/** For tests of routes that need a verifier and not LINE's wire format. */
export function createFakeLineVerifier(mode: FakeVerifierMode, user: { lineUserId: string; displayName: string | null } = { lineUserId: 'Ufake', displayName: 'Fake' }): LineVerifier {
  return {
    async verifyIdToken() {
      switch (mode) {
        case 'valid':
          return { ok: true, ...user };
        case 'wrong_audience':
          return fail('wrong_audience');
        case 'expired':
          return fail('expired');
        case 'bad_signature':
          return fail('invalid_token');
        case 'unreachable':
          return fail('offline');
      }
    },
  };
}
