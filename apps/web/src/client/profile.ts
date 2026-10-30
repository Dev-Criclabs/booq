import { signInPath } from './paths';

// The signed-in player's own profile (GET and PUT /me/profile, F02-T14; AUTH-02-AC15 to AC23, AC29).
// The date of birth is never locked: any number of changes, any time (AC18, AC19). The price group
// comes from the server; a screen never works it out (design 6.6).

export type Level = 'new' | 'beginner' | 'intermediate' | 'advanced';
export const LEVELS: readonly Level[] = ['new', 'beginner', 'intermediate', 'advanced'];
/** The level labels on the canvas (G-C17-Personal-details): New to tennis, Beginner, Intermediate, Advanced. */
export const LEVEL_KEY: Record<Level, string> = { new: 'P-0409', beginner: 'P-0154', intermediate: 'P-0155', advanced: 'P-0156' };

export interface Profile {
  fullName: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  level: Level | null;
  language: 'th' | 'en' | null;
  priceGroup: 'adult' | 'student';
}
export type ProfileField = 'fullName' | 'phone' | 'dateOfBirth' | 'level' | 'language';
export type ProfileErrors = Partial<Record<ProfileField, string>>;
export type ProfileChange = Partial<{ fullName: string; phone: string; dateOfBirth: string | null; level: Level | null; language: 'th' | 'en' }>;

const FIELD_KEY: Record<string, string> = {
  name_missing: 'P-new.profile_name_missing',
  name_too_long: 'P-new.profile_name_too_long',
  name_invalid: 'P-new.profile_name_invalid',
  phone_missing: 'P-new.profile_phone_missing',
  phone_invalid: 'P-new.profile_phone_invalid',
  dob_invalid: 'P-new.profile_dob_invalid',
  dob_future: 'P-new.profile_dob_future',
  level_invalid: 'P-new.profile_level_invalid',
  language_invalid: 'P-new.profile_language_invalid',
};

const FALLBACK: Record<ProfileField, string> = {
  fullName: 'P-new.profile_name_invalid',
  phone: 'P-new.profile_phone_invalid',
  dateOfBirth: 'P-new.profile_dob_invalid',
  level: 'P-new.profile_level_invalid',
  language: 'P-new.profile_language_invalid',
};

export type Loaded = { kind: 'ok'; profile: Profile } | { kind: 'sign_in'; url: string } | { kind: 'error'; key: string };
export type Saved = { kind: 'ok'; profile: Profile } | { kind: 'fields'; errors: ProfileErrors } | { kind: 'sign_in'; url: string } | { kind: 'error'; key: string };

const api = (slug: string) => `/api/c/${encodeURIComponent(slug)}/me/profile`;

/** A guest opening a person page signs in first and comes back to it (AUTH-01-AC9). */
function signIn(slug: string, here: string) {
  return { kind: 'sign_in' as const, url: signInPath(slug, here) };
}

export async function loadProfile(slug: string, here: string, f: typeof fetch): Promise<Loaded> {
  let res: Response;
  try {
    res = await f(api(slug), { credentials: 'same-origin' });
  } catch {
    return { kind: 'error', key: 'P-0327' };
  }
  if (res.status === 401) return signIn(slug, here);
  if (res.status === 404) return { kind: 'error', key: 'P-new.page_not_found' };
  if (!res.ok) return { kind: 'error', key: 'P-0327' };
  return { kind: 'ok', profile: (await res.json()) as Profile };
}

export async function saveProfile(slug: string, here: string, change: ProfileChange, f: typeof fetch): Promise<Saved> {
  let res: Response;
  try {
    res = await f(api(slug), { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change) });
  } catch {
    return { kind: 'error', key: 'P-0327' };
  }
  const body = (await res.json().catch(() => ({}))) as { code?: unknown; fields?: Record<string, unknown> } & Partial<Profile>;
  if (res.ok) return { kind: 'ok', profile: body as Profile };
  if (res.status === 401) return signIn(slug, here);
  if (body.code === 'invalid' && body.fields) {
    const errors: ProfileErrors = {};
    for (const [field, code] of Object.entries(body.fields)) {
      if (typeof code === 'string' && field in FALLBACK) errors[field as ProfileField] = FIELD_KEY[code] ?? FALLBACK[field as ProfileField];
    }
    return { kind: 'fields', errors };
  }
  if (res.status === 404) return { kind: 'error', key: 'P-new.page_not_found' };
  return { kind: 'error', key: 'P-0327' };
}

/** Only the fields that changed are sent, so an untouched field is never rewritten (or audited). */
export function changesFrom(before: Profile, after: { fullName: string; phone: string; dateOfBirth: string | null; level: Level | null }): ProfileChange {
  const c: ProfileChange = {};
  if (after.fullName !== (before.fullName ?? '')) c.fullName = after.fullName;
  if (after.phone !== (before.phone ?? '')) c.phone = after.phone;
  if (after.dateOfBirth !== before.dateOfBirth) c.dateOfBirth = after.dateOfBirth;
  if (after.level !== before.level) c.level = after.level;
  return c;
}

/**
 * The checkout's answer for a Student item (F02-T13 checkStudentItem; AUTH-02-AC10 to AC12): an Adult
 * item never asks, a Student item with no date of birth on file goes to the date of birth step, and a
 * player 18 or older is told the item is for under 18.
 */
export type StudentCheck = 'ok' | 'dob_required' | 'student_too_old' | 'dob_future';
export function dobStepFor(check: StudentCheck): 'none' | 'ask' | 'too_old' {
  if (check === 'dob_required' || check === 'dob_future') return 'ask';
  if (check === 'student_too_old') return 'too_old';
  return 'none';
}

export const dobStepPath = (slug: string, next: string) => `/c/${slug}/date-of-birth?next=${encodeURIComponent(next)}`;
