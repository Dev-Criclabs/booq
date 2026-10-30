import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, privateDecrypt, publicEncrypt, randomBytes, constants } from 'node:crypto';

// Application-level encryption of club secrets (F01-T09; decision D34; review SR-03).
// A fresh AES-256-GCM data key per secret, wrapped with RSA-OAEP (SHA-256) under the public
// key. The wrapped key, IV and ciphertext travel together as
//   booq1.<key id>.<wrapped key>.<iv>.<ciphertext>.<tag>      (base64url parts)
// The club and kind are authenticated data, so a row copied to another club or kind fails to
// decrypt. This is the only module that reads the key variables.

export interface SecretContext {
  clubId: string;
  kind: string;
}
export interface Encrypted {
  ciphertext: string;
  keyId: string;
}

const VERSION = 'booq1';
const b64 = (b: Buffer) => b.toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url');
const aad = (c: SecretContext) => Buffer.from(`${c.clubId}:${c.kind}`);

export function generateKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

function keyIdOf(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex').slice(0, 16);
}

export function encryptSecret(publicKeyPem: string, plaintext: string, context: SecretContext): Encrypted {
  if (plaintext === '') throw new Error('secret is empty');
  if (publicKeyPem.includes('PRIVATE KEY')) throw new Error('encrypt needs the public key');
  const pub = createPublicKey(publicKeyPem);
  const dataKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
  cipher.setAAD(aad(context));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const wrapped = publicEncrypt({ key: pub, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, dataKey);
  const keyId = keyIdOf(publicKeyPem);
  return { keyId, ciphertext: [VERSION, keyId, b64(wrapped), b64(iv), b64(body), b64(cipher.getAuthTag())].join('.') };
}

export function decryptSecret(privateKeyPem: string, ciphertext: string, context: SecretContext): string {
  try {
    const [version, , wrapped, iv, body, tag] = ciphertext.split('.');
    if (version !== VERSION || !wrapped || !iv || !body || !tag) throw new Error('shape');
    const dataKey = privateDecrypt({ key: createPrivateKey(privateKeyPem), oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, unb64(wrapped));
    const d = createDecipheriv('aes-256-gcm', dataKey, unb64(iv));
    d.setAAD(aad(context));
    d.setAuthTag(unb64(tag));
    return Buffer.concat([d.update(unb64(body)), d.final()]).toString('utf8');
  } catch {
    // Never say why, and never echo the input.
    throw new Error('could not decrypt the secret');
  }
}

/** What the support view may show (D27): the last four characters, and nothing for a short value. */
export function last4(plaintext: string): string {
  return plaintext.length > 4 ? plaintext.slice(-4) : '';
}

function pem(value: string): string {
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}
type Env = Record<string, string | undefined>;

/** The platform app and every writer: the public key only. */
export function loadEncryptKey(env: Env = process.env): string {
  const v = env.SECRETS_PUBLIC_KEY;
  if (!v) throw new Error('SECRETS_PUBLIC_KEY is not set');
  return pem(v);
}
/** apps/web and apps/worker only. */
export function loadDecryptKey(env: Env = process.env): string {
  const v = env.SECRETS_PRIVATE_KEY;
  if (!v) throw new Error('SECRETS_PRIVATE_KEY is not set');
  return pem(v);
}
