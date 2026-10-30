import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { checkLiffFake } from './forbid-liff-fake.mjs'

const script = fileURLToPath(new URL('./forbid-liff-fake.mjs', import.meta.url))
const run = (env) => spawnSync(process.execPath, [script], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' })

test('hosted builds fail when the flag is on', () => {
  for (const hosted of [{ VERCEL: '1' }, { APP_ENV: 'staging' }, { APP_ENV: 'production' }, { APP_ENV: 'preview' }]) {
    for (const flag of ['1', 'true', 'yes']) assert.equal(checkLiffFake({ ...hosted, NEXT_PUBLIC_LIFF_FAKE: flag }).ok, false, JSON.stringify([hosted, flag]))
  }
})
test('hosted builds pass when the flag is unset, empty or 0', () => {
  for (const flag of [undefined, '', '0']) assert.equal(checkLiffFake({ VERCEL: '1', NEXT_PUBLIC_LIFF_FAKE: flag }).ok, true)
})
test('local and CI test builds may use the fake', () => {
  assert.equal(checkLiffFake({ NEXT_PUBLIC_LIFF_FAKE: '1' }).ok, true)
  assert.equal(checkLiffFake({ CI: 'true', NEXT_PUBLIC_LIFF_FAKE: '1' }).ok, true)
  assert.equal(checkLiffFake({ APP_ENV: 'local', NEXT_PUBLIC_LIFF_FAKE: '1' }).ok, true)
})
test('the command line exits 1 on a hosted build with the flag on, and 0 otherwise', () => {
  const bad = run({ VERCEL: '1', NEXT_PUBLIC_LIFF_FAKE: '1' })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /NEXT_PUBLIC_LIFF_FAKE/)
  assert.equal(run({ VERCEL: '1' }).status, 0)
  assert.equal(run({ NEXT_PUBLIC_LIFF_FAKE: '1' }).status, 0)
})
test('the message never prints other variables', () => {
  const r = run({ VERCEL: '1', NEXT_PUBLIC_LIFF_FAKE: '1', DATABASE_URL: 'postgres://secret-value' })
  assert.ok(!r.stdout.includes('secret-value') && !r.stderr.includes('secret-value'))
})
