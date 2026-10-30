# Security and PDPA: open questions for the product owner

Status: **DRAFT v1 by the Security and PDPA reviewer, 30 Oct 2026.** Branch `security/reviews`. Each question has a recommendation so it can be answered yes or no in bulk. Security does not decide a rule: an answer goes into the PRD, then the hand-off, then the feature spec (CLAUDE.md rule 5), and the decision log.

**Priority** (same idea as the QA list):

| Priority | Meaning | Needed by |
|---|---|---|
| **A** | Blocks a build task or a design approval this month | Before the task named in "Gates" starts |
| **B** | Needed before the 7 Dec test on production | Decide by 27 Nov; the freeze is 4 Dec |
| **C** | Needed before go live on 29 Dec | Decide by 14 Dec; the checks run by 21 Dec |

Questions already answered by a decision are not repeated. Statements about Thai law are my understanding and need Thai counsel.

## Summary

| Q | Pri | Topic | Gates |
|---|---|---|---|
| Q-01 | A | How the club owner is invited and verified | F01-T23, T28; F02-T10 |
| Q-02 | A | Imported players' balances: staff confirmation | F01-T31; F02-T09 |
| Q-03 | A | Players under 18: consent and the age threshold (D10) | F02-T20; consent text for 7 Dec |
| Q-04 | A | Hold abuse: Pay-tap values, unpaid hold hours cap, limit at Go live | F03-T12, T10 |
| Q-05 | A | BOOQ console second factor, reset and who can reset | F01-T17 |
| Q-06 | B | Owner confirms the live payment merchant and approves Go live | F01-T27b |
| Q-07 | B | Retention schedule | F01-T33, privacy notice |
| Q-08 | B | Data copy contents and the response deadline | F01-T33 |
| Q-09 | B | Controls on wallet and credit adjustments | F06, F11 |
| Q-10 | B | Suspending a player | F11 |
| Q-11 | B | Marketing-type LINE messages | F10, F14, consent text |
| Q-12 | B | Health details in free-text notes | F11, F12 |
| Q-13 | B | CSV import after Go live | F01-T31 |
| Q-14 | B | Breach owner and the club to BOOQ processing agreement | before 7 Dec |
| Q-15 | B | Who writes and signs off the privacy notice | before 7 Dec |
| Q-16 | B | Engineers' emergency access to production and telling the owner | before 7 Dec |
| Q-17 | C | One real payment at Go live, or none | runbook 13 |
| Q-18 | C | Extra access gate for the BOOQ console | F01-T17 |
| Q-19 | C | Independent security test before opening | before 29 Dec |
| Q-20 | C | Security contact and reports | before 29 Dec |
| Q-21 | C | Managed key service before the second club | before club 2 |

---

## Priority A

### Q-01 · How the club owner is invited and verified

- **Related:** SR-01, threat rows BLIND-2, R-02, D2, D15, F01 §5.2.
- **Question:** The owner invite link is created in P3 and "shown once" to the BOOQ person, who sends it by LINE. That person can open it with their own LINE account and become the club's owner, which gives them every player's phone and date of birth, receipts and exports. Which of these do you want?
  1. The system emails the link to the owner's email on file; BOOQ staff never see it; redemption is logged with the redeemer's name and phone; the club cannot go Live until a second platform admin confirms the owner by another channel.
  2. Keep the link shown to staff but add only logging and the second-admin confirmation.
  3. Something else.
- **Recommendation:** Option 1. It is a small design change now and an expensive one after the first club is live. It needs an owner email for every club (P2 step 1 already collects owner contact).
- **Needs:** Product owner yes or no; Architect to amend F01 §5.2 and §7.1.

### Q-02 · Imported players' balances: staff confirmation

- **Related:** SR-05, D11, D13, F01 PLAT-06-AC7.
- **Question:** D13 says imported players match on phone at first sign in, and D11 says phone is typed and not verified. Together, anyone can claim an imported person's credits and wallet by typing their number. May the imported balances stay *pending* until the front desk or owner confirms the claim at the counter (the profile still attaches silently)?
- **Recommendation:** Yes. It keeps D11 (no code check) and D13 (match on phone) and only delays the money. Unclaimed imports expire after a period you choose (see Q-07). Hunter should import only what it can confirm, since its customers are known to the staff.
- **Needs:** Product owner; Architect to add the match task and `claim_status` (F02-T09b).

### Q-03 · Players under 18: consent and the age threshold (D10)

- **Related:** D10 (skipped for now), D12, D62, AUTH-02-AC9, PDPA-2, R-05.
- **Question:** The legal check on consent for players under 18 is still open, and the consent text must be final before 7 Dec. Two sub-questions: (a) how should consent work for a minor who books a Student price (guardian consent at sign up, a guardian's name and phone, or the club collecting it on paper)? (b) My understanding is that under Thai law a person is a minor until 20 unless married, so the people who need a guardian's consent may include 18 and 19 year olds, whom the app treats as Adult for pricing and for consent. Counsel should say which age applies to PDPA consent.
- **Recommendation:** Get counsel's answer on both points this month. Interim position so nothing blocks the build and the 7 Dec test: build the consent screen as drawn; invite **adult testers only** on 7 Dec; do not offer the Student price path to anyone before the answer. If the answer is not in by 21 Dec, switch off the date of birth field and the Student items for new players at go live (the club can sell Adult items; D62 lets a minor buy those) and note it to the club.
- **Needs:** Product owner to ask counsel (this is the legal check you already left open); answer into the PRD.

### Q-04 · Hold abuse: Pay-tap values, an unpaid hold hours cap, and the limit at Go live

- **Related:** SR-09, D41, D61, BOOK-05, threat rows HOLD-1 to HOLD-4, R-06.
- **Question:** D61 gives the Pay-tap limit to Security. Proposed values: **5** new holds per **600** seconds per player; staff **20** in the same window; **3** charges per hold. Separately, because D41 puts no limit on hours per selection and `max_future_court_hours` is empty until the owner sets it, one player can hold every hour of both courts for the whole window. Do you approve (1) those values, (2) a new platform setting `max_unpaid_hold_hours` per player with a proposed value of **4**, and (3) that Go live is refused until the owner has either set `max_future_court_hours` or explicitly chosen "no limit"?
- **Recommendation:** Approve all three. They are platform settings, not code, and can be retuned from real numbers in the first week. If you do not want (2), then (3) must at least be a required choice.
- **Needs:** Product owner; Architect to add the keys and the check to F03 and F01 §9.3.

### Q-05 · BOOQ console second factor, reset, and who can reset

- **Related:** SR-16, D3, F01 A-10, F01 Q-C, threat rows BAUTH-1, BAUTH-2.
- **Question:** F01 assumes an authenticator app and that another platform admin resets a lost factor. Confirm the method and the fallback. BOOQ is small and may have one admin; then nobody can reset.
- **Recommendation:** Authenticator app for everyone, **a passkey or hardware key for platform admins**, never SMS or email codes. Reset needs a second admin and an out-of-band check; with one admin, the user performs the reset using a written procedure and the event is logged. Name a second admin before the 7 Dec test. Lockout after 5 failed codes; sessions 30 minutes idle, 8 hours absolute; a fresh code for dangerous actions (pause, Go live, payment or LINE connection and secrets, exports, staff accounts).
- **Needs:** Product owner; the names of the platform admins.

---

## Priority B

### Q-06 · The owner confirms the live payment merchant and approves Go live

- **Related:** SR-17, D32, BEAM-8, R-03.
- **Question:** The key swap check (D32) proves only that the keys work, not that the merchant is the club's. May the **club owner** confirm in the app, before Go live, that the live merchant shown (name and last four characters of the keys) is theirs, and may Go live also need the owner's approval, not only BOOQ's?
- **Recommendation:** Yes to both. It is one extra tick for the owner and removes the "money lands in the wrong account" risk.
- **Needs:** Product owner; Architect to add a launch check.

### Q-07 · Retention schedule

- **Related:** PDPA-5, F01 Q13 (open), F01 A-21, IMP-9, privacy notice.
- **Question:** Nothing is deleted by time today. Please approve a schedule or give your own. Proposal: pending sign-ups 30 minutes (as designed); idempotency keys 7 days (as designed); logs 30 days (as DevOps proposes); import staging rows 24 hours after confirm or cancel; export and data copy files 24 hours; unclaimed imported players 90 days after the import; **receipts and ledgers kept for the accounting retention period** (I believe five years for accounting records in Thailand; the club's accountant must confirm), with the player identity removed on a deletion request; audit entries kept for the same period (personal values already erased by deletion, SR-04); inactive players (no booking for 24 months) offered anonymisation by the club; provider backups 7 days and nightly dumps 30 days as DevOps plans, stated in the privacy notice.
- **Recommendation:** Approve the proposal as the interim schedule and have the accountant and counsel confirm the accounting period.
- **Needs:** Product owner; the Hunter accountant; counsel.

### Q-08 · Data copy contents and the response deadline

- **Related:** SR-18, PDPA-01-AC3, F01 A-17, F01 Q21, PDPA-3.
- **Question:** (a) Does the copy a player requests include staff notes about them? F01 A-17 says no. My understanding is that the right of access covers personal data the club holds about the person, which includes such notes. (b) What response time do you want to promise? My understanding is 30 days from the request.
- **Recommendation:** Include staff notes unless counsel advises an exception, and tell the player what was withheld and why. Store a due date on every request (30 days), remind the owner at day 20, and show overdue requests in the admin. A full club export may still exclude slips and staff notes (Q18 in F01) because it is for the controller, not the player.
- **Needs:** Product owner; counsel for (a).

### Q-09 · Controls on wallet and credit adjustments

- **Related:** CF-01, CF-02, ROLE-7, AUD-8, R-09.
- **Question:** Front desk can adjust wallets and credits with a note, and credit a wrong-amount payment. Nothing limits the amount or tells the owner. Do you want (1) an amount above which only the owner may adjust, (2) a weekly digest to the owner listing every adjustment, cash entry, no-show reversal, role change and BOOQ change, and (3) that a wrong-amount credit can only be created from the recorded Beam event, for exactly the amount received?
- **Recommendation:** Yes to (2) and (3) now; (1) with a limit the owner sets (an empty setting means no limit, as other TBD values do).
- **Needs:** Product owner; owner of Hunter for the limit.

### Q-10 · Suspending a player

- **Related:** SR-28, HOLD-9, ROLE-8.
- **Question:** The club has no way to stop an abusive or fraudulent player. May the front desk or owner suspend a player with a reason: no new holds or purchases, existing bookings stay, reversible, audited?
- **Recommendation:** Yes, owner and front desk. Put it in A6 (customer profile).
- **Needs:** Product owner; F11 design.

### Q-11 · Marketing-type LINE messages

- **Related:** PDPA-1, SR-27, LINE-05 (birthday discount, referral reward), C17 notification switches.
- **Question:** Birthday and referral messages are promotional. Are they covered by the consent text at sign in, or does the player choose them separately (the notification switches in C17)? Is there a way to stop them?
- **Recommendation:** Keep service messages (confirmation, reminders, cancellations, waitlist, package expiry) under the booking purpose. Make birthday, referral and any promotion a separate, default-on-with-clear-notice or default-off choice in C17, as counsel advises, and honour a switch-off at once.
- **Needs:** Product owner; counsel; writers for the text.

### Q-12 · Health details in free-text notes

- **Related:** PDPA-8, SR-27, staff notes, coach session notes (K5).
- **Question:** Staff notes and coach session notes are free text and may record injuries. Health data is a sensitive category (my understanding) that needs explicit consent. Do you want a warning on the fields and a rule that notes are not for health details?
- **Recommendation:** Yes: a short warning under each note field (new keys for the writers) and a line in the staff guide. No technical filter.
- **Needs:** Product owner; writers.

### Q-13 · CSV import after Go live

- **Related:** SR-20, D13, IMP-3.
- **Question:** The balance part of an import creates value the club owes. Should it be allowed only while the club is Draft or Testing, or after Go live only with a BOOQ platform admin's approval?
- **Recommendation:** Players and packages any time by the owner; **balances only before Go live**, or with a platform admin's approval afterwards (logged).
- **Needs:** Product owner.

### Q-14 · Breach owner and the club to BOOQ processing agreement

- **Related:** PDPA-10, PDPA-11, F01 Q23, runbook 9.
- **Question:** (a) Who owns the breach procedure at BOOQ and who is the club's contact? As I understand it the club, as controller, must tell the regulator within 72 hours where there is a risk, and BOOQ must tell the club without delay. (b) Is there a written processing agreement between each club and BOOQ? None is in the plans. Processor agreements with the database host, hosting, error tracker and email sender are in `accounts.md`.
- **Recommendation:** Name the breach owner and a deputy before 7 Dec. Draft a short processing agreement for Hunter with counsel (purposes, instructions, security measures, sub-processors, breach notice, return or deletion at exit). Run one tabletop of runbook 9.
- **Needs:** Product owner; counsel.

### Q-15 · Who writes and signs off the privacy notice

- **Related:** PDPA-01-AC12, AUTH-02-AC8, hand-off "final before 7 Dec".
- **Question:** The notice and consent text must be final before 7 Dec. Who drafts it (writers with counsel), who signs it for the club, and what contact point does it name?
- **Recommendation:** Security supplies a content list (controller and processor, purposes, data collected, who sees it, retention from Q-07, rights and how to use them, contact, what happens on deletion including backups), the writers draft in Thai and English, counsel reviews, the Hunter owner signs.
- **Needs:** Product owner; counsel; Hunter's owner.

### Q-16 · Engineers' emergency access to production and telling the owner

- **Related:** SR-21, BLIND-6, plan §6.
- **Question:** Engineers with database access can see every club's players. The plan allows this only through a break-glass procedure. When it is used, do you want the club owner told (with the reason), and a limit of two people with standing access?
- **Recommendation:** Yes to both. Ticket, reason, 4 hour limit, a second person approves, record kept outside the database, owner told within a day. This also supports the statement that BOOQ staff do not see club data.
- **Needs:** Product owner; DevOps.

---

## Priority C

### Q-17 · One real payment at Go live, or none

- **Related:** SR-22, D32, A-23, CANCEL-02, PAY-05.
- **Question:** Runbook 13 sends a real small payment after the purge. The F01 design uses a no-money check. A real payment would be receipt 000001, real money the club must account for, and it can never go back as cash. Do you want a real proof payment at all?
- **Recommendation:** No separate test payment. Rely on the no-money check and the Playground tests. If you want a live proof, the Hunter owner makes one ordinary booking at the normal price after opening, and 000001 is a genuine sale.
- **Needs:** Product owner.

### Q-18 · Extra access gate for the BOOQ console

- **Related:** SR-16, BAUTH-4.
- **Question:** The console is reachable from anywhere with email and a second factor. Should it also sit behind an access proxy or an IP allow-list while BOOQ has only a few staff?
- **Recommendation:** Yes: its own host name plus an access proxy or the hosting provider's deployment protection, removed only when the team outgrows it.
- **Needs:** Product owner; DevOps.

### Q-19 · Independent security test before opening

- **Related:** launch checklist 2.4.
- **Question:** Do you want a person who did not build the system to attack the isolation and money paths before 29 Dec (a two-day test against staging with a fixed list), or a paid external test?
- **Recommendation:** A scoped test by someone outside the build team using the checklist in the design review. An external paid test can wait until the second club.
- **Needs:** Product owner; budget if external.

### Q-20 · Security contact and reports

- **Related:** launch checklist 2.4.
- **Question:** Where should a person report a security problem, and who reads it?
- **Recommendation:** A dedicated mailbox named in the privacy notice and a `security.txt`, read by the on-call person.
- **Needs:** Product owner.

### Q-21 · Managed key service before the second club

- **Related:** SR-31, SEC-2, R-07.
- **Question:** The master key for club secrets sits in the hosting environment. Acceptable for Hunter with two named holders; do you agree it must move to a managed key service before the second club is set up?
- **Recommendation:** Yes, and rotate the key once a year in the meantime.
- **Needs:** Product owner; DevOps.
