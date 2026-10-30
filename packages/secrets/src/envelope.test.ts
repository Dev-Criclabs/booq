import { describe, expect, it, vi } from 'vitest';
import { decryptSecret, encryptSecret, generateKeyPair, last4, loadDecryptKey, loadEncryptKey } from './envelope';

// F01-T09 (PDPA-01-AC9, decision D34, SR-03): an asymmetric envelope. The platform app holds only
// the public key and can only encrypt; only apps/web and apps/worker hold the private key.
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const MARKER = 'MARKER-sk_live_0123456789abcdef';

describe('envelope', () => {
  const keys = generateKeyPair();
  const ctx = { clubId: CLUB, kind: 'beam_api_key_live' };

  it('round trips, and the stored form is ciphertext that does not contain the secret', () => {
    const e = encryptSecret(keys.publicKey, MARKER, ctx);
    expect(e.ciphertext).toMatch(/^booq1\./);
    expect(e.ciphertext).not.toContain(MARKER);
    expect(Buffer.from(e.ciphertext).toString('latin1')).not.toContain('sk_live');
    expect(decryptSecret(keys.privateKey, e.ciphertext, ctx)).toBe(MARKER);
  });

  it('two encryptions of the same value differ (fresh data key and IV each time)', () => {
    expect(encryptSecret(keys.publicKey, MARKER, ctx).ciphertext).not.toBe(encryptSecret(keys.publicKey, MARKER, ctx).ciphertext);
  });

  it('is bound to its club and kind: a row copied to another club or kind does not decrypt', () => {
    const e = encryptSecret(keys.publicKey, MARKER, ctx);
    expect(() => decryptSecret(keys.privateKey, e.ciphertext, { ...ctx, clubId: OTHER })).toThrow(/decrypt/);
    expect(() => decryptSecret(keys.privateKey, e.ciphertext, { ...ctx, kind: 'beam_hmac_key_live' })).toThrow(/decrypt/);
  });

  it('a different private key, a tampered envelope and garbage all fail without echoing the secret', () => {
    const e = encryptSecret(keys.publicKey, MARKER, ctx);
    const wrong = generateKeyPair();
    const parts = e.ciphertext.split('.');
    const tampered = [...parts.slice(0, 5), Buffer.from('x' + parts[5]).toString('base64url')].join('.');
    for (const bad of [{ key: wrong.privateKey, text: e.ciphertext }, { key: keys.privateKey, text: tampered }, { key: keys.privateKey, text: 'garbage' }, { key: keys.privateKey, text: MARKER }]) {
      try {
        decryptSecret(bad.key, bad.text, ctx);
        throw new Error('should have failed');
      } catch (err) {
        expect((err as Error).message).toMatch(/decrypt/);
        expect((err as Error).message).not.toContain(MARKER);
      }
    }
  });

  it('the key id names the public key, so a rotation can find the right private key', () => {
    const a = encryptSecret(keys.publicKey, 'x', ctx);
    const b = encryptSecret(generateKeyPair().publicKey, 'x', ctx);
    expect(a.keyId).toMatch(/^[0-9a-f]{16}$/);
    expect(a.keyId).not.toBe(b.keyId);
    expect(a.ciphertext.split('.')[1]).toBe(a.keyId);
  });

  it('keeps the last four characters for display and never more', () => {
    expect(last4(MARKER)).toBe('cdef');
    expect(last4('abc')).toBe('');   // too short to show any part of
    expect(last4('abcd')).toBe('');
    expect(last4('abcde')).toBe('bcde');
  });

  it('writes nothing to the console while encrypting or failing', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const e = encryptSecret(keys.publicKey, MARKER, ctx);
    try { decryptSecret(generateKeyPair().privateKey, e.ciphertext, ctx); } catch { /* expected */ }
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    spies.forEach((s) => s.mockRestore());
  });

  it('rejects an empty secret and a private key given to encrypt', () => {
    expect(() => encryptSecret(keys.publicKey, '', ctx)).toThrow(/empty/);
    expect(() => encryptSecret(keys.privateKey, 'x', ctx)).toThrow(/public key/);
  });
});

describe('keys from the environment', () => {
  const keys = generateKeyPair();
  it('the platform app environment has the public key only: it can encrypt and cannot decrypt', () => {
    const env = { SECRETS_PUBLIC_KEY: keys.publicKey };
    expect(loadEncryptKey(env)).toContain('PUBLIC KEY');
    expect(() => loadDecryptKey(env)).toThrow(/SECRETS_PRIVATE_KEY/);
  });
  it('the web and worker environment has the private key', () => {
    expect(loadDecryptKey({ SECRETS_PRIVATE_KEY: keys.privateKey })).toContain('PRIVATE KEY');
  });
  it('newlines written as \\n in an environment variable are accepted', () => {
    const flat = keys.publicKey.replace(/\n/g, '\\n');
    expect(loadEncryptKey({ SECRETS_PUBLIC_KEY: flat })).toBe(keys.publicKey);
  });
  it('a missing key names the variable, never a value', () => {
    expect(() => loadEncryptKey({})).toThrow(/SECRETS_PUBLIC_KEY/);
  });
});
