#!/usr/bin/env node
// Audits locales/en.json and locales/th.json.
//
//   node tools/i18n/audit.mjs            check and rewrite locales/variable-candidates.csv
//   node tools/i18n/audit.mjs --strict   also fail while open candidates remain
//   node tools/i18n/audit.mjs --no-csv   check only, write nothing
//   node tools/i18n/audit.mjs --variables  also list every variable in use, with key counts
//
// Errors (exit 1): key parity (X keys are English only), variable sets differ
// between languages, stray braces, empty values, Buddhist era years.
// Candidates: values that look like sample data. They go to the CSV with a
// suggested variable name; they do not fail the run unless --strict.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  LOCALES, LANGS, KEY_RE, readLocale, isEnglishOnly, variablesOf, hasStrayBrace,
  findCandidates, BE_YEAR_RE, maskVariables,
} from './lib.mjs'
import { isKept, questionFor } from './decisions.mjs'

const args = new Set(process.argv.slice(2))
const en = readLocale('en')
const th = readLocale('th')
const errors = []

// 1. Key parity and shape
for (const key of Object.keys(en)) {
  if (!KEY_RE.test(key)) errors.push(`${key}: key does not match [PAKLX]-0000`)
  if (!isEnglishOnly(key) && !(key in th)) errors.push(`${key}: missing in th.json`)
}
for (const key of Object.keys(th)) {
  if (!(key in en)) errors.push(`${key}: in th.json but not en.json`)
  if (isEnglishOnly(key)) errors.push(`${key}: X keys are English only (TEXT-05), remove from th.json`)
}

// 2. Values: empty, braces, variable parity, Buddhist era
const locales = { en, th }
for (const lang of LANGS) {
  for (const [key, text] of Object.entries(locales[lang])) {
    if (typeof text !== 'string' || text.trim() === '') errors.push(`${key} [${lang}]: empty value`)
    if (hasStrayBrace(text)) errors.push(`${key} [${lang}]: stray { or } (variables look like {amount})`)
    for (const m of maskVariables(text).matchAll(BE_YEAR_RE)) errors.push(`${key} [${lang}]: Buddhist era year ${m[0]}`)
  }
}
for (const key of Object.keys(th)) {
  if (!(key in en)) continue
  const a = variablesOf(en[key]).join(',')
  const b = variablesOf(th[key]).join(',')
  if (a !== b) errors.push(`${key}: variables differ, en {${a}} vs th {${b}}`)
}

// 3. Candidates
const rows = []
for (const lang of LANGS) {
  for (const [key, text] of Object.entries(locales[lang])) {
    for (const c of findCandidates(lang, text)) {
      const kept = isKept(key, c)
      rows.push({
        key, language: lang, matched: c.matched, suggested: c.variable.includes('…') ? c.variable.split('…').map((v) => `{${v}}`).join(' … ') : `{${c.variable}}`,
        status: kept ? 'kept' : 'open', note: kept || '', question: kept ? '' : questionFor(key, c),
        text,
      })
    }
  }
}
const open = rows.filter((r) => r.status === 'open')

if (!args.has('--no-csv')) {
  const cell = (v) => `"${String(v).replaceAll('"', '""')}"`
  const head = ['key', 'language', 'matched_text', 'suggested_variable', 'status', 'note', 'question', 'full_text']
  const lines = [head.join(',')].concat(
    rows.map((r) => [r.key, r.language, r.matched, r.suggested, r.status, r.note, r.question, r.text].map(cell).join(',')),
  )
  writeFileSync(join(LOCALES, 'variable-candidates.csv'), lines.join('\n') + '\n')
}

if (args.has('--variables')) {
  const used = new Map()
  for (const [key, text] of Object.entries(en)) for (const v of variablesOf(text)) used.set(v, [...(used.get(v) ?? []), key])
  for (const [v, keys] of [...used].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`{${v}}\t${keys.length}\t${keys.slice(0, 3).join(' ')}`)
}

const count = (o) => Object.keys(o).length
console.log(`keys: en ${count(en)}, th ${count(th)}`)
console.log(`candidates: ${open.length} open, ${rows.length - open.length} kept (${new Set(open.map((r) => r.key)).size} keys open)`)
if (errors.length) {
  console.error(`\n${errors.length} error(s):`)
  for (const e of errors.slice(0, 200)) console.error('  ' + e)
  process.exit(1)
}
if (args.has('--strict') && open.length) {
  console.error('open candidates remain (--strict)')
  process.exit(1)
}
console.log('ok')
