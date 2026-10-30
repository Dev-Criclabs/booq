import { describe, expect, it } from 'vitest';
import { clearSessionCookie, clubOfToken, hashToken, newSessionToken, parseSessionCookie, serializeSessionCookie, SESSION_COOKIE } from './cookie';
import { clubUrl } from './club-url';

// F02-T07 / T05 (LINE-01-AC10; AUTH-01-AC13, AC14; design 6.3): the cookie and the club address.
describe('session cookie', () => {
  it('is __Host- prefixed, HttpOnly, Secure, SameSite Lax, Path=/ and has no Domain', () => {
    const c = serializeSessionCookie('tok', 3600);
    expect(c.startsWith(`${SESSION_COOKIE}=tok;`)).toBe(true);
    expect(SESSION_COOKIE.startsWith('__Host-')).toBe(true);
    for (const part of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=3600']) expect(c).toContain(part);
    expect(c.toLowerCase()).not.toContain('domain=');
  });
  it('clears with an empty value and zero age', () => {
    const c = clearSessionCookie();
    expect(c).toContain(`${SESSION_COOKIE}=;`);
    expect(c).toContain('Max-Age=0');
  });
  it('parses the cookie from a Cookie header among others, and ignores a look-alike name', () => {
    expect(parseSessionCookie(`a=1; ${SESSION_COOKIE}=abc_DEF-123; b=2`)).toBe('abc_DEF-123');
    expect(parseSessionCookie(`x${SESSION_COOKIE}=nope`)).toBeNull();
    expect(parseSessionCookie('a=1')).toBeNull();
    expect(parseSessionCookie(undefined)).toBeNull();
    expect(parseSessionCookie(`${SESSION_COOKIE}=`)).toBeNull();
  });
  it('refuses to serialize a token with characters that could split a header', () => {
    expect(() => serializeSessionCookie('a;b', 10)).toThrow();
    expect(() => serializeSessionCookie('a\r\nSet-Cookie: x=1', 10)).toThrow();
  });
});

describe('tokens', () => {
  const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
  it('carry their club, are URL safe and different each time; the stored hash is sha-256 hex', () => {
    const a = newSessionToken(CLUB);
    const b = newSessionToken(CLUB);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}_[A-Za-z0-9_-]{43}$/);
    expect(clubOfToken(a)).toBe(CLUB);
    expect(clubOfToken('abc')).toBeNull();
    expect(() => newSessionToken('not-a-club')).toThrow();
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('clubUrl (AUTH-01-AC14)', () => {
  it('always carries the club', () => {
    expect(clubUrl('https://app.example', 'hunter')).toBe('https://app.example/c/hunter');
    expect(clubUrl('https://app.example/', 'hunter', '/book?slot=1')).toBe('https://app.example/c/hunter/book?slot=1');
  });
  it('refuses a bad slug, a path that escapes the club, or a base that is not https', () => {
    expect(() => clubUrl('https://app.example', 'Bad Slug')).toThrow();
    expect(() => clubUrl('https://app.example', '../x')).toThrow();
    expect(() => clubUrl('https://app.example', 'hunter', '//evil.example')).toThrow();
    expect(() => clubUrl('https://app.example', 'hunter', 'no-slash')).toThrow();
    expect(() => clubUrl('http://app.example', 'hunter')).toThrow();
  });
});
