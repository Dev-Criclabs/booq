import { describe, expect, it } from 'vitest';
import { hashInviteToken, newInviteToken } from './invite';

// F01-T23 part b: the invite token (SR-01). 32 random bytes; only the hash is stored.
describe('invite tokens', () => {
  it('a token is 32 random bytes in URL safe text and never repeats', () => {
    const a = newInviteToken();
    const b = newInviteToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('the hash is the lower case hex SHA-256 of the token, 64 characters, and differs from the token', () => {
    expect(hashInviteToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const t = newInviteToken();
    expect(hashInviteToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(t)).not.toContain(t);
  });

  it('refuses an empty token', () => {
    expect(() => hashInviteToken('')).toThrow();
  });
});
