import { describe, expect, it } from 'vitest';
import { INTERNAL_SIGNATURE, INTERNAL_TIMESTAMP, signInternalCall, verifyInternalCall } from './internal-call';

const NOW = new Date('2026-10-30T10:00:00Z');
const at = (s: number) => new Date(NOW.getTime() + s * 1000);
const h = (x: Record<string, string>) => ({ timestamp: x[INTERNAL_TIMESTAMP] ?? null, signature: x[INTERNAL_SIGNATURE] ?? null });

describe('signed calls between BOOQ apps (F01-T17b)', () => {
  it('a call signed with the shared secret verifies within the skew', () => {
    const sig = h(signInternalCall('s3cret', NOW, '{"a":1}'));
    expect(verifyInternalCall('s3cret', at(20), 30, sig, '{"a":1}')).toBe(true);
  });
  it('a wrong secret, a changed body, a missing or malformed header is refused', () => {
    const sig = h(signInternalCall('s3cret', NOW, '{"a":1}'));
    expect(verifyInternalCall('other', NOW, 30, sig, '{"a":1}')).toBe(false);
    expect(verifyInternalCall('s3cret', NOW, 30, sig, '{"a":2}')).toBe(false);
    expect(verifyInternalCall('s3cret', NOW, 30, { timestamp: null, signature: sig.signature }, '{"a":1}')).toBe(false);
    expect(verifyInternalCall('s3cret', NOW, 30, { timestamp: sig.timestamp, signature: 'zz' }, '{"a":1}')).toBe(false);
    expect(verifyInternalCall('s3cret', NOW, 30, { timestamp: 'abc', signature: sig.signature }, '{"a":1}')).toBe(false);
    expect(verifyInternalCall('', NOW, 30, sig, '{"a":1}')).toBe(false);
  });
  it('a call outside the skew is refused, in either direction (replay)', () => {
    const sig = h(signInternalCall('s3cret', NOW, 'x'));
    expect(verifyInternalCall('s3cret', at(31), 30, sig, 'x')).toBe(false);
    expect(verifyInternalCall('s3cret', at(-31), 30, sig, 'x')).toBe(false);
    expect(verifyInternalCall('s3cret', at(30), 30, sig, 'x')).toBe(true);
  });
  it('signing needs a secret', () => {
    expect(() => signInternalCall('', NOW, 'x')).toThrow();
  });
});
