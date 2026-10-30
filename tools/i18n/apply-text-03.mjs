#!/usr/bin/env node
// TEXT-03 pass. Swaps sample values for named variables in both locale files,
// keeping every key and never touching the surrounding wording.
//
//   node tools/i18n/apply-text-03.mjs --dry-run   print the changes, write nothing
//   node tools/i18n/apply-text-03.mjs             write locales/en.json and locales/th.json
//
// Safe to run again: text that already holds variables is not matched twice.
import {
  LANGS, readLocale, writeLocale, isEnglishOnly, variablesOf, maskVariables,
  genericRules, nameRules,
} from './lib.mjs'
import { RULES } from './rules.mjs'
import { SKIP_GENERIC, WHOLE_STRING_PLACEHOLDERS } from './decisions.mjs'

const dry = process.argv.includes('--dry-run')
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const locales = Object.fromEntries(LANGS.map((l) => [l, readLocale(l)]))
const problems = []
const changed = new Set()

const isPre = (lit) => /[^\d.,\s]/.test(lit.replace(/\[\[|\]\]/g, '')) // letters, ":" or currency sign
const parse = (spec) =>
  spec.split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
    const i = s.lastIndexOf('=')
    return { lit: s.slice(0, i), name: s.slice(i + 1) }
  })

// Replace one literal (first free occurrence). Returns new text or null if absent.
function replaceLiteral(text, alts, name) {
  const masked = maskVariables(text)
  for (const alt of alts) {
    const m = alt.match(/^(.*?)\[\[(.*?)\]\](.*)$/)
    const [before, core, after] = m ? [m[1], m[2], m[3]] : ['', alt, '']
    const lead = /^\d/.test(m ? before + core : core) && !before ? '(?<![\\d.,])' : ''
    const tail = /\d$/.test(m ? core + after : core) && !after ? '(?!\\d)' : ''
    const re = new RegExp(`${esc(before)}${lead}(${esc(core)})${tail}${esc(after)}`, 'u')
    const hit = re.exec(masked)
    if (!hit) continue
    const start = hit.index + hit[0].indexOf(core, before.length)
    return text.slice(0, start) + `{${name}}` + text.slice(start + core.length)
  }
  return null
}

function applyOverrides(key, lang, text, stage) {
  for (const { lit, name } of parse(RULES[key] ?? '')) {
    const forced = lit.startsWith('!')
    const alts = (forced ? lit.slice(1) : lit).split('|')
    if ((forced || alts.some(isPre) ? 'pre' : 'post') !== stage) continue
    const next = replaceLiteral(text, alts, name)
    if (next === null) {
      if (text.includes(`{${name}}`)) continue // already applied on an earlier run
      if (!(lang === 'th' && isEnglishOnly(key))) problems.push(`${key} [${lang}]: rule "${lit}=${name}" found nothing`)
      continue
    }
    text = next
  }
  return text
}

function applyGeneric(key, lang, text) {
  if (SKIP_GENERIC.has(key)) return text
  let work = maskVariables(text)
  const hits = []
  const whole = text.trim()
  for (const [cls, variable, src] of [...genericRules(lang), ...nameRules(lang)]) {
    if (cls === 'placeholder' && WHOLE_STRING_PLACEHOLDERS.has(key)) continue
    if (cls === 'placeholder' && new RegExp(`^(?:${src})$`).test(whole)) continue
    const re = new RegExp(src, 'gu')
    work = work.replace(re, (m, ...rest) => {
      const offset = rest.find((x) => typeof x === 'number')
      hits.push({ variable, matched: m, offset })
      return '\u0000'.repeat(m.length)
    })
  }
  const names = hits.flatMap((h) => (h.variable.includes('…') ? h.variable.split('…') : [h.variable]))
  const dup = names.find((n, i) => names.indexOf(n) !== i)
  if (dup) {
    problems.push(`${key} [${lang}]: two {${dup}} in one text, generic pass skipped (add a rule or a question)`)
    return text
  }
  hits.sort((a, b) => b.offset - a.offset)
  for (const h of hits) {
    const word = lang === 'en' ? ' to ' : ' ถึง '
    const repl = h.variable.includes('…') ? `{startTime}${word}{endTime}` : `{${h.variable}}`
    text = text.slice(0, h.offset) + repl + text.slice(h.offset + h.matched.length)
  }
  return text
}

for (const lang of LANGS) {
  for (const [key, before] of Object.entries(locales[lang])) {
    let text = applyOverrides(key, lang, before, 'pre')
    text = applyGeneric(key, lang, text)
    text = applyOverrides(key, lang, text, 'post')
    if (text !== before) {
      locales[lang][key] = text
      changed.add(`${key}|${lang}`)
      if (dry) console.log(`${key} [${lang}]\n  - ${before}\n  + ${text}`)
    }
  }
}

for (const key of Object.keys(locales.th)) {
  const a = variablesOf(locales.en[key]).join(','), b = variablesOf(locales.th[key]).join(',')
  if (a !== b) problems.push(`${key}: variables differ after the pass, en {${a}} vs th {${b}}`)
}

const keys = new Set([...changed].map((c) => c.split('|')[0]))
console.log(`\n${keys.size} keys changed (${changed.size} texts)`)
if (problems.length) {
  console.error(`${problems.length} problem(s):\n  ` + problems.join('\n  '))
}
if (!dry) {
  if (problems.length) { console.error('not written'); process.exit(1) }
  for (const lang of LANGS) writeLocale(lang, locales[lang])
  console.log('written')
}
