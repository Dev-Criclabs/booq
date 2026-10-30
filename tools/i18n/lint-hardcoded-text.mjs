#!/usr/bin/env node
// Fails when user facing text is written in source code (TEXT-01).
// Every screen, LINE message, receipt and error reads its text from locales/*.json by key.
//
//   node tools/i18n/lint-hardcoded-text.mjs [paths...]     default: the whole repo
//   node tools/i18n/lint-hardcoded-text.mjs --regex         force the dependency free fallback
//   node tools/i18n/lint-hardcoded-text.mjs --ts-from DIR   look for `typescript` in DIR/node_modules
//
// With `typescript` installed (the Next.js app has it) the files are parsed and
// every rule below is checked on the syntax tree. Without it a coarser text based
// check runs (Thai text, JSX text and attributes on one line, copies of locale text).
//
// Rules
//   jsx-text        text between JSX tags             <p>Save</p>        use <p>{t('P-0001')}</p>
//   jsx-attr        placeholder, title, alt, aria-label, label, ... with a string
//   ui-call         toast(), alert(), confirm(), notify() ... with a string
//   error-message   new Error('Court is taken')       throw a code, map it to a key at the edge
//   user-prop       text:, altText:, label:, title:, message:, body: ... with a string
//                   (LINE Flex Message cards, PDF receipt lines, Next.js metadata)
//   thai-text       any string with Thai letters
//   locale-copy     a string equal to a value in locales/*.json
//   unknown-key     t('P-9999') where the key is not in en.json (or th.json, except X keys)
//   missing-vars    t('P-0100') without the variables the text needs, or with names it does not use
//
// Allowed exceptions: put `// i18n-ignore` on the line or the line above, with a reason.
// Whole file: `// i18n-ignore-file` in the first 5 lines. Typical uses: log lines,
// internal assertions, test data. Never for text a player, staff member or coach can see.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname, sep } from 'node:path'
import { createRequire } from 'node:module'
import { ROOT, KEY_RE, readLocale, variablesOf, isEnglishOnly } from './lib.mjs'

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined)
const tsFrom = opt('--ts-from')
const paths = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--ts-from')

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', 'out', 'locales', 'specs', 'docs', 'tools', 'public', 'migrations', '__tests__', 'e2e', 'fixtures'])
const EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const SKIP_FILE = /\.(test|spec|stories|d)\.[cm]?[jt]sx?$|\.config\.[cm]?[jt]s$/

const USER_ATTRS = new Set(['placeholder', 'title', 'alt', 'aria-label', 'aria-description', 'aria-placeholder', 'label', 'helperText', 'description', 'tooltip', 'errorMessage', 'emptyText', 'confirmText', 'cancelText'])
const USER_PROPS = new Set(['text', 'altText', 'label', 'title', 'message', 'body', 'subject', 'description', 'placeholder', 'heading', 'caption', 'header', 'footer', 'error', 'hint', 'tooltip'])
const UI_CALLS = /^(?:toast(?:\.\w+)?|alert|confirm|prompt|notify|showToast|showMessage|setError|setMessage|setNotice)$/
const T_CALLS = new Set(['t', 'tr', 'translate', 'i18n.t', 'text'])
const THAI = /[฀-๿]/
const LETTERS = /[A-Za-z฀-๿]/

const en = readLocale('en')
const th = readLocale('th')
const localeCopies = new Map()
for (const [lang, data] of [['en', en], ['th', th]]) {
  for (const [key, v] of Object.entries(data)) {
    if (/\s/.test(v.trim()) || THAI.test(v)) localeCopies.set(v.trim(), key) // one word values like "Home" are too common
  }
}

// A string a person could read, as opposed to an id, class list, path, enum or key.
export function looksHuman(s) {
  const v = s.trim()
  if (!LETTERS.test(v)) return false
  if (KEY_RE.test(v)) return false
  if (/^[a-z0-9_.:/#@\-[\]]+$/.test(v)) return false // token, path, id, css value
  if (/^(?:https?:|mailto:|tel:|\/|\.\/|#)/.test(v)) return false
  if (/^[A-Z0-9_]+$/.test(v)) return false // CONSTANT
  if (/^[a-z]+(?:[A-Z][a-z0-9]*)+$/.test(v)) return false // camelCase identifier
  return THAI.test(v) || /\s/.test(v) || /^[A-Z]/.test(v)
}

let ts = null
if (!flag('--regex')) {
  try { ts = createRequire(join(tsFrom ? process.cwd() : ROOT, tsFrom ?? '', 'package.json'))('typescript') } catch {
    try { ts = createRequire(join(process.cwd(), 'package.json'))('typescript') } catch { /* fallback */ }
  }
}

const findings = []
const add = (file, line, col, rule, msg) => findings.push({ file, line, col, rule, msg })

function ignored(lines, line) {
  return /i18n-ignore\b/.test(lines[line - 1] ?? '') || /i18n-ignore\b/.test(lines[line - 2] ?? '')
}

function checkKeyUse(file, pos, keyText, argsInfo) {
  if (!(keyText in en)) return add(file, pos.line, pos.col, 'unknown-key', `${keyText} is not in locales/en.json`)
  if (!isEnglishOnly(keyText) && !(keyText in th)) add(file, pos.line, pos.col, 'unknown-key', `${keyText} is not in locales/th.json`)
  const need = variablesOf(en[keyText])
  if (argsInfo === 'dynamic') return
  const given = argsInfo ?? []
  const missing = need.filter((v) => !given.includes(v))
  const extra = given.filter((v) => !need.includes(v))
  if (missing.length) add(file, pos.line, pos.col, 'missing-vars', `${keyText} needs {${missing.join('}, {')}}`)
  if (extra.length) add(file, pos.line, pos.col, 'missing-vars', `${keyText} does not use {${extra.join('}, {')}}`)
}

function lintAst(file, source) {
  const ext = extname(file)
  const kind = ext === '.tsx' ? ts.ScriptKind.TSX : ext === '.jsx' ? ts.ScriptKind.JSX : ext === '.ts' ? ts.ScriptKind.TS : ts.ScriptKind.JS
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
  const lines = source.split('\n')
  const where = (n) => { const p = sf.getLineAndCharacterOfPosition(n.getStart(sf)); return { line: p.line + 1, col: p.character + 1 } }
  const strOf = (n) => {
    if (!n) return null
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text
    if (ts.isTemplateExpression(n)) return n.head.text + n.templateSpans.map((s) => s.literal.text).join(' ')
    if (ts.isJsxExpression(n) && n.expression) return strOf(n.expression)
    if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n)) return strOf(n.expression)
    return null
  }
  const report = (n, rule, msg) => { const p = where(n); if (!ignored(lines, p.line)) add(file, p.line, p.col, rule, msg) }
  const calleeName = (e) => (ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? `${calleeName(e.expression)}.${e.name.text}` : '')

  const visit = (n) => {
    if (ts.isJsxText(n)) {
      const t = n.text.replace(/&\w+;|&#\d+;/g, ' ').trim()
      if (LETTERS.test(t)) report(n, 'jsx-text', `text in JSX: "${t.slice(0, 40)}"`)
    } else if (ts.isJsxAttribute(n) && USER_ATTRS.has(n.name.getText(sf))) {
      const v = strOf(n.initializer)
      if (v !== null && looksHuman(v)) report(n, 'jsx-attr', `${n.name.getText(sf)}="${v.slice(0, 40)}"`)
    } else if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const name = calleeName(n.expression)
      const a0 = n.arguments?.[0]
      const s0 = strOf(a0)
      if (ts.isNewExpression(n) && /Error$/.test(name) && s0 !== null && looksHuman(s0)) report(n, 'error-message', `${name}("${s0.slice(0, 40)}")`)
      else if (ts.isCallExpression(n) && UI_CALLS.test(name) && s0 !== null && looksHuman(s0)) report(n, 'ui-call', `${name}("${s0.slice(0, 40)}")`)
      else if (ts.isCallExpression(n) && T_CALLS.has(name) && s0 !== null && KEY_RE.test(s0)) {
        const a1 = n.arguments[1]
        let info = []
        if (a1 && ts.isObjectLiteralExpression(a1)) {
          info = a1.properties.map((p) => (ts.isShorthandPropertyAssignment(p) || ts.isPropertyAssignment(p) ? p.name.getText(sf) : null))
          if (info.includes(null)) info = 'dynamic' // spread
        } else if (a1) info = 'dynamic'
        const p = where(n)
        if (!ignored(lines, p.line)) checkKeyUse(file, p, s0, info)
      }
    } else if (ts.isPropertyAssignment(n) && USER_PROPS.has(n.name.getText(sf).replace(/['"]/g, ''))) {
      const v = strOf(n.initializer)
      if (v !== null && looksHuman(v)) report(n, 'user-prop', `${n.name.getText(sf)}: "${v.slice(0, 40)}"`)
    }
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      if (THAI.test(n.text)) report(n, 'thai-text', `Thai text in code: "${n.text.slice(0, 30)}"`)
      else if (localeCopies.has(n.text.trim()) && !ts.isImportDeclaration(n.parent)) report(n, 'locale-copy', `copy of ${localeCopies.get(n.text.trim())}: use the key`)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
}

function lintRegex(file, source) {
  const lines = source.split('\n')
  lines.forEach((text, i) => {
    const line = i + 1
    if (ignored(lines, line) || /^\s*(\/\/|\*|\/\*)/.test(text)) return
    if (THAI.test(text)) add(file, line, 1, 'thai-text', 'Thai text in code')
    for (const m of text.matchAll(/\b([\w-]+)\s*=\s*"([^"{}]*)"/g)) if (USER_ATTRS.has(m[1]) && looksHuman(m[2])) add(file, line, m.index + 1, 'jsx-attr', `${m[1]}="${m[2].slice(0, 40)}"`)
    for (const m of text.matchAll(/>\s*([^<>{}\n]*[A-Za-z][^<>{}\n]*?)\s*</g)) if (/^[^=;()]*$/.test(m[1]) && looksHuman(m[1])) add(file, line, m.index + 1, 'jsx-text', `text in JSX: "${m[1].slice(0, 40)}"`)
    for (const m of text.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) if (localeCopies.has(m[2].trim())) add(file, line, m.index + 1, 'locale-copy', `copy of ${localeCopies.get(m[2].trim())}: use the key`)
    for (const m of text.matchAll(/\bt\(\s*['"]([PAKLX]-\d{4})['"]/g)) checkKeyUse(file, { line, col: m.index + 1 }, m[1], 'dynamic')
  })
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name) || flag('--no-skip')) walk(full, out) }
    else if (EXT.has(extname(name)) && !SKIP_FILE.test(name)) out.push(full)
  }
}

const files = []
for (const p of paths.length ? paths : [ROOT]) {
  const st = statSync(p)
  if (st.isDirectory()) walk(p, files); else files.push(p)
}
for (const f of files) {
  const source = readFileSync(f, 'utf8')
  if (/i18n-ignore-file/.test(source.split('\n').slice(0, 5).join('\n'))) continue
  const rel = relative(process.cwd(), f).split(sep).join('/')
  ts ? lintAst(rel, source) : lintRegex(rel, source)
}

findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
for (const f of findings) console.error(`${f.file}:${f.line}:${f.col}  ${f.rule}  ${f.msg}`)
console.log(`${files.length} file(s) checked${ts ? '' : ' (text mode, install typescript for the full check)'}, ${findings.length} finding(s)`)
process.exit(findings.length ? 1 : 0)
