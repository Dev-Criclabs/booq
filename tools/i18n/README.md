# tools/i18n

Dependency free Node scripts (Node 20+) for the locale files. They read `locales/en.json` and `locales/th.json` and nothing else.

| Command | What it does | Fails when |
|---|---|---|
| `node tools/i18n/audit.mjs` | Checks both files and rewrites `locales/variable-candidates.csv`. `--strict` also fails on open candidates, `--no-csv` writes nothing, `--variables` lists variables in use | key parity broken (X keys are English only), variable sets differ between languages, stray `{` `}`, empty value, a Buddhist era year |
| `node tools/i18n/apply-text-03.mjs [--dry-run]` | The TEXT-03 pass: swaps sample values for named variables in both files, same key, same wording. Safe to run again | a rule finds nothing, two values of one kind in one text, variables end up different between languages |
| `node tools/i18n/check-wording.mjs <git-ref>` | TEXT-04 guard: wording of existing keys unchanged against a ref. Lists new keys for the writers | wording changed or a key removed |
| `node tools/i18n/lint-hardcoded-text.mjs [paths]` | TEXT-01: no user facing text in source | see the rules below |
| `node --test tools/i18n/test/*.test.mjs` | Self tests. Set `I18N_TS_FROM=<dir with node_modules/typescript>` to include the lint test | |

Wire these into the app's `package.json` once it exists, for example `"i18n:audit": "node tools/i18n/audit.mjs --no-csv"`, `"i18n:lint": "node tools/i18n/lint-hardcoded-text.mjs src app"`, and run both in CI.

## Where the TEXT-03 decisions live

- `rules.mjs`: per key `literal=name` substitutions. Policy numbers get club setting names (`holdMinutes`, `cancelHours`, `claimMinutes`, `noOfferHours`, `maxHoursInRow`, `bookingWindowDays`). The header explains the syntax.
- `lib.mjs`: the generic detectors (dates, times, money, courts, receipts, names) shared by the audit and the pass.
- `decisions.mjs`: what was kept on purpose (with the reason), what is a question for the writers, which keys skip the generic pass.

To resolve a question: edit `rules.mjs` or `decisions.mjs`, run the pass, run the audit, run `check-wording.mjs HEAD`.

## The hard coded text lint

Rule (also in CLAUDE.md): every piece of text on a screen, in a LINE message, on a receipt or in an error comes from `locales/*.json` by key. The code holds keys (`t('P-0100', { holdMinutes })`) and never sentences.

Checked, on the syntax tree when `typescript` can be found (the Next.js app has it; use `--ts-from DIR` otherwise), on lines of text when not:

| Rule | Catches |
|---|---|
| `jsx-text` | words between JSX tags |
| `jsx-attr` | `placeholder` `title` `alt` `aria-label` `label` `description` `tooltip` ... set to a sentence or capitalised word |
| `ui-call` | `toast(...)` `alert(...)` `confirm(...)` `notify(...)` `setError(...)` with a string |
| `error-message` | `new Error('Court is taken')`. Throw an error code and map it to a key at the edge |
| `user-prop` | `text:` `altText:` `label:` `title:` `message:` `body:` ... with a string: LINE Flex Message cards, PDF receipt lines, Next.js `metadata` |
| `thai-text` | any string holding Thai letters |
| `locale-copy` | a string equal to a multi word value in the locale files |
| `unknown-key` | `t('P-9999')` where the key is missing from `en.json`, or from `th.json` (X keys excepted) |
| `missing-vars` | `t('P-0100')` without the `{variables}` that text needs, or with names it does not use |

Not text, so not flagged: ids, paths, urls, CSS classes, `camelCase` and `CONSTANT` names, keys such as `P-0004`.

Exceptions: `// i18n-ignore <reason>` on the line or the line above (log lines, internal assertions), `// i18n-ignore-file` in the first 5 lines. Never for text a player, staff member, coach or LINE user can see.

Skipped by default: `node_modules`, `.next`, `dist`, `build`, `coverage`, `locales`, `specs`, `docs`, `tools`, `public`, `migrations`, `__tests__`, `e2e`, `fixtures`, `*.test.*`, `*.spec.*`, `*.stories.*`, `*.d.ts`, `*.config.*`.

Known limits: the rules look at literal strings. Text built from pieces (`'Court ' + n`) or read from a database is not seen; the `locale-copy` and `thai-text` rules catch most of it. Add the app's own helper names to `UI_CALLS`, `T_CALLS` and `USER_PROPS` at the top of the script when it has them.
