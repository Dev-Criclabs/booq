// Shared helpers for the locale tools. No dependencies, Node 20+.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const LOCALES = join(ROOT, 'locales')
export const LANGS = ['en', 'th']

export const readLocale = (lang) => JSON.parse(readFileSync(join(LOCALES, `${lang}.json`), 'utf8'))
export const writeLocale = (lang, data) =>
  writeFileSync(join(LOCALES, `${lang}.json`), JSON.stringify(data, null, 2)) // files have no trailing newline; keep diffs clean

export const prefixOf = (key) => key.split('-')[0]
// X keys (platform console) are English only (TEXT-05).
export const isEnglishOnly = (key) => prefixOf(key) === 'X'
export const KEY_RE = /^[PAKLX]-\d{4}$/

// Named variables look like {amount}. Letters and digits only, starts with a letter.
export const VAR_RE = /\{([A-Za-z][A-Za-z0-9]*)\}/g
export const variablesOf = (text) => [...new Set([...text.matchAll(VAR_RE)].map((m) => m[1]))].sort()
// Blank out existing variables so detectors never match inside them.
export const maskVariables = (text) => text.replace(VAR_RE, (m) => '\u0000'.repeat(m.length))
// Any brace that is not part of a well formed variable.
export const hasStrayBrace = (text) => /[{}]/.test(text.replace(VAR_RE, ''))

const MON_EN = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec'
const MONL_EN = 'January|February|March|April|May|June|July|August|September|October|November|December'
const WD_EN = 'Mon|Tue|Wed|Thu|Fri|Sat|Sun'
const WDL_EN = 'Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday'
const MON_TH = 'ม\\.ค\\.|ก\\.พ\\.|มี\\.ค\\.|เม\\.ย\\.|พ\\.ค\\.|มิ\\.ย\\.|ก\\.ค\\.|ส\\.ค\\.|ก\\.ย\\.|ต\\.ค\\.|พ\\.ย\\.|ธ\\.ค\\.'
const MONL_TH = 'มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม'
const WD_TH = 'พฤ\\.|จ\\.|อ\\.|พ\\.|ศ\\.|ส\\.|อา\\.'
const WDL_TH = 'วัน(?:จันทร์|อังคาร|พุธ|พฤหัสบดี|ศุกร์|เสาร์|อาทิตย์)ที่'

// Date shapes. The variable name says which shape the formatter must produce.
// Order matters: longest shape first.
export const DATE_SHAPES = {
  dateLongYear: 'Full weekday, day, full month, year (Saturday 9 January 2027)',
  dateLong: 'Full weekday, day, full month (Saturday 9 January)',
  dateYear: 'Short weekday, day, short month, year (Sat 9 Jan 2027)',
  date: 'Short weekday, day, short month (Sat 9 Jan)',
  dayMonthYear: 'Day, short month, year (9 Jan 2027)',
  dayMonth: 'Day, short month (9 Jan)',
  monthYear: 'Full month, year (January 2027)',
}
export const DATE_RULES = {
  en: [
    ['dateLongYear', `(?:${WDL_EN}) \\d{1,2} (?:${MONL_EN}) \\d{4}`],
    ['dateLong', `(?:${WDL_EN}) \\d{1,2} (?:${MONL_EN})`],
    ['dateYear', `(?:${WD_EN}) \\d{1,2} (?:${MON_EN}) \\d{4}`],
    ['date', `(?:${WD_EN}) \\d{1,2} (?:${MON_EN})`],
    ['dayMonthYear', `\\d{1,2} (?:${MON_EN}) \\d{4}`],
    ['dayMonth', `\\d{1,2} (?:${MON_EN})`],
    ['monthYear', `(?:${MONL_EN}) \\d{4}`],
  ],
  th: [
    ['dateLongYear', `${WDL_TH} \\d{1,2} (?:${MONL_TH}) \\d{4}`],
    ['dateLong', `${WDL_TH} \\d{1,2} (?:${MONL_TH})`],
    ['dateYear', `(?:${WD_TH}) \\d{1,2} (?:${MON_TH}) \\d{4}`],
    ['date', `(?:${WD_TH}) \\d{1,2} (?:${MON_TH})`],
    ['dayMonthYear', `\\d{1,2} (?:${MON_TH}) \\d{4}`],
    ['dayMonth', `\\d{1,2} (?:${MON_TH})`],
    ['monthYear', `(?:${MONL_TH}) \\d{4}`],
  ],
}

const RANGE_WORD = { en: 'to', th: 'ถึง' }
const T = '\\d{1,2}:\\d{2}'

// Generic detectors shared by the audit and the TEXT-03 pass.
// Each entry: [class, variable, regex source, note]. A rule with a function name
// as variable lets the caller decide from context.
export function genericRules(lang) {
  const w = RANGE_WORD[lang]
  const court = lang === 'en' ? '(?:Court|COURT)' : '(?<!ค่า)คอร์ต'
  return [
    ['receipt', 'receiptNumber', 'HTC[-\\u2011]\\d{4}[-\\u2011]\\d{6}'],
    ['link', 'referralLink', 'hunter\\.club/r/[A-Z0-9]+'],
    ['bracket', 'price', '฿\\[PRICE\\]'],
    ['bracket', 'amount', '฿\\[AMOUNT\\]'],
    ['bracket', 'rate', '฿\\[RATE\\]'],
    ['bracket', 'reason', '\\[Reason\\]'],
    ['bracket', 'accountName', '\\[(?:ACCOUNT NAME|ชื่อบัญชี)\\]'],
    ...DATE_RULES[lang].map(([v, src]) => ['date', v, src]),
    ['time', 'startTime…endTime', `${T} ${w} ${T}`],
    ['time', 'time', T],
    ['amount', 'amount', '฿\\d[\\d,]*'],
    ['court', 'court', `(?<=${court} )\\d+`],
  ]
}

// Count-like numbers. Name is a default; policy numbers need a key specific name
// (holdMinutes, cancelHours...) which the TEXT-03 pass sets in rules.mjs.
export function countRules(lang) {
  if (lang === 'en') {
    return [
      ['of', 'count of total', '\\d+ of \\d+'],
      ['minutes', 'minutes', '\\d+ ?(?:minutes?|min)\\b'],
      ['hours', 'hours', '\\d+[ -]?(?:hours?|h)\\b'],
      ['days', 'days', '\\d+ days?\\b'],
      ['months', 'months', '\\d+ months?\\b'],
      ['sessions', 'sessions', '\\d+ (?:sessions?|classes|class|players?|people|coaches|bookings?|credits?|steps?|templates?|spots?|used)\\b'],
      ['ordinal', 'position', '\\d+(?:st|nd|rd|th)\\b'],
      ['number', 'count', '(?<![\\w.,:])\\d+(?:\\.\\d+)?(?![\\w:])'],
    ]
  }
  return [
    ['of', 'count of total', '\\d+ จาก \\d+'],
    ['minutes', 'minutes', '\\d+ นาที'],
    ['hours', 'hours', '\\d+(?:\\.\\d+)? (?:ชั่วโมง|ชม\\.)'],
    ['days', 'days', '\\d+ วัน'],
    ['months', 'months', '\\d+ เดือน'],
    ['sessions', 'sessions', '\\d+ (?:ครั้ง|คลาส|เซสชัน|คน|รายการ|ขั้นตอน|เทมเพลต|ที่|เครดิต)'],
    ['number', 'count', '(?<![\\w.,:])\\d+(?:\\.\\d+)?(?![\\w:])'],
  ]
}

// Names and placeholders that stand for real data.
export function nameRules(lang) {
  return lang === 'en'
    ? [
        ['name', 'playerName', 'Ploy Srisuk'],
        ['name', 'lineName', 'ploy\\.s'],
        ['name', 'code', '(?<=code )[A-Z]+\\d+'],
        ['name', 'firstName', '(?<=Hi, |evening, |morning, |booked, )(?:Ploy|Nok)'],
        ['name', 'clubName', 'Hunter Tennis Club'],
        ['placeholder', 'coachName', 'Coach name'],
        ['placeholder', 'playerName', 'Player name'],
        ['placeholder', 'studentName', 'Student name'],
      ]
    : [
        ['name', 'playerName', 'Ploy Srisuk'],
        ['name', 'lineName', 'ploy\\.s'],
        ['name', 'code', '(?<=โค้ดเพื่อน )[A-Z]+\\d+'],
        ['name', 'firstName', '(?<=คุณ)(?:พลอย|นก)'],
        ['name', 'clubName', 'Hunter Tennis Club'],
        ['placeholder', 'coachName', 'ชื่อโค้ช'],
        ['placeholder', 'playerName', 'ชื่อผู้เล่น'],
        ['placeholder', 'studentName', 'ชื่อนักเรียน'],
      ]
}

// Buddhist era years are never used (CLAUDE.md). 25xx standing alone is a BE year.
export const BE_YEAR_RE = /(?<![\d,฿.])25\d{2}(?![\d,])/g

// Any [Placeholder] a writer left in a text. The audit reports it; the pass names it by rule.
export const BRACKET_RULE = ['bracket', 'placeholder', '\\[[^\\]\\n]{1,40}\\]']

// All candidate sample values in one text. Consumed spans are masked so a later
// rule never matches inside an earlier one.
export function findCandidates(lang, text) {
  let work = maskVariables(text)
  const out = []
  for (const [cls, variable, src] of [...genericRules(lang), ...nameRules(lang), BRACKET_RULE, ...countRules(lang)]) {
    const re = new RegExp(src, 'gu')
    work = work.replace(re, (m, ...rest) => {
      const offset = rest.find((x) => typeof x === 'number')
      out.push({ cls, variable, matched: m, offset })
      return '\u0000'.repeat(m.length)
    })
  }
  return out.sort((a, b) => a.offset - b.offset)
}
