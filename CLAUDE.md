# CLAUDE.md · BOOQ (Hunter Tennis Club, first club)

Read this before every task. It sets the rules for building BOOQ with Spec-Driven Development.

## Sources of truth

- `specs/product/prd-v1.2.md` is the Product Requirements v1.2 export. It holds every rule and decision.
- `specs/product/handoff-v1.2.md` is the Developer Hand-off v1.2 export. It holds requirement IDs, architecture and the data model.
- `specs/features/<F##-name>/` holds requirements.md, design.md and tasks.md for each feature.
- The design canvas holds every screen. Build from the hi-fi boards (H-, G-, S-). Thai copy is on the T- boards.
- If code and spec disagree, stop and ask. Never guess a rule.

## How we work

1. Requirements first. Draft requirements.md from the PRD and hand-off, keep the requirement IDs (such as BOOK-03), and write acceptance criteria as Given, When, Then. Wait for approval.
2. Design second. Draft design.md covering tables, migrations, API routes, states, permission checks and the canvas boards used. Wait for approval.
3. Tasks third. Break the design into tasks under a day each in tasks.md. Each task names its requirement IDs.
4. Build one task per run. Write tests from the acceptance criteria first, then the code. Run tests and type checks, tick the task, and name the IDs in the commit message, such as `BOOK-03 hold slot for payment window`.
5. Rule changes start in the PRD, then the hand-off, then the feature spec. Code never gets ahead of the spec.

## Product rules that apply everywhere

- Every query is scoped by club ID. Permissions are checked on the server.
- BOOQ platform staff never see a club's players, bookings, payments, slips, receipts, wallets or reports.
- Never double book a court or a coach, including during payment holds. A solo class reserves court and coach together or not at all.
- Bookings are 60 minutes on the hour for every club.
- Value never goes back as cash. Refunds go to the wallet or package credit.
- Credits and wallet are ledgers of movements, never one editable number.
- All times are Asia/Bangkok. Store money as integer satang.
- Never invent prices, amounts or settings. Values marked TBD in the PRD are club settings with no default.
- Follow Thailand's PDPA. The club is the data controller and BOOQ the processor.

## Text and language files

- Never write user facing text in the code. Every piece of text on a screen, in a LINE message, on a receipt or in an error comes from the language files.
- The files are `locales/en.json` and `locales/th.json`. Keys match the UX copy spreadsheets the writers use, such as `P-0004` (P player app, A club admin, K coach portal, L LINE and receipt, X platform console).
- `locales/copy-index.csv` lists every key with its screens and canvas boards. Look up a key there by screen before using it.
- New text for a feature goes in `locales/pending/<feature>.json` (D81). Only the Content role merges pending keys into `locales/en.json` and `locales/th.json`.
- One key can be used on several screens. Reuse it; never copy the text into a new key.
- When a text holds sample values (names, dates, times, prices, counts), replace them with named variables such as `{amount}`, `{date}` or `{court}` in both files. Keep the same key, and use the same variable names in both languages.
- Never edit the wording of an existing key. Writers own the wording, and their refined files replace these later. If new text is needed, add a new key in both files following the same prefix and numbering, and list it in the task so it goes to the writers.
- The platform console (X keys) is English only. The player app, club admin, coach portal, LINE messages and receipts ship in Thai and English.
- LINE Flex Message cards and PDF receipts read from the same language files, not from text inside the templates.
- Layouts must survive longer text. Thai runs longer and taller, so content areas scroll and buttons never wrap. Test screens with the longest string in either language.
- Dates use the international year in both languages (29 ธันวาคม 2026, never 2569).

## Removed, do not build

A3 Check-in and any check in QR, A11 Gift vouchers, the A15 message editor, and an everyday slip review queue.
