#!/usr/bin/env node
// Builds locales/copy-index.csv (key, screens, boards) from the design canvas boards.
// The canvas is read only: download its boards first, this script only reads local files.
//
//   node tools/i18n/build-copy-index.mjs <boards-dir> [--sample-ref <git-ref>]
//
// <boards-dir> holds the project/*.dc.html files of the canvas. The boards still show the
// sample values, so keys are matched against the locale text as it was before TEXT-03
// (--sample-ref, default 6a44fda). English texts match H-, G-, S-, L-, R- boards;
// Thai texts match the T- boards. A text is matched to a key of the same app (C boards to P keys,
// A to A, K to K, L and R to L, P platform boards to X), exact after trimming.
// Writes locales/copy-index.csv and locales/copy-index-report.md. Wording is never touched.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { execFileSync } from 'node:child_process'
import { ROOT, LOCALES, prefixOf, isEnglishOnly, readLocale } from './lib.mjs'

const args = process.argv.slice(2)
const dir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--sample-ref')
const ref = args.includes('--sample-ref') ? args[args.indexOf('--sample-ref') + 1] : '6a44fda'
if (!dir) { console.error('usage: build-copy-index.mjs <boards-dir> [--sample-ref <git-ref>]'); process.exit(2) }

const sample = (lang) => JSON.parse(execFileSync('git', ['show', `${ref}:locales/${lang}.json`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }))
const samples = { en: sample('en'), th: sample('th') }
const current = { en: readLocale('en'), th: readLocale('th') }
const norm = (s) => s.replace(/\s+/g, ' ').trim()

const index = { en: new Map(), th: new Map() }
for (const lang of ['en', 'th']) {
  for (const [key, text] of Object.entries(samples[lang])) {
    const t = norm(text)
    index[lang].set(t, [...(index[lang].get(t) ?? []), key])
  }
}

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&middot;': '·' }
const decode = (s) => s.replace(/&(?:amp|lt|gt|quot|#39|nbsp|middot);/g, (m) => ENT[m])

function textsOf(html) {
  const body = html.match(/<x-dc>([\s\S]*?)<\/x-dc>/)?.[1] ?? ''
  const attrs = [...body.matchAll(/\b(?:placeholder|title|alt|aria-label)="([^"]+)"/g)].map((m) => decode(m[1]))
  const stripped = body.replace(/<helmet>[\s\S]*?<\/helmet>/g, '').replace(/<(style|script|svg)[\s\S]*?<\/\1>/g, '\n')
  const nodes = stripped.split(/<[^>]+>/).map((t) => norm(decode(t))).filter(Boolean)
  return [...nodes, ...attrs.map(norm)]
}

// Board name -> language, app and screen.
function describe(name) {
  let m
  const thai = name.startsWith('T-')
  const base = thai ? name.slice(2) : name
  let rest = base.replace(/^(?:G|S|H)-/, '')
  if (/^L-Msg|^L-Rich/.test(base)) return { thai, app: 'L', screen: base }
  if (/^R-Receipt/.test(base)) return { thai: base.endsWith('-TH'), app: 'L', screen: 'Receipt' }
  if (/^L-/.test(base) === false && (m = rest.match(/^([A-Z])(\d+[A-Za-z]*)(?:-|$)/))) {
    return { thai, app: { C: 'P', A: 'A', K: 'K', P: 'X' }[m[1]], screen: m[1] + m[2] }
  }
  return { thai, app: null, screen: rest }
}

const hits = new Map() // key -> { screens:Set, boards:Set, en:Set(boards) , th:Set(boards) }
const unmatched = new Map() // board -> texts
const ambiguous = new Map() // text -> keys
const boardFiles = readdirSync(dir).filter((f) => f.endsWith('.dc.html')).sort()
let boardCount = 0
for (const f of boardFiles) {
  const name = basename(f, '.dc.html')
  const d = describe(name)
  if (!d.app) continue
  boardCount++
  const lang = d.thai ? 'th' : 'en'
  const boardLabel = name
  for (const text of textsOf(readFileSync(join(dir, f), 'utf8'))) {
    const cands = (index[lang].get(text) ?? []).filter((k) => prefixOf(k) === d.app)
    if (!cands.length) {
      if (!/^[\s·.,:;()\-–—+×›▾→•/|%0-9]*$/.test(text)) unmatched.set(boardLabel, [...(unmatched.get(boardLabel) ?? []), text])
      continue
    }
    if (cands.length > 1) ambiguous.set(text, cands)
    for (const k of cands) {
      const h = hits.get(k) ?? { screens: new Set(), boards: new Set(), en: new Set(), th: new Set() }
      h.screens.add(d.screen); h.boards.add(boardLabel); h[lang].add(d.screen)
      hits.set(k, h)
    }
  }
}

const rows = Object.keys(current.en).sort().map((k) => {
  const h = hits.get(k)
  return [k, h ? [...h.screens].sort().join('; ') : '', h ? [...h.boards].sort().join('; ') : '']
})
const cell = (v) => `"${v.replaceAll('"', '""')}"`
writeFileSync(join(LOCALES, 'copy-index.csv'), ['key,screens,boards', ...rows.map((r) => r.map(cell).join(','))].join('\n') + '\n')

// Report
const unused = rows.filter((r) => !r[1]).map((r) => r[0])
const byPrefix = {}
for (const k of unused) (byPrefix[prefixOf(k)] ??= []).push(k)
const disagree = [...hits].filter(([k, h]) => !isEnglishOnly(k) && (h.en.size || h.th.size) && [...h.en].sort().join() !== [...h.th].sort().join())
const out = [
  '# Copy index report', '',
  `Built by \`tools/i18n/build-copy-index.mjs\` from ${boardCount} canvas boards, matched against the locale text at \`${ref}\` (before TEXT-03). Read only; no wording changed.`, '',
  `- Keys: ${rows.length}. With at least one board: ${rows.length - unused.length}. Without: ${unused.length}.`,
  `- Board texts that match no key: ${[...unmatched.values()].reduce((n, v) => n + v.length, 0)} on ${unmatched.size} boards.`,
  `- Texts that fit several keys of the same app: ${ambiguous.size} (every such key is listed against the board; the writers should say which key is meant).`,
  `- Keys whose English and Thai boards disagree: ${disagree.length}.`, '',
  '## Keys with no board (unused, or used only by LINE, receipts or states not on the canvas)', '',
  ...Object.entries(byPrefix).flatMap(([p, ks]) => [`**${p}** (${ks.length}): ${ks.join(', ')}`, '']),
  '## Keys whose English and Thai screens differ', '',
  ...disagree.map(([k, h]) => `- ${k}: en ${[...h.en].join(', ') || 'none'} | th ${[...h.th].join(', ') || 'none'}`), '',
  '## Texts that fit several keys', '',
  ...[...ambiguous].map(([t, ks]) => `- "${t.slice(0, 60)}": ${ks.join(', ')}`), '',
  '## Board texts that match no key', '',
  ...[...unmatched].flatMap(([b, ts]) => [`**${b}**`, ...[...new Set(ts)].map((t) => `- ${t.slice(0, 100)}`), '']),
]
writeFileSync(join(LOCALES, 'copy-index-report.md'), out.join('\n'))
console.log(`boards ${boardCount}, keys ${rows.length}, with board ${rows.length - unused.length}, unused ${unused.length}, unmatched texts ${[...unmatched.values()].reduce((n, v) => n + v.length, 0)}, ambiguous ${ambiguous.size}, en/th disagree ${disagree.length}`)
