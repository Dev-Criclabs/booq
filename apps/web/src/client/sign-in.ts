import { createLiffClient, type SessionOutcome } from '@booq/line';
import type { LiffPort } from './liff';
import { profileSetupPath, safeNext, signInPath } from './paths';

// The sign-in moment (design 4.2, 4.3; LINE-01-AC1 to AC3, AUTH-01-AC2, AC12) on top of F02-T18's
// LIFF client: inside LINE it finishes with no tap; in a browser it shows C1 until the player taps
// Log in with LINE. Sign in never creates or extends a hold (CC-4). This file maps the client's
// outcomes to what the screen does, and the refusals to language keys.

export type SignInError = 'offline' | 'sign_in_failed' | 'not_found' | 'account_inactive';
export type SignInStep = { kind: 'welcome' } | { kind: 'go'; url: string } | { kind: 'error'; code: SignInError };

export function errorFor(code: string): SignInError {
  if (code === 'offline') return 'offline';
  if (code === 'account_inactive') return 'account_inactive';
  if (code === 'not_found' || code === 'club_not_available' || code === 'not_a_tester') return 'not_found';
  return 'sign_in_failed';
}

export function stepFor(outcome: SessionOutcome, slug: string, rawNext: string): SignInStep {
  const next = safeNext(slug, rawNext);
  switch (outcome.state) {
    case 'active':
      return { kind: 'go', url: next };
    case 'pending_profile':
      return { kind: 'go', url: profileSetupPath(slug, next) };
    case 'needs_login':
      return { kind: 'welcome' };
    case 'offline':
      return { kind: 'error', code: 'offline' };
    case 'refused':
      return { kind: 'error', code: errorFor(outcome.code) };
  }
}

export interface SignInDeps {
  liff: LiffPort;
  slug: string;
  next: string;
  origin: string;
  fetch: typeof fetch;
}

export function signInFlow(d: SignInDeps) {
  const client = createLiffClient({ liff: d.liff, fetch: d.fetch, slug: d.slug, origin: d.origin });
  return {
    /** On load, and again after LINE's login comes back. */
    run: async (): Promise<SignInStep> => stepFor(await client.ensureSession(), d.slug, d.next),
    /** Log in with LINE: LINE comes back to this sign-in page, which then finishes the exchange. */
    login: () => client.login(signInPath(d.slug, d.next)),
  };
}

/** The language keys for each error (P-0327 offline, the rest pending in locales/pending/f02.json). */
export const ERROR_KEY: Record<SignInError, string> = {
  offline: 'P-0327',
  sign_in_failed: 'P-new.signin_failed',
  not_found: 'P-new.page_not_found',
  account_inactive: 'P-new.signin_account_inactive',
};
