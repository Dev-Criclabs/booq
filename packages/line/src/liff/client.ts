import { parsePreferredLanguage, type Lang } from '../../../auth/src/liff/language';
import { safeReturnPath } from '../../../auth/src/liff/return-path';

// LIFF client module (F02-T18; LINE-01-AC1 to AC3, AC11; AUTH-01-AC2, AC12; design 4.2). It touches
// neither the DOM nor the LIFF SDK directly: the SDK object and `fetch` are passed in, so it runs
// in a test with a stub. Inside LINE it signs in with no tap; in a browser it reports `needs_login`
// so the screen shows Log in with LINE, and one tap calls login() with a return address inside the
// same club. The ID token goes only in the body of POST /auth/session, is never put in a URL, and is
// not kept here. Any failure to reach the club, LIFF or the server is `offline` (show P-0327, P-0328).

/** The part of the LIFF SDK this module uses. */
export interface LiffLike {
  init(config: { liffId: string }): Promise<void>;
  isInClient(): boolean;
  isLoggedIn(): boolean;
  login(options: { redirectUri: string }): void;
  getIDToken(): string | null;
  getLanguage(): string;
}

export type SessionOutcome =
  | { state: 'active' }
  | { state: 'pending_profile' }
  | { state: 'needs_login' }
  | { state: 'offline' }
  | { state: 'refused'; code: string };

export interface LiffClientOptions {
  liff: LiffLike;
  fetch: typeof fetch;
  slug: string;
  /** The page origin, for the return address handed to LINE Login (https://app.example). */
  origin: string;
  /** Invite link token, when the page was opened from one. Sent in the body, never in a URL. */
  invite?: string;
}

interface ClubConfig {
  liffId: string;
}

export function createLiffClient(options: LiffClientOptions) {
  const { liff, slug } = options;
  const api = `/api/c/${slug}`;
  let initialised = false;

  async function request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: any } | 'offline'> {
    try {
      const res = await options.fetch(`${api}${path}`, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
        credentials: 'same-origin',
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    } catch {
      return 'offline';
    }
  }

  async function ensureInit(): Promise<'ok' | 'offline' | { refused: string }> {
    if (initialised) return 'ok';
    const cfg = await request('GET', '/public/config');
    if (cfg === 'offline' || cfg.status >= 500) return 'offline';
    if (cfg.status !== 200 || typeof (cfg.body as ClubConfig).liffId !== 'string') return { refused: cfg.body?.code ?? 'not_found' };
    try {
      await liff.init({ liffId: (cfg.body as ClubConfig).liffId });
    } catch {
      return 'offline'; // LIFF or LINE Login unreachable (LINE-01-AC11)
    }
    initialised = true;
    return 'ok';
  }

  async function exchange(): Promise<SessionOutcome> {
    const idToken = liff.getIDToken();
    if (!idToken) return { state: 'refused', code: 'no_token' };
    const res = await request('POST', '/auth/session', { idToken, ...(options.invite ? { invite: options.invite } : {}) });
    if (res === 'offline' || res.status === 503) return { state: 'offline' };
    if (res.status === 200) return { state: res.body.state === 'pending_profile' ? 'pending_profile' : 'active' };
    return { state: 'refused', code: String(res.body?.code ?? 'unknown') };
  }

  async function ensureSession(): Promise<SessionOutcome> {
    const ready = await ensureInit();
    if (ready === 'offline') return { state: 'offline' };
    if (ready !== 'ok') return { state: 'refused', code: ready.refused };
    // Inside LINE the login happened during liff.init(); in a browser the person must tap first.
    if (!liff.isInClient() && !liff.isLoggedIn()) return { state: 'needs_login' };
    return exchange();
  }

  return {
    ensureSession,

    /** One tap on Log in with LINE (browser only). The return address is inside this club or the club home. */
    login(returnPath?: string): void {
      const path = safeReturnPath(slug, returnPath) ?? `/c/${slug}`;
      liff.login({ redirectUri: `${options.origin.replace(/\/+$/, '')}${path}` });
    },

    /** The server session was lost (a request came back sign_in_required): inside LINE, sign in again silently with a fresh token. */
    async reestablish(): Promise<SessionOutcome> {
      if (!liff.isInClient() && !liff.isLoggedIn()) return { state: 'needs_login' };
      return exchange();
    },

    /** The LINE app language (or browser language) as th or en; null when it is neither, so the club default applies. */
    preferredLanguage(): Lang | null {
      return parsePreferredLanguage(liff.getLanguage());
    },
  };
}
