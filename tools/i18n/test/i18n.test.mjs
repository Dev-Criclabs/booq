// Run: node --test tools/i18n/test
// The lint test needs `typescript`; set I18N_TS_FROM=<dir with node_modules/typescript> or run it where the app has it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { findCandidates, variablesOf, maskVariables, BE_YEAR_RE } from '../lib.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const lint = join(here, '..', 'lint-hardcoded-text.mjs')

test('variablesOf reads named variables once and sorted', () => {
  assert.deepEqual(variablesOf('{b} and {a} and {b}'), ['a', 'b'])
  assert.deepEqual(variablesOf('no variables, ฿500 stays'), [])
})

test('candidates find dates, times, amounts, courts in both languages', () => {
  const en = findCandidates('en', 'Court 2 · Sat 9 Jan · 18:00 to 19:00 · ฿500').map((c) => c.variable)
  const th = findCandidates('th', 'คอร์ต 2 · ส. 9 ม.ค. · 18:00 ถึง 19:00 · ฿500').map((c) => c.variable)
  assert.deepEqual(en, ['court', 'date', 'startTime…endTime', 'amount'])
  assert.deepEqual(th, en)
})

test('text that already holds variables is not a candidate', () => {
  assert.deepEqual(findCandidates('en', 'Court {court} · {date} · {startTime} to {endTime} · {amount}'), [])
})

test('Thai "ค่าคอร์ต 1 ชั่วโมง" is not read as Court 1', () => {
  assert.ok(!findCandidates('th', 'ค่าคอร์ต 1 ชั่วโมง').some((c) => c.variable === 'court'))
})

test('Buddhist era years are flagged, plain amounts are not', () => {
  assert.equal([...maskVariables('29 ธันวาคม 2569').matchAll(BE_YEAR_RE)].length, 1)
  assert.equal([...maskVariables('฿2,569 and 2027').matchAll(BE_YEAR_RE)].length, 0)
})

test('lint reports hard coded text and passes clean code', { skip: !process.env.I18N_TS_FROM }, () => {
  const run = (f, extra = []) => spawnSync('node', [lint, '--ts-from', process.env.I18N_TS_FROM, ...extra, join(here, 'fixtures', f)], { encoding: 'utf8' })
  const bad = run('bad.tsx', ['--no-skip'])
  assert.equal(bad.status, 1)
  for (const rule of ['ui-call', 'error-message', 'user-prop', 'thai-text', 'locale-copy', 'unknown-key', 'missing-vars', 'jsx-attr', 'jsx-text']) assert.match(bad.stderr, new RegExp(rule))
  assert.equal(run('good.tsx').status, 0)
})
