#!/usr/bin/env node
// TEXT-04 guard: wording of an existing key never changes.
//
//   node tools/i18n/check-wording.mjs <git-ref>     (default HEAD)
//
// For each key in both the ref and the working files, the new text with every
// {variable} read as "any text" must match the old text. So swapping 9 Jan for
// {date} passes, and rewording a sentence fails. Keys that were removed fail.
// New keys are listed so they can go to the writers.
import { execFileSync } from 'node:child_process'
import { LANGS, readLocale, ROOT } from './lib.mjs'

const ref = process.argv[2] ?? 'HEAD'
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const failures = []
const added = []
for (const lang of LANGS) {
  const old = JSON.parse(execFileSync('git', ['show', `${ref}:locales/${lang}.json`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }))
  const now = readLocale(lang)
  for (const key of Object.keys(old)) {
    if (!(key in now)) { failures.push(`${key} [${lang}]: removed`); continue }
    if (old[key] === now[key]) continue
    const re = new RegExp('^' + esc(now[key]).replace(/\\\{[A-Za-z][A-Za-z0-9]*\\\}/g, '.+?') + '$', 's')
    if (!re.test(old[key])) failures.push(`${key} [${lang}]: wording changed\n    was: ${old[key]}\n    now: ${now[key]}`)
  }
  for (const key of Object.keys(now)) if (!(key in old)) added.push(`${key} [${lang}]`)
}
if (added.length) console.log(`new keys for the writers (${added.length}):\n  ${added.join('\n  ')}`)
if (failures.length) { console.error(`${failures.length} wording change(s):\n  ` + failures.join('\n  ')); process.exit(1) }
console.log(`wording unchanged against ${ref}`)
