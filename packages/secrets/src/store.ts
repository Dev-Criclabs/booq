import type { Tx } from '../../db/src/tx';
import { decryptSecret, encryptSecret, last4 } from './envelope';

// The only code that calls app.write_secret / app.read_secret (a lint enforces it).

export const SECRET_KINDS = [
  'line_channel_token', 'line_channel_secret', 'line_login_secret',
  'beam_api_key_test', 'beam_hmac_key_test', 'beam_api_key_live', 'beam_hmac_key_live',
] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

/** Encrypts in the application and hands the database the envelope and the last four characters. */
export async function writeSecret(tx: Tx, publicKey: string, clubId: string, kind: SecretKind, plaintext: string): Promise<void> {
  const e = encryptSecret(publicKey, plaintext, { clubId, kind });
  await tx.query('select app.write_secret($1, $2, $3, $4)', [kind, e.ciphertext, e.keyId, last4(plaintext)]);
}

/** Reads and decrypts one secret of the club in the transaction's context. `worker` picks the worker's function. */
export async function readSecret(tx: Tx, privateKey: string, clubId: string, kind: SecretKind, role: 'web' | 'worker' = 'web'): Promise<string | null> {
  const fn = role === 'worker' ? 'app.read_secret_worker' : 'app.read_secret';
  const r = await tx.query<{ c: string | null }>(`select ${fn}($1) as c`, [kind]);
  const cipher = r.rows[0]?.c ?? null;
  return cipher === null ? null : decryptSecret(privateKey, cipher, { clubId, kind });
}
