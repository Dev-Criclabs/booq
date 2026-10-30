# Locale files

`en.json` and `th.json` hold every piece of text in BOOQ, by key. Code never holds user facing text (CLAUDE.md, TEXT-01). Writers own the wording; developers own the variables.

| File | What it is | Who changes it |
|---|---|---|
| `en.json` | 1,476 keys. English for P, A, K, L and X | Writers replace it; developers only add variables (TEXT-03) or new keys (TEXT-04) |
| `th.json` | 1,180 keys. Thai for P, A, K, L. No X keys, the platform console is English only (TEXT-05) | Same |
| `variable-candidates.csv` | What is left of the TEXT-03 pass: values that still look like sample data, each with a question or a reason it was kept | Written by `tools/i18n/audit.mjs`, do not edit by hand |
| `copy-index.csv` | Key, screens, canvas boards (TEXT-02). Generated from the canvas (D31); replace it if the writers supply theirs | `node tools/i18n/build-copy-index.mjs <boards-dir>` |
| `copy-index-report.md` | Keys with no board, English/Thai disagreements, texts that fit several keys, board texts with no key | Same script |
| `writer-questions.md` | The open candidates grouped to send to the writers as is | By hand |

Prefixes: P player app, A club admin, K coach portal, L LINE and receipt, X platform console.

## Variables

A variable is `{name}`: letters and digits, starting with a letter. A key has the same set of variables in both languages. `node tools/i18n/audit.mjs` fails when they differ. A brace that is not a variable is an error, so write no literal `{` or `}` in copy.

The app fills variables from data and formats them for the language. Text never does arithmetic or plurals itself. Singular and plural stay as separate keys, the way the writers made them (`P-0161` "spots left", `P-0165` "spot left").

| Group | Variables | Format the app passes in |
|---|---|---|
| Money | `{amount}` `{price}` `{courtPrice}` `{coachPrice}` `{pricePerHour}` `{pricePerClass}` `{dropInPrice}` `{saving}` `{total}` `{rate}` `{baseAmount}` `{friendDiscount}` `{referrerReward}` `{unusedCredit}` `{walletBalances}` | Made from integer satang, with the baht sign and separators: `฿1,200`. The sign is part of the variable |
| Dates | `{date}` Sat 9 Jan, `{dateYear}` Sat 9 Jan 2027, `{dayMonth}` 9 Jan, `{dayMonthYear}` 9 Jan 2027, `{dateLong}` Saturday 9 January, `{dateLongYear}`, `{monthYear}` January 2027, `{dateOfBirth}`, `{startDate}` `{endDate}` | Asia/Bangkok. Years are always international (2026, never 2569). Thai uses Thai day and month names |
| Date parts | `{weekday}` `{day}` `{month}` `{year}` `{startDay}` `{endDay}` | Weekday and month in full words in the language, day and year as numbers |
| Times | `{time}` 18:00, `{startTime}` `{endTime}`, `{openTime}` `{closeTime}` | 24 hour, `HH:mm` |
| Club settings | `{holdMinutes}` payment hold, `{cancelHours}` cancellation window, `{claimMinutes}` waitlist claim time, `{noOfferHours}` no offers within, `{maxHoursInRow}` coach rest cap, `{bookingWindowDays}` | From the club's Settings (A16). No default in code, never invented (BOOK-03, CANCEL-01, CLASS-02) |
| Package terms | `{hours}` `{sessions}` `{validityMonths}` `{remaining}` `{total}` | From the package product |
| Counts | `{count}` `{booked}` `{maxPlayers}` `{minPlayers}` `{marked}` `{used}` `{returned}` `{paid}` ... | Plain numbers |
| Names and ids | `{playerName}` `{firstName}` `{coachName}` `{studentName}` `{friendName}` `{clubName}` `{lineName}` `{code}` `{receiptNumber}` `{referralLink}` ... | `{firstName}` is the given name only; Thai keeps its `คุณ` in front of it |
| Courts | `{court}` in `Court {court}` / `คอร์ต {court}`; `{fromCourt}` `{toCourt}` | The court's number or label, without the word "Court" |

`node tools/i18n/audit.mjs --variables` prints every variable in use with the number of keys.

## Rules for editing

- Never change the wording of a key. A new sentence is a new key in both files, with the next number for its prefix, and goes to the writers. `node tools/i18n/check-wording.mjs <git-ref>` fails if wording changed against that ref (variables count as wildcards) and lists new keys.
- Reuse a key on every screen that needs the same text. Do not copy text into a new key.
- No Buddhist era years. No `2569`.
- Run `node tools/i18n/audit.mjs` before every commit that touches `locales/`.

## `variable-candidates.csv`

One row per value still left in the text that looks like sample data. Columns: `key`, `language`, `matched_text`, `suggested_variable`, `status`, `note`, `question`, `full_text`.

- `status` is `open` (a question for the writers or product) or `kept` (looked at, left on purpose; `note` says why, for example the 60 minute booking rule).
- Open rows go to the writers with their `question`. Answers become a rule in `tools/i18n/rules.mjs` or a decision in `tools/i18n/decisions.mjs`, then `node tools/i18n/apply-text-03.mjs` and `node tools/i18n/audit.mjs` again.

## `copy-index.csv`: how it was made

Generated with Option 2 below by `tools/i18n/build-copy-index.mjs` (decision D31), from 188 boards. Matching is by exact text, so it is a first index for the writers to check, not their sign-off. See `copy-index-report.md` for what did not match. The original notes follow.

CLAUDE.md and TEXT-02 name `locales/copy-index.csv` (key, screens, canvas boards) but nobody supplied it, and it cannot be worked out from the locale files alone, so it is **not invented here**. Developers need it to find which key a screen uses (CLAUDE.md: "Look up a key there by screen before using it").

### Option 1: from the writers (preferred)

The UX copy spreadsheets the writers use already have the key per text. Ask for an export with one row per use of a key:

```
key,screens,boards
P-0004,C01,"H-C01-Welcome; T-C01-Welcome; F1-03-C01-Welcome"
```

- `key` exactly as in the locale files, one row per key, all 1,476 of them.
- `screens` the screen ids used in the hand-off screen inventory (C01, A02, K1, P2 ...), `;` separated when a key serves several (TEXT-02).
- `boards` the canvas board file names without `.dc.html`: the hi-fi boards (`H-`, `G-`, `S-`) and the Thai boards (`T-`). Prototype boards (`F`, `V`, `C`, `A` without a prefix) can be left out.
- A key with no screen is a real signal: unused copy, or copy for LINE and receipts (`L-Msg-*`, `R-Receipt-*`).

### Option 2: generate it from the canvas (read only)

The canvas https://claude.ai/artifact/3Jo8snhzdEXEhVhrRqi3ea was read, nothing was changed. What it holds:

- 353 files. One `project/<Board>.dc.html` per board, for example `project/H-C01-Welcome.dc.html` (English hi-fi) and `project/T-C01-Welcome.dc.html` (the same screen in Thai). `project/canvas.json` is the index of boards with their positions.
- Boards are named `<set>-<screen>-<name>`: `H-` hi-fi, `G-` gap screens, `S-` states, `T-` Thai (also `T-G-`, `T-S-`, `T-L-`), `L-` LINE messages, `R-Receipt-EN/TH`, `K1..K6` coach, `P1..P6` platform. Flow maps are `Flows*.dc.html`.
- The text on a board is plain markup text. **No board carries a copy key.** `H-C01-Welcome` shows "Sign in to book" and `T-C01-Welcome` shows "เข้าสู่ระบบเพื่อจอง"; both are `P-0001` only by matching the text.

A script could build the index in four steps:

1. Download the `H-`, `G-`, `S-`, `T-`, `L-`, `R-` and `K`/`P` boards (`project/*.dc.html`) with the artifact read action.
2. For each board, take every text node (strip tags, split on element boundaries, trim) and note the screen id from the file name.
3. Match each text to a key by exact string. Use the locale files **as they were before TEXT-03** (git commit `6a44fda`) because the boards still show the sample values; or turn each `{variable}` into a pattern in today's files. English matches against the `H-`/`G-`/`S-` boards and Thai against the `T-` boards, which also checks that both languages agree.
4. Write `key,screens,boards`, one row per key, and list unmatched board texts and unused keys separately for the writers.

Limits to expect: the same text is on many screens (that is the point of one key on several screens); text split over several elements (a link inside a sentence, as in P-0006 to P-0009) matches only in parts; identical wording under different keys cannot be told apart by text. Those rows need the writers. The generated file should be reviewed by them before use, and it must never overwrite a file the writers supply.
