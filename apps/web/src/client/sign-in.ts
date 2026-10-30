import type { LiffPort } from './liff';
import { profileSetupPath, safeNext } from './paths';

// The sign-in moment (design 4.2, 4.3; LINE-01-AC1 to AC3, AUTH-01-AC2, AC12). Inside LINE it
// finishes with no tap; in a browser it shows C1 until the player taps Log in with LINE. The ID
// token goes to the server once and is dropped. Sign in never creates or extends a hold (CC-4).

export type SignInError = 'offline' | 'sign_in_failed' | 'not_found' | 'account_inactive';
export type SignInStep =
  | { kind: 'welcome' }
  | { kind: 'redirecting' }
  | { kind: 'go'; url: string }
  | { kind: 'error'; code: SignInError };

export interface SignInInput {
  liff: LiffPort | null;
  liffId: string | null;
  slug: string;
  next: string;
  /** This page's own address, where LINE comes back to after its login. */
  here: string;
  fetch: typeof fetch;
}

export function errorFor(status: number, code: unknown): SignInError {
  if (code === 'offline' || status === 503) return 'offline';
  if (code === 'account_inactive') return 'account_inactive';
  if (status === 404 || code === 'not_found' || code === 'club_not_available' || code === 'not_a_tester') return 'not_found';
  return 'sign_in_failed';
}

export async function runSignIn(input: SignInInput): Promise<SignInStep> {
  const { liff, liffId, slug } = input;
  const next = safeNext(slug, input.next);
  if (!liffId) return { kind: 'error', code: 'not_found' };
  if (!liff) return { kind: 'error', code: 'offline' };
  try {
    await liff.init(liffId);
  } catch {
    return { kind: 'error', code: 'offline' };
  }
  if (!liff.isLoggedIn()) {
    if (!liff.isInClient()) return { kind: 'welcome' };
    liff.login(input.here);
    return { kind: 'redirecting' };
  }
  return exchange(input, next);
}

/** After Log in with LINE (browser) or at once (in LINE): hand the ID token to the server. */
export async function exchange(input: SignInInput, next = safeNext(input.slug, input.next)): Promise<SignInStep> {
  const idToken = input.liff?.getIDToken() ?? null;
  if (!idToken) return { kind: 'error', code: 'sign_in_failed' };
  let res: Response;
  try {
    res = await input.fetch(`/api/c/${input.slug}/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ idToken }),
    });
  } catch {
    return { kind: 'error', code: 'offline' };
  }
  const body = (await res.json().catch(() => ({}))) as { state?: unknown; code?: unknown };
  if (!res.ok) return { kind: 'error', code: errorFor(res.status, body.code) };
  if (body.state === 'active') return { kind: 'go', url: next };
  if (body.state === 'needs_profile') return { kind: 'go', url: profileSetupPath(input.slug, next) };
  return { kind: 'error', code: 'sign_in_failed' };
}

/** The language keys for each error (P-0327 offline, the rest pending in locales/pending/f02.json). */
export const ERROR_KEY: Record<SignInError, string> = {
  offline: 'P-0327',
  sign_in_failed: 'P-new.signin_failed',
  not_found: 'P-new.page_not_found',
  account_inactive: 'P-new.signin_account_inactive',
};
