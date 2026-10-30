# Security and PDPA launch checklist

Status: **DRAFT v1 by the Security and PDPA reviewer, 30 Oct 2026.** Branch `security/reviews`. A checklist for people to tick with evidence. Security does not tick anything on its own work; the Reviewer or the user signs each item.

Two gates, from `docs/DEVELOPMENT-PLAN.md` and `docs/ops/plan.md`:

| Gate | Date | What it unlocks |
|---|---|---|
| **Gate 1: test readiness** | Production ready by **4 Dec 2026** (freeze), test starts **7 Dec 2026** | The end-to-end test with mock bookings on **production**, Hunter in Testing status, real people as testers (D16). Staging is for development and QA only |
| **Gate 2: go live** | Go live checklist and drills by **21 Dec 2026**, public booking **29 Dec 2026**, soft launch 9 Jan 2027 | Real players, real money, receipts from 000001 |

Rules for using it:

- An item is ticked only with **evidence** (a link, a test name and run, a screenshot, a signed note). "Done" without evidence is not done.
- Gate 1 items are also Gate 2 items unless the row says otherwise.
- **Block** means the gate does not open until the item is ticked. **Should** means the gate may open with a written, dated exception from the user.
- Every item points to its source: a finding `SR-nn` (design review), a threat row (`threat-model.md`), a decision `Dnn`, or a question `Q-nn` (`open-questions.md`).

---

## Gate 1: before the 7 Dec test (ready by 4 Dec)

### 1.1 Build blockers closed

| ☐ | Item | Evidence | Level | Source |
|---|---|---|---|---|
| [ ] | All seven blocking findings SR-01 to SR-07 are fixed in the designs and their tests pass in CI | Design amended and approved; test run link | Block | design review |
| [ ] | The 16 should-fix findings are fixed or each has a dated exception signed by the user | Table in the PR with status per SR | Should | design review |
| [ ] | The questions that gate a build (Q-01, Q-02, Q-04, Q-05) are answered and written into the PRD, hand-off and feature spec | Decision log rows | Block | open questions |

### 1.2 Isolation and BOOQ blindness

| ☐ | Item | Evidence | Level | Source |
|---|---|---|---|---|
| [ ] | Row-level security meta tests RLS-M01 to M12 pass: every table has RLS enabled and forced, every club table has a tenant policy, every foreign key between tenant tables carries `club_id` | CI run | Block | QA plan, ISO-1 to ISO-5 |
| [ ] | Tenant isolation suite RLS-A01 to A20 passes against a real Postgres, with both clubs seeded and a control read for every denial | CI run | Block | ISO-1 to ISO-10 |
| [ ] | Platform-blind suite RLS-P01 to P18 passes, including the PII marker scan over every console response and log | CI run | Block | BLIND-1 to BLIND-9 |
| [ ] | `booq_platform` has no privilege on any D table and cannot select `club_secret` (checked by query against the production database, not only in CI) | Query output attached | Block | SR-06 |
| [ ] | No role used by an app has `BYPASSRLS` or superuser; `anon` and `authenticated` hold no privilege on any object | Query output attached | Block | SR-06, SR-08 |
| [ ] | The Data API, GraphQL and Realtime are switched off on the staging and production projects; a request with the anon key to the REST path fails | Screenshot of settings; request log | Block | SR-06 |
| [ ] | The anon key and service-role key are in no app environment except `apps/staff-invite`, which holds both (D148: the anon key for the staff password and TOTP checks, the service-role key for invites, resets and deactivation); `apps/platform`, `apps/web` and `apps/worker` hold neither | Environment variable listing per project, names only | Block | SR-06 |
| [ ] | Owner invites are delivered by the system and never shown to BOOQ staff; a BOOQ account cannot create a staff or coach invite | Test run; screenshot of console | Block | SR-01 |
| [ ] | Support window: BOOQ cannot write the status or window columns; 24 hour cap enforced by the database; platform writes to payment or LINE connections on a Live club notify the owner | Test run | Block | SR-02 |
| [ ] | `read_secret` has no club argument; the platform app holds no decrypt key | Test run; key listing | Block | SR-03 |
| [ ] | Every `SECURITY DEFINER` function and view is on the reviewed list, has a fixed search path and a tenant filter | `definer-functions.ts` and the CI check | Block | SR-24 |
| [ ] | Roles per request: removing a role or deactivating a person takes effect on the next request (RLS-R06) | Test run | Block | ROLE-3 |
| [ ] | The route matrix covers every route and every role; a route with no declaration fails the build (RLS-R07) | CI run | Block | ROLE-1 |

### 1.3 Accounts, keys and secrets

| ☐ | Item | Evidence | Level | Source |
|---|---|---|---|---|
| [ ] | Second factor on every account with access to production: GitHub, hosting, database provider, error tracker, email sender, password manager. Hardware key or passkey for the two or three people with owner rights | List of accounts with the factor type, names only | Block | OPS-4 |
| [ ] | The list of people with database owner access has at most two names; the `booq_owner` password is not known to a person; migrations run through CI | Access list | Block | SR-21 |
| [ ] | Each club secret is stored only as ciphertext; the master key has two named holders and an offline recovery copy; the master key is in no log, repository or chat | Test: secret scan of repository history, logs, fixtures; key custody note | Block | SEC-2, SEC-4 |
| [ ] | Secret scanning and push protection are on; the root `.gitignore` blocks `.env*` except `.env.example` | Repository settings screenshot | Block | SEC-5 |
| [ ] | **No live Beam keys are stored** in production during the test; the Testing club uses the Beam Playground set only | Query of `club_secret` kinds | Block | TEST-5, D32 |
| [ ] | Log scrubbing test: a request carrying an ID token, an authorization header, a Beam body and a phone number leaves none of them in the logs, the error tracker or CI output | Test run with markers | Block | LINE-2, SEC-4 |
| [ ] | BOOQ staff accounts are invited only; each has enrolled a second factor and stored recovery codes; the platform admin list is written down with the reset procedure (who resets whom, how identity is checked) | Team list; procedure note | Block | BAUTH-1, BAUTH-2, Q-05 |
| [ ] | BOOQ people who are LINE admins of a club's Official Account are listed; each is removed after setup unless the club asks otherwise | List per club | Should | R-13 |

### 1.4 Web layer and abuse controls

| ☐ | Item | Evidence | Level | Source |
|---|---|---|---|---|
| [ ] | Origin check and JSON-only rule on every cookie-authenticated write; security headers present on all surfaces (snapshot test) | Test run | Block | SR-11 |
| [ ] | The platform console has its own host name and cookie and an extra access gate | Configuration note | Should | SR-16, Q-18 |
| [ ] | Pay-tap values from `threat-model.md` §6 (or the values the user sets) are in `platform.config`; the Go live check that they are set exists; a test proves the limit refuses | Config rows; test run | Block | SR-09, D61 |
| [ ] | Concurrent unpaid hold hours per player is capped, or the user has recorded a decision not to cap | Config row or decision | Block | SR-09, Q-04 |
| [ ] | Rate limits and body caps from §6 are live at the edge and in the app, with a burst test and a bounded alert count | Test run | Should | SR-12 |
| [ ] | Hostile return-path test table passes; no invite or ID token appears in any URL after load or any log | Test run | Should | SR-13 |
| [ ] | CSV export writer neutralises formula cells; import limits are set | Test run | Should | SR-20 |
| [ ] | No raw HTML rendering anywhere (lint); uploads limited and re-encoded | Lint run | Should | SR-29 |

### 1.5 Test mode safety (the 7 Dec test runs on production)

| ☐ | Item | Evidence | Level | Source |
|---|---|---|---|---|
| [ ] | Every row written while the club is Testing carries `is_test`; the column cannot be updated; the registry check fails if a table has the column and is not registered | Test run | Block | TEST-1, TEST-3 |
| [ ] | `notTest()` is used by every report, daily close, receipt list and platform count; a seeded test row shows in none | Test run | Block | D33 |
| [ ] | Test receipts use the non-legal series and are visibly marked as a test (new locale key exists in both files) | Test run; sample PDF | Block | TEST-2 |
| [ ] | The purge was rehearsed on staging with realistic data: only `is_test` rows of one club removed, ledger and audit protected outside the purge, next real receipt is 000001 | Dry-run report | Block | TEST-3, SR-15 |
| [ ] | The purge fence cannot be unlocked by a plain session setting | Test run | Block | SR-15 |
| [ ] | The test clock override is absent from the production function | CI check output | Block | SR-14 |
| [ ] | The tester list is exactly the owner and named BOOQ testers; the invitations are logged; Draft and Testing clubs return 404 to everyone else | Tester list; test run | Block | TEST-7, D4 |
| [ ] | Testers have been told that they are real people using a production system, what is collected, that test data is purged at Go live, and how to ask for a copy or deletion | Briefing note sent | Block | TEST-6 |
| [ ] | LINE messages sent to testers go through the real Official Account and count toward the cap; the paid plan or the free-plan limit is known | Plan screenshot | Should | TEST-9, D32 |

### 1.6 Payments (Beam Playground)

| ☐ | Item | Evidence | Level | Source |
|---|---|---|---|---|
| [ ] | The Playground answers recorded for the facts Beam's documentation does not state: replay behaviour, amount unit in webhooks, QR expiry and payment after expiry, retry timing and timeout, whether a sandbox QR can be marked paid by a tester, whether the authenticated call returns the merchant identity, and what the webhook body carries about the payer | Written results in the F05 design | Block | R-11, BEAM-2, BEAM-10, BEAM-12, SR-17 |
| [ ] | Fake Beam scenarios pass: valid, bad signature, wrong amount, late, duplicate, replayed old callback, out of order, unknown charge, lookup failing, Beam down at create time, reformatted body (raw bytes verified) | CI run | Block | BEAM-1 to BEAM-5, BEAM-11 |
| [ ] | A bad signature changes nothing and raises one alert; a flood of bad signatures raises one alert per window and does no database work beyond a counter | Test run | Block | BEAM-5, SR-12 |
| [ ] | A validly signed callback on the inactive key set is recorded, flagged, answered 200 and changes nothing | Test run | Block | BEAM-7 |
| [ ] | No refund method exists in the gateway interface and the lint fails if one is added | Lint run | Block | CANCEL-02, D26 |
| [ ] | The wrong-amount alert reaches the owner banner; bad signature, failed key check and unreachable Beam show in P1; a failed key check reaches the owner | Test run | Block | D75 |
| [ ] | Only the order reference is sent to Beam; no name, phone or booking detail | Captured request in a test | Block | D76 |

### 1.7 LINE

| ☐ | Item | Evidence | Level | Source |
|---|---|---|---|---|
| [ ] | F02-T00 result recorded: the Login `sub` equals the Messaging API user ID for one provider (or the design is reopened) | Note in the F02 design | Block | LINE-11 |
| [ ] | A token issued for club A's channel is refused at club B; wrong audience, expired and malformed tokens are refused before any database write | Test run | Block | LINE-1 |
| [ ] | The LINE webhook verifies `x-line-signature` over the raw body and caps the body | Test run | Block | LINE-8 |
| [ ] | Return-path and `liff.state` handling pass the hostile table (SR-13) | Test run | Should | LINE-4 |
| [ ] | The device checklist (LIFF silent login, add friend prompt, Flex card, rich menu on iOS and Android) is run, with notes on any prompt that exposes data | Checklist with results | Should | QA test strategy 6.4 |

### 1.8 PDPA: consent, notice, requests

Legal statements in this section are my understanding of the PDPA and **must be confirmed by Thai counsel**; the user has already left one legal check open (D10).

| ☐ | Item | Evidence | Level | Source |
|---|---|---|---|---|
| [ ] | The consent text and the privacy notice are **final** (hand-off: "must be final before testing starts on 7 Dec"). The notice names the club as controller and BOOQ as processor, the purposes, what is collected, who sees it, retention, the rights and how to use them, and a contact | Approved text in `locales/*`; the sign-off | Block | PDPA-1, PDPA-10, Q-15 |
| [ ] | **Players under 18 (D10).** Either the legal check is done and the consent text for minors is final, **or** the 7 Dec test has adult testers only and the user records that the Student price path, which asks for a date of birth, is not offered to anyone under 18 before the check. For 29 Dec the legal check is a hard gate (see Gate 2) | Legal note, or the recorded decision | Block (for Gate 1: either branch) | PDPA-2, Q-03 |
| [ ] | The consent record stores notice version, language, time, and a hash of the exact text shown; refusing consent creates no player record | Test run | Block | SR-27 |
| [ ] | Copy and delete requests work end to end on test accounts: request stored and audited, front desk sees it, copy file delivered through a same-player link, deletion anonymises and keeps receipts and ledgers, refuses with a future booking, shows what will be lost first | Test run; screen recording | Block | PDPA-3, PDPA-4, SR-18 |
| [ ] | After a deletion, a scan for the QA PII markers finds none in audit, outbox, idempotency, import staging, sessions, invites, storage, logs | Scan report | Block | SR-04, SR-19 |
| [ ] | A data-processing agreement between the club and BOOQ (BOOQ as processor) exists and is signed; the processor agreements with the database host, hosting, error tracker and email sender are signed and stored | Signed copies in the password manager | Block | PDPA-10, PDPA-11, Q-14 |
| [ ] | A records-of-processing sheet exists for the club (controller) and for BOOQ (processor), listing purposes, data, recipients, retention, security measures | The sheet | Should | PDPA-11 |
| [ ] | A named person owns the breach procedure (runbook 9); the club contact and the 72 hour clock are written down; a tabletop run has been done | Name; tabletop notes | Block | PDPA-10, Q-14 |
| [ ] | Interim retention schedule approved (sessions, idempotency keys, staging rows, export files, logs, unclaimed imports, audit, ledgers, backups) | Approved table | Should | PDPA-5, Q-07 |
| [ ] | Staff and coach note fields carry a warning not to record health details | Screen check | Should | PDPA-8, Q-12 |
| [ ] | Cookie inventory is exactly the session cookie and the language cookie; no analytics, no tracking | Browser capture | Should | PDPA-9 |

### 1.9 Audit and ledgers

| ☐ | Item | Evidence | Level | Source |
|---|---|---|---|---|
| [ ] | `UPDATE` and `DELETE` on both ledgers and on `audit_entry` fail for every role including the owner; app roles cannot insert audit rows | Test run | Block | AUD-1 |
| [ ] | Every audited table has its trigger; a failing audit write rolls the change back | Test run | Block | AUD-3 |
| [ ] | A staff ledger movement without a note is refused by the database | Test run | Block | PLAT-04-AC3 |
| [ ] | The audit table keeps no personal values (SR-04 design); the owner's date-of-birth history works | Test run | Block | SR-04 |
| [ ] | The owner can read the audit log; front desk, accountant and coach get 404; BOOQ staff cannot read it | Test run | Block | PLAT-04-AC8, AC9 |

### 1.10 Backups, restore, monitoring, incident readiness

| ☐ | Item | Evidence | Level | Source |
|---|---|---|---|---|
| [ ] | Daily provider backup confirmed on the production project (paid plan); retention known | Dashboard screenshot | Block | PDPA-01-AC8 |
| [ ] | Nightly independent dump runs, is encrypted with a key held outside the bucket, and the bucket access list is written down (two names) | Job log; access list | Block | OPS-2 |
| [ ] | **Restore drill 1** done on production into a scratch project (30 Nov to 3 Dec): row counts, ledger balances equal ledger sums, exclusion constraints reject a duplicate court and coach slot, RLS on for every table, receipt numbers unbroken; time written down | Drill record in `docs/ops/drills/` | Block | ops plan §4 |
| [ ] | Deleted players are re-applied after a restore (deletion log exists and the step is in the runbook) | Runbook text; drill note | Should | PDPA-12 |
| [ ] | Alerts live: hold-release lag, expired holds still held, LINE token failure, Beam callback failures by kind, unknown charge, mismatch, backup missing, secret scanning hit; each links to a runbook | Alert list with test firings | Block | ops plan §5 |
| [ ] | Error tracker strips request bodies and headers; a test event with a phone number arrives scrubbed | Screenshot of the received event | Block | BLIND-5 |
| [ ] | On-call person and backup named for the test window; runbooks 1, 3, 5, 7, 8, 9 read | Names; read-receipt note | Block | ops plan §9 |
| [ ] | `CI_STRICT=true`; the security suites are required checks; third-party Actions are pinned; branch protection requires review | Repository settings; workflow file | Block | SR-23 |
| [ ] | Dependency audit run; no unreviewed high or critical finding in production dependencies | `pnpm audit` report | Should | WEB-8 |
| [ ] | Break-glass procedure written: ticket, reason, 4 hour limit, second approver, record kept outside the database, and the owner told | Procedure | Should | SR-21, Q-16 |

---

## Gate 2: before go live on 29 Dec (checked by 21 Dec)

### 2.1 Key swap and merchant identity (D32)

| ☐ | Item | Evidence | Level | Source |
|---|---|---|---|---|
| [ ] | Live Beam and LINE values are entered **in the Go live window**, not earlier, and only by the person named in the plan | Change log in P6 | Block | SR-17, TEST-5 |
| [ ] | The club owner has confirmed in the app that the live merchant is theirs, seeing the merchant name and the last four characters of each key; the live merchant id from Beam equals the confirmed one | `launch_check` row; screenshot | Block | SR-17, Q-06 |
| [ ] | Key swap smoke test passes on the live set (authenticated call, signature check on the live HMAC key); it moves no money | Check result | Block | D32, A-23 |
| [ ] | The test key set is no longer used for the club; a callback to a test URL after Go live changes nothing | Test run | Block | BEAM-7 |
| [ ] | The webhook URL registered in the club's live Beam dashboard carries the live token and the club's live HMAC key was pasted from that dashboard | Dashboard screenshot (keys hidden) | Block | BEAM-1 |
| [ ] | Whether to make one real payment is decided by the user (Q-17). If yes, it is a normal booking by the owner at the normal price, receipt number 000001 is accepted as a real sale, and no refund-to-bank is expected | Recorded decision | Block | SR-22 |

### 2.2 Go live transaction and purge

| ☐ | Item | Evidence | Level | Source |
|---|---|---|---|---|
| [ ] | Go live is refused when any `launch_check` is not `pass`, including: pay-tap values set, owner confirmed merchant, owner identity verified by a second platform admin, LINE connection test, at least one priced product, owner signed in | Test run | Block | F01 §9.3, SR-01, SR-09 |
| [ ] | A named backup of production was taken just before the purge and is kept 30 days | Backup id | Block | runbook 13 |
| [ ] | The purge removes only test rows of this club; counts are logged without personal data; tester player accounts follow the decision on the architect's open FA Q29; the tester list is cleared | Purge log | Block | TEST-3, TEST-6 |
| [ ] | After the purge: no `is_test` row remains, real setup untouched, next receipt is number 000001, test receipts used their own series | Verification queries output | Block | PLAT-07, D4 |
| [ ] | Runbook 13 now follows the design order (SR-22) and was walked through on staging | Updated runbook; walkthrough note | Block | SR-22 |

### 2.3 Players and minors

| ☐ | Item | Evidence | Level | Source |
|---|---|---|---|---|
| [ ] | **D10 closed:** counsel has said how consent works for players under 18, including the age at which a guardian is no longer needed (in Thai law the civil age of majority is 20, my understanding; the app treats 18 as adult for pricing), and the consent screen, text and storage follow it. If not done, the Student price path and the date of birth field are switched off for new players and the club knows | Counsel's written answer; or the recorded switch-off | Block | PDPA-2, Q-03 |
| [ ] | The privacy notice includes retention and that deleted data stays in backups until they age out | Final text | Block | PDPA-5, PDPA-12 |
| [ ] | Marketing-type messages (birthday, referral, promotions) have a recorded basis and a way to stop them | Decision and screen | Block | PDPA-1, Q-11 |
| [ ] | Imported balances (if the club imports): pending-claim flow works, staff confirmation audited; no balance is spendable on an unconfirmed claim | Test run | Block | SR-05 |
| [ ] | Player suspension path exists for the club (or the user accepts the gap in writing) | Screen; or note | Should | SR-28 |

### 2.4 Operations

| ☐ | Item | Evidence | Level | Source |
|---|---|---|---|---|
| [ ] | **Restore drill 2** on production from the nightly dump (and point-in-time if bought) into a scratch project; real recovery time written down | Drill record | Block | ops plan §4 |
| [ ] | Audit hash chain verifies after a restore; the nightly job writes the latest hash per club to the backup bucket | Drill note | Should | SR-21 |
| [ ] | Access review: every human with production, GitHub, hosting, LINE admin, Beam admin access listed with the reason; leavers removed; no shared logins | Signed list | Block | OPS-4, R-12 |
| [ ] | Incident readiness: runbooks 5 (Beam), 8 (secret leak) and 9 (personal data breach) rehearsed once as a tabletop with the on-call people | Notes | Should | PDPA-10 |
| [ ] | On-call named for 29 Dec onward, with hours covering the club's opening time (06:00 to 24:00) | Rota | Block | ops plan §9 |
| [ ] | A security contact is published (an address in the privacy notice and a `security.txt`), and someone watches it | Page; owner of the mailbox | Should | Q-20 |
| [ ] | An independent test of the isolation and money paths (a person who did not build them runs the IDOR list: other player's booking, receipt, wallet, QR, data copy; other club's records; role tampering; webhook forgery) | Report | Should | Q-19 |
| [ ] | Master key rotation and custody note written; second club is not onboarded before the key sits in a managed key service | Note | Should | SR-31, Q-21 |

### 2.5 The first 72 hours after opening

| ☐ | Item | Evidence | Level | Source |
|---|---|---|---|---|
| [ ] | Daily review by a named person of: Beam mismatch and unknown-charge flags, wallet and credit adjustments, role changes, platform writes, expired-unpaid hold counts per player, LINE cap state | Daily note | Should | AUD-8, ROLE-7, HOLD-1 |
| [ ] | Hold-abuse watch: any player with repeated unpaid expiries is reviewed; the suspend action is known to the front desk | Daily note | Should | HOLD-1 |
| [ ] | The pay-tap and unpaid-hours values are re-tuned from real numbers and the change is audited | Config change | Should | threat model §6 |
| [ ] | The first real receipt, first cash entry and first wallet credit are checked against the Beam dashboard and the daily close | Reconciliation note | Should | CF-08 |

---

## Go live day: order of steps

The order matches F01 §4.1 and removes the conflict in runbook 13 (SR-22). Each step names who does it and who confirms.

1. Platform admin (not the one who created the owner invite) confirms the owner's identity by another channel; the check turns `pass`.
2. The owner confirms the live merchant in the app.
3. DevOps takes the named backup and notes its id.
4. A BOOQ person enters the live Beam and LINE values (write only); P6 logs it; step-up second factor is required.
5. The key swap smoke test and the other launch checks run; all must be `pass`.
6. Platform admin or the assigned specialist runs Go live. The single transaction runs the checks, then the purge, then sets Live; any failure rolls it all back and the club stays Testing.
7. DevOps runs the verification queries (no test rows, receipt 000001 next, settings untouched) and files the output.
8. The owner opens the app as a player on the live set only if the user decided on a real booking (Q-17).
9. The on-call person starts the 72 hour watch.

## Evidence storage

Keep evidence in `docs/security/evidence/` as small text files or links, named by the item (for example `1.2-blind-suite-2026-12-02.md`). No personal data and no secrets in evidence files.
