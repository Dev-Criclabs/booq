# F02 LINE Login, LIFF and first sign in · Requirements

Status: **Approved 30 Oct 2026** (gate 1; F02 requirements and the D38 revision are in the user's round 7 approval, `docs/decisions.md`), except the consent text for players under 18, which stays **pending legal** (D10, left open by the user). Revision 5 (30 Oct 2026) applies D38 and D100 to D123 where they touch F02 (Draft and Testing sign in, guest reads, imported player claim, the Player role for every club person) and the Reviewer's findings F02-3 and F02-4 (`docs/review/spec-consistency.md`). Changes after approval go PRD, then hand-off, then this file. No design or code follows until the design gate.

Revision history: v1 draft, v2 applied D1 to D15, v3 applies D18 to D31, v4 applies D38 (no checkbox on C1). D11 and D12 are now in HO AUTH-02, and LINE-07 (message cap) is in the hand-off (F10 owns it).

Feature: F02 LINE Login, LIFF and first sign in. Depends on: F01. Requirement IDs: AUTH-01, AUTH-02, LINE-01. Wave 1.

## Sources

| Short name | File | Sections used |
|---|---|---|
| PRD | `specs/product/prd-v1.2.md` | Change log (rows "Sign in" and "Date of birth", 30 Oct and Oct 2026); Club facts (Adult and Student); Platform and LINE; Customer app pages C1, C2, C3, C17; Quality and scope (PDPA); What changes in the club app |
| HO | `specs/product/handoff-v1.2.md` | Business rules as requirements (AUTH-01, AUTH-02, BOOK-02); LINE integration (LINE-01); Data model (User); Language, design system and open items; Text and language files |
| Plan | `docs/DEVELOPMENT-PLAN.md` | Section 4 |
| Gaps | `docs/canvas-gaps.md` | A9 (date of birth shown as locked), C1 (corrected date of birth and student packages), section C "Date of birth" |
| F01 | `specs/features/F01-platform-foundation/requirements.md` | Roles (ROLE-01 a person holds a set of roles), CC rules, PDPA-01, PLAT-07 test mode |
| Decisions | `docs/decisions.md` | D1, D4, D6, D7, D9, D10 (open), D11, D12, D27, D31; round 1 (Student package stays valid). PRD change log rows "Decisions 30 Oct (2)", "(3)", "(4)", PRD Credits and wallet, HO AUTH-02, PKG-02, LINE-07 |
| QA traceability | `docs/qa/traceability.md` (branch `qa/test-strategy`) | AUTH-02 thin, LINE-01 gap; proposed checks reused below |

The spec wins over the canvas. Where the canvas shows something the spec does not say, it is listed in Open questions, not built.

## Scope

In scope for F02:

- Guest browsing, and the moment sign in starts (AUTH-01).
- LINE Login through LIFF: silent inside LINE, one tap in a browser (LINE-01).
- The prompt to add the club's LINE Official Account as a friend (LINE-01).
- The first sign in profile: full name, phone, PDPA consent (AUTH-02).
- Date of birth: asked only for a student price, never locked, player editable in Profile (AUTH-02, PRD Club facts).
- The player record keyed by LINE user ID, per club (HO Data model: User).
- Language at sign in (starting language follows the LINE app, toggle in Profile).
- Profile: Personal details editing for the fields named above (C17).
- How the app finds the club (club in the URL on one shared domain, D6) and who can sign in to a Testing club (D4).

Out of scope (other features own them): the booking screens themselves and the slot hold (F03), checkout and pricing by price group (F04), the privacy request screens and their back office (F01 PDPA-01, F11), rich menu and messages (F10), staff and owner invite pages (F11, F15; see Q13).

## Canvas legend

H- hi-fi, G- gap states, S- states, T- Thai twin (every English board has a T- twin with the same name, per HO Screen inventory). F1-, F1b- flow copies are not listed again. Build from H-, G-, S-.

## Cross-cutting rules (apply to every requirement below)

**CC-1 Club ID scope.** Every record carries a club ID. The player record is unique on club ID plus LINE user ID. The club is known before sign in: one shared BOOQ domain with the club in the URL (D6). Each club has its own LINE provider (D7). A LINE user of one club is a different player in another club (PRD "A player who uses two clubs signs in to each club's LINE account separately and has separate credits").

**CC-2 Server side permissions.** Sign in is checked on the server. The client's claim of who it is, or which club, is never trusted. The server verifies the LINE token with LINE and checks it was issued for that club's LINE Login channel.

**CC-3 PDPA.** The club is the controller and BOOQ the processor (PDPA-01 in F01). F02 collects the first personal data. Each requirement says what is collected and why.

**CC-4 No double booking.** F02 creates no booking and no hold. Sign in must never create or extend a hold, and a guest can never hold a slot (BOOK-03 starts the hold when a signed in player taps Pay). Where F02 touches a slot (return to checkout after sign in), the slot is kept only as the player's choice, not as a reservation.

**CC-5 Language files (TEXT-01 to TEXT-06).** Every text comes from `locales/en.json` and `locales/th.json` by key. Keys follow the writers' prefixes. Sample values become named variables with the same names in both files (for example `{court}`, `{date}`, `{time}` in the C1 line "Court 2 · Sat 9 Jan · 18:00 to 19:00"). Existing wording is never edited. New text gets a new key in both files and is listed for the writers (list at the end). Player app screens ship in Thai and English. Layouts survive the longest string in either language; buttons never wrap (the C1 and C2 buttons, the Thai consent line), content areas scroll. Dates use the international year in both languages, including the date of birth.

**CC-6 Other platform rules.** All times Asia/Bangkok. Never invent a rule: where the spec is silent it is a question below.

Key lookup by screen waits for `locales/copy-index.csv`, generated from the canvas by the i18n role, read only (D31). Keys found in the locale files for these screens: P-0001 to P-0005 (C1), P-0009, P-0010 to P-0016 (C2), P-0250 Personal details, P-0261 and P-0405 Date of birth, P-0413 and P-0414 and P-0419 and P-0422 (Privacy and my data). These are confirmed by name, not yet by screen, because `copy-index.csv` is not in the repo.

---

## AUTH-01 Browse first, sign in at checkout

**Source.** HO AUTH-01 and BOOK-02. PRD Platform and LINE ("Browse first, sign in at checkout (v1.2)"), C1, C3 (S-C03-Guest), Change log row "Sign in" (30 Oct).

**Requirement.** Players browse without signing in. LINE Login runs only at checkout or purchase.

**Hand-off acceptance check, kept.** Given a guest on C4, when they tap Continue, then LINE Login starts and they return to C10 with the slot kept.

**Acceptance criteria.**

- AUTH-01-AC1. Given a guest (not signed in), when they open the court schedule (C4), solo classes (C5), coach profile (C6), group classes (C7), class detail (C8) or packages (C9), then the pages load and show the club's own data, with no sign in.
- AUTH-01-AC2. Given a guest on C4, when they pick an open slot and tap Continue, then LINE Login starts and, after it, they return to C10 with the same slot chosen (hand-off check).
- AUTH-01-AC3. Given a guest, when they tap Continue, then no hold exists yet. The slot is held only when the signed in player taps Pay (BOOK-03, F03). A guest request to hold a slot is refused by the server.
- AUTH-01-AC4. Given a guest returns to C10 after sign in, when the chosen slot has been taken or held by someone else meanwhile, then the booking is not created and the player is told and sent back to pick again (the same refusal as BOOK-04; the screen is in F03).
- AUTH-01-AC5. Given a guest who taps to buy a package (C9), when they continue, then LINE Login starts and they return to the package checkout (C10P) with the package kept.
- AUTH-01-AC6. Given a guest on any page, when they use Keep browsing on C1, then they go back to browsing and nothing is created (H-C01-Welcome).
- AUTH-01-AC7. Given a guest, when the court grid and the class schedule are shown, then they show held, taken and closed states without showing who holds or booked a slot. No player data reaches a guest.
- AUTH-01-AC8. Given a guest who opens the Home screen, when the page loads, then it shows the guest Home (Find a court time, no booking card, no credits) with a Sign in action (S-C03-Guest).
- AUTH-01-AC9. Given a guest who opens a page that needs a person (My bookings, Credits and wallet, Refer a friend, Profile), when it loads, then LINE Login starts first and the player lands back on that page. The spec lists only booking and buying as the sign in moment; this is the minimum for these pages to work. See Q4.
- AUTH-01-AC10. Given the rich menu tile Book a court, when a guest taps it, then C4 opens directly as a guest page with no sign in (BOOK-02; Home is skipped). A tile that opens a page needing a person (My bookings, Refer a friend) starts sign in first (AC9).
- AUTH-01-AC11. Given a club that is Paused, when a guest or player opens the app, then browsing and sign in still work and the paused pages are shown as paused (PLAT-03 in F01).
- AUTH-01-AC13. Given the app address, when it is opened, then the club comes from the URL on the one shared BOOQ domain (for example the club's name or ID in the path), in LINE and in a browser (D6). The domain itself is a configuration value and is not hard coded, because the user will supply it later (D6). An unknown or not live club in the URL answers 404 (not found), never another club's data (D27 uses the same 404 rule for records outside a caller's reach).
- AUTH-01-AC14. Given a deep link (rich menu tile, shared link, LINE message button), when it is opened, then it contains the club in the same way (D6), so the right club is chosen before any data is read or sign in starts. A link for club A never signs a player in to club B (CC-1).
- AUTH-01-AC15. Given a club in Draft or Testing, when someone opens its URL, then a caller who is not signed in gets only a minimal sign in config (name, language, status, LIFF id); the club admits the owner role and testers, the owner invite stays valid for return visits and testers get long lived invites (D102, F01 PLAT-01-AC11). A BOOQ tester signs in with LINE as a test player. Everyone else sees not found.
- AUTH-01-AC16. Given a guest, when any route answers, then it reads only named public columns or routes; owner contact details and merchant ids are never readable by a guest (D103, F01 PLAT-02-AC14).
- AUTH-01-AC12. Given a guest who cancels or fails LINE Login (they close the LINE consent screen, the network drops), when it ends, then they return to where they were with nothing created, and an offline error uses the existing key (P-0327 "Check your internet and try again. Nothing was booked or charged.", P-0328 "Try again"). Other failure text is a new key.

**Meets.**

- PDPA: a guest gives no personal data and the app stores none about them beyond what the server needs to show open slots. No tracking beyond that is added without a question to the club (cookies and analytics are not in the spec; Q14).
- No double booking: sign in never holds. The held state shown to a guest is read only. The slot chosen before sign in is a choice, so another player may take it (AC4).
- Club scope: public reads are scoped by the club the app opens for (D6); a guest of club A cannot read club B.
- TEXT: C1 keys P-0001 to P-0005 (Sign in to book, the club friend line, Log in with LINE, Keep browsing). "Sign in to book" line uses `{court}`, `{date}`, `{time}`. Guest Home keys from S-C03-Guest. Terms and privacy links on C1 (P-0009 "privacy notice").

**Canvas.** H-C01-Welcome (T-C01-Welcome), S-C03-Guest (T-S-C03-Guest), H-C04-Book-a-court, H-C09-Packages, H-C10-Checkout, S-Error-Offline (T-S-Error-Offline), L-Rich-menu. Flow copies F1-03-C01-Welcome and F2-01-C03-Home show the click path.

---

## LINE-01 Silent LIFF login, add the Official Account as a friend

**Source.** HO LINE-01. PRD Platform and LINE ("Inside LINE this is silent. In a browser the customer taps Log in with LINE once. Sign in prompts customers to add the OA as a friend"), C1.

**Requirement.** Inside LINE, LIFF login is silent. In a browser the player taps Log in with LINE once. Sign in prompts adding the OA as a friend.

**Hand-off acceptance check.** None given; written here.

**Acceptance criteria.**

- LINE-01-AC1. Given a player who opens the app inside LINE (LIFF), when sign in starts, then it finishes with no screen to tap and no extra login page. They land where they were going.
- LINE-01-AC2. Given a player in a browser (not inside LINE), when sign in starts, then C1 shows Log in with LINE; one tap opens LINE's own login and, after it, the player returns to where they were going (AUTH-01-AC2).
- LINE-01-AC3. Given a signed in player, when they come back later in the same LINE or browser session, then they are not asked to log in again while the LINE session stays valid. The session length is Q8.
- LINE-01-AC4. Given each club has its own LINE provider, with its own LIFF app, LINE Login channel and Official Account under it (D7, HO LINE integration), when a player signs in, then the server verifies the LINE token with LINE and accepts it only if it was issued for that club's Login channel. A token for club A is refused at club B (CC-2).
- LINE-01-AC5. Given the LINE user ID the server receives, when the player record is read or created, then the key is club ID plus LINE user ID and the ID is the same one the club's Official Account uses for push messages (same provider), so messages reach the person.
- LINE-01-AC6. Given C1, when the player taps Log in with LINE, then the LIFF add friend option is set to On (normal): LINE's own consent screen offers the choice to add the Official Account, and C1 shows only a plain note about booking updates, with no checkbox (D38, HO LINE-01). H-C01-Welcome and F1-03-C01-Welcome still show a checkbox; that is now a canvas bug.
- LINE-01-AC7. Given the player declines or ignores the friend choice on LINE's screen, when sign in finishes, then they can still book and pay. Missing the friend status must not block a booking.
- LINE-01-AC8. Given a player who is not a friend of the club's Official Account (or has blocked it), when they pay or a booking is confirmed, then checkout is not blocked. The confirmation shows in the app, and the app asks them to add the Official Account (D9). The LINE push message may not reach them; that is expected.
- LINE-01-AC9. Given a signed in player who is not a friend, when the app shows the confirmation (AC8), then it shows the add as friend ask there. Whether it asks again at later sign ins, and how often, is Q5.
- LINE-01-AC10. Given a staff, coach or owner, when they sign in with LINE, then the same LIFF login is used and the role (F01) decides the surface. A person with no role at the club lands in the player app (PRD "Everyone signs in with LINE, and the role decides which surfaces and data they see"). Invite links are Q13.
- LINE-01-AC11. Given the LINE Login or LIFF is unreachable, when sign in starts, then the player gets the offline error (P-0327) and nothing is created. Platform health alerts are LINE-06 (F10, F15).
- LINE-01-AC14. Given a club's LINE provider, when two clubs have the same person, then the person has a different LINE user ID at each club (one provider per club, D7), so the key club ID plus LINE user ID never matches across clubs and a player at two clubs has two accounts (PRD What changes in the club app).
- LINE-01-AC12. Given a LINE display name, when the player record is created, then the display name is stored as given by LINE and is not used as the full name unless the player confirms it (AUTH-02-AC2).
- LINE-01-AC13. Given an access token or ID token, when the server receives it, then it is not stored longer than needed for the sign in and is never written to the audit log or to any log.

**Meets.**

- PDPA: LINE gives the club the LINE user ID, display name and profile picture URL. The club needs only the user ID and display name for the record (data minimisation); the picture is not stored unless a screen needs it (C17 shows initials in the canvas, Q9). The LINE login screen itself shows LINE's consent for sharing the profile with the club. This is separate from the club's PDPA consent in AUTH-02.
- No double booking: sign in does not touch bookings. A sign in during a hold (the player was signed out mid payment) must not release or extend the hold; the hold follows the player ID (F03).
- Club scope: AC4 and AC5 are the club ID rules for LINE. A player at two clubs has two LINE user IDs and two records.
- TEXT: C1 button and checkbox keys P-0003 and P-0004. LINE's own screens are LINE's and are not in the locale files.

**Canvas.** H-C01-Welcome (T-C01-Welcome), F1-03-C01-Welcome, S-C03-Guest.
Note: H-C01-Welcome has a language toggle "ไทย | EN" (Gaps B7 says labels differ across screens). The spec has no rule on the toggle label; see Q10.

---

## AUTH-02 First sign in profile, PDPA consent and date of birth

**Source.** HO AUTH-02. PRD Platform and LINE (first sign in), Club facts (Adult and Student, correcting date of birth 30 Oct 2026), C2, C17, Change log rows "Sign in" and "Date of birth". Gaps A9 and section C.

**Requirement.** First sign in asks only full name, phone and PDPA consent. Date of birth only for a student price. Players can correct it later in Profile; it is never locked.

**Hand-off acceptance check, kept.** Given a new player, when they pick an Adult item, then no date of birth field shows.

**Acceptance criteria.**

First sign in (C2)

- AUTH-02-AC1. Given a LINE user with no player record at this club, when sign in finishes, then C2 shows once, asking only for full name, phone number and consent to the terms and privacy notice (PDPA). No other field is asked (no date of birth, no level, no email).
- AUTH-02-AC2. Given C2, when the player continues, then full name and phone must be filled and consent must be ticked, or the server refuses and the screen shows what is missing. The phone is typed and is not verified by a code in v1 (D11). Format rules for the name and phone are Q2.
- AUTH-02-AC28. Given a phone number that already belongs to another player at the same club, when the player saves it, then it is allowed and the duplicate is flagged on both records, visible to the owner and front desk, as a referral abuse check (D11, F14). Nothing is blocked at sign in.
- AUTH-02-AC3. Given consent is not ticked, when the player tries to continue, then no player record is created and no personal data beyond the LINE ID and name received from LINE is kept. The player can go back to browsing.
- AUTH-02-AC4. Given consent is given, when the player continues, then the player record is saved with full name, phone, language, role Player and the time of consent, and the player lands where they were going (checkout). What the consent record holds is F01 Q20.
- AUTH-02-AC5. Given a returning player (a record exists), when they sign in, then C2 does not show again.
- AUTH-02-AC6. Given C2 shows after a guest chose a slot or package, when the player completes it, then they continue to the payment step with that choice kept (canvas "Continue to payment", AUTH-01-AC2).
- AUTH-02-AC7. Given C2 shows a "Hi, {name}" greeting with the LINE name, when it loads, then the name comes from LINE. Whether the full name field is pre filled from LINE is Q3.
- AUTH-02-AC8. Given the consent text, when it is shown, then it links to the terms and the privacy notice, which name the club as the controller and BOOQ as the processor (PDPA-01-AC12). The consent text is final before 7 Dec 2026.
- AUTH-02-AC9. Given a player who may be under 18, when they give consent at C2, then the consent screen and text are **pending a legal check** (D10, left open by the user). F02 builds the screen as written in the canvas but the consent text cannot be final until the check, and no rule for guardian consent exists yet (Q1).
- AUTH-02-AC32. Given the consent pending legal (D10), when the screen ships for the 7 Dec test, then it is tracked with an owner as an open item and no test treats it as final (Reviewer F02-3).

Date of birth, only for a student price

- AUTH-02-AC10. Given a new player picks an Adult item (any item for the Adult audience, or the court at a price that does not depend on age), when they continue, then no date of birth field shows (hand-off check).
- AUTH-02-AC11. Given a player picks a Student item (a package, class, coach price or other item sold only at a Student price), when they continue and no date of birth is on file, then the date of birth field shows and is required for that item.
- AUTH-02-AC12. Given a date of birth that makes the player under 18 today, when it is saved, then the Student price is allowed. Given a date of birth that makes them 18 or older, then the Student item is refused and the player is told it is for under 18 (PRD "Student packages can only be bought by customers under 18").
- AUTH-02-AC13. Given a player who is a Student, when they turn 18, then their price group is Adult from the 18th birthday (PRD Club facts "switches to adult pricing on the 18th birthday"), worked out from the date of birth on file. The age check uses the Asia/Bangkok date.
- AUTH-02-AC14. Given a player with no date of birth on file, when a price depends on age (coach price on C10, a package or class), then they get Adult prices (D12). Adults may add a date of birth voluntarily (AC17, AC29).
- AUTH-02-AC15. Given a date of birth entered, when it is shown anywhere, then it is shown with the international year (14 March 1994, never a Thai year).
- AUTH-02-AC16. Given a date of birth entry, when it is a future date or makes the player older than a limit the spec does not define, then the server refuses it. The limits are Q7.
- AUTH-02-AC17. Given a player who never picks a Student item, when they use the app, then they are never required to give a date of birth. Adults may add it voluntarily in Profile (D12), which also lets the birthday discount work (F14).
- AUTH-02-AC29. Given an adult in Profile, when they add a date of birth voluntarily, then it is saved like any other (editable, never locked) and used for the birthday discount and the age check, with no effect on their Adult price (D12).
- AUTH-02-AC30. Given a person signs in whose typed phone matches an imported record, when they finish first sign in, then no link is made automatically: the front desk confirms the claim in A6; a sign in matching no record becomes a new player (D105, F01 PLAT-06-AC7).
- AUTH-02-AC31. Given every club person (owner, staff, coach), when they have a record, then they also hold the Player role, so editing their own profile and booking as a player are allowed for them (D115, ROLE-01-AC7).

Profile editing (C17), date of birth never locked

- AUTH-02-AC18. Given a signed in player in Profile, Personal details, when they open it, then the date of birth is shown as an editable field. It is never shown as locked and never says "ask the front desk" (Gaps A9: that canvas text is a canvas bug).
- AUTH-02-AC19. Given a player edits the date of birth in Profile, when they save it, then the server accepts it at any time, with no limit on the number of changes, and the new value applies to every price decision from that moment ("Student pricing follows the date of birth on file", Gaps section C).
- AUTH-02-AC20. Given a corrected date of birth that changes the player's price group (Student to Adult or the reverse), when it is saved, then bookings already confirmed and credits already bought keep what they were bought as. A Student package or credit already bought stays valid and usable after the player becomes an Adult or corrects their date of birth, and keeps its expiry date (PRD Credits and wallet, HO PKG-02, 30 Oct 2026). Only new purchases use the new price group.
- AUTH-02-AC21. Given a date of birth change (including adding or removing one), when it is saved, then an audit entry is written with the old and new value and who made it, and the owner can see it (D12, PLAT-04). The player does not see the audit log.
- AUTH-02-AC22. Given a player in Profile, when they edit personal details, then the fields the player may change are name, phone, date of birth, playing level and language. Whether name and phone are editable is Q3 (G-C17-Personal-details shows them as plain text).
- AUTH-02-AC23. Given a player in Profile, when they set their playing level (New to tennis, Beginner, Intermediate, Advanced on the canvas), then it saves; it is optional and never asked at sign in (PRD: "Playing level is optional and set later in Profile").
- AUTH-02-AC24. Given staff in A6 (customer profile), when they view a player's date of birth and its change history, then front desk and owner see the date and the owner sees the audit entries (D12; role table). Whether staff may also edit it is Q6.

Language

- AUTH-02-AC25. Given a first sign in inside LINE, when the player record is created, then the starting language is the LINE app language (Thai or English); in a browser it follows the browser. Any other language falls back to Q10.
- AUTH-02-AC26. Given a player in Profile, when they use the language toggle (TH, EN), then every screen, message and receipt uses it from then on and it is saved on the player record (PRD "toggle on Profile").
- AUTH-02-AC27. Given a guest, when they use the toggle on C1, then the choice applies for browsing and is saved to the player record at first sign in.

**Meets.**

- PDPA: AUTH-02 collects the minimum: full name, phone, consent. Date of birth is collected only when a student price needs it (minimisation) and is sensitive because it can identify a minor. Consent is recorded and refusing consent creates no record (AC3). A copy or deletion request is in Privacy and my data (PDPA-01, F01). Under 18 players raise a consent question (Q1).
- No double booking: not relevant to the fields. A date of birth change must not cancel or move an existing booking.
- Club scope: the player record is unique on club ID plus LINE user ID. A new club means a new C2 and a new consent, even for the same person.
- TEXT: C2 keys P-0010 to P-0016 (greeting `{name}`, Two details, Full name, Phone number, the consent line, the date of birth and level note, Continue to payment). P-0250 and P-0405 for Profile. Thai runs longer: the consent line and the note must wrap inside the card while the button stays one line. The date of birth field label is shared with A-0531 (reuse it, do not copy).

**Canvas.** H-C02-Profile-setup (T-C02-Profile-setup), F1-04-C02-Profile-setup, H-C17-Profile-receipts (T-C17-Profile-receipts), G-C17-Personal-details (T-G-C17-Personal-details; locked date of birth is the Gaps A9 bug), G-C17-Privacy, G-C03-New-player (T-G-C03-New-player).
Note: H-C02-Profile-setup says "Student prices ask for your date of birth. You can add your playing level later in Profile." This matches the rule above and has no field for the date of birth on C2.

---

## Player record (HO Data model: User, for the design step)

Club ID, LINE user ID, display name, full name, phone, date of birth (optional), language, level (optional), role, tags, staff notes. Consent time and notice version are not in the data model yet (F01 Q20). Staff notes and tags are staff only. The record is unique on club ID plus LINE user ID.

---

## New text keys needed (TEXT-04)

The content role will confirm against the locale files. Likely new keys, needing both languages, added with the same prefix and numbering and sent to the writers:

- P: LINE Login cancelled or failed (other than offline), consent required inline message, full name and phone missing or invalid, date of birth field label and helper on the student step, "Student prices are for players under 18", date of birth in the future, "sign in to see this page" when a guest opens a page that needs a person, the in app ask to add the Official Account on the confirmation for a non friend (D9, LINE-01-AC8), friend ask shown again (if Q5 says so), duplicate phone flag label for staff (AUTH-02-AC28).
- A: staff view of a changed date of birth in the audit log line (named variables).

No key is added by this draft.

---

## Actions for a person (not questions)

- **D10 consent for players under 18: pending legal.** Left open on purpose. A Thai lawyer must say whether a guardian's consent is needed for minors, and how, before the consent text and the privacy notice are final. The text must be final before 7 Dec 2026 (HO Text and language files). AUTH-02-AC9 stays marked pending.
- **D6 domain.** The user will supply the shared BOOQ domain later. Built as a configuration value.
- **Club LINE message cap.** Decided as LINE-07 (F10). For F02 it matters only in that a non friend or capped club still gets the in app confirmation (LINE-01-AC8).

## Open questions

Answered questions are removed (D4, D6, D9, D11, D12 and the Student package decision answered the old Q5 in part, Q6(a)(b)(c), Q7 in part, Q11, Q12, Q16, and part of Q2 and Q13). Numbers are kept so earlier references hold.

**Blocking approval of F02**

1. **Players under 18 and PDPA consent (D10, open).** Does the club need a guardian's consent for minors, and how should it work in v1? Family or guardian accounts are not in v1. Needs a Thai legal check; see Actions for a person.
2. **Name and phone format.** What are the rules for the full name (Thai and English letters, length) and the phone (Thai mobile format)? (Phone is typed, not verified, and duplicates are flagged: D11.)
3. **Which profile fields the player can change.** The spec says the date of birth is correctable. G-C17-Personal-details shows name and phone as plain text with a Save button. Can the player edit name and phone? Should C2 pre fill the full name from LINE's display name (the canvas shows "Ploy Srisuk" with a LINE name "ploy.s")?
4. **Which pages start sign in.** The spec says sign in runs when the player books or buys. My bookings, Credits and wallet, Refer a friend and Profile need a person. Confirm those pages start sign in on open (AUTH-01-AC9), and confirm that inside LINE the player is treated as a guest on browse pages even though LINE could identify them silently (S-C03-Guest shows a Sign in button inside the app).
5. **How often to ask a non friend to add the account (D9).** D9 says do not block checkout, show the confirmation in the app and ask them to add the account. Does the ask repeat at later sign ins or visits, and how often?

**Needed before design**

6. **Staff and the date of birth.** May front desk or owner edit a player's date of birth in A6, or only view it and its history (D12 makes changes audited and visible to the owner)?
7. **Date of birth limits.** No future date; what is the oldest age allowed? (The Adult price for a player with no date of birth is settled: D12.)
8. **Session length.** How long does a sign in last (LINE session, our own session, re check at checkout)? Should payment steps always re verify?
9. **LINE profile picture.** Do we store the LINE picture URL for the player record, or show initials only (H-C17 shows initials "PS")? Storing it adds personal data and is not in the data model.
10. **Language rules.** The browser language rule and the fallback when the language is neither Thai nor English are not in the spec. The toggle label differs between boards (Gaps B7 "TH | EN" and "ไทย | EN"). Which label do we build?
13. **Invites.** Staff and coaches sign in "from an invite link", and the owner is invited by LINE link in P3. Which feature owns redeeming an invite (F11 A17, F15 P3)? What happens to a deactivated staff member who signs in? (A person holding several roles is settled: D1.)
14. **Cookies and analytics.** The spec says nothing about cookies, analytics or tracking for guests. Do we add none (assumed)?
15. **Deleted players.** After a deletion request is carried out, the same LINE user signs in again: is it a brand new player with a new consent and no history (assumed)? How does that sit with a club that must keep receipts (F01 Q22)?
17. **Pre filled slot after sign in.** When the guest chose several hours (multi hour select) before sign in, are all kept? Confirm the choice is kept only in the app and rechecked on return (AUTH-01-AC4).

## Proposed acceptance checks for the hand-off (QA gap list)

QA found LINE-01 has no acceptance check and AUTH-02's check is thin (`docs/qa/traceability.md`). These are proposals for a person to add to the hand-off, PRD first. No rule is added; the full criteria are above.

| ID | Proposed acceptance check | Full criteria |
|---|---|---|
| LINE-01 | Given the app opened inside LINE, when sign in starts, then it finishes with no tap; given a browser, then Log in with LINE shows once and sign in returns the player to where they were; given sign in, then LINE's own screen offers adding the Official Account (no checkbox on C1) and a refusal does not block booking | LINE-01-AC1, AC2, AC6, AC7 |
| AUTH-02 (adds) | Given a player picks a Student item with no date of birth on file, then the date of birth field shows and a date making them 18 or older refuses the item; given a signed in player in Profile, then the date of birth can be edited any number of times and each change is audited and visible to the owner | AUTH-02-AC11, AC12, AC19, AC21 |
| AUTH-02 (adds) | Given a player with no date of birth on file, when a price depends on age, then Adult prices apply; given a phone already used at the club, then the duplicate is flagged and nothing is blocked | AUTH-02-AC14, AC28 |
| AUTH-01 (adds) | Given a guest on any browse page, then it loads without a session and write routes answer 401; given a guest request to hold a slot, then it is refused | AUTH-01-AC1, AC3 |
