# F01 acceptance sweep (F01-T37)

Swept on 30 Oct 2026 against `specs/features/F01-platform-foundation/requirements.md` and the AC-to-test table in `design.md` section 14.

**Result: 130 criteria. 101 covered by a lane test, 4 new QA tests, 2 findings, 23 still open (each with its reason).**

How it is wired: `tests/acceptance/F01-platform-foundation.traced.spec.ts` holds one `traced()` pointer per covered criterion; each fails if the lane's test it names disappears or is renamed. `tests/acceptance/F01-platform-foundation.new.spec.ts` holds the tests QA wrote. The criteria left open stay as `test.todo` in the generated `F01-platform-foundation.spec.ts`. The tenant isolation suite (`tests/rls/`) covers CC-1 and ROLE-AC6 for every club table.

## Findings

| # | Criterion | What is wrong | Where | Severity |
|---|---|---|---|---|
| QA-F01-1 | ROLE-02-AC7, D123 | A platform admin can issue a second-factor **reset** link for their own account. D123 says a reset is done only by another platform admin. `platform.issue_staff_enrolment` only checks that the caller is an admin | `packages/db/migrations/0055_staff_enrolment.sql` | 2 |
| QA-F01-2 | ROLE-01-AC8, D115 | The accountant reads **every** club setting. D115 says the Accountant reads business and tax settings only. Policy `club_setting_read` grants select to owner, front desk and accountant on all rows (hold, cancel window, rest cap and others are readable) | `packages/db/migrations/0002_club_setup.sql` line 183 | 3 |

Both are `it.fails` tests: they pass while the product is wrong and turn red when it is fixed, which is the signal to remove `.fails`. They are not fixed by QA. Which settings count as "business and tax" is not listed in the spec; the test accepts only `vat_enabled` (the one tax setting that exists) and is easy to adjust.

## Criteria

| Criterion | Text (cut) | Status |
|---|---|---|
| ROLE-01-AC1 | Given a LINE user who is a coach at a club and also books courts, when they sign in, then they have  | Covered by a lane test (traced) |
| ROLE-01-AC2 | Given a user with two roles, when the server checks a request, then it allows the request if **any** | Covered by a lane test (traced) |
| ROLE-01-AC3 | Given a user who is a coach and a player, when they look at players or other coaches in the coach po | Covered by a lane test (traced) |
| ROLE-01-AC4 | Given an owner or staff member who also plays, when they book as a player, then they pay as a player | Covered by a lane test (traced) |
| ROLE-01-AC5 | Given a role added to or removed from a person, when it is saved, then it is audited (PLAT-04) with  | Covered by a lane test (traced) |
| ROLE-01-AC6 | Given a BOOQ role, when a person holds one, then it lives on the BOOQ account (ROLE-02) and is never | Covered by a lane test (traced) |
| ROLE-01-AC7 | Given every club person (owner, staff, coach), when they have a record, then they also hold the Play | Covered by a lane test (traced) |
| ROLE-01-AC8 | Given the Accountant, when they open settings, then they read business and tax settings only; they s | **Finding QA-F01-2** (it.fails, red when fixed) |
| ROLE-02-AC1 | Given a BOOQ staff account, when they sign in to the platform console, then they must pass email sig | Covered by a lane test (traced) |
| ROLE-02-AC2 | Given a BOOQ staff account, when they try to sign in through LINE as that account, or open a club's  | Covered by a lane test (traced) |
| ROLE-02-AC3 | Given a LINE sign in of a club user, when they try the platform console, then the server refuses. | New QA test |
| ROLE-02-AC4 | Given a BOOQ staff member removed or deactivated in P6, when they try to sign in, then it is refused | Covered by a lane test (traced) |
| ROLE-02-AC5 | Given every BOOQ sign in, failed sign in, second factor reset and teammate invite, when it happens,  | Covered by a lane test (traced) |
| ROLE-02-AC6 | Given a teammate invited in P6, when they accept, then they set up their own email sign in and secon | Open: Open: the second-factor method is Q-C, and sign in is the auth provider (no spec yet). |
| ROLE-02-AC7 | Given a BOOQ staff member's second factor must be reset, when it is reset, then it is done only by a | **Finding QA-F01-1** (it.fails, red when fixed) |
| ROLE-02-AC8 | Given the owner invite, when P2 step 1 saves the owner's LINE ID, then the invite is bound to that L | Covered by a lane test (traced) |
| ROLE-AC1 | Given a signed in front desk user, when they request revenue, coach pay, prices, rules or staff data | Covered by a lane test (traced) |
| ROLE-AC2 | Given a signed in accountant, when they try to change a booking, price or balance, then the server r | Covered by a lane test (traced) |
| ROLE-AC3 | Given a coach, when they request another coach's schedule, any customer payment or club revenue, the | Covered by a lane test (traced) |
| ROLE-AC4 | Given a player, when they request another player's data, then the server returns not found. | Covered by a lane test (traced) |
| ROLE-AC5 | Given an onboarding specialist, when they open a club not assigned to them, then the server refuses. | Covered by a lane test (traced) |
| ROLE-AC6 | Given a user of club A with any role, when they request a record of club B, then the server returns  | Covered by a lane test (traced) |
| PLAT-01-AC1 | Given a new club created in P2, when it is saved, then its status is Draft, and every later P2 save  | Covered by a lane test (traced) |
| PLAT-01-AC2 | Given a Draft club, when steps 1 to 8 of the setup are not all done, then the server refuses the cha | Covered by a lane test (traced) |
| PLAT-01-AC3 | Given a Testing club, when any P4 Go live check is not passed, then the server refuses the change to | Covered by a lane test (traced) |
| PLAT-01-AC12 | Given the Go live checklist, when P4 lists it, then beyond the P4 checks it requires: the owner has  | Covered by a lane test (traced) |
| PLAT-01-AC4 | Given a club on a blank template, when it has no product, or any rule is unset, then Go live is refu | Covered by a lane test (traced) |
| PLAT-01-AC5 | Given a Draft or Testing club, when a player opens the player app, then the club is not visible to p | Covered by a lane test (traced) |
| PLAT-01-AC11 | Given a Draft or Testing club, when someone who is not signed in calls it, then the club serves only | Covered by a lane test (traced) |
| PLAT-01-AC6 | Given a Testing club, when it goes Live, then all test data is purged (P4 "Test bookings will be cle | Covered by a lane test (traced) |
| PLAT-01-AC7 | Given a club of any status, when any status change is made, then it records who, when, old status, n | Covered by a lane test (traced) |
| PLAT-01-AC8 | Given an onboarding specialist, when they request a status change on a club that is not assigned to  | Covered by a lane test (traced) |
| PLAT-01-AC10 | Given a Paused club, when a platform admin resumes it, then the status returns to Live, the reason f | Covered by a lane test (traced) |
| PLAT-01-AC9 | Given a failed test, when the club is Draft or Testing, then it stays in that status and P3 shows wh | Covered by a lane test (traced) |
| PLAT-02-AC1 | Given BOOQ staff in a club's support view, when they request players, bookings, payments, slips, rec | Covered by a lane test (traced) |
| PLAT-02-AC2 | Given a Draft or Testing club, when BOOQ staff change a setup value in the support view, then the ch | Covered by a lane test (traced) |
| PLAT-02-AC3 | Given a Live club with Allow BOOQ to make changes off, when BOOQ staff try to change any value, then | Covered by a lane test (traced) |
| PLAT-02-AC4 | Given a Live club, when the owner turns on Allow BOOQ to make changes, then BOOQ staff can edit setu | Covered by a lane test (traced) |
| PLAT-02-AC5 | Given the 24 hour window is on, when the owner turns it off early, then edits stop at once. | Covered by a lane test (traced) |
| PLAT-02-AC6 | Given any support view visit or change by BOOQ staff, when it happens, then it is logged in P6 and i | Covered by a lane test (traced) |
| PLAT-02-AC7 | Given a Paused club, when BOOQ staff open the support view, then it is look only, unless the owner h | Covered by a lane test (traced) |
| PLAT-02-AC8 | Given a stored secret (Messaging API token, Beam key, LIFF secret), when it is shown anywhere, then  | Covered by a lane test (traced) |
| PLAT-02-AC9 | Given a platform user without access to the club, when they open its support view, then the server r | Covered by a lane test (traced) |
| PLAT-02-AC10 | Given BOOQ staff in P1 or P3, when they look at a club, then they may see aggregate counts (for exam | Covered by a lane test (traced) |
| PLAT-02-AC12 | Given the support view, when it lists pages, then it holds exactly: courts and hours, products and p | New QA test |
| PLAT-02-AC13 | Given BOOQ staff request a record of a club they have no access to, or a record outside the setup on | Open: Route level (404 for another club or a record outside setup). Needs the apps/platform routes; the database side is the tenant suite. Next batch. |
| PLAT-02-AC14 | Given a guest (not signed in), when any route answers them, then it reads only named public columns  | Covered by a lane test (traced) |
| PLAT-02-AC11 | Given an aggregate count, when it is produced, then it is computed on the server as a number only, w | Covered by a lane test (traced) |
| PLAT-03-AC1 | Given a Live club, when a platform admin pauses it with a reason, then the status is Paused, the rea | Covered by a lane test (traced) |
| PLAT-03-AC2 | Given a pause request without a reason, when it is submitted, then it is refused (P3c "Reason, requi | Covered by a lane test (traced) |
| PLAT-03-AC3 | Given an onboarding specialist, when they try to pause or resume a club, then the server refuses. On | Covered by a lane test (traced) |
| PLAT-03-AC4 | Given a Paused club, when a player or a staff member tries to start a new booking or purchase or a n | Covered by a lane test (traced) |
| PLAT-03-AC5 | Given a Paused club, when a player opens the app, then Book a court, Classes and Packages show as pa | Open: Player app screens (F02/F03 UI). Playwright, later. |
| PLAT-03-AC6 | Given an existing booking, when the club is paused, then the booking stays valid and its LINE remind | Open: Reminders still sent while Paused: F10 job. Next batch with F10. |
| PLAT-03-AC7 | Given a package or wallet balance with an expiry date, when the club is resumed, then every expiry d | Covered by a lane test (traced) |
| PLAT-03-AC8 | Given a Paused club, when the owner or staff open the club admin, then it works and every page shows | Open: Admin banner (F11 UI). Playwright, later. |
| PLAT-03-AC9 | Given a payment already started before the pause, when it completes after the pause begins, then it  | Open: PAY-03 handling of a payment started before a pause: F05. Next batch. |
| PLAT-03-AC10 | Given any pause or resume, then it is written to the P6 log and the club's audit log (PLAT-04). | Covered by a lane test (traced) |
| PLAT-03-AC11 | Given a Paused club, when a platform admin resumes it, then new booking and buying turn back on, the | Covered by a lane test (traced) |
| PLAT-03-AC12 | Given a Paused club, when the owner or staff manage existing bookings, then they may move, add a coa | Open: Moves, cancels and late payment in a Paused club: F03/F05/F09 behaviour. Next batch. |
| PLAT-04-AC1 | Given a change to a booking, a credit or wallet balance (any ledger movement made by staff), a price | Covered by a lane test (traced) |
| PLAT-04-AC2 | Given the change cannot write its audit entry, when the transaction runs, then the whole change is r | Covered by a lane test (traced) |
| PLAT-04-AC3 | Given a staff adjustment to credits or wallet, when it is submitted without a written reason, then i | Covered by a lane test (traced) |
| PLAT-04-AC4 | Given a change made by BOOQ staff, when it is saved, then the entry names the BOOQ staff member and  | Covered by a lane test (traced) |
| PLAT-04-AC5 | Given any platform action (create club, status change, support view visit, pause, test run, export,  | Covered by a lane test (traced) |
| PLAT-04-AC6 | Given an audit entry, or a credit or wallet ledger row, when anyone tries to edit or delete it, then | Covered by a lane test (traced) |
| PLAT-04-AC12 | Given a deleted player is anonymised, when it is done, then personal fields in audit rows are replac | Covered by a lane test (traced) |
| PLAT-04-AC7 | Given an owner, when they open the audit log, then they can search and filter it by staff, record an | Open: Audit log search screen (F11 UI). |
| PLAT-04-AC8 | Given a front desk, accountant or coach, when they request the audit log, then the server refuses (A | Covered by a lane test (traced) |
| PLAT-04-AC9 | Given the Staff and audit log, when it lists an entry about a player, then it shows what the club ne | Covered by a lane test (traced) |
| PLAT-04-AC10 | Given a PDPA copy or delete request, when it is made or handled, then it is logged in the club's aud | Covered by a lane test (traced) |
| PLAT-04-AC11 | Given times in entries, when they are stored and shown, then they are Asia/Bangkok. | Covered by a lane test (traced) |
| PLAT-05-AC1 | Given one codebase for every club, when a feature switch is set on one club, then it changes that cl | Covered by a lane test (traced) |
| PLAT-05-AC2 | Given a switch is off for a club, when any surface or API of that club asks for the feature, then th | Covered by a lane test (traced) |
| PLAT-05-AC3 | Given a switch, when it is changed, then it is written to the audit log (it is a setting; PLAT-04). | Covered by a lane test (traced) |
| PLAT-05-AC4 | Given a club's payment option (Beam or slip checking), when it is read, then it behaves as a club le | Covered by a lane test (traced) |
| PLAT-05-AC5 | Given Hunter, when it runs, then nothing is written only for Hunter. Tennis, two courts, ฿500 an hou | New QA test |
| PLAT-05-AC6 | Given the list of switches, when F01 ships, then it contains only switches the spec names. The list  | Covered by a lane test (traced) |
| PLAT-05-AC7 | Given the Tennis template, when a new club starts from it, then products, prices and rules are copie | Covered by a lane test (traced) |
| PLAT-05-AC8 | Given the Blank template, when a new club starts from it, then it has no products and every club rul | Covered by a lane test (traced) |
| PLAT-05-AC9 | Given a template, when a value is a TBD in the spec (add-on prices, Head Coach price, referral rewar | Covered by a lane test (traced) |
| PLAT-05-AC10 | Given sport labels, when a club uses a template, then labels follow the sport (court, table, lane) f | Covered by a lane test (traced) |
| PLAT-05-AC11 | Given Padel and Pickleball, when F01 ships, then they appear as templates marked "to build" and cann | Covered by a lane test (traced) |
| PLAT-05-AC12 | Given a platform admin or specialist, when they pick a template in P2 or A0, then the chosen templat | Covered by a lane test (traced) |
| PLAT-05-AC13 | Given the Tennis template, when it is loaded, then its prices equal the final offer in PRD Pricing a | Covered by a lane test (traced) |
| PLAT-05-AC15 | Given the Tennis template, when it is loaded, then it carries the PRD default rules: payment hold 15 | Covered by a lane test (traced) |
| PLAT-05-AC16 | Given the Tennis template, when it is loaded, then it also carries the other values the PRD and deci | Covered by a lane test (traced) |
| PLAT-05-AC14 | Given the template actions on H-P5 ("New template", "Duplicate", "Edit") when F01 is built, then whe | Open: Undecided in the spec (its own Q5): no test until decided. |
| PLAT-06-AC1 | Given an owner in A0 step 7, when they upload a CSV of players, packages or balances, then the serve | Covered by a lane test (traced) |
| PLAT-06-AC18 | Given a CSV import, when it completes, then it has created players, customer packages and ledger mov | Open: Import creates no bookings: the import function is not on main yet. |
| PLAT-06-AC2 | Given an import with any invalid row, when the owner confirms or tries to, then nothing is saved. Th | Covered by a lane test (traced) |
| PLAT-06-AC3 | Given a balances file, when it is imported, then each balance becomes ledger movements with the reas | Covered by a lane test (traced) |
| PLAT-06-AC4 | Given a packages file, when it is imported, then each row creates a customer package with credits to | Open: Package import needs F06 (customer_package, import ledger rows). Not built. |
| PLAT-06-AC5 | Given an import file, when a row has a club ID column or any other club's identifier, then it is ign | Open: Import ignores a foreign club id: the import function is not on main yet. |
| PLAT-06-AC6 | Given an import, when it completes, then one audit entry records who, when, file name, counts of row | Open: Import audit entry: same. |
| PLAT-06-AC7 | Given an imported player, when someone signs in with LINE and their typed phone matches an imported  | Covered by a lane test (traced) |
| PLAT-06-AC8 | Given a front desk, accountant, coach or BOOQ staff, when they try to import, then the server refuse | Covered by a lane test (traced) |
| PLAT-06-AC9 | Given a CSV file, when it holds amounts, then amounts are read as THB and stored as integer satang,  | Covered by a lane test (traced) |
| PLAT-06-AC10 | Given an uploaded file, when the import is finished or cancelled, then the raw file is not kept long | Covered by a lane test (traced) |
| PLAT-06-AC11 | Given a club, when "Export club data" is run, then the export holds only that club's records (CC-1). | Covered by a lane test (traced) |
| PLAT-06-AC12 | Given BOOQ staff in P3, when they press Export club data, then the export starts, but BOOQ staff can | Covered by a lane test (traced) |
| PLAT-06-AC13 | Given an owner or front desk in A5 (the Accountant sees names on receipts and reports, never phone n | Open: Customer CSV export route (A5, F11). |
| PLAT-06-AC14 | Given an accountant or owner in A13 and A14, when they export a report or receipts, then they receiv | Open: Report and receipt exports (F13, F11). |
| PLAT-06-AC15 | Given any export of customers or club data, when it is made, then an audit entry records who, when,  | Open: Export audit entry with row count: export routes (F11). |
| PLAT-06-AC17 | Given any club, when F01 ships, then there is no delete club action in the platform console or anywh | Covered by a lane test (traced) |
| PLAT-06-AC16 | Given an export file, when it is produced, then slips and staff notes are included only in the full  | Open: Depends on Q18 (slips and notes in the export). Open. |
| PLAT-07-AC1 | Given a club in Testing, when a booking, order, payment, receipt, ledger movement or player record i | Covered by a lane test (traced) |
| PLAT-07-AC2 | Given a test receipt, when it is issued, then it uses its own number series that is clearly not a le | Open: Test receipt series: F13 receipts. Not built when swept. |
| PLAT-07-AC3 | Given a club goes Live, when Go live is confirmed, then all test flagged data of that club is purged | Covered by a lane test (traced) |
| PLAT-07-AC12 | Given the Go live purge, when it runs, then it removes only rows made by a tester kind; owner, staff | Covered by a lane test (traced) |
| PLAT-07-AC4 | Given the purge, when it runs, then it deletes only rows with the test flag and only for that club I | Covered by a lane test (traced) |
| PLAT-07-AC5 | Given a club in Testing, when someone signs in to the player app, then only the club owner and named | Covered by a lane test (traced) |
| PLAT-07-AC6 | Given BOOQ staff in P4, when they look at test results, then they see pass or fail per check only (D | Covered by a lane test (traced) |
| PLAT-07-AC7 | Given test data, when it is counted for aggregates in P1 (bookings in the last 30 days), then it is  | Covered by a lane test (traced) |
| PLAT-07-AC8 | Given a test run, when it starts, finishes or is purged, then it is written to P6 (PLAT-04). | Covered by a lane test (traced) |
| PLAT-07-AC10 | Given each club, when Beam is set up, then the club holds two sets of Beam keys, test and live. Test | Covered by a lane test (traced) |
| PLAT-07-AC11 | Given test flagged records, when any report, daily close, receipts list or platform count is produce | Open: Test rows excluded from reports, daily close, receipts lists, P1: F13 reports; the test-mode flag itself is covered. Next batch. |
| PLAT-07-AC9 | Given a test payment in Testing, when it is made, then it uses Beam's sandbox only. There is no in a | New QA test |
| PDPA-01-AC1 | Given any processing of player data, when BOOQ staff act, then they act only on the club's setup, ne | Covered by a lane test (traced) |
| PDPA-01-AC2 | Given a new player's first sign in, when they continue, then consent to the terms and the privacy no | Covered by a lane test (traced) |
| PDPA-01-AC3 | Given a signed in player, when they request a copy of their data in Profile, then the request is sto | Covered by a lane test (traced) |
| PDPA-01-AC4 | Given a signed in player, when they request deletion, then the request is stored, the front desk see | Covered by a lane test (traced) |
| PDPA-01-AC5 | Given a player who asks for deletion and holds a future booking or credit, when the request is handl | Covered by a lane test (traced) |
| PDPA-01-AC6 | Given slips and staff notes, when anyone other than staff of that club asks for them, then the serve | Covered by a lane test (traced) |
| PDPA-01-AC7 | Given a PDPA request, when it is made, handled or refused, then it is in the club's audit log (PLAT- | Covered by a lane test (traced) |
| PDPA-01-AC8 | Given all club data, when the nightly backup runs, then every club's data is backed up daily. How lo | Open: Nightly backups: DevOps. A restore drill is a go live exit item (test-strategy 6.6). |
| PDPA-01-AC9 | Given personal data in transit and at rest, when it is stored or sent, then it is encrypted in trans | Covered by a lane test (traced) |
| PDPA-01-AC10 | Given hosting, when data is stored, then it is stored in Supabase in the nearest region, Singapore,  | Open: Hosting region and data processing agreement: a document and a parked legal check (D5, D147). Not testable in code. |
| PDPA-01-AC11 | Given a player, when they open Privacy and my data, then they see the privacy notice, Request a copy | Open: Privacy and my data screen (F02/F11 UI, P-0413 and others). Playwright, later. |
| PDPA-01-AC12 | Given the privacy notice, when a player reads it, then it names the club as the controller and BOOQ  | Open: Privacy notice text names club as controller and BOOQ as processor: a content check on the final text, due before 7 Dec. |

## Design section 14 groups not covered by this sweep

Accountant columns (D35) over routes, key sets and callbacks on the inactive URL (F05), settings writes and audit, export download link expiry, deletion with a future booking over the app: lane tests exist for the database side of several of these (`anonymise`, `settings`, `import-export`); the route level waits for the apps. Playwright screens follow with the app lanes.
