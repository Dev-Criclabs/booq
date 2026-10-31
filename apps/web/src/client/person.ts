import { signInPath } from './paths';

// Pages that need a person (AUTH-01-AC9; design 6.2; assumption A-5): My bookings, Credits and
// wallet, Refer a friend and Profile. A guest who opens one signs in first and lands back on it. The
// check asks the server (GET /me/profile answers sign_in_required to a guest); the client never decides.

export type Who = { kind: 'person' } | { kind: 'guest' } | { kind: 'error' };

export async function whoAmI(slug: string, f: typeof fetch): Promise<Who> {
  try {
    const res = await f(`/api/c/${encodeURIComponent(slug)}/me/profile`, { credentials: 'same-origin' });
    if (res.status === 401) return { kind: 'guest' };
    return res.ok ? { kind: 'person' } : { kind: 'error' };
  } catch {
    return { kind: 'error' };
  }
}

/** Where a guest goes from a person page: sign in, then back to this page. */
export const signInFor = (slug: string, here: string) => signInPath(slug, here);
