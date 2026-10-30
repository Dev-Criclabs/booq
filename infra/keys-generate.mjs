// Creates the key pair for club secrets (decision D34, D149; packages/secrets/src/envelope.ts).
// RSA 3072, public key as SPKI PEM, private key as PKCS8 PEM: the same parameters as generateKeyPair() in packages/secrets.
//
//   node infra/keys-generate.mjs <private-key-file>
//
// The PRIVATE key goes only to the file you name (created with mode 0600, never overwritten) and is never printed.
// The PUBLIC key and its key id go to standard output. The key id is what the stored envelopes carry (booq1.<keyId>...),
// so ops can tell which key encrypted a row.
// Run on an operator machine, move the file into the password manager, then delete it. See docs/ops/secrets.md.
import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'

export function newKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return { publicKey, privateKey, keyId: keyIdOf(publicKey) }
}

/** Same as keyIdOf() in packages/secrets: first 16 hex characters of the SHA-256 of the SPKI DER. */
export function keyIdOf(publicKeyPem) {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })
  return createHash('sha256').update(der).digest('hex').slice(0, 16)
}

/** One line with literal \n, as the apps accept it in an environment variable. */
export const asEnvValue = (pem) => pem.trim().replace(/\n/g, '\\n')

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2]
  if (!file) { console.error('usage: node infra/keys-generate.mjs <private-key-file>'); process.exit(2) }
  if (existsSync(file)) { console.error(`${file} exists. Refusing to overwrite.`); process.exit(2) }
  const k = newKeyPair()
  writeFileSync(file, k.privateKey, { mode: 0o600, flag: 'wx' })
  console.log(`key id: ${k.keyId}`)
  console.log(`private key written to ${file} (mode 600). Store it in the password manager, then delete the file.`)
  console.log('SECRETS_PUBLIC_KEY value (one line):')
  console.log(asEnvValue(k.publicKey))
}
