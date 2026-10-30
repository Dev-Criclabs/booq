# F01 Platform foundation · Requirements

Status: **Approved 30 Oct 2026** (gate 1). Recorded in `docs/decisions.md`, rounds 4 and 7. Revision 5 (30 Oct 2026) applies D32 to D37 (Beam key sets, test data excluded from reports, encryption, Accountant visibility) and D100 to D123 where they touch F01 (purge scope, audit history, Draft and Testing sign in, guest reads, anonymising, imported player claim, receipt year, pause actions, Go live checks, roles, owner invite, second factor reset), and the Reviewer's findings F01-8, F01-14, F01-16, F01-17, F01-18, F01-19, F01-21 (`docs/review/spec-consistency.md`). Changes after approval go PRD, then hand-off, then this file. No design or code follows until the design gate.

Revision history: v1 draft, v2 applied D1 to D15, v3 applies D18 to D31, v4 applies D32 to D37, v5 applies D100 to D123 and the Reviewer's findings. ROLE-01, ROLE-02 and PLAT-07 are in the hand-off (no longer proposed). ROLE-01, ROLE-02 and PLAT-07 were proposed IDs in v2 and are now in the hand-off (Roles table and Roles, platform console and data protection). The ledger reason `import` is in the hand-off data model. Decisions are cited as D1 to D31.

Feature: F01 Platform foundation (clubs, locations, resources, roles, settings, audit). Depends on: nothing built yet. There is no earlier Booq code or database, so Hunter is the first real build and the core is created with it (decisions log, round 2b; hand-off Overview). Requirement IDs: PLAT-01 to PLAT-06, PDPA-01, plus ROLE-01, ROLE-02, PLAT-07 (in the hand-off since 30 Oct 2026). Wave 1.

## Sources

| Short name | File | Sections used |
|---|---|---|
| PRD | `specs/product/prd-v1.2.md` | Users, roles and app structure; BOOQ platform and club onboarding (Who uses it, What a club needs before it can go live, Platform console pages, Platform flows, Pausing a live club, Support access, What changes in the club app, Platform foundation); Quality and scope; Open questions for the platform |
| HO | `specs/product/handoff-v1.2.md` | Architecture; Data model; Business rules as requirements; Roles, platform console and data protection (PLAT-01 to PLAT-06, PDPA-01); Text and language files (TEXT-01 to TEXT-06) |
| Plan | `docs/DEVELOPMENT-PLAN.md` | Section 4 (settings that are empty, not blockers) |
| Gaps | `docs/canvas-gaps.md` | A2, A7, C3, C5, C7 |
| Decisions | `docs/decisions.md` | D1 to D31, round 2b (Notion core versus PRD), round 1. PRD change log rows "Decisions 30 Oct (2)", "(3)" and "(4)" |
| QA traceability | `docs/qa/traceability.md` (branch `qa/test-strategy`) | Gaps list for PLAT-01 to PLAT-06, PDPA-01, TEXT-03 to TEXT-06; proposed checks reused below |

The spec wins over the canvas. Where the canvas shows something the spec does not say, it is listed in Open questions, not built.

## Scope

In scope for F01:

- The club record and its lifecycle (Draft, Testing, Live, Paused), locations, resources (courts), opening hours. The tables are created new, named `club` and `location` from the start (decisions log, round 2b).
- Club ID scoping of every record, and the block that keeps BOOQ staff away from a club's player, booking and payment data.
- The roles (a person holds a set of roles) and permission checks for the seven roles, and BOOQ staff sign in (email plus a second factor).
- Test mode data: flagged, own receipt series, purged at Go live.
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

**CC-5 Language files (TEXT-01 to TEXT-06).** Every screen text, error and message comes from `locales/en.json` and `locales/th.json` by key. Keys follow the writers' prefixes (P player, A club admin, K coach, L LINE and receipt, X platform console). One key can serve several screens. Sample values become named variables with the same names in both files. Existing wording is never edited, new text gets a new key in both files and is listed for the writers. The platform console (X keys) is English only. Everything else ships in Thai and English. Layouts survive the longest string, buttons never wrap and content areas scroll. Dates use the international year in both languages. The F01 text keys are listed per requirement; `locales/copy-index.csv` does not exist yet; it is generated from the canvas by the i18n role, read only (D31), so key lookup by screen waits for it.

**CC-6 Other platform rules.** All times Asia/Bangkok. Money as integer satang. Never invent a price, amount or setting: a value marked TBD is an empty club setting.

---

## Roles (PRD Users, roles and app structure; HO Roles, platform console and data protection)

Seven roles. Five belong to a club, two to BOOQ. Club people sign in with LINE (F02) and the role decides the surface and the data. BOOQ staff sign in differently (ROLE-02). A person can hold **several roles in one club** (D1, see ROLE-01).

| Role | Belongs to | Surface | Can | Cannot |
|---|---|---|---|---|
| Player (adult or student) | Club | Player app | Book, buy, pay, cancel, see own credits, receipts and referrals | See other players |
| Coach | Club | Coach portal | Own schedule, availability, leave, attendance, notes, own earnings | See other coaches, payments or revenue |
| Front desk | Club | Club admin | Bookings, walk ins and cash, customers | See revenue or coach pay, change prices, rules or staff |
| Accountant | Club | Club admin, finance pages | Read and export reports and receipts | Change bookings, prices or balances |
| Owner | Club | Club admin, everything | All of the above plus prices, packages, promotions, rules, staff, coach pay | Nothing restricted (for the club's own data) |
| Platform admin | BOOQ | Platform console | Create and set up clubs, change status, pause and resume with a reason, setup only support view, see aggregate booking counts and the owner's contact details (D2) | See individual players, bookings, payments, slips, receipts, wallets or reports |
| Onboarding specialist | BOOQ | Platform console | For assigned clubs: set up, setup only support view, take a club to Draft, Testing and Live (D15), see aggregate counts and the owner's contact details (D2) | Pause or resume a club (D15). Delete a club: no club can be deleted in v1 (D14) |

Admin console pages by role, from PRD Coach portal and admin console (front desk and owner share A1, A2, A5, A6, A12; owner only A7, A8, A9, A10, A16, A17; owner and accountant A13, A14; A4 only in backup mode; A0 owner only until live). F11 turns this into the sidebar. F01 supplies the permission check behind it.

### ROLE-01 Roles are a set (decision D1)

**Source.** D1 (`docs/decisions.md`). PRD Users, roles and app structure and HO Data model (User: "role") say one role; D1 changes it. The PRD and hand-off are updated (HO ROLE-01).

**Requirement.** A person can hold several roles in one club, for example a coach who also plays, or an owner who also coaches. A user's roles are a set, not a single value. The key stays club ID plus LINE user ID, so it is one person record with a set of roles.

- ROLE-01-AC1. Given a LINE user who is a coach at a club and also books courts, when they sign in, then they have one record with the roles Coach and Player and can open both surfaces.
- ROLE-01-AC2. Given a user with two roles, when the server checks a request, then it allows the request if **any** of their roles allows it, and refuses if none does. Rights are the union of the roles and nothing more.
- ROLE-01-AC3. Given a user who is a coach and a player, when they look at players or other coaches in the coach portal, then they see only what the Coach role allows; the Player role does not widen it.
- ROLE-01-AC4. Given an owner or staff member who also plays, when they book as a player, then they pay as a player (same price, same hold, same rules). Staff rights do not skip payment or the hold.
- ROLE-01-AC5. Given a role added to or removed from a person, when it is saved, then it is audited (PLAT-04) with the old and new set. Roles are assigned by the owner only (A17).
- ROLE-01-AC6. Given a BOOQ role, when a person holds one, then it lives on the BOOQ account (ROLE-02) and is never mixed into a club role set. A BOOQ staff member who also plays at a club has a separate club player record signed in with LINE.
- ROLE-01-AC7. Given every club person (owner, staff, coach), when they have a record, then they also hold the Player role, so they can book and edit their own profile (D115, Reviewer F02-4).
- ROLE-01-AC8. Given the Accountant, when they open settings, then they read business and tax settings only; they see no other settings (D115). Only the Owner marks a coach payout paid (D115).

**Meets.** PDPA: roles decide which personal data a person sees; the union rule keeps it to the minimum. No double booking: the person's coach time and court time are separate resources for F03's uniqueness rule; whether one person may be booked in two places at once is not in the spec (Q-A). Club scope: the set belongs to one club. TEXT: A17 role names use A keys (Thai and English).

**Canvas.** H-A17-Staff-audit (T-A17-Staff-audit). The canvas shows one role per row; it needs updating to a set.

### ROLE-02 BOOQ staff sign in (decision D3)

**Source.** D3. PRD Who uses it (Platform admin, Onboarding specialist). The PRD body says "everyone signs in with LINE"; D3 and the PRD change log row "Decisions 30 Oct (2)" say BOOQ staff use email plus a second factor.

**Requirement.** BOOQ staff sign in with email plus a second factor, separate from LINE. Club people, including a club owner, sign in with LINE only.

- ROLE-02-AC1. Given a BOOQ staff account, when they sign in to the platform console, then they must pass email sign in and a second factor. Without the second factor, no session is created.
- ROLE-02-AC2. Given a BOOQ staff account, when they try to sign in through LINE as that account, or open a club's admin console as a club user, then it is refused. A BOOQ account never gets a club role (ROLE-01-AC6).
- ROLE-02-AC3. Given a LINE sign in of a club user, when they try the platform console, then the server refuses.
- ROLE-02-AC4. Given a BOOQ staff member removed or deactivated in P6, when they try to sign in, then it is refused and any open session ends.
- ROLE-02-AC5. Given every BOOQ sign in, failed sign in, second factor reset and teammate invite, when it happens, then it is written to P6 (PLAT-04).
- ROLE-02-AC6. Given a teammate invited in P6, when they accept, then they set up their own email sign in and second factor. The method (code app, SMS, other) is Q-C.
- ROLE-02-AC7. Given a BOOQ staff member's second factor must be reset, when it is reset, then it is done only by another platform admin and logged in P6 (D123).
- ROLE-02-AC8. Given the owner invite, when it is created, then it is created unbound and emailed only to the owner's email on the club record (`club.owner_email`), never shown to BOOQ staff as a usable link and never sent through LINE. The first LINE user who redeems it takes the owner role and the invite binds to that person; any other LINE user who opens it afterwards is refused and the attempt is logged in P6; later, only that LINE user can open it (D151, replacing the binding part of D122). The owner's LINE ID typed in P2 step 1 stays a contact detail and binds nothing.
- ROLE-02-AC9. Given the person who redeemed the owner invite, when they type their phone, then they are verified (`owner_verified`) only if it equals the owner phone on the club record; a mismatch keeps Go live closed until a second platform admin confirms with the owner by another channel (`confirm_owner_verified`), and both steps are written to P6 (D151). A fresh invite can be issued while no owner is bound (D138) and is created unbound the same way.

**Meets.** PDPA: BOOQ staff are processor staff; the second factor limits access to the console. No double booking: not relevant. Club scope: BOOQ accounts have no club ID; access to one club is by assignment and role (PLAT-02). TEXT: P6 and the BOOQ sign in screen are X keys, English only (TEXT-05); the sign in screen needs new X keys (listed below).

**Canvas.** H-P6-Team-audit. No board exists for the BOOQ staff sign in screen (Q-C).

### Role checks (acceptance criteria for the roles table; tested under PLAT-04 and CC-2)

- ROLE-AC1. Given a signed in front desk user, when they request revenue, coach pay, prices, rules or staff data, then the server refuses, whatever the screen shows.
- ROLE-AC2. Given a signed in accountant, when they try to change a booking, price or balance, then the server refuses and nothing changes.
- ROLE-AC3. Given a coach, when they request another coach's schedule, any customer payment or club revenue, then the server refuses.
- ROLE-AC4. Given a player, when they request another player's data, then the server returns not found.
- ROLE-AC5. Given an onboarding specialist, when they open a club not assigned to them, then the server refuses. When they try to pause or resume any club, then the server refuses (D15). There is no delete club action for anyone in v1 (D14).
- ROLE-AC6. Given a user of club A with any role, when they request a record of club B, then the server returns not found (CC-1).

Canvas: H-A17-Staff-audit (invite and role assignment), H-P6-Team-audit (platform roles), T- twins for the admin pages (X pages have no Thai twin, TEXT-05).

Open: see Q-A to Q-C.

---

## PLAT-01 Club status

**Source.** HO PLAT-01. PRD Platform console pages P3 and P4, Flow J, Pausing a live club.

**Requirement.** Club status runs Draft, Testing, Live, Paused. Go live needs every check in P4 passed.

**What this means for build.** A club has exactly one status. Status changes are made only by BOOQ staff in the platform console, never by the club. An onboarding specialist takes an assigned club to Draft, Testing and Live; only a platform admin pauses or resumes (D15). The set of checks Go live needs is the P4 list (HO and PRD; see Q7 for the list's open points).

**Acceptance criteria.**

- PLAT-01-AC1. Given a new club created in P2, when it is saved, then its status is Draft, and every later P2 save keeps it Draft.
- PLAT-01-AC2. Given a Draft club, when steps 1 to 8 of the setup are not all done, then the server refuses the change to Testing and P3 shows what is missing and who owes it (PRD Platform flows: Flow J). Both a specialist (assigned club) and a platform admin may make this change (D15).
- PLAT-01-AC3. Given a Testing club, when any P4 Go live check is not passed, then the server refuses the change to Live, whatever the screen shows. When every check is passed and BOOQ staff press Go live, then the status is Live and the change is written to the P6 log.
- PLAT-01-AC12. Given the Go live checklist, when P4 lists it, then beyond the P4 checks it requires: the owner has signed in and is verified (`owner_verified`, or confirmed by a second platform admin, D151), one completed test booking, the per player pay tap limit is set, and the Beam key swap with its smoke test is done (D108, D32, D151). Go live is refused until each is ticked.
- PLAT-01-AC4. Given a club on a blank template, when it has no product, or any rule is unset, then Go live is refused (PRD P5). A product with a price counts; the exact rule list is Q7.
- PLAT-01-AC5. Given a Draft or Testing club, when a player opens the player app, then the club is not visible to players (P4 "Players can't see the club yet"). In Testing, only the testers can sign in: the club owner and named BOOQ testers (D4, PLAT-07).
- PLAT-01-AC11. Given a Draft or Testing club, when someone who is not signed in calls it, then the club serves only a minimal sign in config (name, language, status, LIFF id). The club admits the owner role and testers; the owner invite stays valid for return visits and testers get long lived invites (D102).
- PLAT-01-AC6. Given a Testing club, when it goes Live, then all test data is purged (P4 "Test bookings will be cleared, deleted at Go live") and the club's real receipts start at 000001 (D4; PLAT-07).
- PLAT-01-AC7. Given a club of any status, when any status change is made, then it records who, when, old status, new status and, for Paused, the reason (PLAT-04).
- PLAT-01-AC8. Given an onboarding specialist, when they request a status change on a club that is not assigned to them, or try to pause or resume any club, then the server refuses. A platform admin may pause and resume any club (D15).
- PLAT-01-AC10. Given a Paused club, when a platform admin resumes it, then the status returns to Live, the reason for resuming is written to P6, and the pause length is fixed for PLAT-03-AC7. Only a platform admin can resume (D15).
- PLAT-01-AC9. Given a failed test, when the club is Draft or Testing, then it stays in that status and P3 shows what is missing and who owes it (PRD Flow J).

**Meets.**

- PDPA: status holds no personal data. The Testing purge deletes test data only, never a live player's data.
- No double booking: not relevant, except that Go live must not delete real bookings. The clear step is limited to bookings flagged as test.
- Club scope: status is a field on the club record; a status change addresses one club ID.
- TEXT: P3, P4 and P1 are X keys, English only. Status labels (Draft, Testing, Live, Paused) come from X keys already in `en.json` (to be confirmed by key lookup).

**Canvas.** H-P1-Clubs, H-P1-Clubs-clear, H-P1-Clubs-paused, H-P2-Step1-Basics to H-P2-Step5b-Payments-slip, H-P3-Club-detail, H-P3-Club-alert, H-P3-Club-fixed, H-P3-Club-live, H-P4-Launch.
Note Gaps A2: H-P4-Launch lists "fake slip" tests, which belong to slip clubs. Hunter pays by Beam, so the P4 list for a Beam club needs a decision (Q7). What BOOQ sees of test results is pass or fail only (D4, PLAT-07).

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
- PLAT-02-AC7. Given a Paused club, when BOOQ staff open the support view, then it is look only, unless the owner has allowed changes (D27). A Paused club behaves like a Live club here.
- PLAT-02-AC8. Given a stored secret (Messaging API token, Beam key, LIFF secret), when it is shown anywhere, then only the last 4 characters show. Secrets are write only: BOOQ staff and the owner can replace a value but nobody can read it back (D27).
- PLAT-02-AC9. Given a platform user without access to the club, when they open its support view, then the server refuses (assigned clubs only for the specialist, ROLE-AC5).
- PLAT-02-AC10. Given BOOQ staff in P1 or P3, when they look at a club, then they may see aggregate counts (for example bookings in the last 30 days, as P1 shows) and the owner's contact details (name, phone, LINE and email, as entered in P2 step 1). They never see an individual booking, player, payment, slip, receipt, wallet or report (D2).
- PLAT-02-AC12. Given the support view, when it lists pages, then it holds exactly: courts and hours, products and pricing (with add-ons), LINE, payment connections, settings. It does not hold staff, coaches, closures or promo codes (D27).
- PLAT-02-AC13. Given BOOQ staff request a record of a club they have no access to, or a record outside the setup only view, when the server answers, then it returns 404 (not found), never a refusal that confirms the record exists (D27).
- PLAT-02-AC14. Given a guest (not signed in), when any route answers them, then it reads only named public columns or routes; owner contact details and merchant ids are never readable by a guest (D103).
- PLAT-02-AC11. Given an aggregate count, when it is produced, then it is computed on the server as a number only, with no list of rows behind it and no way to drill down (D2). Which counts exist is limited to those on P1 and P3 (Q-D).

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
- PLAT-03-AC3. Given an onboarding specialist, when they try to pause or resume a club, then the server refuses. Only a platform admin pauses or resumes (D15).
- PLAT-03-AC4. Given a Paused club, when a player or a staff member tries to start a new booking or purchase or a new hold, then the server refuses it, including a direct API call, and the app shows "Online booking is paused for now. Message the club on LINE for help." (P-0442 "Online booking is paused for now"; exact string by key). The owner can still manage existing bookings (D60, HO PLAT-03).
- PLAT-03-AC5. Given a Paused club, when a player opens the app, then Book a court, Classes and Packages show as paused and upcoming bookings still show (PRD Pausing).
- PLAT-03-AC6. Given an existing booking, when the club is paused, then the booking stays valid and its LINE reminders still go out.
- PLAT-03-AC7. Given a package or wallet balance with an expiry date, when the club is resumed, then every expiry date moves forward by the length of the pause (start to end) and still ends at 23:59 Asia/Bangkok on its day (D20 applies to pause extensions). The ledger records one movement per package with a reason, not a silent edit (PKG-01, D28). Whether a wallet with no expiry is touched is Q11.
- PLAT-03-AC8. Given a Paused club, when the owner or staff open the club admin, then it works and every page shows a banner with the reason and a Message BOOQ button (H-A01 pause banner, S-A01-Paused).
- PLAT-03-AC9. Given a payment already started before the pause, when it completes after the pause begins, then it is handled by the PAY-03 rules (F05), not refused. Stated here only so F05 and F01 agree; the spec does not say. See Q12.
- PLAT-03-AC10. Given any pause or resume, then it is written to the P6 log and the club's audit log (PLAT-04).
- PLAT-03-AC11. Given a Paused club, when a platform admin resumes it, then new booking and buying turn back on, the pause banner leaves the club admin, the owner gets a LINE message, and the pause length (start to resume) is used for the expiry shift in AC7 (D15).
- PLAT-03-AC12. Given a Paused club, when the owner or staff manage existing bookings, then they may move, add a coach, cancel and mark no show (D107). A late payment is not used to confirm a booking in a Paused club and the whole value goes to the wallet (D107, D109).

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
- PLAT-04-AC6. Given an audit entry, or a credit or wallet ledger row, when anyone tries to edit or delete it, then the server refuses and the database rejects it too (the app has no update or delete right). Both are append only (D28; H-P6-Team-audit "Nothing here can be edited or deleted"). A correction is a new row. The same holds for the club log. The one exception is the Go live purge of test flagged data (PLAT-07-AC3).
- PLAT-04-AC12. Given a deleted player is anonymised, when it is done, then personal fields in audit rows are replaced by a placeholder and nothing else in an audit row can change (D104). This is the second named exception to append only, after the Go live purge.
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
- PLAT-05-AC8. Given the Blank template, when a new club starts from it, then it has no products and every club rule is empty, including hold time, waitlist claim time, no offer cut off, rest cap and group player counts (D8, PRD P5). The owner adds everything in Pricing and Settings.
- PLAT-05-AC9. Given a template, when a value is a TBD in the spec (add-on prices, Head Coach price, referral reward, friend discount, birthday discount, max future court hours, below minimum alert time, wallet balance expiry, coach pay), then it is copied as an empty setting. No value is invented (D8).
- PLAT-05-AC10. Given sport labels, when a club uses a template, then labels follow the sport (court, table, lane) from the template (PRD Platform foundation, P5).
- PLAT-05-AC11. Given Padel and Pickleball, when F01 ships, then they appear as templates marked "to build" and cannot be chosen until built (H-P5 text "To build before the first padel club"). Their content is out of scope.
- PLAT-05-AC12. Given a platform admin or specialist, when they pick a template in P2 or A0, then the chosen template is recorded on the club and the copy is written to the audit log.
- PLAT-05-AC13. Given the Tennis template, when it is loaded, then its prices equal the final offer in PRD Pricing and packages (court ฿500, 10 hour bundle ฿4,500 for 3 months, 20 hour bundle ฿8,000 for 5 months, solo and group single prices and 8 packs for Adult and Student), stored as integer satang. Values are copied from the spec; none are added.
- PLAT-05-AC15. Given the Tennis template, when it is loaded, then it carries the PRD default rules: payment hold 15 minutes (the owner may pick 10, 15 or 20), waitlist claim time 30 minutes, no waitlist offers within 2 hours of start, coach rest cap 6 hours in a row, group classes 4 to 6 players (D8). Booking length is fixed at 60 minutes for every club and is not a template value.
- PLAT-05-AC16. Given the Tennis template, when it is loaded, then it also carries the other values the PRD and decisions state: booking window 30 days, cancel window 12 hours, package QR time 15 minutes (D74), package expiry reminders 14 and 3 days, VAT off (PRD Club facts, Payments). The Blank template leaves all of these empty and Go live needs them set (F01-8).
- PLAT-05-AC14. Given the template actions on H-P5 ("New template", "Duplicate", "Edit") when F01 is built, then whether those actions exist is decided in Q5.

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

- PLAT-06-AC1. Given an owner in A0 step 7, when they upload a CSV of players, packages or balances, then the server validates every row before saving and shows an error report listing each failing row with the reason. Nothing is saved until the whole file is valid and the owner confirms (D13).
- PLAT-06-AC18. Given a CSV import, when it completes, then it has created players, customer packages and ledger movements only, and no bookings (D13).
- PLAT-06-AC2. Given an import with any invalid row, when the owner confirms or tries to, then nothing is saved. The import is all or nothing, the owner fixes the file and uploads again (D13).
- PLAT-06-AC3. Given a balances file, when it is imported, then each balance becomes ledger movements with the reason `import` and the owner as actor, never a single editable number (PKG-01, D13). `import` is a new ledger reason beyond reserve, return, use, forfeit, expire, adjust; the PRD and hand-off data model need it added, PRD first.
- PLAT-06-AC4. Given a packages file, when it is imported, then each row creates a customer package with credits total, purchase date and expiry date, and ledger rows with reason `import` for credits already used. Whether the file's expiry date is kept or recomputed from purchase date plus validity (PKG-02) is Q15.
- PLAT-06-AC5. Given an import file, when a row has a club ID column or any other club's identifier, then it is ignored; the club ID is always the importing club (CC-1).
- PLAT-06-AC6. Given an import, when it completes, then one audit entry records who, when, file name, counts of rows read, saved and rejected, and each created balance is audited (PLAT-04).
- PLAT-06-AC7. Given an imported player, when someone signs in with LINE and their typed phone matches an imported record, then they are linked only after the front desk confirms the claim in A6; a sign in that matches no record becomes a new player (D105, D13). Duplicate phones at one club are flagged (D11).
- PLAT-06-AC8. Given a front desk, accountant, coach or BOOQ staff, when they try to import, then the server refuses. Import is for the owner only (D13), including in Draft and Testing support view.
- PLAT-06-AC9. Given a CSV file, when it holds amounts, then amounts are read as THB and stored as integer satang, and dates are read as Asia/Bangkok and shown with the international year.
- PLAT-06-AC10. Given an uploaded file, when the import is finished or cancelled, then the raw file is not kept longer than the import needs (PDPA data minimisation; retention is Q13).

Data export

- PLAT-06-AC11. Given a club, when "Export club data" is run, then the export holds only that club's records (CC-1).
- PLAT-06-AC12. Given BOOQ staff in P3, when they press Export club data, then the export starts, but BOOQ staff cannot open, download or read its content. The owner downloads the file (D14). Where the owner finds and downloads it (A16 or a link in LINE) is Q1.
- PLAT-06-AC13. Given an owner or front desk in A5 (the Accountant sees names on receipts and reports, never phone numbers or dates of birth, D35), when they press Export CSV, then they receive the customer list CSV for their club (PRD A5 shows CSV export for front desk and owner).
- PLAT-06-AC14. Given an accountant or owner in A13 and A14, when they export a report or receipts, then they receive CSV or PDF for their club (PRD Reports, Receipts). Built in F13 and F11. F01 owns only the rule that exports are club scoped and audited.
- PLAT-06-AC15. Given any export of customers or club data, when it is made, then an audit entry records who, when, which export and how many rows (PLAT-04), because exports carry personal data.
- PLAT-06-AC17. Given any club, when F01 ships, then there is no delete club action in the platform console or anywhere else in v1 (D14). A club leaves by export and pause only.
- PLAT-06-AC16. Given an export file, when it is produced, then slips and staff notes are included only in the full club export, and only if Q18 says so (PDPA-01: staff only).

**Meets.**

- PDPA: an import loads personal data the club already holds, so the club is the controller and must have its own lawful basis. First sign in still asks for consent (PDPA-01, F02), so an imported player is asked at their first sign in, not treated as consented. Exports are controlled access, audited and never delivered to BOOQ staff (Q1).
- No double booking: an import creates no bookings (D13), so it cannot create a clash. Importing bookings is not in v1.
- Club scope: see AC5 and AC11.
- TEXT: A0 and A5 text in A keys (A-0498 "Start from the sport template, edit prices, or import players and package balances from a CSV", A-0066 "Export CSV"), both languages. P3 "Export club data" is X-0133, English only. CSV column headings are data, not screen text; their names are fixed in design. Import error reasons are screen text and need keys (new keys, below).

**Canvas.** H-A0-Setup-checklist (T-A0-Setup-checklist), H-A05-Customers (T-A05), H-P3-Club-detail (Export club data button).

---

## PLAT-07 Test mode data (decision D4, D26)

**Source.** D4 (`docs/decisions.md`). PRD Key dates and Design deliverables ("A test mode with mock bookings and fake slips for the 7 Dec test"), P4 Launch, Flow J. PRD change log row "Decisions 30 Oct (2)". The hand-off has no ID for it.

**Requirement.** In Testing, test data is flagged, uses its own non legal receipt numbers, and is purged at Go live so the club's real receipts start at 000001. The testers are the club owner and named BOOQ testers. BOOQ sees pass or fail only.

**Acceptance criteria.**

- PLAT-07-AC1. Given a club in Testing, when a booking, order, payment, receipt, ledger movement or player record is made, then it is flagged as test data at creation, on the server, and the flag cannot be removed.
- PLAT-07-AC2. Given a test receipt, when it is issued, then it uses its own number series that is clearly not a legal receipt (marked as a test on screen and in the PDF) and never uses the club's real sequence (HTC‑2027‑000001 and on). The series name and format are for design.
- PLAT-07-AC3. Given a club goes Live, when Go live is confirmed, then all test flagged data of that club is purged in one step, including test players, test ledgers and the test receipt series, and the real receipt sequence starts at 000001 of the club's series for that Bangkok year (D4, D106; receipt numbers run per club per Bangkok year and the prefix is set in P2 step 1 and required before Go live).
- PLAT-07-AC12. Given the Go live purge, when it runs, then it removes only rows made by a tester kind; owner, staff and coach accounts are never test rows and survive Go live (D100). Audit entries are not flagged on their own: only audit entries about test data are purged, and a setting changed in Testing keeps its audit entry after Go live (D101).
- PLAT-07-AC4. Given the purge, when it runs, then it deletes only rows with the test flag and only for that club ID. If any row cannot be purged, Go live does not complete and the status stays Testing.
- PLAT-07-AC5. Given a club in Testing, when someone signs in to the player app, then only the club owner and named BOOQ testers can. The tester list is set in P4 or P3 by BOOQ staff and every change is written to P6 (D4). A BOOQ tester signs in to the player app with LINE as a test player, not with the BOOQ account (ROLE-02-AC2).
- PLAT-07-AC6. Given BOOQ staff in P4, when they look at test results, then they see pass or fail per check only (D4). They never see the test bookings, test players, test payments or test receipts themselves. The owner sees them in the club admin.
- PLAT-07-AC7. Given test data, when it is counted for aggregates in P1 (bookings in the last 30 days), then it is not counted (D33).
- PLAT-07-AC8. Given a test run, when it starts, finishes or is purged, then it is written to P6 (PLAT-04).
- PLAT-07-AC10. Given each club, when Beam is set up, then the club holds two sets of Beam keys, test and live. Testing uses the test set. Swapping to the live set at Go live is a required item on the P4 checklist, with a smoke test, and Go live is refused until it is ticked (D32). Test LINE messages go through the club's real Official Account and count toward the monthly cap (D32).
- PLAT-07-AC11. Given test flagged records, when any report, daily close, receipts list or platform count is produced, then they are excluded everywhere and appear only in test mode views (D33).
- PLAT-07-AC9. Given a test payment in Testing, when it is made, then it uses Beam's sandbox only. There is no in app "simulate payment" action in any club status (D26), so no route can confirm a booking without a valid signed Beam callback (F05 owns the integration). The 7 Dec test runs on production with Hunter in Testing status (PRD Decisions 30 Oct (3)).

**Meets.**

- PDPA: test players are people (testers) or fake records. The test flag keeps real players' data apart from test data. BOOQ never sees test bookings or players, even though they are mock, so the "BOOQ never sees player data" rule has no exception (D4).
- No double booking: test bookings use the same holds and uniqueness rule as real ones, so a test is a true test of it; the purge removes them without touching any real booking.
- Club scope: the flag and the purge are per club ID.
- TEXT: P4 text is X keys, English only. Test receipt marking is receipt text (L keys, Thai and English), new key needed.

**Canvas.** H-P4-Launch, H-P3-Club-detail, R-Receipt-TH and R-Receipt-EN (the test marking has no board; Q-E).

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
- PDPA-01-AC9. Given personal data in transit and at rest, when it is stored or sent, then it is encrypted in transit (TLS) and at rest (the host's standard disk encryption), and stored secrets such as Beam and LINE keys get an extra layer of encryption in the app (D34).
- PDPA-01-AC10. Given hosting, when data is stored, then it is stored in Supabase in the nearest region, Singapore, under a data processing agreement with the club as controller (D5). Plan section 3 ("Thai-region hosting") is superseded by D5.
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

The tables are created new (no earlier core). Naming is `club` and `location` from the start (decisions log, round 2b). Club (name TH and EN, legal name, tax ID, branch, registered address, status, payment option, feature switches), Location, Resource (court), Opening hours, User (club ID, LINE user ID, a set of roles, D1), BOOQ staff account (email, second factor, role, assigned clubs; no club ID, D3), tester list per club (D4), a test flag on records made in Testing (D4), Audit entry. Booq core naming differs (Notion Store and Branch, this spec Club and Location): keep the core's table names and map the labels in the UI (HO Architecture). Settings values live per club (list in PRD A16 and HO Business rules).

Club settings in scope (values are Hunter's, from the spec; every one is editable, none hard coded; the spec's TBDs are empty): opening hours, booking window, cancellation cut off, hold time (10, 15 or 20), waitlist claim window and no offer cut off, max future court hours (empty), coach rest cap, below minimum alert (empty), expiry reminders, wallet balance expiry (empty), package order QR time, business and tax details, VAT switch, Allow BOOQ to make changes, automatic slip checking switch (slip clubs). Settings are validated on the server: hold time only 10, 15 or 20; no setting can change the 60 minute booking length.

---

## New text keys needed (TEXT-04)

The content role will confirm against the locale files. Likely new keys, needing both languages, added with the same prefix and numbering and sent to the writers:

- A: import preview and row error reasons (A0), export started and export ready messages (A5), refusal message when an action is not allowed for the role, audit log "change" lines with named variables, setting validation errors (hold time).
- L: "test receipt" marking on the test PDF receipt (PLAT-07-AC2), Thai and English.
- P: paused state is already covered (P-0442); deletion and copy request confirmations if not in the keys already used by G-C17-Privacy.
- X: BOOQ staff sign in and second factor screens and errors (ROLE-02), tester list in P4 (PLAT-07), purge confirmation, aggregate counts labels, resume club action and reason (PLAT-01-AC10), export club data confirmation, status change refusals ("missing: <step>, owed by <who>"), template "to build" label.

No key is added by this draft.

---

## Actions for a person (not questions; the user must do these)

- **D10 consent for players under 18.** Skipped by the user and still open. Not decided here (see F02).
- **Club LINE message cap.** Decided 30 Oct 2026 as LINE-07 (F10, F15). Nothing more for F01.

## Open questions

Answered questions are removed (D100 to D123 answered the Reviewer's questions on purge scope, Go live checks, pause actions, roles, receipt year and imported player claims; D1 to D15 answered the old Q2, Q3, Q6, Q8, Q14, Q17, Q19, Q24, Q28 and parts of Q1, Q4, Q15, Q16, Q23, Q26; D27 answered Q9 and Q10). Numbers are kept so earlier references hold. New questions are Q-A to Q-E.

**Blocking approval of F01**

1. **Where the owner downloads the club export (PLAT-06).** Decided: the owner downloads it and BOOQ staff can only start it (D14). Where does the owner find it (A16 button, a link sent in LINE), how long does the link live, and may the owner also start it without BOOQ?
5. **Feature switches and the template screen.** Which switches exist in v1? The spec says "feature switches per club" but names none. Candidates from the docs are payment option, slip checking and backup mode (F16), coach add at checkout. Should P5 have New template, Duplicate and Edit in v1, or only the Tennis and Blank templates?
7. **Go live and empty settings (PLAT-01, PLAT-05).** D108 adds the Go live checks beyond P4. Still open: BOOK-05 says an empty max future court hours means no limit, but P5 says Go live is blocked until "every rule is set". Which settings must be set before Go live (the full list), and may Hunter go live with the TBD settings (add-on prices, referral reward, birthday discount, below minimum alert time, wallet expiry) still empty? For a Beam club, P4 still lists fake slip tests (Gaps A2): what are the Beam tests?

**Needed before design**

4. **Status moves back.** Can a Testing club return to Draft? Can a Live club be set back to Testing (D15 gives a specialist Draft, Testing and Live)?

11. Pause and expiry: pause extensions end at 23:59 Bangkok (D20). Wallet balance expiry is still an empty setting. Does the expiry shift apply to a wallet with no expiry (nothing to shift)? What happens to a pause shorter than a day, or a credit that expires during the pause? Do the 14 and 3 day package reminders follow the new date?
12. A payment started before the pause and finished after it: confirm F05 applies PAY-03 as if no pause.
13. Audit and data retention: how long are audit entries, backups and import files kept, and what happens to audit entries about a deleted player?
15. CSV packages: does an imported package keep the file's expiry date, or is it recomputed from purchase date plus validity (PKG-02)?
16. CSV phone match: what happens when a phone matches two imported records, or none, at first sign in?
18. Full club export: which records (slips, staff notes, ledgers, receipts, audit log)?
20. Consent record: the User record has no consent fields. May we add consent time, notice version and language to the data model (PRD and hand-off change first)? Needed to show consent under PDPA.
21. Data copy: are staff notes included in the player's copy (PDPA-01 says staff only)? The G-C17 text does not list notes.
22. Deletion: what is the legal basis and time limit to respond, what happens to a player with a future booking, a wallet balance or unused credits, and are receipts anonymised or kept as is (the canvas says receipts stay on record)? Legal advice may be needed (with D10).
23. Breach procedure: who owns it, and who is told? (Encryption is settled by D34 and the data processing agreement by D5.)
25. PDPA requests: no admin board shows where the front desk handles copy and delete requests (A5 and A6 have none). Which page, and which role (front desk or owner only)?
26. Club locations: PRD Foundation says a club has one or more locations, but the platform open questions ask if one club can have more than one. Does F01 build the add location UI, or only the data model with one location (Hunter)? (The web address per club is answered by D6, see F02.)
27. Club text fields: everything the club types has a Thai and an English field. Are both required to save, or may one be empty?

**New**

- **Q-A.** May one person be booked in two places at the same time (a coach who is also a player, D1)? The spec has no rule. If not, F03 needs one.
- **Q-B.** Must a club always have at least one Owner? The spec is silent; a club with no owner has no one to approve changes. (Not yet written as a criterion.)
- **Q-C.** BOOQ staff sign in (D3): which second factor (authenticator app, SMS, email code), and is there a board for the sign in screen? (Reset by another platform admin, logged in P6, is settled by D123.)
- **Q-D.** Which aggregate counts may BOOQ staff see (D2)? P1 shows bookings in the last 30 days. Anything else?
- **Q-E.** Test data in Testing (D4): what exactly marks a test receipt on the PDF, and is there a board for the tester list and the test receipt? (Exclusion from counts and reports is settled by D33.)

## Proposed acceptance checks for the hand-off (QA gap list)

QA found no acceptance check in the hand-off for the IDs below (`docs/qa/traceability.md`). These one line Given/When/Then checks are drawn from the criteria above. They are proposals for a person to add to the hand-off, PRD first. No rule is added; the full criteria are in each section.

| ID | Proposed acceptance check | Full criteria |
|---|---|---|
| PLAT-01 | Given a Testing club with one P4 check failing, when BOOQ staff press Go live, then the server refuses and P3 shows what is missing and who owes it | PLAT-01-AC2, AC3 |
| PLAT-02 | Given BOOQ staff in the support view of a Live club, when they request a player, booking or payment, then the server returns not found; when they try to edit a setting without the owner's 24 hour switch, then it is refused | PLAT-02-AC1, AC3, AC13 |
| PLAT-03 | Given a Paused club, when a player starts a booking, then the server refuses; their existing booking stays valid, its reminders go out, and on resume the expiry dates move forward by the pause length | PLAT-03-AC4, AC6, AC7 |
| PLAT-04 | Given any change to a booking, balance, price or setting, when it is saved, then one audit entry exists with actor, time, record, old value, new value and reason, and no route can edit or delete it | PLAT-04-AC1, AC6 |
| PLAT-05 | Given a club with a feature switched off, when its API is called for that feature, then the server refuses; a club started from Blank has no products and empty rules | PLAT-05-AC2, AC8 |
| PLAT-06 | Given an import file with one bad row, when the owner confirms, then nothing is saved and an error report lists the row; given Export club data pressed by BOOQ staff, then the content is not readable by them | PLAT-06-AC1, AC2, AC12 |
| PDPA-01 | Given a player's copy request, when it is handled, then the file holds only that player's rows; given a deletion request, then the profile is anonymised, financial rows stay (pending Q22), and both requests are in the audit log | PDPA-01-AC3, AC4, AC7 |
| TEXT-03 | Given the locale files, when a key holds a name, date, time, price or count, then it uses a named variable with the same name in both files | CC-5 |
| TEXT-04 | Given a change to an existing key's wording in a commit that is not a writers' import, when CI runs, then it fails; a new key must exist in both files | CC-5 |
| TEXT-05 | Given any key not starting with X, when `th.json` is checked, then it exists; the platform console renders with no Thai | CC-5 |
| TEXT-06 | Given the longest string of either language for a key, when the screen renders at 375 px and 1280 px, then no button wraps and the content area scrolls | CC-5 |
