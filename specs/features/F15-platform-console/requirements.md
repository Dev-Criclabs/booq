# F15 Platform console P1 to P6 · Requirements

Status: **DRAFT for approval (gate 1).** Drafted 30 Oct 2026. Nothing here is approved until a person says so. No design or code follows until then.

Feature: F15 Platform console. Depends on: F01. Requirement IDs: PLAT-01 to PLAT-07 as they appear on the P pages (F01 owns the rules and data; F15 owns the screens and platform routes), ROLE-02, LINE-06, and the page rules the hand-off has no ID for (labelled R1 to R6, local to this file). Waves 3 to 5; P2 to P4 are needed to put Hunter into Testing and Live.

## Sources

| Short name | File | Sections used |
|---|---|---|
| PRD | `specs/product/prd-v1.2.md` | BOOQ platform and club onboarding (Who uses it, What a club needs before it can go live, Platform console pages, Platform flows J and K, Pausing a live club, Support access, What changes in the club app, Platform foundation, Open questions for the platform); Payment checking and LINE message costs; Key dates |
| HO | `specs/product/handoff-v1.2.md` | Roles, platform console and data protection (PLAT-01 to PLAT-07, ROLE-02, PDPA-01); LINE integration (LINE-06, LINE-07); Screen inventory (Platform console row); Payments (PAY-01) |
| Decisions | `docs/decisions.md` | D2, D3, D4, D14, D15, D26, D27, D32, D33, D75, D98, D100, D101, D102, D103, D108, D114, D122, D123; D6 (shared domain with the club in the URL) |
| Gaps | `docs/canvas-gaps.md` | A2 (slip tests in P4), B6, C7 |
| F01 | `specs/features/F01-platform-foundation/requirements.md` | The rules F15 shows: status, support view, pause, audit, templates, export, test mode |
| Other features | F05, F10, F11, F13 | Beam keys and tests, rich menu and LINE health, A0 and A16, receipts series |

The spec wins over the canvas. The platform console is **English only** (TEXT-05); its text uses X keys. Boards named are the ones in the canvas file list on 30 Oct 2026; the P boards have no Thai twins.

## Scope

In scope: the platform console pages P1 Clubs, P2 New club (steps 1 to 5), P3 Club detail (with P3b support view and P3c pause), P4 Launch, P5 Templates, P6 Team and audit log, and the platform routes behind them; BOOQ staff sign in (ROLE-02); the owner invite; the per club health and usage numbers.

Out of scope: the rules themselves (F01), the club admin pages including A0 and A16 (F11), Beam integration (F05), the rich menu image and messages (F10), receipts (F13).

## Canvas legend

H- hi-fi, F4-, F5a-, F5b- flow copies (not repeated). Boards: H-P1-Clubs, H-P1-Clubs-clear, H-P1-Clubs-paused, H-P2-Step1-Basics, H-P2-Step2-Plan, H-P2-Step3-Courts, H-P2-Step4-LINE, H-P2-Step5-Payments, H-P2-Step5b-Payments-slip (slip clubs, F16), H-P3-Club-detail, H-P3-Club-alert, H-P3-Club-fixed, H-P3-Club-live, H-P3b-Support-view, H-P3c-Pause-club, H-P4-Launch, H-P5-Templates, H-P5b-Templates-blank, H-P6-Team-audit, Flows-Platform.

## Cross-cutting rules (apply to every requirement below)

**CC-1 Club ID scope and BOOQ blindness.** Every platform view addresses one club ID at a time, or none (team actions). BOOQ staff see setup and aggregates only, never a club's players, bookings, payments, slips, receipts, wallets or reports (PLAT-02, D2). A request for a club outside the caller's assignment answers 404 (D27).

**CC-2 Server side.** The server checks the platform role and the club assignment for every platform read and write. Roles: Platform admin (all clubs, create, status, pause and resume, support view); Onboarding specialist (assigned clubs: set up, support view, Draft, Testing and Live; no pause, resume or delete) (D15). Every platform route is behind email plus a second factor (ROLE-02, D3).

**CC-3 PDPA.** The console holds club setup and the owner's contact details, which BOOQ may see (D2). It never holds player data. Aggregate counts are numbers only. The audit log P6 holds BOOQ staff identities; it is append only (D28). BOOQ is the data processor (PDPA-01).

**CC-4 No double booking.** Not relevant to the console, except that nothing in P1 to P6 deletes or moves a booking: pausing keeps bookings; a change to courts or hours under bookings is refused (F01, D50); the Go live purge removes only test rows (D100).

**CC-5 Language files (TEXT-01 to TEXT-06).** The platform console is English only (TEXT-05): its text comes from X keys in `locales/en.json`, with no Thai. Sample values (club names, dates, counts, ids) are named variables per `locales/README.md`. Existing wording is not edited; new text gets new keys in `en.json` (and `locales/pending/`, D81), proposed by the drafter, owned by the writers (D51). Layouts survive the longest string; tables scroll; buttons never wrap. Club names the console shows are the club's English name field.

**CC-6 Other platform rules.** All times Asia/Bangkok. Money is integer satang (the BOOQ plan is ฿1,900 a month plus VAT, one plan for every club). Never invent a rule: where the spec is silent it is a question below.

---

## ROLE-02 BOOQ staff sign in, and the team (P6)

**Source.** HO ROLE-02; D3, D123; PRD Who uses it, P6. F01 owns the rules (ROLE-02-AC1 to AC8); F15 builds the screens.

**Acceptance criteria.**

- ROLE-02-F15-AC1. Given the platform console, when a BOOQ staff member opens it, then they sign in with email plus a second factor, not LINE; without the second factor no session is created (F01 ROLE-02-AC1).
- ROLE-02-F15-AC2. Given P6, when a platform admin invites a teammate (name, role), then an invite goes out and the teammate sets their own email sign in and second factor; the role is Platform admin or Onboarding specialist; a specialist is assigned clubs.
- ROLE-02-F15-AC3. Given P6, when a platform admin assigns clubs to a specialist, then the specialist sees only those clubs in P1 (P1 "Onboarding specialists only see clubs assigned to them").
- ROLE-02-F15-AC4. Given a teammate is removed or deactivated, when it is saved, then they cannot sign in and open sessions end (F01 ROLE-02-AC4).
- ROLE-02-F15-AC5. Given a teammate's second factor must be reset, when it is reset, then only another platform admin can do it and it is logged in P6 (D123).
- ROLE-02-F15-AC6. Given P6 lists the team, then it shows name, role, assigned clubs and last active; a specialist cannot open the team list's admin actions.
- ROLE-02-F15-AC7. Given every BOOQ sign in, failed sign in, invite, removal and second factor reset, when it happens, then a P6 entry is written (F01 ROLE-02-AC5).

**Meets.** PDPA: BOOQ staff are processor staff; CC-3. No double booking: not relevant. Club scope: team actions have no club ID. TEXT: X keys. The second factor type is Q1.

**Canvas.** H-P6-Team-audit.

---

## P6 The platform audit log (PLAT-04)

**Source.** HO PLAT-04; PRD P6; D28.

**Acceptance criteria.**

- P6-AC1. Given any platform action (create club, status change, pause and resume, support view visit and change, test run, export started, invite, template change, tester list change), when it happens, then a P6 entry is written with who, when, club and what (F01 PLAT-04-AC5).
- P6-AC2. Given P6, when a platform admin opens it, then they can filter by club, status changes, support views and date; a specialist sees only entries for assigned clubs.
- P6-AC3. Given an entry, when anyone tries to edit or delete it, then the server refuses; "Every platform action is kept. Nothing here can be edited or deleted" (H-P6-Team-audit, D28).
- P6-AC4. Given a BOOQ change in a club's support view, when it is saved, then it appears in P6 and in the club's own audit log with the BOOQ staff name (PLAT-02-AC6).
- P6-AC5. Given P6 entries, when they mention a club, then they hold no player data (CC-1).
- P6-AC6. Given how long P6 entries are kept, then it is not decided (F01 Q13, parked retention pattern); until then none is deleted.

**Meets.** PDPA: entries name BOOQ staff only. No double booking: not relevant. Club scope: per club or none. TEXT: X keys, English only.

**Canvas.** H-P6-Team-audit.

---

## P1 Clubs (with LINE-06)

**Source.** PRD P1, Running many clubs; HO LINE-06, LINE-07; D2, D33, D75, D98, D114.

**Requirement.** P1 lists every club with status, setup progress, bookings in the last 30 days, LINE messages this month against the plan, and alerts.

**Acceptance criteria.**

- P1-AC1. Given a platform admin, when P1 loads, then it lists every club with its status (Draft, Testing, Live, Paused), setup progress (steps done of 9), bookings in the last 30 days, LINE messages used this month against the plan limit, and alerts; a specialist sees only assigned clubs.
- P1-AC2. Given the bookings count and the message count, then they are aggregate numbers computed on the server; there is no way to open the rows behind them (D2, PLAT-02-AC11).
- P1-AC3. Given a club in Testing, when P1 loads, then its counts show "Test only" and test data is excluded from the live counts (D33).
- P1-AC4. Given status filter chips (All, Live, Testing, Draft, Paused) with counts, when one is chosen, then the list is filtered.
- P1-AC5. Given alerts, when P1 loads, then clubs with alerts are listed first. Alert kinds in v1 are those the spec names: LINE token failed or expired (LINE-06, D114), LINE message cap at 70 percent (LINE-07, D98), Beam key check failed and Beam unreachable (D75), a bad signature on Beam callbacks (D75), LINE usage unreadable (D97), owner has not opened the invite, a failed live check in P3. Each alert opens the club in P3.
- P1-AC6. Given a club row, when it is clicked, then P3 Club detail opens.
- P1-AC7. Given the LINE message count, when it is shown, then it comes from LINE's own count for the club's Official Account against the club's plan limit (F10 LINE-06-AC2), and the plan (free or paid) shows.
- P1-AC8. Given the New club button, when a platform admin or specialist presses it, then P2 starts and the club is saved as a Draft.
- P1-AC9. Given a paused club, when P1 loads, then it shows Paused with its reason in P3 (H-P1-Clubs-paused).
- P1-AC10. Given what P1 shows for a club with a deleted owner or no owner, then it is not decided (Q2).

**Meets.** PDPA: counts only (CC-3). No double booking: not relevant. Club scope: per club row; specialists by assignment. TEXT: X keys.

**Canvas.** H-P1-Clubs, H-P1-Clubs-clear, H-P1-Clubs-paused.

---

## P2 New club (PLAT-01, PLAT-05)

**Source.** PRD P2 and What a club needs before it can go live (steps 1 to 5); HO PLAT-01, PLAT-05, PAY-01; D6, D32, D122.

**Requirement.** P2 is the setup wizard, steps 1 to 5, saved as a Draft at any point. Steps 6 to 8 are done by the owner after the invite (A0, F11); step 9 is P4.

**Acceptance criteria.**

- P2-AC1. Given P2 step 1 (Club basics), when it is filled, then it holds the club name in Thai and English, the legal company name, tax ID (13 digits), branch, the registered address printed on receipts, the owner's name, phone, LINE ID and email, and the default language; the receipt prefix is also set here and is required before Go live (D106).
- P2-AC2. Given the owner's LINE ID entered in step 1, when the club is saved, then the owner invite is bound to that LINE ID and is single use (D122).
- P2-AC3. Given P2 step 2 (Plan), when it is shown, then it states one BOOQ plan of ฿1,900 a month plus VAT for every club, not editable per club, and sets only the trial end and the billing start (PRD). Whether BOOQ bills through the platform is open (Q3).
- P2-AC4. Given P2 step 3 (Courts and hours), when it is filled, then it holds the sport, the location (Hunter: Main location · Head office; Add location exists in the data model, F01 Q26), the courts as resources (name, sport, indoor or outdoor, lights, players) and opening hours per day; bookings stay 60 minutes on the hour (PRD, F01).
- P2-AC5. Given P2 step 4 (LINE), when it is filled, then it holds the LINE provider, the Official Account ID, the LINE Login channel ID, the LIFF app ID and the Messaging API token (stored encrypted, write only, last 4 shown, D27, D34), each with a Test and a result, and a step by step guide; the three must sit under one provider (D7).
- P2-AC6. Given P2 step 4, when the rich menu is uploaded, then the club's own menu goes to its own Official Account with the owner's labels, and it can be redone after the owner sets labels (F10 LINE-02-AC5).
- P2-AC7. Given P2 step 5 (Payments), when it is filled, then the club picks Beam or PromptPay with slip checking (PAY-01); for Beam it holds the club's own Beam merchant details in two sets, test and live, with a Test connection (D32); the slip option is F16 and is not built for Hunter.
- P2-AC8. Given any step, when BOOQ staff press Save draft or Next, then the club is saved as a Draft and later steps stay editable; a club with unsaved required fields stays Draft.
- P2-AC9. Given the Tests, when a test fails, then the club stays Draft or Testing and P3 shows what is missing and who owes it (Flow J).
- P2-AC10. Given the wizard text "Refunds go back by PromptPay" on the Beam option (PRD, Gaps A3), when F15 is built, then it is not built; the text says wallet or package credit (D117).
- P2-AC11. Given P2, when a club is created, then it records the template chosen (Tennis or Blank) and the creator, and writes P6 (PLAT-05-AC12).
- P2-AC12. Given a club's web address, when it is created, then the club is reached on the one shared BOOQ domain with the club in the URL (D6); how the club's URL name is set and checked for uniqueness is Q4.

**Meets.** PDPA: owner contact details are club setup data BOOQ may hold (D2). No double booking: not relevant. Club scope: P2 creates one club. TEXT: X keys, English only; Thai fields (club name Thai) are club data, not text.

**Canvas.** H-P2-Step1-Basics to H-P2-Step5-Payments (H-P2-Step5b-Payments-slip is F16).

---

## P3 Club detail, support view and pause (PLAT-01, PLAT-02, PLAT-03, PLAT-06)

**Source.** PRD P3, Support access, Pausing a live club, Flow K; HO PLAT-01, PLAT-02, PLAT-03, PLAT-06; D14, D15, D27, D75, D102, D108.

**Acceptance criteria.**

- P3-AC1. Given P3 for a club, when it loads, then it shows the setup checklist (steps 1 to 9) with what is missing and who owes it (BOOQ or the owner), the owner invite (sent, opened, copy link, resend), live checks (LINE Login, Messaging API, LIFF app, payment connection) with last test time and Test all again, and the status control.
- P3-AC2. Given the status control, when staff change the status, then F01's rules apply: Testing unlocks when steps 1 to 8 are done; Live is set in P4; specialists take assigned clubs through Draft, Testing and Live; only a platform admin pauses or resumes (D15, PLAT-01).
- P3-AC3. Given a platform admin pauses a Live club, when they confirm in P3c, then a reason is required, the owner gets a LINE message with the reason, and the effects of F01 PLAT-03 apply (new booking and buying off, bookings and reminders kept, expiry moved at resume, banner in the club admin).
- P3-AC4. Given a Paused club, when a platform admin resumes it, then F01 PLAT-01-AC10 applies.
- P3-AC5. Given Open support view, when BOOQ staff open it, then it shows setup only: courts and hours, products and pricing (with add-ons), LINE, payment connections, settings; it does not show staff, coaches, closures or promo codes (D27). Draft and Testing clubs open in edit mode; Live and Paused clubs are look only unless the owner has turned on Allow BOOQ to make changes for 24 hours (PLAT-02).
- P3-AC6. Given a stored secret, when it is shown in P3 or the support view, then only the last 4 characters show and it can only be replaced (D27).
- P3-AC7. Given a club's Messaging API token failed (P3b "Failed · token expired"), when P3 loads, then the failure and a way to retest show, and the alert in P1 clears when a test passes.
- P3-AC8. Given Export club data, when a platform admin or specialist presses it, then the export starts, they cannot open, download or read it, and the owner downloads it (D14, PLAT-06). Where the owner finds it is F01 Q1.
- P3-AC9. Given the owner contact details (name, phone, LINE, email), when P3 shows them, then BOOQ staff may see them (D2).
- P3-AC10. Given no club can be deleted in v1 (D14), when P3 loads, then there is no Delete club action.
- P3-AC11. Given a visit to the support view or a change in it, when it happens, then it is logged in P6 and in the club's own audit log with the staff name (PLAT-02-AC6).
- P3-AC12. Given a club of another assignment, when a specialist opens its P3, then the server answers 404 (CC-1).
- P3-AC13. Given the tester list (owner and named BOOQ testers, D102), when staff edit it in P3 or P4, then every change is written to P6; testers get long lived invites and a BOOQ tester signs in with LINE as a test player (F01 PLAT-07-AC5).

**Meets.** PDPA: setup only; D2 limits. No double booking: pausing never cancels a booking. Club scope: P3 is one club; specialists by assignment. TEXT: X keys.

**Canvas.** H-P3-Club-detail, H-P3-Club-alert, H-P3-Club-fixed, H-P3-Club-live, H-P3b-Support-view, H-P3c-Pause-club.

---

## P4 Launch: test mode and Go live (PLAT-01, PLAT-07)

**Source.** PRD P4, Flow J; HO PLAT-01, PLAT-07; D4, D26, D32, D33, D100, D101, D108; Gaps A2.

**Acceptance criteria.**

- P4-AC1. Given a club in Testing, when P4 loads, then it shows the test mode results as pass or fail per check only, never the test bookings, players, payments or receipts (D4, PLAT-07-AC6), and a Run tests again action.
- P4-AC2. Given the test checklist, when it is built for a Beam club, then it holds checks that apply to Beam (a mock court booking with bundle hours, a sandbox payment confirmed by a verified callback, the LINE confirmation arrives, the reminder is sent, the receipt PDF has the club's legal details, the booking shows on the club calendar); the fake slip checks of the canvas board are for slip clubs only (Gaps A2, F16). The full Beam list is F01 Q7.
- P4-AC3. Given test payments, when they run, then they use Beam's sandbox only; there is no in app simulate payment (D26).
- P4-AC4. Given the Go live checklist, when it is shown, then it holds: all setup steps done, LINE and payment checks pass today, at least one product and every required rule set, prices and packages checked by the owner, staff and coaches invited, test bookings will be cleared (deleted at Go live), the owner agrees to the go live date; and beyond these, the owner has signed in, one completed test booking, the per player pay tap limit is set, and the Beam key swap with its smoke test is done (D108, D32).
- P4-AC5. Given any line unticked, when staff press Go live, then the server refuses and the button is locked (PLAT-01-AC3).
- P4-AC6. Given Go live, when it completes, then the status becomes Live, the club moves to the live Beam key set, all test flagged rows are purged (only tester kind rows; owner, staff and coach accounts and audit entries survive, D100, D101), the real receipt series starts at 000001 for the Bangkok year (D4, D106), and P6 records it.
- P4-AC7. Given a failed purge, when any row cannot be purged, then Go live does not complete and the club stays Testing (F01 PLAT-07-AC4).
- P4-AC8. Given the 7 Dec test, when it runs, then it runs on production with Hunter in Testing status (D16); test LINE messages go through the real Official Account and count toward the cap (D32).
- P4-AC9. Given Go live, when a specialist presses it for an assigned club, then it works (D15).

**Meets.** PDPA: BOOQ sees pass or fail only. No double booking: the purge removes only test rows; real bookings do not exist before Go live. Club scope: per club. TEXT: X keys.

**Canvas.** H-P4-Launch.

---

## P5 Templates (PLAT-05)

**Source.** PRD P5; HO PLAT-05; D8.

**Acceptance criteria.**

- P5-AC1. Given P5, when it loads, then it lists the templates (Tennis with Hunter's setup, Padel and Pickleball "to build", Blank) and shows the selected template's products, prices and rules (H-P5-Templates).
- P5-AC2. Given the Tennis template, when it is shown, then it carries the PRD default prices and the rules of F01 PLAT-05-AC15 and AC16; Blank shows no products and empty rules (H-P5b-Templates-blank, D8).
- P5-AC3. Given a template, when it shows "Used by n clubs", then it states that changes affect new clubs only.
- P5-AC4. Given New template, Duplicate and Edit on the canvas, when F15 is built, then whether they exist in v1 is F01 Q5.
- P5-AC5. Given a club picks a template, when it is applied (P2 or A0 step 7), then it is copied into the club (F01 PLAT-05-AC7) and written to P6.
- P5-AC6. Given Blank, when a club starts from it, then Go live stays blocked until at least one product and every required rule is set (PRD P5, F01 PLAT-01-AC4).

**Meets.** PDPA: not relevant. No double booking: a template cannot set booking length. Club scope: templates are platform data; copies are club data. TEXT: X keys.

**Canvas.** H-P5-Templates, H-P5b-Templates-blank.

---

## R1 Platform console shell

**Source.** PRD Platform console pages; H-P1 to H-P6.

**Acceptance criteria.**

- R1-AC1. Given the console sidebar, when it loads, then it lists Clubs, Templates and Team and audit log; a specialist does not see Team administration.
- R1-AC2. Given the console is desktop at 1280 px, when it renders, then tables scroll and buttons never wrap (TEXT-06).
- R1-AC3. Given the console, when it renders text, then it is English only (TEXT-05).
- R1-AC4. Given any page, when a request is for a club the caller cannot reach, then it is 404 (CC-1).

**Meets.** As CC rules. TEXT: X keys.

**Canvas.** All H-P boards (sidebar).

---

## Data covered by F15 (HO Data model, for the design step)

Club (status, payment option, plan dates, template, receipt prefix, URL name), Location, Resource, Opening hours, BOOQ staff account (email, second factor, role, assigned clubs; no club ID), club_tester, platform audit entries (P6), setup checklist state per club, live check results, usage counters (messages, bookings counts), invite (bound to the owner LINE ID, single use). Beam key sets and the LINE token are encrypted secrets, write only.

## Proposed new text keys (D51)

Proposed by the drafter; X keys, English only; numbers from the i18n role after `copy-index.csv` exists (D31). Existing X keys first (X-0133, X-0178, X-0185 to X-0187, X-0213, X-0222, X-0290, X-0291 and others).

- X: alert labels for the kinds in P1-AC5, the Beam test checklist lines (P4-AC2), the extra Go live lines (P4-AC4), second factor screens and errors, tester list, team invite and second factor reset, export started notice, club URL name field and its errors.

No key is added by this draft.

## Open questions

1. **Second factor and the sign in screen (ROLE-02).** Which second factor (authenticator app, SMS, email code), and is there a board for the BOOQ sign in screen? (Reset by another platform admin is settled, D123.)
2. **A club with no owner signed in.** What does P1 show and what does P3 offer when the owner invite is unopened for a long time, or the owner left?
3. **Billing through the platform (PRD open question, C7).** The plan is ฿1,900 a month plus VAT but P2 step 2 says billing through the platform is open. Is BOOQ billing built in v1, or are trial end and billing start only dates BOOQ keeps?
4. **Club URL name (D6).** Where is the club's name in the URL set (a P2 field), who checks it is unique, and can it change after Go live?
5. **Sports on P2 step 3.** The canvas lists Tennis, Padel, Pickleball and Badminton, but P5 has templates Tennis, Padel, Pickleball and Blank only. Is Badminton a sport label without a template, or removed?
6. **P2 step 5 for a Beam club.** Which Beam details does BOOQ enter (merchant ID, API key and webhook signing key in two sets) and which does the club owner enter? Hunter's account and sandbox are the user's own task.
7. **Beam test list (F01 Q7).** The full P4 checks for a Beam club, and which "every rule is set" must be ticked for Hunter with TBD settings empty.
8. **Alert kinds.** Are the alert kinds in P1-AC5 the full list for v1, and who is told for each (BOOQ only, or also the owner)? D75 and D114 settle some.
9. **Templates actions (F01 Q5).** New template, Duplicate and Edit in v1 or only Tennis and Blank?
10. **Platform audit retention (P6-AC6).** How long is P6 kept? (Parked pattern with F01 Q13.)
