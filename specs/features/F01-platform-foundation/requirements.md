# F01 Platform foundation · Requirements

Status: **DRAFT for approval (gate 1).** Drafted 30 Oct 2026. Nothing here is approved until a person says so. No design or code follows until then.

Feature: F01 Platform foundation (clubs, locations, resources, roles, settings, audit). Depends on: Booq core. Requirement IDs: PLAT-01 to PLAT-06, PDPA-01. Wave 1.

## Sources

| Short name | File | Sections used |
|---|---|---|
| PRD | `specs/product/prd-v1.2.md` | Users, roles and app structure; BOOQ platform and club onboarding (Who uses it, What a club needs before it can go live, Platform console pages, Platform flows, Pausing a live club, Support access, What changes in the club app, Platform foundation); Quality and scope; Open questions for the platform |
| HO | `specs/product/handoff-v1.2.md` | Architecture; Data model; Business rules as requirements; Roles, platform console and data protection (PLAT-01 to PLAT-06, PDPA-01); Text and language files (TEXT-01 to TEXT-06) |
| Plan | `docs/DEVELOPMENT-PLAN.md` | Section 4 (settings that are empty, not blockers) |
| Gaps | `docs/canvas-gaps.md` | A2, A7, C3, C5, C7 |

The spec wins over the canvas. Where the canvas shows something the spec does not say, it is listed in Open questions, not built.

## Scope

In scope for F01:

- The club record and its lifecycle (Draft, Testing, Live, Paused), locations, resources (courts), opening hours.
- Club ID scoping of every record, and the block that keeps BOOQ staff away from a club's player, booking and payment data.
- The roles and permission checks for the seven roles.
- The club settings store (values, empty TBD values, change history). The Settings screen itself (A16) is built in F11.
- The audit log write path for club staff and BOOQ staff. The audit log screens (A17, P6) are built in F11 and F15.
- Feature switches per club, and sport templates (what a template is and how a new club starts from one).
- CSV import (players, packages, balances) and data export (club data, customers).
- The PDPA rules that apply to the whole platform.

Out of scope for F01 (other features own them): LINE Login and first sign in (F02), booking, holds and uniqueness rules (F03), pricing and add-ons (F04), Beam (F05), ledgers (F06), LINE messages (F10), the A0 to A17 screens (F11), the P1 to P6 screens (F15). F01 supplies the data and server rules those screens call.

## Canvas legend

H- hi-fi, G- gap states, S- states, T- Thai twin (every English board has a T- twin with the same name, per HO Screen inventory). F4- boards are the Step 6 clickable flow copies of the H- boards and are not listed again. Build from H-, G-, S-. Boards named below are the ones that exist in the canvas file list on 30 Oct 2026.

## Cross-cutting rules (apply to every requirement below)

**CC-1 Club ID scope.** Every record carries a club ID. Every query is filtered by club ID on the server, and a row level rule backs it (PRD What changes in the club app; HO Data model; CLAUDE.md). Nothing is shared between clubs. A request for another club's record behaves as not found.

**CC-2 Server side permissions.** The client only shows and collects. The server checks the caller's role for every read and write (PRD Quality and scope; HO Roles).

**CC-3 PDPA.** The club is the data controller and BOOQ the processor (PDPA-01). Each requirement says what personal data it touches and how it stays inside that rule.

**CC-4 No double booking.** F01 holds no booking logic. Where it matters, F01 must not weaken it: resources have a stable ID that the uniqueness rule in F03 keys on, an inactive resource cannot be booked, and a closure or pause never deletes a booking. Each requirement says "not relevant" when that is the case.

**CC-5 Language files (TEXT-01 to TEXT-06).** Every screen text, error and message comes from `locales/en.json` and `locales/th.json` by key. Keys follow the writers' prefixes (P player, A club admin, K coach, L LINE and receipt, X platform console). One key can serve several screens. Sample values become named variables with the same names in both files. Existing wording is never edited, new text gets a new key in both files and is listed for the writers. The platform console (X keys) is English only. Everything else ships in Thai and English. Layouts survive the longest string, buttons never wrap and content areas scroll. Dates use the international year in both languages. The F01 text keys are listed per requirement; `locales/copy-index.csv` does not exist yet, so key lookup by screen is a task for the content role before design.

**CC-6 Other platform rules.** All times Asia/Bangkok. Money as integer satang. Never invent a price, amount or setting: a value marked TBD is an empty club setting.

---

## Roles (PRD Users, roles and app structure; HO Roles, platform console and data protection)

Seven roles. Five belong to a club, two to BOOQ. A person signs in with LINE (F02) and the role decides the surface and the data.

| Role | Belongs to | Surface | Can | Cannot |
|---|---|---|---|---|
| Player (adult or student) | Club | Player app | Book, buy, pay, cancel, see own credits, receipts and referrals | See other players |
| Coach | Club | Coach portal | Own schedule, availability, leave, attendance, notes, own earnings | See other coaches, payments or revenue |
| Front desk | Club | Club admin | Bookings, walk ins and cash, customers | See revenue or coach pay, change prices, rules or staff |
| Accountant | Club | Club admin, finance pages | Read and export reports and receipts | Change bookings, prices or balances |
| Owner | Club | Club admin, everything | All of the above plus prices, packages, promotions, rules, staff, coach pay | Nothing restricted (for the club's own data) |
| Platform admin | BOOQ | Platform console | Create and set up clubs, change status, pause with a reason, setup only support view | See players, bookings, payments, slips, receipts, wallets or reports |
| Onboarding specialist | BOOQ | Platform console | Same as platform admin for assigned clubs | Pause or delete clubs |

Admin console pages by role, from PRD Coach portal and admin console (front desk and owner share A1, A2, A5, A6, A12; owner only A7, A8, A9, A10, A16, A17; owner and accountant A13, A14; A4 only in backup mode; A0 owner only until live). F11 turns this into the sidebar. F01 supplies the permission check behind it.

**ROLE-AC (acceptance criteria for the roles table, no separate ID in the spec; they are tested under PLAT-04 and CC-2).**

- ROLE-AC1. Given a signed in front desk user, when they request revenue, coach pay, prices, rules or staff data, then the server refuses, whatever the screen shows.
- ROLE-AC2. Given a signed in accountant, when they try to change a booking, price or balance, then the server refuses and nothing changes.
- ROLE-AC3. Given a coach, when they request another coach's schedule, any customer payment or club revenue, then the server refuses.
- ROLE-AC4. Given a player, when they request another player's data, then the server returns not found.
- ROLE-AC5. Given an onboarding specialist, when they open a club not assigned to them, then the server refuses. When they try to pause or delete any club, then the server refuses.
- ROLE-AC6. Given a user of club A with any role, when they request a record of club B, then the server returns not found (CC-1).

Canvas: H-A17-Staff-audit (invite and role assignment), H-P6-Team-audit (platform roles), T- twins for the admin pages (X pages have no Thai twin, TEXT-05).

Open: a person with two roles at one club, who may deactivate an owner, onboarding specialist status changes. See Open questions Q2, Q3, Q4.

---

## PLAT-01 Club status

**Source.** HO PLAT-01. PRD Platform console pages P3 and P4, Flow J, Pausing a live club.

**Requirement.** Club status runs Draft, Testing, Live, Paused. Go live needs every check in P4 passed.

**What this means for build.** A club has exactly one status. Status changes are made only by BOOQ staff in the platform console, never by the club. The set of checks Go live needs is the P4 list (HO and PRD; see Q7 for the list's open points).

**Acceptance criteria.**

- PLAT-01-AC1. Given a new club created in P2, when it is saved, then its status is Draft, and every later P2 save keeps it Draft.
- PLAT-01-AC2. Given a Draft club, when steps 1 to 8 of the setup are not all done, then the server refuses the change to Testing and P3 shows what is missing and who owes it (PRD Platform flows: Flow J).
- PLAT-01-AC3. Given a Testing club, when any P4 Go live check is not passed, then the server refuses the change to Live, whatever the screen shows. When every check is passed and BOOQ staff press Go live, then the status is Live and the change is written to the P6 log.
- PLAT-01-AC4. Given a club on a blank template, when it has no product, or any rule is unset, then Go live is refused (PRD P5). A product with a price counts; the exact rule list is Q7.
- PLAT-01-AC5. Given a Draft or Testing club, when a player opens the player app, then the club is not visible to players (P4 "Players can't see the club yet"). Who can test is Q6.
- PLAT-01-AC6. Given a Testing club, when it goes Live, then its test bookings are deleted (P4 "Test bookings will be cleared, deleted at Go live"). Receipt numbers are Q8.
- PLAT-01-AC7. Given a club of any status, when any status change is made, then it records who, when, old status, new status and, for Paused, the reason (PLAT-04).
- PLAT-01-AC8. Given an onboarding specialist or platform admin, when they request a status change on a club that is not assigned to them, then the server refuses (role table; CC-2).
- PLAT-01-AC9. Given a Failed test, when the club is Draft or Testing, then it stays in that status and P3 shows what is missing and who owes it (PRD Flow J).

**Meets.**

- PDPA: status holds no personal data. The Testing clear step deletes test data only, never a live player's data.
- No double booking: not relevant, except that Go live must not delete real bookings. The clear step is limited to bookings flagged as test.
- Club scope: status is a field on the club record; a status change addresses one club ID.
- TEXT: P3, P4 and P1 are X keys, English only. Status labels (Draft, Testing, Live, Paused) come from X keys already in `en.json` (to be confirmed by key lookup).

**Canvas.** H-P1-Clubs, H-P1-Clubs-clear, H-P1-Clubs-paused, H-P2-Step1-Basics to H-P2-Step5b-Payments-slip, H-P3-Club-detail, H-P3-Club-alert, H-P3-Club-fixed, H-P3-Club-live, H-P4-Launch.
Note Gaps A2: H-P4-Launch lists "fake slip" tests, which belong to slip clubs. Hunter pays by Beam, so the P4 list for a Beam club needs a decision (Q7).

---

## PLAT-02 Support view (setup only)

**Source.** HO PLAT-02. PRD Support access, Platform admin row of the roles table, Open questions for the platform (settled 30 Oct 2026).

**Requirement.** The support view shows setup only: courts, products and pricing, LINE, payment connections, settings. Draft and Testing clubs are editable. Live clubs are look only, unless the owner turns on Allow BOOQ to make changes, which lasts 24 hours.

**Acceptance criteria.**

- PLAT-02-AC1. Given BOOQ staff in a club's support view, when they request players, bookings, payments, slips, receipts, wallets or reports, then the server refuses, even with a direct API call (CLAUDE.md "BOOQ platform staff never see...").
- PLAT-02-AC2. Given a Draft or Testing club, when BOOQ staff change a setup value in the support view, then the change is saved.
- PLAT-02-AC3. Given a Live club with Allow BOOQ to make changes off, when BOOQ staff try to change any value, then the server refuses and the support view shows look only.
- PLAT-02-AC4. Given a Live club, when the owner turns on Allow BOOQ to make changes, then BOOQ staff can edit setup values. When 24 hours have passed, then it turns off by itself and further edits are refused, with no action by anyone.
- PLAT-02-AC5. Given the 24 hour window is on, when the owner turns it off early, then edits stop at once.
- PLAT-02-AC6. Given any support view visit or change by BOOQ staff, when it happens, then it is logged in P6 and in the club's own staff audit log with the BOOQ staff name (PRD Support access; PLAT-04).
- PLAT-02-AC7. Given a Paused club, when BOOQ staff open the support view, then it behaves as a Live club (look only unless the window is on). Paused is not in the spec for this rule; see Q9.
- PLAT-02-AC8. Given the Messaging API token or another secret, when it is shown in the support view, then it is masked to the last four characters (H-P2-Step4-LINE shows last 4). Whether staff can read or replace the full value is Q10.
- PLAT-02-AC9. Given a platform user without access to the club, when they open its support view, then the server refuses (assigned clubs only for the specialist, ROLE-AC5).

**Meets.**

- PDPA: this is the data processor limit in code. BOOQ staff see setup only. No personal data of players is readable. The club's staff audit log contains player names (H-A17 rows), so it is also outside the support view; only the entries about BOOQ visits are shown to the owner.
- No double booking: not relevant. Edits to courts or hours by BOOQ staff never delete a booking; a change that would conflict with existing bookings is handled as a closure (F11 A12).
- Club scope: support view is bound to one club ID at a time.
- TEXT: X keys for the console (English only). The owner's A16 switch uses A keys (Thai and English), with A-0362 "Allow BOOQ to make changes".

**Canvas.** H-P3b-Support-view, H-A16-Settings (BOOQ support block), F5a-03-P3b-Support-view (flow copy).

---

## PLAT-03 Pause a club

**Source.** HO PLAT-03. PRD Pausing a live club, Platform flow K, P3c.

**Requirement.** Pausing turns off new booking and buying, keeps existing bookings and reminders, moves package and wallet expiry forward by the pause length, and shows a banner in the club admin.

**Acceptance criteria.**

- PLAT-03-AC1. Given a Live club, when a platform admin pauses it with a reason, then the status is Paused, the reason is stored and the owner gets a LINE message with the reason (P3c "The club owner gets a LINE message with the reason").
- PLAT-03-AC2. Given a pause request without a reason, when it is submitted, then it is refused (P3c "Reason, required").
- PLAT-03-AC3. Given an onboarding specialist, when they try to pause, then the server refuses (role table).
- PLAT-03-AC4. Given a Paused club, when a player tries to start a new booking or purchase, then the server refuses, including a direct API call, and the app shows "Online booking is paused for now. Message the club on LINE for help." (P-0442 "Online booking is paused for now"; exact string by key).
- PLAT-03-AC5. Given a Paused club, when a player opens the app, then Book a court, Classes and Packages show as paused and upcoming bookings still show (PRD Pausing).
- PLAT-03-AC6. Given an existing booking, when the club is paused, then the booking stays valid and its LINE reminders still go out.
- PLAT-03-AC7. Given a package or wallet balance with an expiry date, when the club is resumed, then every expiry date moves forward by the length of the pause (start to end). The ledger records one movement per package with a reason, not a silent edit. Credits and wallet stay ledgers (PKG-01). Whether a wallet with no expiry is touched is Q11.
- PLAT-03-AC8. Given a Paused club, when the owner or staff open the club admin, then it works and every page shows a banner with the reason and a Message BOOQ button (H-A01 pause banner, S-A01-Paused).
- PLAT-03-AC9. Given a payment already started before the pause, when it completes after the pause begins, then it is handled by the PAY-03 rules (F05), not refused. Stated here only so F05 and F01 agree; the spec does not say. See Q12.
- PLAT-03-AC10. Given any pause or resume, then it is written to the P6 log and the club's audit log (PLAT-04).

**Meets.**

- PDPA: the pause reason and the owner's LINE ID are the only personal data touched. Pausing never exposes player data to BOOQ staff.
- No double booking: pausing removes new holds; existing bookings and holds are kept. Holds in progress at the moment of pause run to their normal end and release. A pause never cancels or moves a booking.
- Club scope: the pause is a field of one club; the expiry shift touches only that club's rows.
- TEXT: P3c is X keys (English only). Player paused text and A banner use P and A keys in both languages (P-0442, A-0519 and others, to be confirmed by lookup). Pause length shown with named variables.

**Canvas.** H-P3c-Pause-club, H-P3-Club-live, H-P1-Clubs-paused, S-C03-Paused (T-S-C03-Paused), S-A01-Paused (T-S-A01-Paused), F5b-preview-A01-Paused, F5b-preview-C03-Paused.

---

## PLAT-04 Audit log

**Source.** HO PLAT-04. PRD Users, roles and app structure ("Every change to a booking, balance, price or setting goes to the audit log"), Data model (Audit entry), P6.

**Requirement.** Every change to a booking, balance, price or setting writes an audit entry. Every platform action also writes to P6.

**Acceptance criteria.**

- PLAT-04-AC1. Given a change to a booking, a credit or wallet balance (any ledger movement made by staff), a price or a setting, when it is saved, then one audit entry is written in the same transaction, holding actor, time, record type and ID, old value, new value and reason.
- PLAT-04-AC2. Given the change cannot write its audit entry, when the transaction runs, then the whole change is rolled back (no unaudited change).
- PLAT-04-AC3. Given a staff adjustment to credits or wallet, when it is submitted without a written reason, then it is refused (PRD Credits and wallet; PKG-01).
- PLAT-04-AC4. Given a change made by BOOQ staff, when it is saved, then the entry names the BOOQ staff member and appears in P6 and in the club's own audit log (PRD Support access).
- PLAT-04-AC5. Given any platform action (create club, status change, support view visit, pause, test run, export, invite), when it happens, then a P6 entry is written with club, who and what.
- PLAT-04-AC6. Given an audit entry, when anyone tries to edit or delete it, then the server refuses; entries are append only (H-P6-Team-audit "Nothing here can be edited or deleted"). The same holds for the club log.
- PLAT-04-AC7. Given an owner, when they open the audit log, then they can search and filter it by staff, record and date (PRD A17; screen is F11).
- PLAT-04-AC8. Given a front desk, accountant or coach, when they request the audit log, then the server refuses (A17 is owner only).
- PLAT-04-AC9. Given the Staff and audit log, when it lists an entry about a player, then it shows what the club needs to run the business; BOOQ staff cannot read it (PLAT-02-AC1).
- PLAT-04-AC10. Given a PDPA copy or delete request, when it is made or handled, then it is logged in the club's audit log (G-C17-Privacy, "Every request is recorded in the audit log"; PDPA-01).
- PLAT-04-AC11. Given times in entries, when they are stored and shown, then they are Asia/Bangkok.

**Meets.**

- PDPA: the audit log holds old and new values that may include personal data, so it is club scoped, staff only, and outside BOOQ's view. Retention and what happens to entries when a player is deleted are Q13.
- No double booking: a booking move or cancel is audited, including who moved it. The audit does not enforce uniqueness (F03 does).
- Club scope: each entry has a club ID; a platform entry carries the club ID it concerns, or none for team actions.
- TEXT: A17 uses A keys in both languages; P6 uses X keys, English only. Audit "change" text comes from keys with named variables (record, old, new), not strings assembled in code.

**Canvas.** H-A17-Staff-audit (T-A17-Staff-audit), H-P6-Team-audit, F5a/F5b flow copies.

---

## PLAT-05 Feature switches and templates

**Source.** HO PLAT-05. PRD Platform foundation (Templates row), Running many clubs, P5.

**Requirement.** Feature switches per club, one codebase. Templates Tennis (Hunter), Padel, Pickleball, Blank.

**Acceptance criteria.**

Feature switches

- PLAT-05-AC1. Given one codebase for every club, when a feature switch is set on one club, then it changes that club only (CC-1).
- PLAT-05-AC2. Given a switch is off for a club, when any surface or API of that club asks for the feature, then the server refuses and the surface hides it. A hidden screen is not enough.
- PLAT-05-AC3. Given a switch, when it is changed, then it is written to the audit log (it is a setting; PLAT-04).
- PLAT-05-AC4. Given a club's payment option (Beam or slip checking), when it is read, then it behaves as a club level choice made in P2 step 5 (PAY-01), and slip checking and backup mode are features that exist only when slip checking is chosen (F16).
- PLAT-05-AC5. Given Hunter, when it runs, then nothing is written only for Hunter. Tennis, two courts, ฿500 an hour and Beam are club settings or switches (HO Architecture).
- PLAT-05-AC6. Given the list of switches, when F01 ships, then it contains only switches the spec names. The list itself is Q5.

Templates

- PLAT-05-AC7. Given the Tennis template, when a new club starts from it, then products, prices and rules are copied to that club as its own values. Later changes to the template do not change existing clubs ("Changes only affect new clubs", H-P5).
- PLAT-05-AC8. Given the Blank template, when a new club starts from it, then it has no products and empty club rules (PRD P5), and the owner adds everything in Pricing.
- PLAT-05-AC9. Given a template, when a template value is a TBD, then it is copied as empty. No value is invented.
- PLAT-05-AC10. Given sport labels, when a club uses a template, then labels follow the sport (court, table, lane) from the template (PRD Platform foundation, P5).
- PLAT-05-AC11. Given Padel and Pickleball, when F01 ships, then they appear as templates marked "to build" and cannot be chosen until built (H-P5 text "To build before the first padel club"). Their content is out of scope.
- PLAT-05-AC12. Given a platform admin or specialist, when they pick a template in P2 or A0, then the chosen template is recorded on the club and the copy is written to the audit log.
- PLAT-05-AC13. Given Tennis template values, when they are loaded, then they equal the final offer in PRD Pricing and packages (court ฿500, 10 hour bundle ฿4,500 for 3 months, 20 hour bundle ฿8,000 for 5 months, solo and group single prices and 8 packs for Adult and Student) and the rules in HO Business rules. They are stored as integer satang. The values are copied from the spec; none are added.
- PLAT-05-AC14. Given a template editing screen ("New template", "Duplicate", "Edit" are on H-P5), when F01 is built, then whether those actions exist is decided in Q5.

**Meets.**

- PDPA: switches and templates hold no personal data.
- No double booking: a template can set the number of resources and hours but never the 60 minute booking unit (fixed for every club).
- Club scope: a template is platform data (no club ID); a copy is club data (club ID set at copy).
- TEXT: P5 is X keys, English only. Template names and sport labels the player sees are Thai and English fields.

**Canvas.** H-P5-Templates, H-P5b-Templates-blank, H-A09b-Pricing-groups (T-A09b), H-P2-Step3-Courts.

---

## PLAT-06 CSV import and data export

**Source.** HO PLAT-06. PRD Onboarding friction fixes ("CSV import for players, packages and balances in A0 step 7... Export club data in P3 gives a clean exit"), A5 (CSV export), Reports (every report exports to CSV).

**Requirement.** CSV import of players, packages and balances in A0. Export club data in P3.

**Acceptance criteria.**

CSV import (owner, in A0 step 7)

- PLAT-06-AC1. Given an owner in A0 step 7, when they upload a CSV of players, packages or balances, then the server validates every row before saving and shows the rows that fail, with the reason. Nothing is saved until the owner confirms (preview first).
- PLAT-06-AC2. Given an import with any invalid row, when the owner confirms, then valid rows may be saved only if the owner chooses it; the default is all or nothing. Which is the default is Q14.
- PLAT-06-AC3. Given a balances file, when it is imported, then each balance becomes ledger movements with a reason and the owner as actor, never a single editable number (PKG-01). The ledger reasons in the spec are reserve, return, use, forfeit, expire, adjust, so the reason for imports is Q15.
- PLAT-06-AC4. Given a packages file, when it is imported, then each row creates a customer package with a total, purchase date and expiry date, and one ledger row per used credit. Expiry is taken from the file (the purchase date plus validity rule in PKG-02 cannot be recomputed for old purchases). See Q15.
- PLAT-06-AC5. Given an import file, when a row has a club ID column or any other club's identifier, then it is ignored; the club ID is always the importing club (CC-1).
- PLAT-06-AC6. Given an import, when it completes, then one audit entry records who, when, file name, counts of rows read, saved and rejected, and each created balance is audited (PLAT-04).
- PLAT-06-AC7. Given an import, when a player in the file later signs in with LINE, then they are matched to the imported record by the rule the spec defines. The spec defines none, see Q16. No automatic match is built until then.
- PLAT-06-AC8. Given a front desk, accountant, coach or BOOQ staff, when they try to import, then the server refuses (the PRD puts it in A0, an owner page; whether BOOQ staff may help is Q17).
- PLAT-06-AC9. Given a CSV file, when it holds amounts, then amounts are read as THB and stored as integer satang, and dates are read as Asia/Bangkok and shown with the international year.
- PLAT-06-AC10. Given an uploaded file, when the import is finished or cancelled, then the raw file is not kept longer than the import needs (PDPA data minimisation; retention is Q13).

Data export

- PLAT-06-AC11. Given a club, when "Export club data" is run, then the export holds only that club's records (CC-1).
- PLAT-06-AC12. Given BOOQ staff press Export club data in P3, when the export is made, then BOOQ staff cannot open, download or read the content. Where it goes and who receives it is Q1 (this conflicts with H-P3-Club-detail; see Q1). No export is built until Q1 is answered.
- PLAT-06-AC13. Given an owner or front desk in A5, when they press Export CSV, then they receive the customer list CSV for their club (PRD A5 shows CSV export for front desk and owner).
- PLAT-06-AC14. Given an accountant or owner in A13 and A14, when they export a report or receipts, then they receive CSV or PDF for their club (PRD Reports, Receipts). Built in F13 and F11. F01 owns only the rule that exports are club scoped and audited.
- PLAT-06-AC15. Given any export of customers or club data, when it is made, then an audit entry records who, when, which export and how many rows (PLAT-04), because exports carry personal data.
- PLAT-06-AC16. Given an export file, when it is produced, then slips and staff notes are included only in the full club export, and only if Q18 says so (PDPA-01: staff only).

**Meets.**

- PDPA: an import loads personal data the club already holds, so the club is the controller and must have its own lawful basis. First sign in still asks for consent (PDPA-01, F02), so an imported player is asked at their first sign in, not treated as consented. Exports are controlled access, audited and never delivered to BOOQ staff (Q1).
- No double booking: an import of players, packages and balances creates no bookings. If a bookings import is ever wanted it needs the uniqueness rule (not in PLAT-06; Q19).
- Club scope: see AC5 and AC11.
- TEXT: A0 and A5 text in A keys (A-0498 "Start from the sport template, edit prices, or import players and package balances from a CSV", A-0066 "Export CSV"), both languages. P3 "Export club data" is X-0133, English only. CSV column headings are data, not screen text; their names are fixed in design. Import error reasons are screen text and need keys (new keys, below).

**Canvas.** H-A0-Setup-checklist (T-A0-Setup-checklist), H-A05-Customers (T-A05), H-P3-Club-detail (Export club data button).

---

## PDPA-01 Data protection

**Source.** HO PDPA-01. PRD Quality and scope ("PDPA privacy notice and consent at sign up, data copy or deletion on request, slips and staff notes staff only, daily backups"), Platform foundation ("Under PDPA the club is the data controller and BOOQ is the data processor").

**Requirement.** The club is the data controller, BOOQ the processor. Consent at first sign in, copy or delete on request, slips and staff notes staff only, daily backups.

**Acceptance criteria.**

- PDPA-01-AC1. Given any processing of player data, when BOOQ staff act, then they act only on the club's setup, never on player, booking or payment data (PLAT-02-AC1). BOOQ is a processor for the club.
- PDPA-01-AC2. Given a new player's first sign in, when they continue, then consent to the terms and the privacy notice is required and recorded (F02 AUTH-02 builds the screen; F01 supplies the record). What the record holds is Q20.
- PDPA-01-AC3. Given a signed in player, when they request a copy of their data in Profile, then the request is stored, the front desk sees it and the player gets the file in LINE (G-C17-Privacy). The file holds profile, bookings, credits and receipts. Whether staff notes are included is Q21.
- PDPA-01-AC4. Given a signed in player, when they request deletion, then the request is stored, the front desk sees it and the club confirms in LINE. On deletion the profile and history are deleted, unused credits and wallet balance are lost, and receipts stay on record for the club's accounts (G-C17-Privacy copy). Receipt and ledger rows are anonymised, not deleted, because receipt numbers are never reused and the ledger is the record of money. See Q22 for the legal basis and the time limit.
- PDPA-01-AC5. Given a player who asks for deletion and holds a future booking or credit, when the request is handled, then the staff see what will be lost before confirming. What happens to the booking is Q22.
- PDPA-01-AC6. Given slips and staff notes, when anyone other than staff of that club asks for them, then the server refuses. A player never sees staff notes; a coach never sees slips; BOOQ staff never see either.
- PDPA-01-AC7. Given a PDPA request, when it is made, handled or refused, then it is in the club's audit log (PLAT-04-AC10).
- PDPA-01-AC8. Given all club data, when the nightly backup runs, then every club's data is backed up daily. How long backups are kept, and how a deleted player is removed from backups, are Q13.
- PDPA-01-AC9. Given personal data in transit and at rest, when it is stored or sent, then it is encrypted (security basics; not stated in the spec, see Q23 before we promise a standard).
- PDPA-01-AC10. Given the Thai hosting region, when data is stored, then where it is stored is as the plan says (DevOps role "Thai-region hosting", Plan section 3). Whether data must stay in Thailand is Q24.
- PDPA-01-AC11. Given a player, when they open Privacy and my data, then they see the privacy notice, Request a copy and Request deletion, in the language they use (P-0413, P-0414, P-0419, P-0422).
- PDPA-01-AC12. Given the privacy notice, when a player reads it, then it names the club as the controller and BOOQ as the processor. The notice's final text is due before 7 Dec 2026 (HO "Privacy consent, receipt and payment text must be final before testing").

**Meets.**

- PDPA: this requirement is the rule set. Each other requirement in F01 and F02 states its own PDPA effect.
- No double booking: a deletion never frees or moves a past booking; a future booking is handled by staff (Q22).
- Club scope: every request, copy and deletion applies to one player of one club. A player at two clubs has two accounts, so a request at one club never touches the other (PRD Platform foundation: Players).
- TEXT: P keys for the player app (both languages); consent and privacy text must be final before 7 Dec 2026 and reviewed by the writers.

**Canvas.** G-C17-Privacy (T-G-C17-Privacy), G-C17-Personal-details, H-C17-Profile-receipts, H-C02-Profile-setup.
Note: there is no board for how the front desk sees and handles a copy or deletion request (Q25).

---

## Data covered by F01 (from HO Data model; for the design step, listed so approval covers it)

Club (name TH and EN, legal name, tax ID, branch, registered address, status, payment option, feature switches), Location, Resource (court), Opening hours, User (club ID, LINE user ID, role), Audit entry. Booq core naming differs (Notion Store and Branch, this spec Club and Location): keep the core's table names and map the labels in the UI (HO Architecture). Settings values live per club (list in PRD A16 and HO Business rules).

Club settings in scope (values are Hunter's, from the spec; every one is editable, none hard coded; the spec's TBDs are empty): opening hours, booking window, cancellation cut off, hold time (10, 15 or 20), waitlist claim window and no offer cut off, max future court hours (empty), coach rest cap, below minimum alert (empty), expiry reminders, wallet balance expiry (empty), package order QR time, business and tax details, VAT switch, Allow BOOQ to make changes, automatic slip checking switch (slip clubs). Settings are validated on the server: hold time only 10, 15 or 20; no setting can change the 60 minute booking length.

---

## New text keys needed (TEXT-04)

The content role will confirm against the locale files. Likely new keys, needing both languages, added with the same prefix and numbering and sent to the writers:

- A: import preview and row error reasons (A0), export started and export ready messages (A5), refusal message when an action is not allowed for the role, audit log "change" lines with named variables, setting validation errors (hold time).
- P: paused state is already covered (P-0442); deletion and copy request confirmations if not in the keys already used by G-C17-Privacy.
- X: export club data confirmation, status change refusals ("missing: <step>, owed by <who>"), template "to build" label.

No key is added by this draft.

---

## Open questions

Numbered so the person approving can answer by number. Each says where the spec is silent or in conflict. None is guessed.

**Blocking approval of F01**

1. **Export club data conflict (PLAT-06, PDPA-01).** H-P3-Club-detail puts "Export club data" in the platform console, but the spec says BOOQ staff never see players, bookings, payments, slips, receipts, wallets or reports. Who receives the export (the owner by link in LINE, a download for BOOQ staff, a file the club downloads in A16)? And does BOOQ staff only start it?
2. **A person with two roles.** The User record has one role. Can the same LINE user be a player and a coach, or an owner and a player, in one club? Hunter's coaches will also play.
3. **Delete a club.** The specialist "cannot pause or delete", which implies the platform admin can delete a club. The PRD has no rule for it. Does club deletion exist in v1, who may do it, and what happens to the club's data (PDPA)?
4. **Onboarding specialist and status.** "Same as platform admin for assigned clubs" gives a specialist Testing and Go live. Is that intended? Who can resume a Paused club, and can a Testing club return to Draft?
5. **Feature switches and the template screen.** Which switches exist in v1? The spec says "feature switches per club" but names none. Candidates from the docs are payment option, slip checking and backup mode (F16), coach add at checkout. Should P5 have New template, Duplicate and Edit in v1, or only the Tennis and Blank templates?
6. **Who can use a Testing club.** P4 says players cannot see a Testing club, but test mode needs mock bookings. Who signs in to test (BOOQ staff as testers, the owner)? Mock data would be visible to BOOQ staff, which the "never see bookings" rule forbids. Is mock data in Testing allowed to be seen by BOOQ staff?
7. **Go live checks and blank rules.** BOOK-05 says an empty max future court hours means no limit, but P5 says Go live is blocked until "every rule is set". Which rules must be set (the full list)? Hunter has TBD values (add-on prices, referral reward, birthday discount, below minimum alert time, wallet expiry). Must Hunter fill them before Go live? And for a Beam club, P4 lists slip tests (Gaps A2): what are its tests?
8. **Test receipts.** RCPT-01 says an unbroken receipt sequence per club and numbers never reused. P4 deletes test bookings at Go live. Do test payments take receipt numbers, so should the sequence start only after Go live?

**Needed before design**

9. Support view when a club is Paused: look only unless the window is on (assumed)?
10. Secrets (Messaging API token, Beam keys, LIFF secret): can BOOQ staff read or replace them in the support view, and are they stored encrypted and masked?
11. Pause and wallet: wallet balance expiry is still an empty setting. Does the expiry shift apply to a wallet with no expiry (nothing to shift)? Also confirm the 14 and 3 day package reminders follow the new date.
12. A payment started before the pause and finished after it: confirm F05 applies PAY-03 as if no pause.
13. Audit and data retention: how long are audit entries, backups and import files kept, and what happens to audit entries about a deleted player?
14. CSV import default: all or nothing, or save the valid rows? Maximum file size and row count?
15. CSV: what is the ledger reason for imported credits and wallet (the spec lists reserve, return, use, forfeit, expire, adjust only)? Do imported packages keep the file's expiry date?
16. CSV: players imported before they sign in have no LINE user ID, the permanent key. How is an imported record matched to a LINE sign in (phone)? What if a phone has two records or matches no one?
17. CSV import: owner only, or can BOOQ staff help in Draft or Testing (support view edit mode) with an owner's file? That could expose player data to BOOQ.
18. Full club export: which records (slips, staff notes, ledgers, receipts, audit log)?
19. Bookings in CSV import: PLAT-06 lists players, packages and balances only. Confirm no bookings are imported.
20. Consent record: the User record has no consent fields. May we add consent time, notice version and language to the data model (PRD and HO change first)? This is needed to show consent under PDPA.
21. Data copy: are staff notes included in the player's copy (PDPA-01 says staff only)? The spec's G-C17 text does not list notes.
22. Deletion: what is the legal basis and the time limit to respond, what happens to a player with a future booking, a wallet balance or unused credits, and are receipts anonymised or kept as is (the canvas says receipts stay on record)? Legal advice may be needed.
23. Security baseline: may we state encryption in transit and at rest, and who owns the DPA between each club and BOOQ and a breach procedure? None is in the spec.
24. Must data stay in Thailand (hosting region)? The plan mentions Thai-region hosting but the PRD does not set it.
25. PDPA requests: no admin board shows where the front desk handles copy and delete requests (the A5 and A6 boards have none). Which page, and which role (front desk or owner only)?
26. Club locations: PRD Foundation says a club has one or more locations, but the platform open questions ask "Can one club have more than one location or branch?" Does F01 build the add location UI, or only the data model with one location (Hunter)? Also: web address per club (open question C7) affects how the app finds the club in a browser, see F02 Q11.
27. Club text fields: PRD says everything the club types has a Thai and an English field. Are both required to save, or may the Thai or English be empty?
28. Settings TBD: confirm the empty settings list in this draft matches Plan section 4 (add-on prices, Head Coach price, referral reward, friend discount, birthday discount, max future court hours, class below minimum alert time, wallet balance expiry, coach pay numbers). Defaults the PRD does state (hold 15, rest cap 6, claim 30 minutes, no offers within 2 hours, 4 to 6 players): are they platform defaults for a Blank club, or empty until the owner sets them (P5 Blank says empty club rules)?
