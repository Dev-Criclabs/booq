import test from 'node:test'
import assert from 'node:assert/strict'
import { constants, createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, privateDecrypt, publicEncrypt, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { asEnvValue, keyIdOf, newKeyPair } from '../keys-generate.mjs'

const script = fileURLToPath(new URL('../keys-generate.mjs', import.meta.url))

test('the pair is RSA 3072 in the formats packages/secrets reads, and the key id is 16 hex characters', () => {
  const k = newKeyPair()
  assert.match(k.publicKey, /BEGIN PUBLIC KEY/)
  assert.match(k.privateKey, /BEGIN PRIVATE KEY/)
  assert.equal(createPublicKey(k.publicKey).asymmetricKeyDetails.modulusLength, 3072)
  assert.match(k.keyId, /^[0-9a-f]{16}$/)
  assert.equal(keyIdOf(k.publicKey), k.keyId)
})

test('an envelope built the way packages/secrets builds it decrypts with the private key', () => {
  const k = newKeyPair()
  const dataKey = randomBytes(32), iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', dataKey, iv); c.setAAD(Buffer.from('club:kind'))
  const body = Buffer.concat([c.update('secret-value', 'utf8'), c.final()]); const tag = c.getAuthTag()
  const wrapped = publicEncrypt({ key: createPublicKey(k.publicKey), oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, dataKey)
  const back = privateDecrypt({ key: createPrivateKey(k.privateKey), oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, wrapped)
  const d = createDecipheriv('aes-256-gcm', back, iv); d.setAAD(Buffer.from('club:kind')); d.setAuthTag(tag)
  assert.equal(Buffer.concat([d.update(body), d.final()]).toString('utf8'), 'secret-value')
})

test('the env form is one line with literal \\n and turns back into the same key', () => {
  const k = newKeyPair()
  const v = asEnvValue(k.publicKey)
  assert.ok(!v.includes('\n'))
  assert.equal(keyIdOf(v.replace(/\\n/g, '\n')), k.keyId)
})

test('the command writes the private key to a 0600 file, prints only the public key, and never overwrites', () => {
  const dir = mkdtempSync(join(tmpdir(), 'keys-'))
  try {
    const file = join(dir, 'private.pem')
    const r = spawnSync(process.execPath, [script, file], { encoding: 'utf8' })
    assert.equal(r.status, 0)
    assert.equal(statSync(file).mode & 0o777, 0o600)
    const priv = readFileSync(file, 'utf8')
    assert.match(priv, /BEGIN PRIVATE KEY/)
    assert.ok(!r.stdout.includes('PRIVATE KEY') && !r.stdout.includes(priv.split('\n')[1]))
    assert.match(r.stdout, /key id: [0-9a-f]{16}/)
    const again = spawnSync(process.execPath, [script, file], { encoding: 'utf8' })
    assert.equal(again.status, 2)
    assert.equal(readFileSync(file, 'utf8'), priv)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
