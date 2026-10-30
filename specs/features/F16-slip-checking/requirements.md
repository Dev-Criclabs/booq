# F16 Slip checking option and backup mode · Requirements (stub)

Status: **STUB. NOT FOR THE HUNTER LAUNCH.** Drafted 30 Oct 2026. Hunter pays by Beam (F05). This file holds the scope, the headline criteria and the open questions for clubs that choose PromptPay with slip checking, so nothing about it is lost. It is not scheduled, it is not approved, and no design or code follows until a person schedules it (Plan wave "Not for Hunter launch").

Feature: F16 Slip checking option and backup mode. Depends on: F04. Requirement ID: PAY-08 (HO: "Slip checking option (F16, other clubs): slip upload, automatic check, popup with Chat with us on LINE, backup mode with 60 minute holds and A4. Not needed for Hunter's launch").

## Sources

PRD: Payments, cancellation, credits and wallet (Checkout and payment, slip rules, "A4 Backup slip check is used only while automatic checking is down or turned off"); Quality and scope (Backup mode); Payment checking and LINE message costs (Option B, slip checking API; providers Thunder, EasySlip, SlipOK; Hunter launches on Option A); Customer app pages C11, C11b; Admin A4. HO: PAY-01, PAY-08, Screen inventory (A4, slip clubs only). Decisions: D53 (A4 waits for F16), D52 (F16 sets the 60 minute backup hold), D32, D34. Gaps: A2 (slip screens shown as Hunter's path are canvas errors), C6 (slip provider not chosen).

## Scope (what F16 will cover when scheduled)

- A club picks PromptPay with slip checking in P2 step 5 (PAY-01); Beam is the other option.
- C11 with slip upload: the player pays the club's own PromptPay QR and uploads the transfer slip; a small Checking overlay shows while it is checked (C11b).
- Automatic slip check through a slip checking API: amount, receiving account, transfer time after the booking was created, and that the slip is unused. Only a verified slip confirms a booking.
- A slip that does not match: nothing is booked and a popup on C11 gives the reason and offers Upload a new slip and Chat with us on LINE; the club admin checks it in the LINE OA chat and the front desk books it (A2) or adds the value to the wallet (A6). There is no everyday slip review queue (removed).
- Backup mode: when automatic checking is down or the owner turns Automatic slip checking off in Settings (A16), holds extend to 60 minutes (D52), C11 tells the player the club is checking by hand, and A4 Backup slip check appears in the admin menu only while this lasts; staff tick amount, receiving account, transfer time and that the money arrived before Approve unlocks; every decision is logged; when checking is back, holds return to the club's normal hold time.
- A slip that arrives after the hold ends is approved if the slot is still open; otherwise the value goes to the wallet (PAY-03 logic, D25).
- The LINE message Slip needs re upload (PRD message table), sent when the automatic check says the slip does not match.

## Headline criteria (to be expanded at gate 1 when scheduled)

- PAY-08-AC1. Given a club on slip checking, when a player pays, then C11 shows the slip screen, and a Beam club never shows it (PAY-01).
- PAY-08-AC2. Given an uploaded slip, when the automatic check passes (amount, receiving account, transfer time after booking creation, slip unused), then the booking is confirmed with its receipt and LINE card; when it fails, nothing is booked.
- PAY-08-AC3. Given the checker is down or off, when the club is in backup mode, then holds are 60 minutes and A4 is available to front desk and owner only until checking returns.
- PAY-08-AC4. Given a slip is stored, when anyone other than the club's staff asks for it, then the server refuses; slips are staff only and BOOQ staff never see them (PDPA-01, PLAT-02).
- PAY-08-AC5. Given any slip route or A4 on a Beam club, when it is requested, then it answers 404.

Every criterion follows the same cross-cutting rules as F05: club ID scope, server side checks, PDPA, no double booking (a slip never reserves a slot; the hold does), Thai and English text from keys, Asia/Bangkok times, integer satang.

## Open questions

1. **Slip checking provider (Gaps C6).** Thunder, EasySlip or SlipOK? Recommended default (D147): decide only when the first club picks this option; price sheets are in the PRD cost section; EasySlip and Thunder both state account, amount and duplicate checks.
2. **Slip storage and retention.** How long are slip images kept? Parked by the user (retention periods); not decided here.
3. **Who owns the provider account.** The club pays its own checking fees directly (PRD Running costs); is the API key stored per club (assumed, as for Beam keys, write only, D27, D34)?
4. **Test mode for slip clubs.** The canvas P4 board lists fake slip tests (Gaps A2). Recommended default (D147): they run for slip clubs only, with fake slips in Testing and never in Hunter's checklist.
