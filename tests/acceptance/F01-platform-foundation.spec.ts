// F01 Platform foundation: acceptance check skeletons, one todo per criterion.
// Generated from specs/features/F01-platform-foundation/requirements.md (approved 30 Oct 2026, branch spec/f01-f02-requirements).
// Criteria text is the spec's; the test title is cut short, the full Given/When/Then is in the comment above it.
// Tests come first (CLAUDE.md): replace each todo with a test when the F-design.md is approved. Needs vitest (D30).
import { describe, test } from 'vitest';

describe('ROLE-01', () => {
  // Given a LINE user who is a coach at a club and also books courts, when they sign in, then they have one record with the roles Coach and Player and can open both surfaces.
  test.todo('ROLE-01-AC1 Given a LINE user who is a coach at a club and also books courts, when they sign in, then they have one ...');
  // Given a user with two roles, when the server checks a request, then it allows the request if **any** of their roles allows it, and refuses if none does. Rights are the union of the roles and nothing more.
  test.todo('ROLE-01-AC2 Given a user with two roles, when the server checks a request, then it allows the request if **any** of ...');
  // Given a user who is a coach and a player, when they look at players or other coaches in the coach portal, then they see only what the Coach role allows; the Player role does not widen it.
  test.todo('ROLE-01-AC3 Given a user who is a coach and a player, when they look at players or other coaches in the coach portal, ...');
  // Given an owner or staff member who also plays, when they book as a player, then they pay as a player (same price, same hold, same rules). Staff rights do not skip payment or the hold.
  test.todo('ROLE-01-AC4 Given an owner or staff member who also plays, when they book as a player, then they pay as a player (same ...');
  // Given a role added to or removed from a person, when it is saved, then it is audited (PLAT-04) with the old and new set. Roles are assigned by the owner only (A17).
  test.todo('ROLE-01-AC5 Given a role added to or removed from a person, when it is saved, then it is audited (PLAT-04) with the ...');
  // Given a BOOQ role, when a person holds one, then it lives on the BOOQ account (ROLE-02) and is never mixed into a club role set. A BOOQ staff member who also plays at a club has a separate club player record signed in with LINE.
  test.todo('ROLE-01-AC6 Given a BOOQ role, when a person holds one, then it lives on the BOOQ account (ROLE-02) and is never mixed ...');
});

describe('ROLE-02', () => {
  // Given a BOOQ staff account, when they sign in to the platform console, then they must pass email sign in and a second factor. Without the second factor, no session is created.
  test.todo('ROLE-02-AC1 Given a BOOQ staff account, when they sign in to the platform console, then they must pass email sign in ...');
  // Given a BOOQ staff account, when they try to sign in through LINE as that account, or open a club's admin console as a club user, then it is refused. A BOOQ account never gets a club role (ROLE-01-AC6).
  test.todo('ROLE-02-AC2 Given a BOOQ staff account, when they try to sign in through LINE as that account, or open a club\'s admin ...');
  // Given a LINE sign in of a club user, when they try the platform console, then the server refuses.
  test.todo('ROLE-02-AC3 Given a LINE sign in of a club user, when they try the platform console, then the server refuses.');
  // Given a BOOQ staff member removed or deactivated in P6, when they try to sign in, then it is refused and any open session ends.
  test.todo('ROLE-02-AC4 Given a BOOQ staff member removed or deactivated in P6, when they try to sign in, then it is refused and ...');
  // Given every BOOQ sign in, failed sign in, second factor reset and teammate invite, when it happens, then it is written to P6 (PLAT-04).
  test.todo('ROLE-02-AC5 Given every BOOQ sign in, failed sign in, second factor reset and teammate invite, when it happens, then ...');
  // Given a teammate invited in P6, when they accept, then they set up their own email sign in and second factor. The method (code app, SMS, other) is Q-C.
  test.todo('ROLE-02-AC6 Given a teammate invited in P6, when they accept, then they set up their own email sign in and second ...');
});

describe('ROLE', () => {
  // Given a signed in front desk user, when they request revenue, coach pay, prices, rules or staff data, then the server refuses, whatever the screen shows.
  test.todo('ROLE-AC1 Given a signed in front desk user, when they request revenue, coach pay, prices, rules or staff data, then ...');
  // Given a signed in accountant, when they try to change a booking, price or balance, then the server refuses and nothing changes.
  test.todo('ROLE-AC2 Given a signed in accountant, when they try to change a booking, price or balance, then the server refuses ...');
  // Given a coach, when they request another coach's schedule, any customer payment or club revenue, then the server refuses.
  test.todo('ROLE-AC3 Given a coach, when they request another coach\'s schedule, any customer payment or club revenue, then the ...');
  // Given a player, when they request another player's data, then the server returns not found.
  test.todo('ROLE-AC4 Given a player, when they request another player\'s data, then the server returns not found.');
  // Given an onboarding specialist, when they open a club not assigned to them, then the server refuses. When they try to pause or resume any club, then the server refuses (D15). There is no delete club action for anyone in v1 (D14).
  test.todo('ROLE-AC5 Given an onboarding specialist, when they open a club not assigned to them, then the server refuses. When ...');
  // Given a user of club A with any role, when they request a record of club B, then the server returns not found (CC-1).
  test.todo('ROLE-AC6 Given a user of club A with any role, when they request a record of club B, then the server returns not ...');
});

describe('PLAT-01', () => {
  // Given a new club created in P2, when it is saved, then its status is Draft, and every later P2 save keeps it Draft.
  test.todo('PLAT-01-AC1 Given a new club created in P2, when it is saved, then its status is Draft, and every later P2 save keeps ...');
  // Given a Draft club, when steps 1 to 8 of the setup are not all done, then the server refuses the change to Testing and P3 shows what is missing and who owes it (PRD Platform flows: Flow J). Both a specialist (assigned club) and a platform admin may make this change (D15).
  test.todo('PLAT-01-AC2 Given a Draft club, when steps 1 to 8 of the setup are not all done, then the server refuses the change to ...');
  // Given a Testing club, when any P4 Go live check is not passed, then the server refuses the change to Live, whatever the screen shows. When every check is passed and BOOQ staff press Go live, then the status is Live and the change is written to the P6 log.
  test.todo('PLAT-01-AC3 Given a Testing club, when any P4 Go live check is not passed, then the server refuses the change to Live, ...');
  // Given a club on a blank template, when it has no product, or any rule is unset, then Go live is refused (PRD P5). A product with a price counts; the exact rule list is Q7.
  test.todo('PLAT-01-AC4 Given a club on a blank template, when it has no product, or any rule is unset, then Go live is refused ...');
  // Given a Draft or Testing club, when a player opens the player app, then the club is not visible to players (P4 "Players can't see the club yet"). In Testing, only the testers can sign in: the club owner and named BOOQ testers (D4, PLAT-07).
  test.todo('PLAT-01-AC5 Given a Draft or Testing club, when a player opens the player app, then the club is not visible to players ...');
  // Given a Testing club, when it goes Live, then all test data is purged (P4 "Test bookings will be cleared, deleted at Go live") and the club's real receipts start at 000001 (D4; PLAT-07).
  test.todo('PLAT-01-AC6 Given a Testing club, when it goes Live, then all test data is purged (P4 "Test bookings will be cleared, ...');
  // Given a club of any status, when any status change is made, then it records who, when, old status, new status and, for Paused, the reason (PLAT-04).
  test.todo('PLAT-01-AC7 Given a club of any status, when any status change is made, then it records who, when, old status, new ...');
  // Given an onboarding specialist, when they request a status change on a club that is not assigned to them, or try to pause or resume any club, then the server refuses. A platform admin may pause and resume any club (D15).
  test.todo('PLAT-01-AC8 Given an onboarding specialist, when they request a status change on a club that is not assigned to them, ...');
  // Given a failed test, when the club is Draft or Testing, then it stays in that status and P3 shows what is missing and who owes it (PRD Flow J).
  test.todo('PLAT-01-AC9 Given a failed test, when the club is Draft or Testing, then it stays in that status and P3 shows what is ...');
  // Given a Paused club, when a platform admin resumes it, then the status returns to Live, the reason for resuming is written to P6, and the pause length is fixed for PLAT-03-AC7. Only a platform admin can resume (D15).
  test.todo('PLAT-01-AC10 Given a Paused club, when a platform admin resumes it, then the status returns to Live, the reason for ...');
});

describe('PLAT-02', () => {
  // Given BOOQ staff in a club's support view, when they request players, bookings, payments, slips, receipts, wallets or reports, then the server refuses, even with a direct API call (CLAUDE.md "BOOQ platform staff never see...").
  test.todo('PLAT-02-AC1 Given BOOQ staff in a club\'s support view, when they request players, bookings, payments, slips, ...');
  // Given a Draft or Testing club, when BOOQ staff change a setup value in the support view, then the change is saved.
  test.todo('PLAT-02-AC2 Given a Draft or Testing club, when BOOQ staff change a setup value in the support view, then the change ...');
  // Given a Live club with Allow BOOQ to make changes off, when BOOQ staff try to change any value, then the server refuses and the support view shows look only.
  test.todo('PLAT-02-AC3 Given a Live club with Allow BOOQ to make changes off, when BOOQ staff try to change any value, then the ...');
  // Given a Live club, when the owner turns on Allow BOOQ to make changes, then BOOQ staff can edit setup values. When 24 hours have passed, then it turns off by itself and further edits are refused, with no action by anyone.
  test.todo('PLAT-02-AC4 Given a Live club, when the owner turns on Allow BOOQ to make changes, then BOOQ staff can edit setup ...');
  // Given the 24 hour window is on, when the owner turns it off early, then edits stop at once.
  test.todo('PLAT-02-AC5 Given the 24 hour window is on, when the owner turns it off early, then edits stop at once.');
  // Given any support view visit or change by BOOQ staff, when it happens, then it is logged in P6 and in the club's own staff audit log with the BOOQ staff name (PRD Support access; PLAT-04).
  test.todo('PLAT-02-AC6 Given any support view visit or change by BOOQ staff, when it happens, then it is logged in P6 and in the ...');
  // Given a Paused club, when BOOQ staff open the support view, then it behaves as a Live club (look only unless the window is on). Paused is not in the spec for this rule; see Q9.
  test.todo('PLAT-02-AC7 Given a Paused club, when BOOQ staff open the support view, then it behaves as a Live club (look only ...');
  // Given the Messaging API token or another secret, when it is shown in the support view, then it is masked to the last four characters (H-P2-Step4-LINE shows last 4). Whether staff can read or replace the full value is Q10.
  test.todo('PLAT-02-AC8 Given the Messaging API token or another secret, when it is shown in the support view, then it is masked ...');
  // Given a platform user without access to the club, when they open its support view, then the server refuses (assigned clubs only for the specialist, ROLE-AC5).
  test.todo('PLAT-02-AC9 Given a platform user without access to the club, when they open its support view, then the server refuses ...');
  // Given BOOQ staff in P1 or P3, when they look at a club, then they may see aggregate counts (for example bookings in the last 30 days, as P1 shows) and the owner's contact details (name, phone, LINE and email, as entered in P2 step 1). They never see an individual booking, player, payment, slip, receipt, wallet or report (D2).
  test.todo('PLAT-02-AC10 Given BOOQ staff in P1 or P3, when they look at a club, then they may see aggregate counts (for example ...');
  // Given an aggregate count, when it is produced, then it is computed on the server as a number only, with no list of rows behind it and no way to drill down (D2). Which counts exist is limited to those on P1 and P3 (Q-D).
  test.todo('PLAT-02-AC11 Given an aggregate count, when it is produced, then it is computed on the server as a number only, with no ...');
});

describe('PLAT-03', () => {
  // Given a Live club, when a platform admin pauses it with a reason, then the status is Paused, the reason is stored and the owner gets a LINE message with the reason (P3c "The club owner gets a LINE message with the reason").
  test.todo('PLAT-03-AC1 Given a Live club, when a platform admin pauses it with a reason, then the status is Paused, the reason is ...');
  // Given a pause request without a reason, when it is submitted, then it is refused (P3c "Reason, required").
  test.todo('PLAT-03-AC2 Given a pause request without a reason, when it is submitted, then it is refused (P3c "Reason, required").');
  // Given an onboarding specialist, when they try to pause or resume a club, then the server refuses. Only a platform admin pauses or resumes (D15).
  test.todo('PLAT-03-AC3 Given an onboarding specialist, when they try to pause or resume a club, then the server refuses. Only a ...');
  // Given a Paused club, when a player tries to start a new booking or purchase, then the server refuses, including a direct API call, and the app shows "Online booking is paused for now. Message the club on LINE for help." (P-0442 "Online booking is paused for now"; exact string by key).
  test.todo('PLAT-03-AC4 Given a Paused club, when a player tries to start a new booking or purchase, then the server refuses, ...');
  // Given a Paused club, when a player opens the app, then Book a court, Classes and Packages show as paused and upcoming bookings still show (PRD Pausing).
  test.todo('PLAT-03-AC5 Given a Paused club, when a player opens the app, then Book a court, Classes and Packages show as paused ...');
  // Given an existing booking, when the club is paused, then the booking stays valid and its LINE reminders still go out.
  test.todo('PLAT-03-AC6 Given an existing booking, when the club is paused, then the booking stays valid and its LINE reminders ...');
  // Given a package or wallet balance with an expiry date, when the club is resumed, then every expiry date moves forward by the length of the pause (start to end). The ledger records one movement per package with a reason, not a silent edit. Credits and wallet stay ledgers (PKG-01). Whether a wallet with no expiry is touched is Q11.
  test.todo('PLAT-03-AC7 Given a package or wallet balance with an expiry date, when the club is resumed, then every expiry date ...');
  // Given a Paused club, when the owner or staff open the club admin, then it works and every page shows a banner with the reason and a Message BOOQ button (H-A01 pause banner, S-A01-Paused).
  test.todo('PLAT-03-AC8 Given a Paused club, when the owner or staff open the club admin, then it works and every page shows a ...');
  // Given a payment already started before the pause, when it completes after the pause begins, then it is handled by the PAY-03 rules (F05), not refused. Stated here only so F05 and F01 agree; the spec does not say. See Q12.
  test.todo('PLAT-03-AC9 Given a payment already started before the pause, when it completes after the pause begins, then it is ...');
  // Given any pause or resume, then it is written to the P6 log and the club's audit log (PLAT-04).
  test.todo('PLAT-03-AC10 Given any pause or resume, then it is written to the P6 log and the club\'s audit log (PLAT-04).');
  // Given a Paused club, when a platform admin resumes it, then new booking and buying turn back on, the pause banner leaves the club admin, the owner gets a LINE message, and the pause length (start to resume) is used for the expiry shift in AC7 (D15).
  test.todo('PLAT-03-AC11 Given a Paused club, when a platform admin resumes it, then new booking and buying turn back on, the pause ...');
});

describe('PLAT-04', () => {
  // Given a change to a booking, a credit or wallet balance (any ledger movement made by staff), a price or a setting, when it is saved, then one audit entry is written in the same transaction, holding actor, time, record type and ID, old value, new value and reason.
  test.todo('PLAT-04-AC1 Given a change to a booking, a credit or wallet balance (any ledger movement made by staff), a price or a ...');
  // Given the change cannot write its audit entry, when the transaction runs, then the whole change is rolled back (no unaudited change).
  test.todo('PLAT-04-AC2 Given the change cannot write its audit entry, when the transaction runs, then the whole change is rolled ...');
  // Given a staff adjustment to credits or wallet, when it is submitted without a written reason, then it is refused (PRD Credits and wallet; PKG-01).
  test.todo('PLAT-04-AC3 Given a staff adjustment to credits or wallet, when it is submitted without a written reason, then it is ...');
  // Given a change made by BOOQ staff, when it is saved, then the entry names the BOOQ staff member and appears in P6 and in the club's own audit log (PRD Support access).
  test.todo('PLAT-04-AC4 Given a change made by BOOQ staff, when it is saved, then the entry names the BOOQ staff member and ...');
  // Given any platform action (create club, status change, support view visit, pause, test run, export, invite), when it happens, then a P6 entry is written with club, who and what.
  test.todo('PLAT-04-AC5 Given any platform action (create club, status change, support view visit, pause, test run, export, ...');
  // Given an audit entry, when anyone tries to edit or delete it, then the server refuses; entries are append only (H-P6-Team-audit "Nothing here can be edited or deleted"). The same holds for the club log.
  test.todo('PLAT-04-AC6 Given an audit entry, when anyone tries to edit or delete it, then the server refuses; entries are append ...');
  // Given an owner, when they open the audit log, then they can search and filter it by staff, record and date (PRD A17; screen is F11).
  test.todo('PLAT-04-AC7 Given an owner, when they open the audit log, then they can search and filter it by staff, record and date ...');
  // Given a front desk, accountant or coach, when they request the audit log, then the server refuses (A17 is owner only).
  test.todo('PLAT-04-AC8 Given a front desk, accountant or coach, when they request the audit log, then the server refuses (A17 is ...');
  // Given the Staff and audit log, when it lists an entry about a player, then it shows what the club needs to run the business; BOOQ staff cannot read it (PLAT-02-AC1).
  test.todo('PLAT-04-AC9 Given the Staff and audit log, when it lists an entry about a player, then it shows what the club needs to ...');
  // Given a PDPA copy or delete request, when it is made or handled, then it is logged in the club's audit log (G-C17-Privacy, "Every request is recorded in the audit log"; PDPA-01).
  test.todo('PLAT-04-AC10 Given a PDPA copy or delete request, when it is made or handled, then it is logged in the club\'s audit ...');
  // Given times in entries, when they are stored and shown, then they are Asia/Bangkok.
  test.todo('PLAT-04-AC11 Given times in entries, when they are stored and shown, then they are Asia/Bangkok.');
});

describe('PLAT-05', () => {
  // Given one codebase for every club, when a feature switch is set on one club, then it changes that club only (CC-1).
  test.todo('PLAT-05-AC1 Given one codebase for every club, when a feature switch is set on one club, then it changes that club ...');
  // Given a switch is off for a club, when any surface or API of that club asks for the feature, then the server refuses and the surface hides it. A hidden screen is not enough.
  test.todo('PLAT-05-AC2 Given a switch is off for a club, when any surface or API of that club asks for the feature, then the ...');
  // Given a switch, when it is changed, then it is written to the audit log (it is a setting; PLAT-04).
  test.todo('PLAT-05-AC3 Given a switch, when it is changed, then it is written to the audit log (it is a setting; PLAT-04).');
  // Given a club's payment option (Beam or slip checking), when it is read, then it behaves as a club level choice made in P2 step 5 (PAY-01), and slip checking and backup mode are features that exist only when slip checking is chosen (F16).
  test.todo('PLAT-05-AC4 Given a club\'s payment option (Beam or slip checking), when it is read, then it behaves as a club level ...');
  // Given Hunter, when it runs, then nothing is written only for Hunter. Tennis, two courts, ฿500 an hour and Beam are club settings or switches (HO Architecture).
  test.todo('PLAT-05-AC5 Given Hunter, when it runs, then nothing is written only for Hunter. Tennis, two courts, ฿500 an hour and ...');
  // Given the list of switches, when F01 ships, then it contains only switches the spec names. The list itself is Q5.
  test.todo('PLAT-05-AC6 Given the list of switches, when F01 ships, then it contains only switches the spec names. The list itself ...');
  // Given the Tennis template, when a new club starts from it, then products, prices and rules are copied to that club as its own values. Later changes to the template do not change existing clubs ("Changes only affect new clubs", H-P5).
  test.todo('PLAT-05-AC7 Given the Tennis template, when a new club starts from it, then products, prices and rules are copied to ...');
  // Given the Blank template, when a new club starts from it, then it has no products and every club rule is empty, including hold time, waitlist claim time, no offer cut off, rest cap and group player counts (D8, PRD P5). The owner adds everything in Pricing and Settings.
  test.todo('PLAT-05-AC8 Given the Blank template, when a new club starts from it, then it has no products and every club rule is ...');
  // Given a template, when a value is a TBD in the spec (add-on prices, Head Coach price, referral reward, friend discount, birthday discount, max future court hours, below minimum alert time, wallet balance expiry, coach pay), then it is copied as an empty setting. No value is invented (D8).
  test.todo('PLAT-05-AC9 Given a template, when a value is a TBD in the spec (add-on prices, Head Coach price, referral reward, ...');
  // Given sport labels, when a club uses a template, then labels follow the sport (court, table, lane) from the template (PRD Platform foundation, P5).
  test.todo('PLAT-05-AC10 Given sport labels, when a club uses a template, then labels follow the sport (court, table, lane) from ...');
  // Given Padel and Pickleball, when F01 ships, then they appear as templates marked "to build" and cannot be chosen until built (H-P5 text "To build before the first padel club"). Their content is out of scope.
  test.todo('PLAT-05-AC11 Given Padel and Pickleball, when F01 ships, then they appear as templates marked "to build" and cannot be ...');
  // Given a platform admin or specialist, when they pick a template in P2 or A0, then the chosen template is recorded on the club and the copy is written to the audit log.
  test.todo('PLAT-05-AC12 Given a platform admin or specialist, when they pick a template in P2 or A0, then the chosen template is ...');
  // Given the Tennis template, when it is loaded, then its prices equal the final offer in PRD Pricing and packages (court ฿500, 10 hour bundle ฿4,500 for 3 months, 20 hour bundle ฿8,000 for 5 months, solo and group single prices and 8 packs for Adult and Student), stored as integer satang. Values are copied from the spec; none are added.
  test.todo('PLAT-05-AC13 Given the Tennis template, when it is loaded, then its prices equal the final offer in PRD Pricing and ...');
  // Given the template actions on H-P5 ("New template", "Duplicate", "Edit") when F01 is built, then whether those actions exist is decided in Q5.
  test.todo('PLAT-05-AC14 Given the template actions on H-P5 ("New template", "Duplicate", "Edit") when F01 is built, then whether ...');
  // Given the Tennis template, when it is loaded, then it carries the PRD default rules: payment hold 15 minutes (the owner may pick 10, 15 or 20), waitlist claim time 30 minutes, no waitlist offers within 2 hours of start, coach rest cap 6 hours in a row, group classes 4 to 6 players (D8). Booking length is fixed at 60 minutes for every club and is not a template value.
  test.todo('PLAT-05-AC15 Given the Tennis template, when it is loaded, then it carries the PRD default rules: payment hold 15 ...');
});

describe('PLAT-06', () => {
  // Given an owner in A0 step 7, when they upload a CSV of players, packages or balances, then the server validates every row before saving and shows an error report listing each failing row with the reason. Nothing is saved until the whole file is valid and the owner confirms (D13).
  test.todo('PLAT-06-AC1 Given an owner in A0 step 7, when they upload a CSV of players, packages or balances, then the server ...');
  // Given an import with any invalid row, when the owner confirms or tries to, then nothing is saved. The import is all or nothing, the owner fixes the file and uploads again (D13).
  test.todo('PLAT-06-AC2 Given an import with any invalid row, when the owner confirms or tries to, then nothing is saved. The ...');
  // Given a balances file, when it is imported, then each balance becomes ledger movements with the reason `import` and the owner as actor, never a single editable number (PKG-01, D13). `import` is a new ledger reason beyond reserve, return, use, forfeit, expire, adjust; the PRD and hand-off data model need it added, PRD first.
  test.todo('PLAT-06-AC3 Given a balances file, when it is imported, then each balance becomes ledger movements with the reason ...');
  // Given a packages file, when it is imported, then each row creates a customer package with credits total, purchase date and expiry date, and ledger rows with reason `import` for credits already used. Whether the file's expiry date is kept or recomputed from purchase date plus validity (PKG-02) is Q15.
  test.todo('PLAT-06-AC4 Given a packages file, when it is imported, then each row creates a customer package with credits total, ...');
  // Given an import file, when a row has a club ID column or any other club's identifier, then it is ignored; the club ID is always the importing club (CC-1).
  test.todo('PLAT-06-AC5 Given an import file, when a row has a club ID column or any other club\'s identifier, then it is ignored; ...');
  // Given an import, when it completes, then one audit entry records who, when, file name, counts of rows read, saved and rejected, and each created balance is audited (PLAT-04).
  test.todo('PLAT-06-AC6 Given an import, when it completes, then one audit entry records who, when, file name, counts of rows ...');
  // Given an imported player, when that person first signs in with LINE, then they are matched to the imported record on phone number (D13) and then asked for consent as a new player (PDPA-01-AC2). A phone that matches two imported records, or none, is not matched automatically; what happens then is Q16. Duplicate phones at one club are flagged (D11).
  test.todo('PLAT-06-AC7 Given an imported player, when that person first signs in with LINE, then they are matched to the imported ...');
  // Given a front desk, accountant, coach or BOOQ staff, when they try to import, then the server refuses. Import is for the owner only (D13), including in Draft and Testing support view.
  test.todo('PLAT-06-AC8 Given a front desk, accountant, coach or BOOQ staff, when they try to import, then the server refuses. ...');
  // Given a CSV file, when it holds amounts, then amounts are read as THB and stored as integer satang, and dates are read as Asia/Bangkok and shown with the international year.
  test.todo('PLAT-06-AC9 Given a CSV file, when it holds amounts, then amounts are read as THB and stored as integer satang, and ...');
  // Given an uploaded file, when the import is finished or cancelled, then the raw file is not kept longer than the import needs (PDPA data minimisation; retention is Q13).
  test.todo('PLAT-06-AC10 Given an uploaded file, when the import is finished or cancelled, then the raw file is not kept longer ...');
  // Given a club, when "Export club data" is run, then the export holds only that club's records (CC-1).
  test.todo('PLAT-06-AC11 Given a club, when "Export club data" is run, then the export holds only that club\'s records (CC-1).');
  // Given BOOQ staff in P3, when they press Export club data, then the export starts, but BOOQ staff cannot open, download or read its content. The owner downloads the file (D14). Where the owner finds and downloads it (A16 or a link in LINE) is Q1.
  test.todo('PLAT-06-AC12 Given BOOQ staff in P3, when they press Export club data, then the export starts, but BOOQ staff cannot ...');
  // Given an owner or front desk in A5, when they press Export CSV, then they receive the customer list CSV for their club (PRD A5 shows CSV export for front desk and owner).
  test.todo('PLAT-06-AC13 Given an owner or front desk in A5, when they press Export CSV, then they receive the customer list CSV ...');
  // Given an accountant or owner in A13 and A14, when they export a report or receipts, then they receive CSV or PDF for their club (PRD Reports, Receipts). Built in F13 and F11. F01 owns only the rule that exports are club scoped and audited.
  test.todo('PLAT-06-AC14 Given an accountant or owner in A13 and A14, when they export a report or receipts, then they receive CSV ...');
  // Given any export of customers or club data, when it is made, then an audit entry records who, when, which export and how many rows (PLAT-04), because exports carry personal data.
  test.todo('PLAT-06-AC15 Given any export of customers or club data, when it is made, then an audit entry records who, when, which ...');
  // Given an export file, when it is produced, then slips and staff notes are included only in the full club export, and only if Q18 says so (PDPA-01: staff only).
  test.todo('PLAT-06-AC16 Given an export file, when it is produced, then slips and staff notes are included only in the full club ...');
  // Given any club, when F01 ships, then there is no delete club action in the platform console or anywhere else in v1 (D14). A club leaves by export and pause only.
  test.todo('PLAT-06-AC17 Given any club, when F01 ships, then there is no delete club action in the platform console or anywhere ...');
  // Given a CSV import, when it completes, then it has created players, customer packages and ledger movements only, and no bookings (D13).
  test.todo('PLAT-06-AC18 Given a CSV import, when it completes, then it has created players, customer packages and ledger movements ...');
});

describe('PLAT-07', () => {
  // Given a club in Testing, when a booking, order, payment, receipt, ledger movement or player record is made, then it is flagged as test data at creation, on the server, and the flag cannot be removed.
  test.todo('PLAT-07-AC1 Given a club in Testing, when a booking, order, payment, receipt, ledger movement or player record is ...');
  // Given a test receipt, when it is issued, then it uses its own number series that is clearly not a legal receipt (marked as a test on screen and in the PDF) and never uses the club's real sequence (HTC‑2027‑000001 and on). The series name and format are for design.
  test.todo('PLAT-07-AC2 Given a test receipt, when it is issued, then it uses its own number series that is clearly not a legal ...');
  // Given a club goes Live, when Go live is confirmed, then all test flagged data of that club is purged in one step, including test players, test ledgers and the test receipt series, and the real receipt sequence starts at 000001 (D4; RCPT-01 unbroken sequence stays true for real receipts).
  test.todo('PLAT-07-AC3 Given a club goes Live, when Go live is confirmed, then all test flagged data of that club is purged in ...');
  // Given the purge, when it runs, then it deletes only rows with the test flag and only for that club ID. If any row cannot be purged, Go live does not complete and the status stays Testing.
  test.todo('PLAT-07-AC4 Given the purge, when it runs, then it deletes only rows with the test flag and only for that club ID. If ...');
  // Given a club in Testing, when someone signs in to the player app, then only the club owner and named BOOQ testers can. The tester list is set in P4 or P3 by BOOQ staff and every change is written to P6 (D4). A BOOQ tester signs in to the player app with LINE as a test player, not with the BOOQ account (ROLE-02-AC2).
  test.todo('PLAT-07-AC5 Given a club in Testing, when someone signs in to the player app, then only the club owner and named BOOQ ...');
  // Given BOOQ staff in P4, when they look at test results, then they see pass or fail per check only (D4). They never see the test bookings, test players, test payments or test receipts themselves. The owner sees them in the club admin.
  test.todo('PLAT-07-AC6 Given BOOQ staff in P4, when they look at test results, then they see pass or fail per check only (D4). ...');
  // Given test data, when it is counted for aggregates in P1 (bookings in the last 30 days), then it is not counted (derived: a Testing club has no real bookings; the spec is silent, Q-E).
  test.todo('PLAT-07-AC7 Given test data, when it is counted for aggregates in P1 (bookings in the last 30 days), then it is not ...');
  // Given a test run, when it starts, finishes or is purged, then it is written to P6 (PLAT-04).
  test.todo('PLAT-07-AC8 Given a test run, when it starts, finishes or is purged, then it is written to P6 (PLAT-04).');
  // Given Beam in Testing, when a test payment is made, then it uses Beam's sandbox and never moves real money (F05 owns the integration; stated here so the test flag and the sandbox agree).
  test.todo('PLAT-07-AC9 Given Beam in Testing, when a test payment is made, then it uses Beam\'s sandbox and never moves real ...');
});

describe('PDPA-01', () => {
  // Given any processing of player data, when BOOQ staff act, then they act only on the club's setup, never on player, booking or payment data (PLAT-02-AC1). BOOQ is a processor for the club.
  test.todo('PDPA-01-AC1 Given any processing of player data, when BOOQ staff act, then they act only on the club\'s setup, never ...');
  // Given a new player's first sign in, when they continue, then consent to the terms and the privacy notice is required and recorded (F02 AUTH-02 builds the screen; F01 supplies the record). What the record holds is Q20.
  test.todo('PDPA-01-AC2 Given a new player\'s first sign in, when they continue, then consent to the terms and the privacy notice ...');
  // Given a signed in player, when they request a copy of their data in Profile, then the request is stored, the front desk sees it and the player gets the file in LINE (G-C17-Privacy). The file holds profile, bookings, credits and receipts. Whether staff notes are included is Q21.
  test.todo('PDPA-01-AC3 Given a signed in player, when they request a copy of their data in Profile, then the request is stored, ...');
  // Given a signed in player, when they request deletion, then the request is stored, the front desk sees it and the club confirms in LINE. On deletion the profile and history are deleted, unused credits and wallet balance are lost, and receipts stay on record for the club's accounts (G-C17-Privacy copy). Receipt and ledger rows are anonymised, not deleted, because receipt numbers are never reused and the ledger is the record of money. See Q22 for the legal basis and the time limit.
  test.todo('PDPA-01-AC4 Given a signed in player, when they request deletion, then the request is stored, the front desk sees it ...');
  // Given a player who asks for deletion and holds a future booking or credit, when the request is handled, then the staff see what will be lost before confirming. What happens to the booking is Q22.
  test.todo('PDPA-01-AC5 Given a player who asks for deletion and holds a future booking or credit, when the request is handled, ...');
  // Given slips and staff notes, when anyone other than staff of that club asks for them, then the server refuses. A player never sees staff notes; a coach never sees slips; BOOQ staff never see either.
  test.todo('PDPA-01-AC6 Given slips and staff notes, when anyone other than staff of that club asks for them, then the server ...');
  // Given a PDPA request, when it is made, handled or refused, then it is in the club's audit log (PLAT-04-AC10).
  test.todo('PDPA-01-AC7 Given a PDPA request, when it is made, handled or refused, then it is in the club\'s audit log (PLAT-04-AC10).');
  // Given all club data, when the nightly backup runs, then every club's data is backed up daily. How long backups are kept, and how a deleted player is removed from backups, are Q13.
  test.todo('PDPA-01-AC8 Given all club data, when the nightly backup runs, then every club\'s data is backed up daily. How long ...');
  // Given personal data in transit and at rest, when it is stored or sent, then it is encrypted (security basics; not stated in the spec, see Q23 before we promise a standard).
  test.todo('PDPA-01-AC9 Given personal data in transit and at rest, when it is stored or sent, then it is encrypted (security ...');
  // Given hosting, when data is stored, then it is stored in Supabase in the nearest region, Singapore, under a data processing agreement with the club as controller (D5). The cross border transfer needs a Thai lawyer's confirmation under PDPA before Go live; if refused, the fallback is to self host Postgres in Thailand (D5). This is an action for a person, see Actions for a person. Plan section 3 ("Thai-region hosting") is superseded by D5.
  test.todo('PDPA-01-AC10 Given hosting, when data is stored, then it is stored in Supabase in the nearest region, Singapore, under ...');
  // Given a player, when they open Privacy and my data, then they see the privacy notice, Request a copy and Request deletion, in the language they use (P-0413, P-0414, P-0419, P-0422).
  test.todo('PDPA-01-AC11 Given a player, when they open Privacy and my data, then they see the privacy notice, Request a copy and ...');
  // Given the privacy notice, when a player reads it, then it names the club as the controller and BOOQ as the processor. The notice's final text is due before 7 Dec 2026 (HO "Privacy consent, receipt and payment text must be final before testing").
  test.todo('PDPA-01-AC12 Given the privacy notice, when a player reads it, then it names the club as the controller and BOOQ as the ...');
});
