# F06 Packages, credit and wallet ledgers · Requirements

Status: **Approved 30 Oct 2026** (gate 1). Recorded in `docs/decisions.md`, round 9: the drafter's F06 and F10 requirements and the answers D83 to D99 were approved by the user. Revision 2 applies D83 to D90 and the hand-off and PRD rows on `main`. Changes after approval go PRD, then hand-off, then this file. No design or code follows until the design gate.

Feature: F06 Packages, credit and wallet ledgers. Depends on: F04. Requirement IDs: PKG-01, PKG-02, PKG-03. Also covers the rules the hand-off has no ID for (labelled R1 to R6, local to this file). Wave 3.

## Sources

| Short name | File | Sections used |
|---|---|---|
| PRD | `specs/product/prd-v1.2.md` | Pricing and packages; Payments, cancellation, credits and wallet (Booking and cancellation policy, Credits and wallet, Checkout and payment); Customer app pages C9, C10P, C11P, C12P, C14; Promotions (referral and birthday rewards go to the wallet); Pausing a live club; Data model (Package product, Customer package, Credit ledger, Wallet ledger) |
| HO | `specs/product/handoff-v1.2.md` | Business rules as requirements (PKG-01 to PKG-03, CANCEL-01, CANCEL-02, COACH-03, COACH-04); Payments (PAY-03, PAY-04, PAY-05); Data model (Package product, Customer package, Credit ledger, Wallet ledger) |
| Decisions | `docs/decisions.md` | D20, D21, D22, D28, D33, D34, D37, D40, D64, D74, D78, D79, D83 to D90; round 1 (Student package stays valid) |
| Gaps | `docs/canvas-gaps.md` | B5 (wrong expiry sample), C1, C2 |
| QA | `docs/qa/traceability.md`, `open-questions.md` (branch `qa/test-strategy`) | PKG rows; Q-11, Q-12, Q-13, Q-15 |
| Other features | F01, F03, F04, F05, F09, F10, F14 | Pause, hold, order and allocation, payments, cancel, messages, rewards |

The spec wins over the canvas. Boards named are the ones in the canvas file list on 30 Oct 2026; every board has a T- Thai twin.

## Scope

In scope: the package products a club sells and the packages a player owns; the credit ledger and the wallet ledger (append only); how credits are reserved, returned, used, forfeited and expire; expiry dates; extension by the owner and by a pause; wallet reasons; the balance as the sum of the ledger; buying a package (alone or with a booking); the C9, C14 and C12P player screens and the staff adjust action.

Out of scope: the order price and the order of use (F04), the QR payment (F05), cancel and closure decisions (F09, F06 supplies the ledger moves they call), the expiry and birthday messages (F10, F14 values), referral reward rules (F14), receipts (F13), the A6 and A9 screens (F11).

## Canvas legend

H- hi-fi, G- gap states, S- states, T- Thai twin, F1-, F2- flow copies (not repeated). Boards: H-C09-Packages, H-C09b-Packages-solo, H-C09c-Packages-group, H-C10P-Package-checkout, H-C10P-Bundle-plus-booking, H-C10P-Pack-plus-class, H-C11P-Pay-package, G-C11P-Beam-package, H-C12P-Hours-added, H-C12P-Seat-plus-pack, H-C14-Credits-wallet, H-C08b-Class-pack-choice, G-A02c-Sell-package, H-A06-Customer-profile, H-A09-Pricing, F2-02-C09-Packages, F2-03-C10P-Package-checkout, F2-05-C12P-Hours-added.

## Cross-cutting rules (apply to every requirement below)

**CC-1 Club ID scope.** Every product, package, credit row and wallet row carries a club ID and every query filters by it. A player at two clubs has two wallets and separate credits (PRD What changes in the club app). A request for another club's record answers 404 (D27).

**CC-2 Server side.** The server decides every movement. The client never sends a balance. Staff adjustments need a role (Front desk and Owner), a written reason and an audit entry.

**CC-3 PDPA.** Ledger rows are the player's financial records, club staff by role; BOOQ staff never see them (PLAT-02). The Accountant sees names but not phone numbers or dates of birth (D35). On a deletion request ledger rows are kept for the club's accounts and the player is anonymised (PDPA-01-AC4, F01 Q22). Personal data is encrypted in transit and at rest (D34). Test records are flagged and excluded from reports (D33).

**CC-4 No double booking.** A credit reserves nothing on the schedule; the booking does (F03). A credit is reserved in the same transaction as the booking, so two parallel bookings that need the last credit give exactly one success and one refusal, never a negative balance and never a booking with no credit paid. Credit reserved for a booking that is released or cancelled returns to the package.

**CC-5 Language files (TEXT-01 to TEXT-06).** All text from `locales/*` by key, Thai and English. Sample values become named variables with the same names in both files: `{credits}`, `{hours}`, `{sessions}`, `{date}` (expiry), `{amount}`, `{days}`. Validity, expiry reminder days and the cancel window are variables, never typed. Existing wording is not edited; new text gets new keys in both files, proposed by the drafter, owned by the writers (D51). Dates use the international year in both languages. Layouts survive the longest string; buttons never wrap; the history list scrolls.

**CC-6 Other platform rules.** All times Asia/Bangkok. Money is integer satang; credits are whole numbers. Value never goes back as cash: it returns as wallet or package credit (CANCEL-02, PAY-05). Never invent a price or setting: wallet balance expiry is an empty setting.

---

## PKG-01 Credits and wallet are ledgers

**Source.** HO PKG-01. PRD Credits and wallet; Data model (Credit ledger, Wallet ledger); D28, D78.

**Requirement.** Credits and wallet are ledgers. Every movement has a reason and, for staff, a written note.

**Hand-off acceptance check, kept.** Balance always equals the sum of its ledger rows.

**Acceptance criteria.**

- PKG-01-AC1. Given any credit or wallet balance, when it is read, then it equals the sum of its ledger rows. No column holds an editable balance; the balance is derived (property test after any random sequence of operations).
- PKG-01-AC2. Given the credit ledger, when a row is written, then its reason is one of reserve, return, use, forfeit, expire, adjust, import (HO Data model) and it names the package, the change, the booking where there is one, and the staff member where there is one.
- PKG-01-AC3. Given the wallet ledger, when a row is written, then its reason is one of refund, late_payment, wrong_amount, duplicate_payment, referral_reward, spend, return, adjust, import, and expire only if the club has set a wallet balance expiry (D78). It names the booking or referral where there is one and the staff member where there is one.
- PKG-01-AC4. Given a staff adjustment to credits or wallet, when it is saved without a written reason, then it is refused; with a reason, a row with the reason `adjust` and the note is written and audited (PRD, PLAT-04).
- PKG-01-AC5. Given a ledger row, when anyone tries to change or delete it, then the server refuses and the database rejects it. Both ledgers are append only; a correction is a new row (D28).
- PKG-01-AC6. Given any movement, when it is saved, then the ledger row and the booking, order or request that caused it are saved in one transaction, or neither is.
- PKG-01-AC7. Given a movement would make a balance negative (spending more than the balance, using a credit that is not there, a staff `adjust`), when it is requested, then the server refuses. A staff adjustment can never take a balance below zero (D83).
- PKG-01-AC8. Given two requests that spend the last credit or the last wallet satang in parallel, when they run, then exactly one succeeds (CC-4; QA concurrency tests).
- PKG-01-AC9. Given the wallet, when a customer asks to withdraw it, then no such route exists; the wallet cannot be withdrawn (PRD, CANCEL-02).
- PKG-01-AC10. Given the history on C14, when the player opens it, then they see every movement of every credit and wallet, with its reason in their language, newest first (PRD Credits and wallet).
- PKG-01-AC11. Given a movement made in Testing, when it is saved, then it is flagged test and excluded from reports (PLAT-07, D33).
- PKG-01-AC12. Given a late payment, a wrong amount, a duplicate payment or a refund of value to the wallet, when F05 or F09 credits the wallet, then F06 writes the row with the matching reason from AC3 and the amount in satang.

**Meets.**

- PDPA: ledgers are financial records kept after a deletion request (anonymised, PDPA-01-AC4).
- No double booking: AC8 and CC-4; credit use and booking are one transaction.
- Club scope: ledgers are per club and per player.
- TEXT: reason labels on C14 are P keys, Thai and English, one per reason in AC2 and AC3.

**Canvas.** H-C14-Credits-wallet (T-), H-A06-Customer-profile (adjust, T-).

---

## PKG-02 Package products, prices, validity and expiry

**Source.** HO PKG-02. PRD Pricing and packages (final offer); D20, D74; PRD Credits and wallet (Student package stays valid); QA Q-11; Gaps B5.

**Requirement.** Bundles: 10 hours ฿4,500 for 3 months, 20 hours ฿8,000 for 5 months. Class packs are 8 sessions for 3 months. Expiry date is the purchase date plus validity (calendar months). A Student package stays valid after the holder becomes an Adult.

**Hand-off acceptance check, kept.** Expiry date = purchase date plus validity. A Student package stays valid after the holder becomes an Adult.

**Acceptance criteria.**

- PKG-02-AC1. Given a club's package products (Hunter from the Tennis template: 10 hour bundle ฿4,500 3 months, 20 hour bundle ฿8,000 5 months, solo class pack of 8 for Adult ฿5,600 and Student ฿4,800, group pack of 8 for Adult ฿4,000 and Student ฿3,200, each 3 months), when they are loaded, then the prices are stored in satang (450000, 800000, and so on) and each is a product row with credit type, credits, validity in months, price group, tier and price. The values are copied from the template, not typed in code.
- PKG-02-AC2. Given a purchase, when the package is created, then its expiry is calendar months from the purchase date, ending 23:59 Asia/Bangkok on that day; if that day does not exist in the month, the last day of the month (D20). 30 Nov plus 3 months is 28 Feb (or 29 in a leap year). The purchase date is the Bangkok date of the payment confirmation.
- PKG-02-AC3. Given a bundle bought on 5 Jan 2027, when it is created, then it expires 5 Apr 2027 at 23:59 (the canvas sample "9 Apr" is wrong, Gaps B5).
- PKG-02-AC4. Given a package product, when the owner changes its price or validity, then it applies to new purchases only and the change is audited (PLAT-04).
- PKG-02-AC5. Given a Student package bought by a player under 18, when the player turns 18 or corrects their date of birth to an adult age, then the package stays valid, keeps its expiry date and its remaining credits stay usable, for the Student items they were bought for, until expiry (PRD Credits and wallet, HO PKG-02, D84). A new Student package cannot be bought (PKG-02-AC6). The class list for a player who is now Adult is F08 Q2.
- PKG-02-AC6. Given a Student package product, when a player 18 or older tries to buy it, then the server refuses (F04 R1-AC6).
- PKG-02-AC7. Given a package product with no price set, when C9 loads, then it is not offered (an empty setting is not free).
- PKG-02-AC8. Given a product the owner marks inactive, when C9 loads, then it is not offered; packages already owned keep working.
- PKG-02-AC9. Given the validity and expiry shown on C9, C10P and C12P, when they are shown, then they come from the product and the computed expiry date, with the international year in both languages.
- PKG-02-AC10. Given a court bundle, when it is used, then its hours work at any available booking time on either court (PRD Pricing and packages), and a solo pack credit works with any coach in its tier (PRD Solo classes).

**Meets.**

- PDPA: the date of birth only decides whether a Student package may be bought; it is not shown on the package.
- No double booking: buying a package reserves nothing on the schedule (a package bought with a booking has the booking's hold, F03).
- Club scope: products and packages are per club.
- TEXT: package names are Thai and English fields; per hour savings and validity text use variables.

**Canvas.** H-C09-Packages (T-), H-C09b-Packages-solo, H-C09c-Packages-group, H-C10P-* boards, H-C12P-Hours-added, H-A09-Pricing.

---

## PKG-03 Expiry reminders, expiry and extension

**Source.** HO PKG-03. PRD Credits and wallet ("Expired credits are lost. LINE reminders go 14 and 3 days before expiry. The owner can extend a package only with a written reason"); D20, D29; PLAT-03.

**Requirement.** Expiry reminders 14 and 3 days before. Expired credits are lost unless the owner extends with a reason.

**Acceptance criteria.**

- PKG-03-AC1. Given a package with credits left, when it is 14 days and again 3 days before its expiry date, then the player gets the Package expiring LINE message once each, in their language (F10; sent even at 80 percent of the cap, D29).
- PKG-03-AC2. Given a package with no credits left, when its reminder dates arrive, then no reminder is sent.
- PKG-03-AC3. Given a package reaches its expiry (23:59 Bangkok on the expiry date), when the expiry job runs, then one `expire` ledger row removes the credits that are left and the package shows Expired; credits are lost (PRD).
- PKG-03-AC4. Given an `expire` row, when it is written, then it is a new ledger row, not an edit of earlier rows (D28).
- PKG-03-AC5. Given an owner extends a package, when they save it, then a written reason is required, the new expiry date (still ending 23:59 Bangkok) is stored, an `adjust` row or extension record with the reason is written, and the change is audited (PRD, PLAT-04). Front desk cannot extend. The owner extends one package at a time; there is no bulk extension in v1 (D88).
- PKG-03-AC6. Given an extension, when the reminder dates of the new expiry arrive, then reminders follow the new date; earlier reminders already sent are not repeated.
- PKG-03-AC7. Given a club is resumed after a pause, when the pause ends, then every package expiry date moves forward by the exact length of the pause, and the expiry then runs to 23:59 Asia/Bangkok on the resulting day, including for a pause shorter than a day (PLAT-03, D20, D90). Each move is one ledger or extension record with the reason "pause".
- PKG-03-AC8. Given credit reserved for a future booking before the package reaches its expiry date, when the date arrives, then the credit stays valid for that session (D85) and is used when the session starts.
- PKG-03-AC9. Given a booking made with a credit reserved before expiry, when it is cancelled after the package expiry date, then the credit is lost and not returned (D85). A new booking can never reserve a credit of an expired package.
- PKG-03-AC10. Given a wallet balance expiry, when the club has set one, then `expire` rows apply to wallet balances at that date; when the setting is empty, wallet balances never expire, and staff are warned when the setting is first set that existing balances will start to expire (D89, D78).

**Meets.**

- PDPA: reminders are sent only to the owner of the package.
- No double booking: expiry never touches a booking; it removes only unused credit.
- Club scope: the job runs per club and reads that club's expiry and pause dates.
- TEXT: reminder text with `{days}` and `{date}` (L keys, F10).

**Canvas.** H-C14-Credits-wallet (expiry shown per package), H-A06-Customer-profile, L-Msg-* (the Package expiring card goes with the F10 boards, D86).

---

## R1 Reserve, use, return and forfeit of credit

**Source.** PRD Credits and wallet ("A credit is reserved at booking, returned on a cancellation 12 hours or more ahead, used once the session starts, and forfeited on a late cancellation or no show"); D21, D22, D40; HO CANCEL-01, COACH-03, COACH-04.

**Requirement.** Credit moves through reserve, return, use and forfeit. F09 decides when; F06 writes the rows.

**Acceptance criteria.**

- R1-AC1. Given a booking that uses a package credit, when it is submitted, then a `reserve` row is written for the credit type that fits (court hour, solo class by tier and customer type, group session by customer type) in the same transaction as the booking (F04 R4-AC7).
- R1-AC2. Given a reserved credit and a booking cancelled 12 hours or more before start, when F09 cancels it, then a `return` row puts the credit back to its own package (D21).
- R1-AC3. Given a reserved credit and a session that starts, when the session slot starts, then a `use` row is written (once the session starts).
- R1-AC4. Given a late cancel (under the cancel window) or a no show, when F09 or staff mark it, then a `forfeit` row is written and the credit is not returned (CANCEL-01, CANCEL-04).
- R1-AC5. Given staff reverse a no show or late cancel, when they do it, then the credit comes back by a new row, not by editing the old one; what it does for coach pay is F09 and QA Q-14 (not decided here).
- R1-AC6. Given a mixed payment (credit, wallet and money) cancelled 12 hours or more ahead, when F09 returns value, then package credit returns to the package, money paid (Beam or cash) goes to the wallet with the reason `refund`, wallet use returns to the wallet with the reason `return`, add-ons return with the booking, and a used promo code or birthday entitlement is restored (D21, D78).
- R1-AC7. Given a club closure (F09), when it cancels a booking, then the full value returns whatever the time (PRD) as the same moves.
- R1-AC8. Given a booking made partly by credit and the hold ends without payment, when the hold is released, then the reserved credit returns to the package and any wallet spend returns to the wallet by new rows (F04 R7-AC6).
- R1-AC9. Given a solo pack credit and a coach added at court checkout, when the order is priced, then no `reserve` row is written on the solo package (COACH-03, F04 R2-AC4).
- R1-AC10. Given a solo class booked through Classes with a solo pack credit, when it is confirmed, then the credit covers the coaching line only and the court is paid by a bundle hour, wallet or money (COACH-04).

**Meets.** PDPA: not beyond CC-3. No double booking: the reserve is inside the booking transaction (CC-4). Club scope: per club package. TEXT: cancel sheet outcome text is F09's keys; reason labels are PKG-01's.

**Canvas.** H-C13b-Cancel-sheet, H-C14-Credits-wallet, G-C10b-Solo-with-credit.

---

## R2 Wallet funding and use

**Source.** PRD Credits and wallet ("The wallet is a THB balance funded by cancellations and referral rewards. It is spent after package credits and before any money at checkout, and can't be withdrawn"); D22, D37, D78, D79.

**Requirement.** The wallet is a THB balance. It is funded by returned value, late and wrong amount payments, duplicate payments, referral rewards and staff adjustments or imports. It is spent after package credit and before money.

**Acceptance criteria.**

- R2-AC1. Given a checkout, when the wallet has a balance, then it is applied after package credit and before money, for the amount left only (D22, F04 R4-AC1).
- R2-AC2. Given the wallet balance on C14 and the checkout, when it is shown, then it is shown in baht (whole when whole, else two decimals, D69).
- R2-AC3. Given a referral reward (F14), when it is due, then a `referral_reward` row is written for the amount the owner set; if the amount is empty, nothing is written.
- R2-AC4. Given value returned to the wallet for a late payment, wrong amount or duplicate payment, when it is written, then the row carries the matching reason and the money received is the amount (D78), and a late payment or wrong amount credit gets its own receipt (D37, D79).
- R2-AC5. Given a wallet spend, when it is saved, then a `spend` row is written in the same transaction as the order.
- R2-AC6. Given an `import` row from a CSV import, when it is written, then it uses the reason `import` with the owner as actor (F01 PLAT-06-AC3).
- R2-AC7. Given the wallet, when a staff member credits or debits it, then the reason `adjust`, a written reason and an audit entry are required (PKG-01-AC4).
- R2-AC8. Given "value owed to customers" in reports, when it is computed, then it is unused package credit plus wallet balances, shown separately (D57, F11 ADMIN-14).

**Meets.** PDPA: wallet is the player's own record. No double booking: not relevant. Club scope: one wallet per player per club. TEXT: C14 and checkout wallet lines from P keys with `{amount}`.

**Canvas.** H-C14-Credits-wallet (T-), H-C10-Checkout, G-C10-Credit-covered.

---

## R3 Buying a package

**Source.** PRD C9, C10P, C11P, C12P, Key flows H and I; PAY-04, D74; F04 R6.

**Requirement.** A package is bought alone (nothing held, own QR time) or together with a booking (one bill, with the booking's hold). A bought package's credits can be used at once, including for the booking that came with it.

**Acceptance criteria.**

- R3-AC1. Given a player buys a package alone, when they pay, then the package is created only after the Beam callback is verified (F05 PAY-04); nothing is created if the QR time ends unpaid.
- R3-AC2. Given a player buys a bundle with a booking (Flow H), when they pay, then it is one order and one bill; the bundle is created and one hour is used now with a `reserve` row for the booking, in the same transaction.
- R3-AC3. Given a player buys a group pack from the class screen (Flow I), when they pay, then the pack is created and one session is used now, leaving the rest.
- R3-AC4. Given a purchase is confirmed, when it is saved, then the package gets its expiry (PKG-02-AC2), a receipt is issued (F13) and the C12P confirmation shows the credits added, the expiry date and Book now.
- R3-AC5. Given a purchase by staff at the desk (G-A02c), when they take cash, then it follows PAY-06 and creates the package the same way.
- R3-AC6. Given a package order for a Paused club, when a player tries to buy, then the server refuses (F01 PLAT-03).
- R3-AC7. Given a package bought together with a booking whose payment arrives late so the booking cannot be confirmed, when it is handled, then all of it goes to the wallet, with nothing partly created (D87, PAY-03).
- R3-AC8. Given the owner sells a package, when it is a Student product, then the buyer must be under 18 (PKG-02-AC6).

**Meets.** PDPA: not beyond CC-3. No double booking: a package alone cannot double book; a package with a booking uses the booking's hold and uniqueness. Club scope: per club. TEXT: C9, C10P, C12P text from P keys with `{credits}`, `{hours}`, `{sessions}`, `{date}`, `{amount}`.

**Canvas.** H-C09-Packages, H-C10P-*, H-C11P-Pay-package, G-C11P-Beam-package, H-C12P-*, H-C08b-Class-pack-choice, G-A02c-Sell-package, F2-02-C09-Packages to F2-05-C12P-Hours-added.

---

## Data covered by F06 (HO Data model, for the design step)

Package product (club, name Thai and English, credit type, credits, validity in months, price group, tier, price in satang, active), Customer package (customer, product, credits total, purchased at, expires at, extension reason), Credit ledger (package, change, reason, booking, staff), Wallet ledger (customer, change in satang, reason, booking or referral, staff). Balances are derived; the extension and pause moves are records with reasons.

## Proposed new text keys (D51)

Proposed by the drafter; writers own the wording; numbers from the i18n role after `copy-index.csv` exists (D31). Existing keys first.

- P: one label per ledger reason on C14 (reserve, return, use, forfeit, expire, adjust, import, refund, late payment, wrong amount, duplicate payment, referral reward, spend), package expired, extended, not offered.
- A: extension reason field and label, adjust reason (reuse A-0120 "Reason, required" where it fits), package pause move label.
- L: Package expiring uses `{days}` and `{date}` (F10).

No key is added by this draft.

## Open questions

All 8 earlier questions are answered by D83 to D90 and removed. One related point sits in F08: D84 lets a player who is now Adult keep using Student credits for the Student items they were bought for, while CLASS-01 hides Student classes from adults (F08 Q2).
