// Decisions the TEXT-03 pass and the audit share. Add to these lists, never edit
// the wording of a key. Every entry names its reason so the writers can check it.

// Generic pass skipped: composed summaries, or two values of one kind in a text.
export const SKIP_GENERIC = new Set([
  'A-0217', 'A-0221', 'A-0223', // class template schedule summaries (weekday + time lists)
  'K-0042', 'K-0047', 'K-0050', 'K-0053', // upper case English dates (MON 11 JAN)
])

// Texts that are only a placeholder name. They may be a field label, not a sample.
export const WHOLE_STRING_PLACEHOLDERS = new Set(['P-0066', 'A-0031', 'A-0187', 'K-0008', 'K-0029'])

const FIXED_60 = 'Bookings and classes are always 60 minutes for every club (CLAUDE.md), so this is a rule, not a setting'
const ONE_CREDIT = 'One credit per class or session (PKG rule), so 1 is a rule, not a sample'
const WIZARD = 'Fixed numbering of the onboarding steps (1 to 9), not sample data'
const AGE = 'Adult and Student audiences split at age 18 (PRD), a rule'
const FIXED_SPEC = (what) => `${what} is fixed in the PRD, not a club setting`

// [keys or null for any key, regex tested on the matched text, reason]
const KEPT = [
  [null, /^60 ?(?:minutes?|min|นาที)$/, FIXED_60],
  [['A-0332', 'A-0333', 'A-0334', 'X-0254'], /^\d+ ?(?:min|นาที)?$|^\d+$/, FIXED_SPEC('The hold choices 10, 15 and 20 minutes and the 60 minute backup hold')],
  [['X-0252', 'X-0095'], /\d+/, FIXED_60],
  [['P-0180', 'P-0199', 'P-0308', 'P-0309', 'P-0312', 'P-0378', 'A-0147', 'L-0039', 'P-0303', 'P-0427', 'A-0279'], /^1(?!\d)/, ONE_CREDIT],
  [['P-0293', 'P-0434', 'A-0251', 'A-0427'], /^1(?!\d)/, 'One coach per solo class, one promo code per order (PRD rules)'],
  [['A-0434', 'A-0528', 'A-0530'], /^18/, AGE],
  [['L-0021', 'L-0028'], /^\d+/, FIXED_SPEC('Reminders go 24 h and 2 h before start')],
  [['A-0351'], /^\d+/, FIXED_SPEC('Package expiry reminders go 14 and 3 days before expiry')],
  [['A-0363', 'X-0213'], /^24/, FIXED_SPEC('Support access lasting 24 hours')],
  [['P-0011', 'A-0486'], /^[24]$/, 'Fixed form structure (two details to fill, four ticks), the English uses a word'],
  [['X-0111'], /^4$/, 'Fixed label (last 4 digits of the account number)'],
  [['X-0114'], /^6$/, WIZARD],
  [['A-0384'], /^7\b/, 'Fixed option label of a report filter'],
  [['X-0017'], /^30\b/, 'Fixed label of the console column (last 30 days)'],
  [['X-0045'], /13/, 'Helper text that says how many digits a tax ID has'],
  [['X-0033', 'X-0039', 'X-0062', 'X-0072', 'X-0096', 'X-0116', 'X-0136', 'X-0137', 'X-0138', 'X-0139',
    'X-0140', 'X-0142', 'X-0144', 'X-0146', 'X-0147', 'X-0148', 'X-0149', 'X-0164', 'X-0228', 'X-0288',
    'A-0491', 'A-0493', 'A-0495', 'A-0497', 'A-0499', 'A-0501', 'A-0504'], /^\d+/, WIZARD],
]

export function isKept(key, c) {
  for (const [keys, re, reason] of KEPT) {
    if ((!keys || keys.includes(key)) && re.test(c.matched)) {
      if (!keys && c.matched.startsWith('60') && BACKUP_HOLD.has(key)) continue
      return reason
    }
  }
  return ''
}

// Backup mode holds a slot 60 minutes. Whether that is fixed or a setting is a question.
const BACKUP_HOLD = new Set(['P-0439', 'A-0459', 'A-0461'])

const Q = {
  'P-0066': 'Is this a field label (keep) or a sample coach name on a card ({coachName})?',
  'A-0031': 'Is this a field label (keep) or a sample player name ({playerName})?',
  'L-0025': 'Is this a field label (keep) or a sample coach name ({coachName})?',
  'A-0187': 'Is this a field label (keep) or a sample coach name ({coachName})?',
  'K-0008': 'Is this a field label (keep) or a sample student name ({studentName})?',
  'K-0029': 'Is this a field label (keep) or a sample player name ({playerName})?',
  'P-0072': '"Set of 3 balls" looks like a shop item name from the club catalogue. Is the name data (then this key is not needed) or copy? If copy, 3 becomes {count}.',
  'A-0048': '"Set of 3 balls" looks like a shop item name from the club catalogue. Same question as P-0072.',
  'P-0245': 'Is "Friend 1" a sample or a list placeholder? If a sample, {friendName}.',
  'P-0247': 'Is "Friend 2" a sample or a list placeholder? If a sample, {friendName}.',
  'P-0354': 'Ordinal "1st in line": en and th need different ordinal formats. Suggest {position} with en "1st" and th "1"? Writers to confirm.',
  'P-0357': 'Ordinal "2nd in line": same question as P-0354.',
  'P-0397': '"Hunter" is the short club name. Needs a second variable ({clubShortName}) next to {clubName}. Confirm.',
  'A-0541': '"Hunter" is the short club name. Same question as P-0397.',
  'X-0235': '"Hunter\'s setup" is the template name. Is it data (the template list) or copy?',
  'P-0401': 'English says "Two" in words, Thai has the digit 2. Number of courts: {courtCount}? Needs the English word changed, which is the writers\' call.',
  'P-0439': 'Backup mode hold is 60 minutes in the PRD. Fixed rule (keep) or a setting ({backupHoldMinutes})?',
  'A-0459': 'Backup mode hold is 60 minutes in the PRD. Same question as P-0439.',
  'A-0461': 'Backup mode hold is 60 minutes in the PRD. Same question as P-0439.',
  'K-0042': 'English is upper case (MON 11 JAN), Thai is not. Use {date} and upper case it with styling? Writers to confirm.',
  'K-0047': 'Same question as K-0042.', 'K-0050': 'Same question as K-0042.', 'K-0053': 'Same question as K-0042.',
  'K-0069': 'Says "7th hour", which is the rest rule limit plus 1. Needs {nextHourInRow} with ordinal formatting, or reword. Writers to confirm.',
  'A-0346': 'Says "7th hour", which is the rest rule limit plus 1. Same question as K-0069.',
  'A-0073': 'Is "No visit in 30 days" a fixed filter or a setting? Not in the PRD.',
  'A-0217': 'Schedule summary (weekdays and times of a template). Is it composed from data? Then the key may not be needed.',
  'A-0221': 'Same question as A-0217.', 'A-0223': 'Same question as A-0217.',
  'A-0279': '"the 1st of the month" is the birthday message day. Fixed rule or a setting? Not in the PRD.',
  'A-0357': 'Tax ID and "Head office" are the club\'s real registered details (settled). Should they be {taxId} and {branch} club settings?',
  'L-0043': 'Tax ID and "Head office" on the receipt are the club\'s registered details. Same question as A-0357.',
  'A-0508': 'Rich menu has three editable labels in A0 but six tiles in the image (gap C4). Left until decided.',
  'A-0510': 'Same question as A-0508.', 'A-0512': 'Same question as A-0508.',
  'P-0076': 'Thai says "1 ชั่วโมง" where English says "Court hour". The digit is in the Thai only, so it is not changed. Writers to align.',
  'A-0306': 'Same question as P-0076.',
  'P-0145': 'Same question as P-0072 for the shop item "set of 3".',
  'P-0279': 'Thai says "ทั้ง 2 คอร์ต" where English says "either court". The club has two courts today; a digit in Thai only is left. Writers to align.',
  'A-0348': 'What does [X] h before stand for (cancel hours?). Named {hours} until confirmed.',
  'A-0540': 'Are [From] and [To] dates, hours or amounts? Named {from} and {to} until confirmed.',
  'X-0089': '[Yes or no] is a placeholder for a yes or no value. Name it {yesNo}? Left.',
  'A-0446': 'Check the sample: "0 of 3 coaches" paid. OK as {paid} of {total}.',
}
const BY_CLASS = {
  of: 'Two numbers: which is the count and which is the total or maximum?',
  ordinal: 'Ordinal needs locale formatting. Confirm the variable.',
}

export function questionFor(key, c) {
  return Q[key] || BY_CLASS[c.cls] || ''
}
