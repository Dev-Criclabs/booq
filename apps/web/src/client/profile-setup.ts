import type { Lang } from './i18n';
import { safeNext, signInPath } from './paths';

// C2 submit (design 4.3; AUTH-02-AC1 to AC6). Only full name, phone and consent are asked. Without
// consent nothing is sent, so nothing is created (AC3). Field refusals come back as codes, which map
// to the pending P keys; the player continues to where they were going with the choice kept (AC6).

export type Field = 'fullName' | 'phone' | 'consent';
export type FieldErrors = Partial<Record<Field, string>>;
export type ProfileOutcome =
  | { kind: 'go'; url: string }
  | { kind: 'fields'; errors: FieldErrors }
  | { kind: 'error'; key: string };

const FIELD_KEY: Record<string, string> = {
  name_missing: 'P-new.profile_name_missing',
  name_too_long: 'P-new.profile_name_too_long',
  name_invalid: 'P-new.profile_name_invalid',
  phone_missing: 'P-new.profile_phone_missing',
  phone_invalid: 'P-new.profile_phone_invalid',
};
const CONSENT_KEY = 'P-new.profile_consent_required';

export interface ProfileInput {
  slug: string;
  next: string;
  fullName: string;
  phone: string;
  consent: boolean;
  language: Lang;
  noticeVersion(): Promise<string>;
  fetch: typeof fetch;
}

/** What is missing before anything is sent: the server checks again (AC2). */
export function missing(input: Pick<ProfileInput, 'fullName' | 'phone' | 'consent'>): FieldErrors {
  const e: FieldErrors = {};
  if (input.fullName.trim() === '') e.fullName = FIELD_KEY['name_missing']!;
  if (input.phone.trim() === '') e.phone = FIELD_KEY['phone_missing']!;
  if (!input.consent) e.consent = CONSENT_KEY;
  return e;
}

export async function submitProfile(input: ProfileInput): Promise<ProfileOutcome> {
  const next = safeNext(input.slug, input.next);
  const before = missing(input);
  if (Object.keys(before).length) return { kind: 'fields', errors: before };
  let res: Response;
  try {
    res = await input.fetch(`/api/c/${input.slug}/auth/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ fullName: input.fullName, phone: input.phone, consent: true, noticeVersion: await input.noticeVersion(), language: input.language }),
    });
  } catch {
    return { kind: 'error', key: 'P-0327' };
  }
  const body = (await res.json().catch(() => ({}))) as { state?: unknown; code?: unknown; fields?: Record<string, unknown> };
  if (res.ok && body.state === 'active') return { kind: 'go', url: next };
  if (body.code === 'invalid' && body.fields) {
    const errors: FieldErrors = {};
    for (const f of ['fullName', 'phone'] as const) {
      const code = body.fields[f];
      if (typeof code === 'string') errors[f] = FIELD_KEY[code] ?? FIELD_KEY[f === 'fullName' ? 'name_invalid' : 'phone_invalid']!;
    }
    return { kind: 'fields', errors };
  }
  if (body.code === 'consent_required') return { kind: 'fields', errors: { consent: CONSENT_KEY } };
  // The pending sign-up ran out (30 minutes) or was never there: sign in again, same choice.
  if (res.status === 401) return { kind: 'go', url: signInPath(input.slug, next) };
  // Already a player (a second tab finished first): carry on.
  if (body.code === 'not_pending' || body.code === 'already_registered') return { kind: 'go', url: next };
  if (res.status === 404) return { kind: 'error', key: 'P-new.page_not_found' };
  if (res.status === 503 || res.status >= 500) return { kind: 'error', key: 'P-0327' };
  return { kind: 'error', key: 'P-new.signin_failed' };
}

/** The button reads Continue to payment on the way to checkout, otherwise Continue. */
export function continueKey(next: string): 'P-0016' | 'P-0057' {
  return /\/checkout(\/|\?|$)/.test(next.split('#')[0]!) ? 'P-0016' : 'P-0057';
}
