import { createHash, randomBytes } from 'node:crypto';

// The session cookie (F02-T07; LINE-01-AC10; design 5). `__Host-` forces Secure, Path=/ and no
// Domain, so a sibling site cannot set or read it. The browser holds a random token; the
// database holds only its sha-256 hex (migration 0102). The ID token and access token are never
// stored or put in a cookie (AC13).

export const SESSION_COOKIE = '__Host-booq_session';
const SAFE_TOKEN = /^[A-Za-z0-9_-]+$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The token starts with its club (32 hex, no dashes) so a request whose slug is another club's
 * is refused before any lookup (design 6.3: the session's club is the truth). The rest is 256
 * random bits; the club prefix is not a secret and adds no guessing power.
 */
export function newSessionToken(clubId: string): string {
  if (!UUID.test(clubId)) throw new Error('session token: bad club id');
  return `${clubId.replace(/-/g, '').toLowerCase()}_${randomBytes(32).toString('base64url')}`;
}

/** The club a token was issued for, as a uuid, or null if it does not carry one. */
export function clubOfToken(token: string): string | null {
  const m = /^([0-9a-f]{32})_[A-Za-z0-9_-]{43}$/.exec(token);
  if (!m) return null;
  const h = m[1]!;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function serializeSessionCookie(token: string, maxAgeSeconds: number): string {
  if (!SAFE_TOKEN.test(token)) throw new Error('session cookie: unsafe token');
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 0) throw new Error('session cookie: bad age');
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function parseSessionCookie(header: string | undefined | null): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) {
      const value = rest.join('=');
      return SAFE_TOKEN.test(value) ? value : null;
    }
  }
  return null;
}
